'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (arg) => ipcRenderer.invoke(channel, arg);

// main から届く知らせを購読する。戻り値の関数で購読をやめる
const listen = (channel) => (callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

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
    onChange: listen('vault:changed'),
  },
  agents: {
    list: invoke('agents:list'),
    launch: invoke('agents:launch'),
    install: invoke('agents:install'),
    configure: invoke('agents:configure'),
    services: invoke('agents:services'),
  },
  jobs: {
    list: invoke('jobs:list'),
    submit: invoke('jobs:submit'),
    cancel: invoke('jobs:cancel'),
    retry: invoke('jobs:retry'),
    complete: invoke('jobs:complete'),
    output: invoke('jobs:output'),
    onUpdate: listen('jobs:update'),
    onGroup: listen('groups:update'),
  },
  command: {
    plan: invoke('command:plan'),
    run: invoke('command:run'),
  },
  quota: {
    list: invoke('quota:list'),
    set: invoke('quota:set'),
    onUpdate: listen('quota:update'),
  },
  git: {
    overview: invoke('git:overview'),
    merge: invoke('git:merge'),
  },
  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set'),
    chooseWorkspace: invoke('settings:chooseWorkspace'),
  },
  workspace: {
    open: invoke('workspace:open'),
  },
  talk: {
    ask: invoke('talk:ask'),
    voicevox: invoke('talk:voicevox'),
    synthesize: invoke('talk:synthesize'),
    getSettings: invoke('talk:getSettings'),
    setSettings: invoke('talk:setSettings'),
  },
  speech: {
    models: invoke('speech:models'),
    download: invoke('speech:download'),
    remove: invoke('speech:remove'),
    onProgress: listen('speech:progress'),
  },
  openExternal: invoke('open-external'),
});
