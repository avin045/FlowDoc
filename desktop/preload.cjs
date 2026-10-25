// Bridge between the workspace UI (extension/app.html running in the desktop
// shell) and the main process. Exposed as window.flowdocDesktop.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('flowdocDesktop', {
  platform: process.platform,
  sessionType: process.env.XDG_SESSION_TYPE || '',
  // 'system' | 'light' | 'dark' — keeps native window chrome in step with the UI.
  setTheme: (mode) => ipcRenderer.send('theme:set', mode),
  kv: {
    get: (key) => ipcRenderer.invoke('kv:get', key),
    set: (key, value) => ipcRenderer.invoke('kv:set', key, value),
    remove: (key) => ipcRenderer.invoke('kv:remove', key),
  },
  onStoreChange: on('kv:changed'),
  recorder: {
    start: (opts) => ipcRenderer.invoke('recorder:start', opts),
    stop: () => ipcRenderer.invoke('recorder:stop'),
    discard: () => ipcRenderer.invoke('recorder:discard'),
    pause: () => ipcRenderer.invoke('recorder:pause'),
    resume: () => ipcRenderer.invoke('recorder:resume'),
    state: () => ipcRenderer.invoke('recorder:state'),
    onState: on('recorder:state'),
    onFinished: on('recorder:finished'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
    setKey: (provider, key) => ipcRenderer.invoke('settings:setKey', provider, key),
  },
  notion: {
    me: () => ipcRenderer.invoke('notion:me'),
    pages: (query) => ipcRenderer.invoke('notion:pages', query),
    children: (pageId) => ipcRenderer.invoke('notion:children', pageId),
    path: (pageId) => ipcRenderer.invoke('notion:path', pageId),
    setSaved: (list) => ipcRenderer.invoke('notion:setSaved', list),
    // req: { parentId, location: {id,title,path,crumbs}, title, model, replacePageId }
    save: (req) => ipcRenderer.invoke('notion:save', req),
    onProgress: on('notion:progress'),
  },
  ai: {
    complete: (req) => ipcRenderer.invoke('ai:complete', req),
    listModels: (provider) => ipcRenderer.invoke('ai:listModels', provider),
  },
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
});
