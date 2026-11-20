const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('goldMt5', Object.freeze({
  state: () => ipcRenderer.invoke('mt5:state'),
  chooseTerminal: () => ipcRenderer.invoke('mt5:choose-terminal'),
  connect: input => ipcRenderer.invoke('mt5:connect', input),
  disconnect: () => ipcRenderer.invoke('mt5:disconnect'),
  installIndicator: () => ipcRenderer.invoke('mt5:install-indicator'),
  bridge: () => ipcRenderer.invoke('mt5:bridge')
}));
