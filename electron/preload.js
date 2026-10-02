'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oz', {
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    setPassword: (password) => ipcRenderer.invoke('auth:set', password),
    verify: (password) => ipcRenderer.invoke('auth:verify', password),
  },
});
