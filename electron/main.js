'use strict';

const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const config = require('./config');
const auth = require('./auth');
const system = require('./services/system');
const { createNews } = require('./services/news');
const { createGithub } = require('./services/github');
const { createVault } = require('./services/vault');

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

  // ページ内のリンクはアプリの中では開かず、既定のブラウザに渡す
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://`)) {
      event.preventDefault();
      openExternal(url);
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(`${SCHEME}://oz/src/index.html`);
}

// 外部で開いてよいのは Web ページと Obsidian だけ
function openExternal(url) {
  try {
    const { protocol: scheme } = new URL(url);
    if (scheme === 'https:' || scheme === 'http:' || scheme === 'obsidian:') {
      shell.openExternal(url);
      return true;
    }
  } catch {
    // 不正なURLは開かない
  }
  return false;
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

// エラーは { error } として画面に返し、画面側でそのまま表示できるようにする
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      return { error: err?.message ?? String(err) };
    }
  });
}

function registerIpc() {
  const userData = app.getPath('userData');
  const news = createNews({ fetch: net.fetch });
  const github = createGithub({
    fetch: net.fetch,
    dataDir: userData,
    getToken: () => config.get('github')?.token ?? null,
  });
  const vault = createVault({
    getConfig: () => config.get('vault'),
    setConfig: (value) => config.set('vault', value),
  });
  const watchVault = () => vault.watch(() => broadcast('vault:changed'));
  watchVault();

  handle('auth:status', () => auth.status());
  handle('auth:set', (password) => auth.setPassword(password));
  handle('auth:verify', (password) => auth.verify(password));

  handle('system:snapshot', () => system.snapshot());

  handle('news:list', (options) => news.list({ force: Boolean(options?.force) }));
  handle('news:save', (item) => vault.saveNews(item));

  handle('github:trending', (options) =>
    github.trending({ since: options?.since, language: options?.language, force: Boolean(options?.force) }),
  );
  handle('github:top', (options) => github.top({ scope: options?.scope, force: Boolean(options?.force) }));
  handle('github:growth', (options) => github.growth({ windowHours: options?.windowHours }));

  handle('vault:info', () => vault.info());
  handle('vault:graph', () => vault.graph());
  handle('vault:add', (note) => vault.addNote(note));
  handle('vault:open', (rel) => ({ ok: openExternal(vault.obsidianUrl(rel)) }));
  handle('vault:choose', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, {
      title: 'Obsidian の保管庫を選ぶ',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return vault.info();
    const info = vault.choose(result.filePaths[0]);
    watchVault();
    return info;
  });

  handle('open-external', (url) => ({ ok: openExternal(String(url)) }));
}

app.whenReady().then(() => {
  config.init(app.getPath('userData'));
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
