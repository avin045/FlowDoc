const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flowdocCapture', {
  onGrab: (cb) => ipcRenderer.on('capture:grab', (_e, req) => cb(req)),
  sendFrame: (id, frame) => ipcRenderer.send(`capture:frame:${id}`, frame),
});
