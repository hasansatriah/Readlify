const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // persistence
  loadData: () => ipcRenderer.invoke('data:load'),
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

  // native OS notifications (pengingat jam belajar & deadline)
  showNotification: (payload) => ipcRenderer.send('notify:show', payload),
  onNotificationClicked: (cb) => ipcRenderer.on('notify:clicked', (_e, goto) => cb(goto)),
});
