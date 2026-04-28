const { app, BrowserWindow, ipcMain, dialog, shell, net } = require('electron');
const path    = require('path');
const fs      = require('fs');
const https   = require('https');
const os      = require('os');
const { spawn, exec } = require('child_process');

app.commandLine.appendSwitch('enable-experimental-web-platform-features');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Kostudio Audio Cue',
    backgroundColor: '#0d0d0d',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();
  setTimeout(() => checkForUpdates(), 4000);
});

app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── Auto-update ───────────────────────────────────────────

async function checkForUpdates() {
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
  const platform  = process.platform;
  const arch      = process.arch;
  const assets    = releaseData.assets || [];

  // Pick the right asset
  let asset;
  if (platform === 'win32') {
    asset = assets.find(a => a.name.endsWith('.exe'));
  } else if (platform === 'darwin') {
    // Prefer arm64 on Apple Silicon, fall back to x64
    asset = assets.find(a => a.name.includes('arm64') && a.name.endsWith('.dmg'))
         || assets.find(a => a.name.endsWith('.dmg'));
  }

  if (!asset) {
    win.webContents.send('update-error', { message: 'No compatible download found for your platform.' });
    return;
  }

  // Destination paths
  const tmpDir  = os.tmpdir();
  const destPath = path.join(tmpDir, asset.name);

  win.webContents.send('update-download-progress', { percent: 0, label: `Downloading ${releaseData.tag_name}…` });

  try {
    await downloadFile(asset.browser_download_url, destPath, (downloaded, total) => {
      const percent = total ? Math.round(downloaded / total * 100) : -1;
      win.webContents.send('update-download-progress', { percent, label: `Downloading update… ${percent}%` });
    });
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

function installWindows(newExePath, win) {
  if (!app.isPackaged) {
    // Dev mode — just show done
    win.webContents.send('update-ready', {
      platform: 'win32-dev',
      message: '(Dev mode) Update downloaded — would restart in production.'
    });
    return;
  }

  const currentExe = process.execPath;
  const batPath    = path.join(os.tmpdir(), 'kostudio-updater.bat');

  // Batch script: wait for app to exit, replace exe, relaunch
  const bat = `@echo off
chcp 65001 >nul
timeout /t 3 /nobreak >nul
:retry
copy /y "${newExePath}" "${currentExe}" >nul 2>&1
if errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto retry
)
start "" "${currentExe}"
del "${newExePath}" >nul 2>&1
del "%~f0" >nul 2>&1
`;

  fs.writeFileSync(batPath, bat, 'utf8');

  win.webContents.send('update-ready', {
    platform: 'win32',
    message: 'Update ready — the app will restart now to apply it.'
  });

  // Give the renderer a moment to show the message, then quit
  setTimeout(() => {
    spawn('cmd.exe', ['/c', batPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    app.quit();
  }, 2500);
}

function installMac(dmgPath, win) {
  // Copy DMG to ~/Downloads so it survives after tmp is cleaned
  const downloadsDir = path.join(os.homedir(), 'Downloads');
  const destDmg      = path.join(downloadsDir, path.basename(dmgPath));
  try { fs.copyFileSync(dmgPath, destDmg); } catch {}

  // Work out where the running .app lives so we replace it in-place.
  // process.execPath = /some/path/Kostudio Audio Cue.app/Contents/MacOS/Kostudio Audio Cue
  // Three dirname() calls up = the .app bundle itself.
  const appName   = 'Kostudio Audio Cue.app';
  const volName   = 'Kostudio Audio Cue';
  const mountedApp = `/Volumes/${volName}/${appName}`;

  let targetApp = `/Applications/${appName}`;            // safe default
  if (app.isPackaged) {
    const bundle = path.dirname(path.dirname(path.dirname(process.execPath)));
    if (bundle.endsWith('.app')) targetApp = bundle;     // use actual location
  }

  const fallback = () => {
    exec(`hdiutil detach "/Volumes/${volName}" -quiet 2>/dev/null || true`);
    shell.openPath(destDmg);
    win.webContents.send('update-ready', {
      platform: 'darwin-manual',
      message: 'Could not auto-install. DMG opened — drag Kostudio Audio Cue to Applications to complete the update.'
    });
  };

  // Step 1: mount the DMG
  exec(`hdiutil attach "${destDmg}" -nobrowse -quiet`, (mountErr) => {
    if (mountErr) { fallback(); return; }

    // Step 2: strip quarantine, delete old bundle, copy new one to exact path
    const installCmd = [
      `xattr -r -d com.apple.quarantine "${mountedApp}" 2>/dev/null || true`,
      `rm -rf "${targetApp}"`,
      `cp -R "${mountedApp}" "${targetApp}"`,
    ].join(' && ');

    exec(installCmd, (cpErr) => {
      // Always detach — fire and forget
      exec(`hdiutil detach "/Volumes/${volName}" -quiet 2>/dev/null || true`);

      if (cpErr) {
        shell.openPath(destDmg);
        win.webContents.send('update-ready', {
          platform: 'darwin-manual',
          message: `Auto-install failed (${cpErr.message}). DMG opened — drag Kostudio Audio Cue to Applications to complete the update.`
        });
      } else {
        win.webContents.send('update-ready', {
          platform: 'darwin-auto',
          message: `Update installed to ${path.dirname(targetApp)}.\nClose the app and reopen it from there to use the new version.`
        });
      }
    });
  });
}

// ── Download helper (streams with redirect following) ─────

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const follow = (currentUrl, hops = 0) => {
      if (hops > 10) { reject(new Error('Too many redirects')); return; }
      const u = new URL(currentUrl);
      const options = {
        hostname: u.hostname,
        path:     u.pathname + u.search,
        headers:  { 'User-Agent': 'KostudioAudioCue' },
      };
      https.get(options, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          follow(res.headers.location, hops + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        const file = fs.createWriteStream(destPath);
        res.on('data', chunk => { downloaded += chunk.length; onProgress?.(downloaded, total); });
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
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

ipcMain.handle('fs-read-file', async (_, filePath) => {
  const buf = fs.readFileSync(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

ipcMain.handle('fs-file-exists', async (_, filePath) => {
  return fs.existsSync(filePath);
});

ipcMain.handle('fs-write-text', async (_, filePath, content) => {
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
});

ipcMain.handle('fs-read-text', async (_, filePath) => {
  return fs.readFileSync(filePath, 'utf8');
});

ipcMain.handle('path-join', async (_, ...parts) => {
  return path.join(...parts);
});

// ── IPC: Dialogs ──────────────────────────────────────────

ipcMain.handle('dialog-save', async (_, defaultPath) => {
  const result = await dialog.showSaveDialog({
    defaultPath,
    filters: [
      { name: 'Cue Project', extensions: ['cuepro'] },
      { name: 'All Files',   extensions: ['*'] }
    ]
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('dialog-open-file', async () => {
  const result = await dialog.showOpenDialog({
    filters: [
      { name: 'Cue Project', extensions: ['cuepro'] },
      { name: 'All Files',   extensions: ['*'] }
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
