const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron:           true,
  // Electron 32 removed File.path; this is the supported way to learn where a picked / dropped file lives on disk
  // (it is what lets a saved project point at the original audio file). Returns '' for files that aren't on disk.
  getPathForFile:       (file)          => { try { return webUtils?.getPathForFile ? webUtils.getPathForFile(file) : (file?.path || ''); } catch { return ''; } },
  readFile:             (path)          => ipcRenderer.invoke('fs-read-file', path),
  fileExists:           (path)          => ipcRenderer.invoke('fs-file-exists', path),
  writeTextFile:        (path, content) => ipcRenderer.invoke('fs-write-text', path, content),
  readTextFile:         (path)          => ipcRenderer.invoke('fs-read-text', path),
  showSaveDialog:       (defaultPath)   => ipcRenderer.invoke('dialog-save', defaultPath),
  showOpenFileDialog:   ()              => ipcRenderer.invoke('dialog-open-file'),
  showOpenAudioDialog:  ()              => ipcRenderer.invoke('dialog-open-audio'),
  showOpenFolderDialog: ()              => ipcRenderer.invoke('dialog-open-folder'),
  joinPath:             (...parts)      => ipcRenderer.invoke('path-join', ...parts),
  openDonate:           ()              => ipcRenderer.invoke('open-donate'),
  exportShow:           (payload)       => ipcRenderer.invoke('export-show', payload),

  // The show's state, so the main process never interrupts it or loses work: unsaved changes → ask before closing;
  // playing / locked → no update dialog in front of it
  setDirty:             (dirty)         => ipcRenderer.send('show-dirty', dirty === true),
  setBusy:              (busy)          => ipcRenderer.send('show-busy', busy === true),
  onSaveBeforeClose:    (cb)            => ipcRenderer.on('save-before-close', () => cb()),
  saveBeforeCloseDone:  (ok)            => ipcRenderer.send('save-before-close-done', ok === true),

  // Settings kept by the main process (update check) + "check now"
  getAppSettings:       ()              => ipcRenderer.invoke('app-get-settings'),
  setAppSettings:       (s)             => ipcRenderer.invoke('app-set-settings', s),
  checkForUpdatesNow:   ()              => ipcRenderer.invoke('update-check-now'),

  // Opt-in remote control (Stream Deck / phone remote): settings, state for the remote, and commands coming back
  remote: {
    getConfig:  ()    => ipcRenderer.invoke('remote-get-config'),
    setConfig:  (cfg) => ipcRenderer.invoke('remote-set-config', cfg),
    regenToken: ()    => ipcRenderer.invoke('remote-regen-token'),
    sendState:  (st)  => ipcRenderer.send('remote-state', st),
    onCommand:  (cb)  => ipcRenderer.on('remote-command', (_, cmd) => cb(cmd)),
  },

  // Update events (main → renderer)
  onUpdateProgress: (cb) => ipcRenderer.on('update-download-progress', (_, data) => cb(data)),
  onUpdateReady:    (cb) => ipcRenderer.on('update-ready',             (_, data) => cb(data)),
  onUpdateError:    (cb) => ipcRenderer.on('update-error',             (_, data) => cb(data)),
});
