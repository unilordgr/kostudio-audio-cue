const { app, BrowserWindow, ipcMain, dialog, shell, net } = require('electron');
const path    = require('path');
const fs      = require('fs');
const https   = require('https');
const os      = require('os');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');

const execFileP = promisify(execFile);

app.commandLine.appendSwitch('enable-experimental-web-platform-features');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Kostudio Audio Cue',
    icon: path.join(__dirname, 'build', 'icons', '256x256.png'),
    backgroundColor: '#0d0d0d',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // OUT-point enforcement, loop regions and auto-advance run on a
      // requestAnimationFrame loop — never let it stall when minimised.
      backgroundThrottling: false,
    },
  });

  // The renderer is a single local page: never let it open windows or navigate away.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', e => e.preventDefault());

  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();
  setTimeout(() => checkForUpdates(), 4000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── Auto-update ───────────────────────────────────────────

async function checkForUpdates() {
  // Only Windows (.exe) and macOS (.dmg) builds are published.
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  try {
    const res = await net.fetch(
      'https://api.github.com/repos/unilordgr/kostudio-audio-cue/releases/latest',
      { headers: { 'User-Agent': 'KostudioAudioCue-UpdateCheck' } }
    );
    if (!res.ok) return;
    const data = await res.json();

    const latestTag = data.tag_name || '';
    const latestVer = latestTag.replace(/^v/, '');
    const currentVer = app.getVersion();

    if (!latestVer || !isNewerVersion(latestVer, currentVer)) return;

    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update Available',
      message: `Kostudio Audio Cue ${latestTag} is available`,
      detail: `You are running version ${currentVer}.\n\nThe update will download in the background — you can keep working.`,
      buttons: ['Download Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) {
      downloadAndInstall(data, win);
    }
  } catch (e) {
    console.log('Update check skipped:', e.message);
  }
}

async function downloadAndInstall(releaseData, win) {
  const platform = process.platform;
  const arch     = process.arch;
  const assets   = releaseData.assets || [];

  // Pick the right asset. Never fall back to a different CPU architecture on
  // macOS: the install step replaces the running app, so a wrong-arch DMG
  // would leave the user with an app that cannot start.
  let asset;
  if (platform === 'win32') {
    asset = assets.find(a => a.name.includes('x64') && a.name.endsWith('.exe'))
         || assets.find(a => a.name.endsWith('.exe'));
  } else if (platform === 'darwin') {
    asset = assets.find(a => a.name.includes(arch) && a.name.endsWith('.dmg'));
  }

  if (!asset || !/^https:\/\/github\.com\//.test(asset.browser_download_url || '')) {
    win.webContents.send('update-error', { message: 'No compatible download found for your platform.' });
    return;
  }

  // Destination path — basename() guards against a crafted asset name.
  const destPath = path.join(os.tmpdir(), path.basename(asset.name));

  win.webContents.send('update-download-progress', { percent: 0, label: `Downloading ${releaseData.tag_name}…` });

  try {
    await downloadFile(asset.browser_download_url, destPath, (downloaded, total) => {
      const percent = total ? Math.round(downloaded / total * 100) : -1;
      win.webContents.send('update-download-progress', { percent, label: `Downloading update… ${percent}%` });
    }, asset.size);
  } catch (e) {
    win.webContents.send('update-error', { message: 'Download failed: ' + e.message });
    return;
  }

  if (platform === 'win32') {
    installWindows(destPath, win);
  } else if (platform === 'darwin') {
    installMac(destPath, win);
  }
}

async function installWindows(newExePath, win) {
  if (!app.isPackaged) {
    // Dev mode — just show done
    win.webContents.send('update-ready', {
      platform: 'win32-dev',
      message: '(Dev mode) Update downloaded — would restart in production.'
    });
    return;
  }

  // The portable build runs from an extracted temp dir, so process.execPath is
  // NOT the .exe the user launched. electron-builder exposes the real path here.
  const currentExe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const batPath    = path.join(os.tmpdir(), 'kostudio-updater.bat');

  // Batch script:
  //  - waits up to 30 s for the app process to release the lock
  //  - copies the new exe over the old one
  //  - relaunches (only when RELAUNCH=1) — including on failure, so the user
  //    is never left with a closed app
  //  - cleans up both the downloaded exe and the bat itself
  // Paths are passed as environment variables, never written into the script,
  // so non-ASCII usernames and %, &, ^ in paths cannot break or inject into it.
  const bat = `@echo off
set RETRIES=0
:retry
copy /y "%NEW_EXE%" "%CUR_EXE%" >nul 2>&1
if errorlevel 1 (
  set /a RETRIES+=1
  if %RETRIES% GEQ 30 goto fail
  timeout /t 1 /nobreak >nul
  goto retry
)
if "%RELAUNCH%"=="1" start "" "%CUR_EXE%"
del "%NEW_EXE%" >nul 2>&1
del "%~f0" >nul 2>&1
exit /b 0
:fail
if "%RELAUNCH%"=="1" start "" "%CUR_EXE%"
del "%NEW_EXE%" >nul 2>&1
del "%~f0" >nul 2>&1
exit /b 1
`;

  try {
    fs.writeFileSync(batPath, bat, 'ascii');
  } catch (e) {
    win.webContents.send('update-error', { message: 'Could not prepare the updater: ' + e.message });
    return;
  }

  const launchUpdater = (relaunch) => {
    spawn('cmd.exe', ['/c', batPath], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, NEW_EXE: newExePath, CUR_EXE: currentExe, RELAUNCH: relaunch ? '1' : '0' },
    }).unref();
  };

  // Never force-quit: the operator may be mid-show with unsaved work.
  const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    title: 'Update Ready',
    message: 'The update has been downloaded',
    detail: 'Restart now to apply it, or choose Later — it will be applied automatically the next time you close the app.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 1,
    cancelId: 1,
  });

  if (response === 0) {
    win.webContents.send('update-ready', { platform: 'win32', message: 'Restarting to apply the update…' });
    // Let the renderer paint the message; the bat's retry loop covers any
    // extra time the process needs to fully exit.
    setTimeout(() => { launchUpdater(true); app.quit(); }, 1500);
  } else {
    win.webContents.send('update-ready', { platform: 'win32', message: 'Update downloaded — it will be applied when you close the app.' });
    app.once('will-quit', () => launchUpdater(false));
  }
}

async function installMac(dmgPath, win) {
  // Copy DMG to ~/Downloads so it survives after tmp is cleaned
  const downloadsDir = path.join(os.homedir(), 'Downloads');
  const destDmg      = path.join(downloadsDir, path.basename(dmgPath));
  try { fs.copyFileSync(dmgPath, destDmg); } catch {}

  // Work out where the running .app lives so we replace it in-place.
  // process.execPath = /some/path/Kostudio Audio Cue.app/Contents/MacOS/Kostudio Audio Cue
  // Three dirname() calls up = the .app bundle itself.
  const appName = 'Kostudio Audio Cue.app';

  let targetApp = `/Applications/${appName}`;            // safe default
  if (app.isPackaged) {
    const bundle = path.dirname(path.dirname(path.dirname(process.execPath)));
    if (bundle.endsWith('.app')) targetApp = bundle;     // use actual location
  }

  // No shell is involved anywhere below: every command gets an argument array,
  // so quotes / $() / backticks in a path cannot be interpreted.
  let mountPoint = null;
  const detach = () => (mountPoint
    ? execFileP('hdiutil', ['detach', mountPoint, '-quiet']).catch(() => {})
    : Promise.resolve());

  const manual = (message) => {
    shell.openPath(destDmg);
    win.webContents.send('update-ready', { platform: 'darwin-manual', message });
  };

  try {
    // Step 1: mount the DMG and read the *actual* mount point — a stale mount
    // from an earlier update would otherwise make it land at "… 1" and we'd
    // reinstall the old app.
    let stdout;
    try {
      ({ stdout } = await execFileP('hdiutil', ['attach', destDmg, '-nobrowse', '-plist']));
    } catch {
      manual('Could not auto-install. DMG opened — drag Kostudio Audio Cue to Applications to complete the update.');
      return;
    }
    const m = /<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/.exec(stdout);
    if (!m) throw new Error('could not find the mounted volume');
    mountPoint = m[1].replace(/&amp;/g, '&');

    const mountedApp = path.join(mountPoint, appName);
    if (!fs.existsSync(mountedApp)) throw new Error(`${appName} not found in the DMG`);

    // Step 2: copy to a staging path first, then swap — a failed copy must
    // never leave the user without an app.
    const staging = `${targetApp}.update`;
    fs.rmSync(staging, { recursive: true, force: true });
    await execFileP('ditto', [mountedApp, staging]);
    await execFileP('xattr', ['-cr', staging]).catch(() => {});   // strip quarantine
    fs.rmSync(targetApp, { recursive: true, force: true });
    fs.renameSync(staging, targetApp);

    win.webContents.send('update-ready', {
      platform: 'darwin-auto',
      message: `Update installed to ${path.dirname(targetApp)}.\nClose the app and reopen it from there to use the new version.`
    });
  } catch (cpErr) {
    manual(`Auto-install failed (${cpErr.message}). DMG opened — drag Kostudio Audio Cue to Applications to complete the update.`);
  } finally {
    await detach();
  }
}

// ── Download helper (streams with redirect following) ─────

function downloadFile(url, destPath, onProgress, expectedSize) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { fs.rmSync(destPath, { force: true }); } catch {}   // never leave a partial file behind
      reject(err);
    };

    const follow = (currentUrl, hops = 0) => {
      if (hops > 10) { fail(new Error('Too many redirects')); return; }
      let u;
      try { u = new URL(currentUrl); } catch (e) { fail(e); return; }
      if (u.protocol !== 'https:') { fail(new Error('Refusing non-HTTPS download')); return; }

      const req = https.get(u, { headers: { 'User-Agent': 'KostudioAudioCue' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          let next;
          try { next = new URL(res.headers.location, u).href; } catch (e) { fail(e); return; }
          follow(next, hops + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          fail(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        const file = fs.createWriteStream(destPath);
        res.on('data', chunk => { downloaded += chunk.length; onProgress?.(downloaded, total); });
        res.on('error', err => { file.destroy(); fail(err); });
        res.on('close', () => {
          if (!res.complete) { file.destroy(); fail(new Error('Connection closed before the download finished')); }
        });
        file.on('error', fail);
        file.on('finish', () => {
          file.close(() => {
            // A truncated installer must never be copied over the app.
            const want = expectedSize || total;
            if (want && downloaded !== want) {
              fail(new Error(`Incomplete download (${downloaded} of ${want} bytes)`));
              return;
            }
            settled = true;
            resolve();
          });
        });
        res.pipe(file);
      });
      req.setTimeout(30000, () => req.destroy(new Error('Download timed out')));
      req.on('error', fail);
    };
    follow(url);
  });
}

// ── Version compare ───────────────────────────────────────

function isNewerVersion(latest, current) {
  const parse = v => String(v).split('.').map(n => parseInt(n, 10) || 0);
  const [lMaj, lMin, lPat] = parse(latest);
  const [cMaj, cMin, cPat] = parse(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

// ── IPC: File system ──────────────────────────────────────
//
// The renderer loads user-supplied project files, so treat it as untrusted:
//  • reads are limited to audio files and .cuepro projects
//  • writes are limited to .cuepro paths the user picked in a native dialog

const AUDIO_EXT = /\.(wav|mp3|ogg|oga|flac|aac|m4a|m4b|aif|aiff|aifc|opus|webm|mp4|mka|caf)$/i;
const approvedProjectPaths = new Set();   // absolute paths returned by the save/open dialogs

function resolvePath(p) {
  if (typeof p !== 'string' || !p) throw new Error('Invalid path');
  return path.resolve(p);
}
const isProjectFile = p => path.extname(p).toLowerCase() === '.cuepro';
const isAudioFile   = p => AUDIO_EXT.test(p);

ipcMain.handle('fs-read-file', async (_, filePath) => {
  const p = resolvePath(filePath);
  if (!isAudioFile(p)) throw new Error('Only audio files can be read');
  const buf = await fs.promises.readFile(p);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

ipcMain.handle('fs-file-exists', async (_, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return false;
  const p = path.resolve(filePath);
  if (!isAudioFile(p)) return false;
  try { await fs.promises.access(p); return true; } catch { return false; }
});

ipcMain.handle('fs-write-text', async (_, filePath, content) => {
  const p = resolvePath(filePath);
  if (!isProjectFile(p) || !approvedProjectPaths.has(p)) throw new Error('Write not permitted — use Save As to choose a location');
  if (typeof content !== 'string') throw new Error('Invalid content');
  // Write to a temp file then rename, so a crash mid-save can't truncate the show file.
  const tmp = `${p}.tmp`;
  await fs.promises.writeFile(tmp, content, 'utf8');
  await fs.promises.rename(tmp, p);
  return true;
});

ipcMain.handle('fs-read-text', async (_, filePath) => {
  const p = resolvePath(filePath);
  if (!isProjectFile(p)) throw new Error('Only .cuepro project files can be read');
  return fs.promises.readFile(p, 'utf8');
});

ipcMain.handle('path-join', async (_, ...parts) => {
  if (!parts.every(x => typeof x === 'string')) throw new Error('Invalid path');
  return path.join(...parts);
});

// ── IPC: Dialogs ──────────────────────────────────────────

ipcMain.handle('dialog-save', async (_, defaultPath) => {
  const result = await dialog.showSaveDialog({
    defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined,
    filters: [
      { name: 'Cue Project', extensions: ['cuepro'] },
      { name: 'All Files',   extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePath) return null;
  let filePath = result.filePath;
  if (!isProjectFile(filePath)) filePath += '.cuepro';
  approvedProjectPaths.add(path.resolve(filePath));
  return filePath;
});

ipcMain.handle('dialog-open-file', async () => {
  const result = await dialog.showOpenDialog({
    filters: [
      { name: 'Cue Project', extensions: ['cuepro'] },
      { name: 'All Files',   extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (result.canceled) return null;
  const filePath = result.filePaths[0];
  if (isProjectFile(filePath)) approvedProjectPaths.add(path.resolve(filePath));   // "Save" may overwrite what was opened
  return filePath;
});

ipcMain.handle('dialog-open-audio', async () => {
  const result = await dialog.showOpenDialog({
    filters: [
      { name: 'Audio',     extensions: ['wav', 'mp3', 'ogg', 'oga', 'flac', 'aac', 'm4a', 'aif', 'aiff', 'opus', 'webm'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog-open-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});
