const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flowdocCapture', {
  onGrab: (cb) => ipcRenderer.on('capture:grab', (_e, req) => cb(req)),
  onPatch: (cb) => ipcRenderer.on('capture:patch', (_e, req) => cb(req)),
  sendHeld: (id) => ipcRenderer.send(`capture:held:${id}`),
  sendFrame: (id, frame) => ipcRenderer.send(`capture:frame:${id}`, frame),
  onDiff: (cb) => ipcRenderer.on('capture:diff', (_e, req) => cb(req)),
  sendDiff: (id, differ) => ipcRenderer.send(`capture:diff:${id}`, differ),
  onRedact: (cb) => ipcRenderer.on('capture:redact', (_e, req) => cb(req)),
  sendRedacted: (id, dataUrl) => ipcRenderer.send(`capture:redacted:${id}`, dataUrl),
});
