const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron:           true,
  readFile:             (path)          => ipcRenderer.invoke('fs-read-file', path),
  fileExists:           (path)          => ipcRenderer.invoke('fs-file-exists', path),
  writeTextFile:        (path, content) => ipcRenderer.invoke('fs-write-text', path, content),
  readTextFile:         (path)          => ipcRenderer.invoke('fs-read-text', path),
  showSaveDialog:       (defaultPath)   => ipcRenderer.invoke('dialog-save', defaultPath),
  showOpenFileDialog:   ()              => ipcRenderer.invoke('dialog-open-file'),
  showOpenFolderDialog: ()              => ipcRenderer.invoke('dialog-open-folder'),
  joinPath:             (...parts)      => ipcRenderer.invoke('path-join', ...parts),

  // Update events (main → renderer)
  onUpdateProgress: (cb) => ipcRenderer.on('update-download-progress', (_, data) => cb(data)),
  onUpdateReady:    (cb) => ipcRenderer.on('update-ready',             (_, data) => cb(data)),
  onUpdateError:    (cb) => ipcRenderer.on('update-error',             (_, data) => cb(data)),

  // Stream Deck integration
  sendPadState:      (data) => ipcRenderer.send('pad-state-broadcast', data),
  onApiCommand:      (cb)   => ipcRenderer.on('api-command',      (_, data) => cb(data)),
  onApiRequestState: (cb)   => ipcRenderer.on('api-request-state', ()      => cb()),
});
