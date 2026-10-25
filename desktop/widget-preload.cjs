const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recorderBar', {
  state: () => ipcRenderer.invoke('recorder:state'),
  pause: () => ipcRenderer.invoke('recorder:pause'),
  resume: () => ipcRenderer.invoke('recorder:resume'),
  stop: () => ipcRenderer.invoke('recorder:stop'),
  discard: () => ipcRenderer.invoke('recorder:discard'),
  onState: (cb) => ipcRenderer.on('recorder:state', (_e, s) => cb(s)),
});
