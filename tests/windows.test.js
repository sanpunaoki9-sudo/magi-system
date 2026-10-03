'use strict';

// Windows でだけ動くところのテスト（GitHub Actions の Windows で実行する）。
// - PATH に無い CLI を、npm の置き場所・agy の置き場所・VS Code 拡張の同梱から見つける
// - npm で入れた .cmd に、依頼文を標準入力で渡す（依頼文の記号がコマンドとして動かない）
// - .exe には依頼文を引数で渡す（引用符や記号がそのまま届く）
// - ユーザー名に空白があるときのパス
// 本物の .exe は作れないので、node.exe をコピーして CLI の代わりにする（--version が動き、-p で式を実行する）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WIN = process.platform === 'win32';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 60000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await fn()) return;
    await wait(100);
  }
  throw new Error('時間内に終わりませんでした');
}

test('Windows: CLI をいつもの場所と拡張機能の同梱から見つけ、.cmd と .exe で依頼を実行する', { skip: !WIN, timeout: 180000 }, async () => {
  // ユーザー名に空白があるホーム
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oz-win-')), 'OZ Test User');
  const home = path.join(root, 'home');
  const appData = path.join(home, 'AppData', 'Roaming');
  const localAppData = path.join(home, 'AppData', 'Local');

  // Codex: npm で入れたもの（.cmd）。依頼文は標準入力から読む
  fs.mkdirSync(path.join(appData, 'npm'), { recursive: true });
  fs.writeFileSync(path.join(appData, 'npm', 'codex.cmd'), [
    '@echo off',
    'if "%~1"=="--version" (echo codex-cli 0.0.0-fake& exit /b 0)',
    'more > prompt.txt',
    'echo export const api = 1;> api.js',
    'echo done',
    '',
  ].join('\r\n'));

  // Claude Code: VS Code 拡張に同梱の本体
  const native = path.join(home, '.vscode', 'extensions', 'anthropic.claude-code-9.9.9-win32-x64', 'resources', 'native-binary');
  fs.mkdirSync(native, { recursive: true });
  fs.copyFileSync(process.execPath, path.join(native, 'claude.exe'));

  // Antigravity CLI: 公式インストーラの置き場所
  const agyDir = path.join(localAppData, 'agy', 'bin');
  fs.mkdirSync(agyDir, { recursive: true });
  fs.copyFileSync(process.execPath, path.join(agyDir, 'agy.exe'));

  const saved = { USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA };
  Object.assign(process.env, { USERPROFILE: home, APPDATA: appData, LOCALAPPDATA: localAppData });
  const modPath = require.resolve('../electron/services/agents');
  delete require.cache[modPath];

  try {
    const { createAgents } = require('../electron/services/agents');
    const { createGit } = require('../electron/services/git');
    const { createQuota } = require('../electron/services/quota');
    const { createRunner } = require('../electron/services/runner');

    const agents = createAgents({ openExternal: () => true });
    const found = Object.fromEntries((await agents.detect({ force: true })).agents.map((a) => [a.id, a]));

    assert.equal(found['claude-code'].cli.path, path.join(native, 'claude.exe'));
    assert.equal(found['claude-code'].cli.source, 'VS Code 拡張に同梱');
    assert.match(found['claude-code'].version, /^v\d+/);

    assert.equal(found.codex.cli.path, path.join(appData, 'npm', 'codex.cmd'));
    assert.equal(found.codex.version, 'codex-cli 0.0.0-fake');

    assert.equal(found.antigravity.cli.path, path.join(agyDir, 'agy.exe'));
    assert.equal(found.antigravity.headless, true);
    // node の --help には agy の旗が無いので、旗は付けない
    assert.deepEqual(found.antigravity.taskFlags, []);

    // 呼び出し方: .cmd はシェル経由（パスを引用符で囲む）、.exe は直接
    const ws = path.join(root, 'work space');
    const codexInv = await agents.invocation('codex', { mode: 'task', prompt: 'x', cwd: ws });
    assert.equal(codexInv.shell, true);
    assert.equal(codexInv.command, `"${path.join(appData, 'npm', 'codex.cmd')}"`);
    assert.ok(Object.keys(codexInv.env).filter((k) => /^path$/i.test(k)).length === 1);
    assert.match(codexInv.env.Path, /system32/i);

    // 実行: 依頼文に記号があってもコマンドとして動かない（標準入力で渡すため）
    const git = createGit({ getConfig: () => ({ workspace: ws, gitUserName: 'OZ Test', gitUserEmail: 'oz@example.com' }) });
    const runner = createRunner({ agents, git, quota: createQuota(), vault: { ensureHub() {}, addNote() {}, appendNote() {} }, dataDir: path.join(root, 'data') });
    runner.startLoop();

    const job = runner.submit({ agentId: 'codex', prompt: 'API を作る & echo HACKED > hacked.txt | "quoted" %PATH%' });
    await until(() => ['done', 'failed'].includes(runner.get(job.id).status));
    const codexDone = runner.get(job.id);
    assert.equal(codexDone.status, 'done', codexDone.error ?? '');
    const codexWt = git.worktreePath('codex');
    assert.ok(fs.existsSync(path.join(codexWt, 'api.js')));
    assert.ok(!fs.existsSync(path.join(codexWt, 'hacked.txt')));
    assert.match(fs.readFileSync(path.join(codexWt, 'prompt.txt'), 'utf8'), /echo HACKED/);

    // .exe には引数で渡す。引用符や & がそのまま届けば、node -p が式として実行してファイルを書く
    const agyJob = runner.submit({ agentId: 'antigravity', prompt: 'require("fs").writeFileSync("index.html", "<h1>OZ & \\"quotes\\"</h1>")' });
    await until(() => ['done', 'failed', 'handed-off'].includes(runner.get(agyJob.id).status));
    const agyDone = runner.get(agyJob.id);
    assert.equal(agyDone.status, 'done', agyDone.error ?? '');
    assert.equal(fs.readFileSync(path.join(git.worktreePath('antigravity'), 'index.html'), 'utf8'), '<h1>OZ & "quotes"</h1>');
    assert.ok(agyDone.commit.files.some((f) => f.file === 'index.html'));

    runner.stopAll();
  } finally {
    Object.assign(process.env, saved);
    delete require.cache[modPath];
  }
});
