'use strict';

const { app, BrowserWindow, ipcMain, net, protocol } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const auth = require('./auth');

const APP_ROOT = path.join(__dirname, '..');
const SCHEME = 'app';

// app:// を正規のオリジンとして扱い、ES Modules と fetch をそのまま使えるようにする
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function registerAppProtocol() {
  protocol.handle(SCHEME, (request) => {
    const { pathname } = new URL(request.url);
    const filePath = path.normalize(path.join(APP_ROOT, decodeURIComponent(pathname)));
    if (!filePath.startsWith(APP_ROOT + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#fafafa',
    autoHideMenuBar: true,
    show: false,
    title: 'OZ Assistant',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(`${SCHEME}://oz/src/index.html`);
}

function registerIpc() {
  ipcMain.handle('auth:status', () => auth.status());
  ipcMain.handle('auth:set', (_e, password) => auth.setPassword(password));
  ipcMain.handle('auth:verify', (_e, password) => auth.verify(password));
}

app.whenReady().then(() => {
  auth.init(app.getPath('userData'));
  registerAppProtocol();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
