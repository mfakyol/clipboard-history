const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const handler = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('clip', {
  getHistory: () => ipcRenderer.invoke('history:get'),
  paste: (id, opts) => ipcRenderer.invoke('history:paste', id, opts),
  togglePin: (id) => ipcRenderer.invoke('history:pin', id),
  remove: (id) => ipcRenderer.invoke('history:remove', id),
  clear: () => ipcRenderer.invoke('history:clear'),
  hide: () => ipcRenderer.send('palette:hide'),
  onHistory: (cb) => on('history:changed', cb),
  onShow: (cb) => on('palette:show', cb),
  startSearch: () => ipcRenderer.send('palette:search'),
  onPasteSelected: (cb) => on('palette:paste-selected', cb),
  onSearchMode: (cb) => on('palette:search-mode', cb),
});
