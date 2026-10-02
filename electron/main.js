'use strict';

const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, net, protocol, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const config = require('./config');
const auth = require('./auth');
const system = require('./services/system');
const { createNews } = require('./services/news');
const { createGithub } = require('./services/github');
const { createVault } = require('./services/vault');
const { registerDevIpc } = require('./ipc-dev');
const { createSpeechModels } = require('./services/speech-models');

const APP_ROOT = path.join(__dirname, '..');
const SCHEME = 'app';
let speechModels = null;
let mainWindow = null;
let tray = null;
let quitting = false;
const ICON = path.join(APP_ROOT, 'src', 'assets', 'icon-256.png');
const TRAY_ICON = path.join(APP_ROOT, 'src', 'assets', 'tray.png');

// SharedArrayBuffer（音声認識を複数スレッドで動かすのに必要）を使えるようにする見出し
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

async function withIsolation(responsePromise) {
  const res = await responsePromise;
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(ISOLATION_HEADERS)) headers.set(key, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// app:// を正規のオリジンとして扱い、ES Modules と fetch をそのまま使えるようにする
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function registerAppProtocol() {
  protocol.handle(SCHEME, (request) => {
    const { pathname } = new URL(request.url);
    // 音声認識のモデルは userData に保存しているので、そこから返す
    if (pathname.startsWith('/models/')) {
      const modelFile = speechModels?.resolve(pathname.slice('/models/'.length));
      if (!modelFile) return new Response('Not found', { status: 404 });
      return withIsolation(net.fetch(pathToFileURL(modelFile).toString()));
    }
    const filePath = path.normalize(path.join(APP_ROOT, decodeURIComponent(pathname)));
    if (!filePath.startsWith(APP_ROOT + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    return withIsolation(net.fetch(pathToFileURL(filePath).toString()));
  });
}

// 閉じてもバックグラウンドで動かすか（利用枠の回復後の自動再開や、作業中の依頼を止めないため）
const keepInBackground = () => config.get('app')?.background !== false;

function showWindow() {
  if (!mainWindow) {
    createWindow({ show: true });
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(TRAY_ICON));
  tray.setToolTip('OZ Assistant');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'OZ Assistant を開く', click: showWindow },
    { type: 'separator' },
    { label: '終了', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

function createWindow({ show = true } = {}) {
  const win = new BrowserWindow({
    icon: ICON,
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

  // 閉じるボタンでは終了せず、タスクトレイに隠れる（終了はトレイのメニューから）
  win.on('close', (event) => {
    if (quitting || !keepInBackground()) return;
    event.preventDefault();
    win.hide();
  });
  win.on('closed', () => {
    mainWindow = null;
  });

  mainWindow = win;
  if (show) win.once('ready-to-show', () => win.show());
  win.loadURL(`${SCHEME}://oz/src/index.html`);
}

// 外部で開いてよいのは Web ページと Obsidian だけ
function openExternal(url) {
  try {
    const { protocol: scheme } = new URL(url);
    if (scheme === 'https:' || scheme === 'http:' || scheme === 'obsidian:' || url.startsWith('vscode://file/')) {
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
  let dev = null;
  const news = createNews({ fetch: net.fetch });
  const github = createGithub({
    fetch: net.fetch,
    dataDir: userData,
    getToken: () => dev?.getGithubToken() ?? config.get('github')?.token ?? null,
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

  dev = registerDevIpc({ handle, broadcast, openExternal, vault, news, speechModels, fetch: net.fetch });
}

// マイクは話しかけモードのために、このアプリの画面にだけ許可する
function registerPermissions() {
  const allowed = new Set(['media', 'speaker-selection']);
  const fromApp = (url) => String(url ?? '').startsWith(`${SCHEME}://oz/`);
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(allowed.has(permission) && fromApp(details.requestingUrl ?? wc.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => allowed.has(permission) && fromApp(`${origin}/`));
}

// 2つ目を起動したら、先に動いている方の画面を出す（依頼が二重に動かないように）
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
}

app.on('before-quit', () => {
  quitting = true;
});

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.oz.assistant');
  config.init(app.getPath('userData'));
  speechModels = createSpeechModels({
    fetch: net.fetch,
    dataDir: app.getPath('userData'),
    onProgress: (p) => broadcast('speech:progress', p),
  });
  registerPermissions();
  registerAppProtocol();
  registerIpc();
  createTray();
  // Windows の起動時に開いたとき（--hidden）は、トレイにだけ置く
  createWindow({ show: !process.argv.includes('--hidden') });

  app.on('activate', showWindow);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
