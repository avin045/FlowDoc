const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recorderBar', {
  state: () => ipcRenderer.invoke('recorder:state'),
  pause: () => ipcRenderer.invoke('recorder:pause'),
  resume: () => ipcRenderer.invoke('recorder:resume'),
  stop: () => ipcRenderer.invoke('recorder:stop'),
  discard: () => ipcRenderer.invoke('recorder:discard'),
  apps: (keep) => ipcRenderer.invoke('recorder:apps', keep),
  setApps: (apps) => ipcRenderer.invoke('recorder:setApps', apps),
  includeApp: (app) => ipcRenderer.invoke('recorder:includeApp', app),
  dismissStray: (key) => ipcRenderer.invoke('recorder:dismissStray', key),
  reselectArea: () => ipcRenderer.invoke('recorder:reselectArea'),
  fit: (size) => ipcRenderer.send('recorder:fit', size),
  onState: (cb) => ipcRenderer.on('recorder:state', (_e, s) => cb(s)),
  onStray: (cb) => ipcRenderer.on('recorder:stray', (_e, app) => cb(app)),
});
