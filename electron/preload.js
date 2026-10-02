'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (arg) => ipcRenderer.invoke(channel, arg);

contextBridge.exposeInMainWorld('oz', {
  auth: {
    status: invoke('auth:status'),
    setPassword: invoke('auth:set'),
    verify: invoke('auth:verify'),
  },
  system: {
    snapshot: invoke('system:snapshot'),
  },
  news: {
    list: invoke('news:list'),
    save: invoke('news:save'),
  },
  github: {
    trending: invoke('github:trending'),
    top: invoke('github:top'),
    growth: invoke('github:growth'),
  },
  vault: {
    info: invoke('vault:info'),
    graph: invoke('vault:graph'),
    add: invoke('vault:add'),
    open: invoke('vault:open'),
    choose: invoke('vault:choose'),
    onChange(callback) {
      const listener = () => callback();
      ipcRenderer.on('vault:changed', listener);
      return () => ipcRenderer.removeListener('vault:changed', listener);
    },
  },
  openExternal: invoke('open-external'),
});
