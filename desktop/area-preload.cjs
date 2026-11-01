const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('areaPicker', {
  onInit: (cb) => ipcRenderer.on('area:init', (_e, data) => cb(data)),
  onClear: (cb) => ipcRenderer.on('area:clear', () => cb()),
  began: () => ipcRenderer.send('area:began'),
  done: (rect) => ipcRenderer.send('area:done', rect),
  cancel: () => ipcRenderer.send('area:cancel'),
});
