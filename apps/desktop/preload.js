const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vpnClient', {
  start(payload) {
    return ipcRenderer.invoke('vpn-client:start', payload);
  },
  stop() {
    return ipcRenderer.invoke('vpn-client:stop');
  },
  getStatus() {
    return ipcRenderer.invoke('vpn-client:get-status');
  },
  copyText(text) {
    return ipcRenderer.invoke('vpn-client:copy-text', text);
  },
  readText() {
    return ipcRenderer.invoke('vpn-client:read-text');
  },
  onStatusChange(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('vpn-client:status', listener);
    return () => ipcRenderer.removeListener('vpn-client:status', listener);
  },
  onLog(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('vpn-client:log', listener);
    return () => ipcRenderer.removeListener('vpn-client:log', listener);
  },
});
