const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wobb', {
  start(payload) {
    return ipcRenderer.invoke('wobb:start', payload);
  },
  stop() {
    return ipcRenderer.invoke('wobb:stop');
  },
  getStatus() {
    return ipcRenderer.invoke('wobb:get-status');
  },
  onStatusChange(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('wobb:status', listener);
    return () => ipcRenderer.removeListener('wobb:status', listener);
  },
  onLog(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('wobb:log', listener);
    return () => ipcRenderer.removeListener('wobb:log', listener);
  },
});
