const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // persistence
  loadData: () => ipcRenderer.invoke('data:load'),
  getVersion: () => ipcRenderer.invoke('app:version'),

  // Mode Fokus layar penuh
  setFullScreen: (on) => ipcRenderer.invoke('window:set-fullscreen', on),
  onFullScreenChange: (cb) => ipcRenderer.on('window:fullscreen-changed', (_e, v) => cb(v)),

  // EdPDF: PDF yang dibuka dari luar (Explorer / "Buka dengan"), cetak, & pengaturan default
  edpdfReady: () => ipcRenderer.send('edpdf:ready'),
  onOpenPdfFiles: (cb) => ipcRenderer.on('edpdf:open-files', (_e, files) => cb(files)),
  printPage: (opts) => ipcRenderer.invoke('edpdf:print', opts),
  openDefaultAppsSettings: () => ipcRenderer.invoke('app:open-default-apps'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),

  // mini pomodoro widget window
  openMiniTimer: () => ipcRenderer.send('mini-timer:open'),
  closeMiniTimer: () => ipcRenderer.send('mini-timer:close'),
  onMiniTimerClosed: (cb) => ipcRenderer.on('mini-timer-closed', cb),

  // cross-window timer sync
  sendTimerState: (state) => ipcRenderer.send('timer:state', state),
  onTimerState: (cb) => ipcRenderer.on('timer:state', (_e, state) => cb(state)),
  sendTimerControl: (action) => ipcRenderer.send('timer:control', action),
  onTimerControl: (cb) => ipcRenderer.on('timer:control', (_e, action) => cb(action)),

  // Focus Mode "reminder medsos" — soft in-app reminder only, no OS-level access
  blockSites: (domains) => ipcRenderer.invoke('focus:block', domains),
  unblockSites: () => ipcRenderer.invoke('focus:unblock'),

  // "Balik fokus" nudge — only looks at this app's own window focus, never
  // at other programs.
  setFocusGuard: (active) => ipcRenderer.send('focus-guard:set', active),
  returnToApp: () => ipcRenderer.send('focus-guard:return'),
});
