const { app, BrowserWindow, ipcMain, dialog, shell, net } = require('electron');
const path = require('path');
const fs   = require('fs');

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
  // Check for updates a few seconds after launch so the UI is ready first
  setTimeout(() => checkForUpdates(), 4000);
});

app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── Auto-update check ─────────────────────────────────────

async function checkForUpdates() {
  try {
    const res = await net.fetch(
      'https://api.github.com/repos/unilordgr/kostudio-audio-cue/releases/latest',
      { headers: { 'User-Agent': 'KostudioAudioCue-UpdateCheck' } }
    );
    if (!res.ok) return;
    const data = await res.json();

    const latestTag = data.tag_name || '';          // e.g. "v1.2.0"
    const latestVer = latestTag.replace(/^v/, '');  // "1.2.0"
    const currentVer = app.getVersion();            // from package.json

    if (!latestVer || !isNewerVersion(latestVer, currentVer)) return;

    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update Available',
      message: `Kostudio Audio Cue ${latestTag} is available`,
      detail: `You are running version ${currentVer}.\n\nWould you like to go to the download page?`,
      buttons: ['Download Update', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) {
      shell.openExternal(data.html_url);
    }
  } catch (e) {
    // Silently ignore — no internet, rate limit, etc.
    console.log('Update check skipped:', e.message);
  }
}

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
