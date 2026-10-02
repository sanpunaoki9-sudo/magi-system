'use strict';

// AIエージェント（Claude Code / Codex / Antigravity）の定義・インストール確認・起動。
// CLI に渡す引数はすべて固定にし、依頼の文面は標準入力で渡す（コマンドラインに利用者の文字列を入れない）。
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IS_WIN = process.platform === 'win32';

const AGENTS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    vendor: 'Anthropic',
    kind: 'cli',
    command: 'claude',
    // -p: 1回だけ実行して終わる / 依頼文は標準入力 / ファイル編集は自動で許可
    headlessArgs: ['-p', '--output-format', 'text', '--permission-mode', 'acceptEdits'],
    interactiveArgs: [],
    npmPackage: '@anthropic-ai/claude-code',
    vscodeExtension: 'anthropic.claude-code',
    statusPage: 'https://status.anthropic.com/api/v2/status.json',
    strengths: '設計・レビュー・テスト・複雑な変更',
  },
  {
    id: 'codex',
    name: 'Codex',
    vendor: 'OpenAI',
    kind: 'cli',
    command: 'codex',
    // exec: 1回だけ実行 / --full-auto: 作業フォルダ内の編集を自動で許可 / '-': 依頼文は標準入力
    headlessArgs: ['exec', '--full-auto', '-'],
    interactiveArgs: [],
    npmPackage: '@openai/codex',
    vscodeExtension: 'openai.chatgpt',
    statusPage: 'https://status.openai.com/api/v2/status.json',
    strengths: '処理の実装・API・スクリプト',
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    vendor: 'Google',
    kind: 'app',
    command: 'antigravity',
    appPaths: IS_WIN
      ? [path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Antigravity', 'Antigravity.exe')]
      : process.platform === 'darwin'
        ? ['/Applications/Antigravity.app/Contents/MacOS/Electron']
        : ['/usr/share/antigravity/antigravity', '/opt/Antigravity/antigravity'],
    downloadUrl: 'https://antigravity.google/download',
    statusPage: null,
    strengths: '画面・UI・ブラウザでの確認',
  },
];

const byId = (id) => AGENTS.find((a) => a.id === id);

function which(command) {
  return new Promise((resolve) => {
    execFile(IS_WIN ? 'where' : 'which', [command], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      if (err) return resolve(null);
      const first = String(stdout).split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      resolve(first ?? null);
    });
  });
}

// 固定の引数でコマンドを実行する（Windows の .cmd を動かすため shell を使うが、利用者の文字列は渡さない）
function runFixed(command, args, { cwd, timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: IS_WIN, windowsHide: true });
    // 入力を待つコマンドで止まらないように、標準入力はすぐ閉じる
    child.stdin.on('error', () => {});
    child.stdin.end();
    let out = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, output: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output: out.trim() });
    });
  });
}

function vscodeExe() {
  const candidates = IS_WIN
    ? [
        path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
        path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe'),
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code']
      : ['/usr/bin/code', '/usr/share/code/bin/code', '/snap/bin/code'];
  return candidates.find((p) => p && fs.existsSync(p)) ?? null;
}

function createAgents({ openExternal }) {
  let toolCache = null;

  // インストール状況。重いので1分だけ覚えておく
  async function detect({ force = false } = {}) {
    if (!force && toolCache && Date.now() - toolCache.at < 60000) return toolCache.value;
    const [git, code, npm] = await Promise.all([which('git'), which('code'), which('npm')]);
    const agents = await Promise.all(
      AGENTS.map(async (agent) => {
        const cliPath = await which(agent.command);
        const appPath = agent.appPaths?.find((p) => p && fs.existsSync(p)) ?? null;
        let version = null;
        if (cliPath && agent.kind === 'cli') {
          const res = await runFixed(agent.command, ['--version'], { timeout: 15000 });
          version = res.ok ? res.output.split('\n')[0].slice(0, 60) : null;
        }
        return {
          id: agent.id,
          installed: Boolean(cliPath || appPath),
          path: cliPath ?? appPath,
          version,
        };
      }),
    );
    const value = {
      tools: { git: Boolean(git), vscode: Boolean(code || vscodeExe()), npm: Boolean(npm) },
      agents,
    };
    toolCache = { at: Date.now(), value };
    return value;
  }

  function list() {
    return AGENTS.map(({ id, name, vendor, kind, strengths, downloadUrl, npmPackage, vscodeExtension }) => ({
      id, name, vendor, kind, strengths, downloadUrl, npmPackage, vscodeExtension,
    }));
  }

  // VS Code でフォルダを開く。vscode:// を使うので、シェルを通さない
  function openInVSCode(dir) {
    const exe = vscodeExe();
    if (exe) {
      spawn(exe, [dir], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      return true;
    }
    const url = `vscode://file/${dir.replace(/\\/g, '/').replace(/^\/?/, IS_WIN ? '' : '/')}`;
    return openExternal(url);
  }

  // 新しいターミナルを開いて、対話モードでエージェントを動かす
  function openTerminal(agent, dir) {
    if (IS_WIN) {
      // Windows のパスに " は使えないので、引用符で囲めば安全
      const title = `OZ ${agent.name}`;
      const line = `/d /s /c start "${title}" /D "${dir}" cmd /k ${agent.command}`;
      spawn(process.env.ComSpec ?? 'cmd.exe', [line], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
      return true;
    }
    if (process.platform === 'darwin') {
      const script = `tell application "Terminal" to do script "cd " & quoted form of "${dir.replace(/"/g, '')}" & " && ${agent.command}"`;
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref();
      return true;
    }
    spawn('x-terminal-emulator', ['-e', agent.command], { cwd: dir, detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    return true;
  }

  async function launchApp(agent, dir) {
    const appPath = agent.appPaths?.find((p) => p && fs.existsSync(p));
    if (appPath) {
      spawn(appPath, [dir], { detached: true, stdio: 'ignore' }).unref();
      return true;
    }
    const cli = await which(agent.command);
    if (cli) {
      // Windows の .cmd はシェル経由になるので、パスを引用符で囲む（Windows のパスに " は使えない）
      spawn(agent.command, [IS_WIN ? `"${dir}"` : dir], { detached: true, stdio: 'ignore', shell: IS_WIN }).unref();
      return true;
    }
    return false;
  }

  // 単体起動: VS Code（Antigravity は自分のエディタ）で作業場所を開き、エージェントを立ち上げる
  async function launch(agentId, dir) {
    const agent = byId(agentId);
    if (!agent) throw new Error('知らないエージェントです');
    if (agent.kind === 'app') {
      if (!(await launchApp(agent, dir))) throw new Error(`${agent.name} が見つかりません。インストールしてください`);
      return { opened: [agent.name] };
    }
    if (!(await which(agent.command))) throw new Error(`${agent.name} が見つかりません。設定からインストールできます`);
    const opened = [];
    if (openInVSCode(dir)) opened.push('VS Code');
    openTerminal(agent, dir);
    opened.push(`${agent.name}（ターミナル）`);
    return { opened };
  }

  // 開発環境の準備: CLI のインストールと VS Code 拡張機能の追加（固定のコマンドだけを実行）
  async function install(agentId, what) {
    const agent = byId(agentId);
    if (!agent) throw new Error('知らないエージェントです');
    if (what === 'cli') {
      if (!agent.npmPackage) throw new Error(`${agent.name} は公式サイトからインストールしてください`);
      const res = await runFixed('npm', ['install', '-g', agent.npmPackage], { timeout: 300000 });
      toolCache = null;
      if (!res.ok) throw new Error(`インストールに失敗しました: ${res.output.slice(-300)}`);
      return { ok: true };
    }
    if (what === 'extension') {
      if (!agent.vscodeExtension) throw new Error('VS Code 拡張機能はありません');
      const res = await runFixed('code', ['--install-extension', agent.vscodeExtension, '--force'], { timeout: 300000 });
      if (!res.ok) throw new Error(`拡張機能を追加できませんでした: ${res.output.slice(-300)}`);
      return { ok: true };
    }
    if (what === 'download' && agent.downloadUrl) {
      openExternal(agent.downloadUrl);
      return { ok: true };
    }
    throw new Error('この操作はできません');
  }

  return { list, detect, launch, install, openInVSCode, byId };
}

module.exports = { createAgents, AGENTS, byId, IS_WIN };
