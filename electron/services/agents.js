'use strict';

// AIエージェント（Claude Code / Codex / Antigravity）の定義・インストール場所の検出・起動。
//
// 呼び出し方の原則:
// - Windows の .cmd（npm で入れたもの）はシェル経由でしか動かないので、引数は固定にして依頼文は標準入力で渡す
// - .exe はシェルを通さずに直接起動する。このときは依頼文を引数で渡しても安全
// - PATH に無くても、よくあるインストール先を探して、見つかった場所から直接動かす
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IS_WIN = process.platform === 'win32';
const HOME = os.homedir();
const LOCALAPPDATA = process.env.LOCALAPPDATA ?? path.join(HOME, 'AppData', 'Local');
const APPDATA = process.env.APPDATA ?? path.join(HOME, 'AppData', 'Roaming');
const PROGRAM_FILES = process.env.ProgramFiles ?? 'C:\\Program Files';

// 引数で渡せる依頼文の長さの上限（Windows のコマンドラインは約32000文字まで）
const MAX_ARG_PROMPT = 20000;
const TASK_FILE = 'OZ_TASK.md';

const winget = (name) => path.join(LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', name);

const AGENTS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    vendor: 'Anthropic',
    names: ['claude'],
    // ネイティブ版インストーラ・npm・winget の順に探す
    paths: IS_WIN
      ? [path.join(HOME, '.local', 'bin', 'claude.exe'), path.join(APPDATA, 'npm', 'claude.cmd'), winget('claude.exe')]
      : [path.join(HOME, '.local', 'bin', 'claude'), path.join(HOME, '.claude', 'local', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude'],
    // 依頼文は標準入力。task はファイル編集を自動で許可、それ以外（司令塔・会話）は編集しない
    args: {
      task: ['-p', '--output-format', 'text', '--permission-mode', 'acceptEdits'],
      plan: ['-p', '--output-format', 'text'],
      chat: ['-p', '--output-format', 'text'],
    },
    npmPackage: '@anthropic-ai/claude-code',
    vscodeExtension: 'anthropic.claude-code',
    installUrl: 'https://docs.claude.com/en/docs/claude-code/setup',
    statusPage: 'https://status.anthropic.com/api/v2/status.json',
    strengths: '設計・レビュー・テスト・複雑な変更',
  },
  {
    id: 'codex',
    name: 'Codex',
    vendor: 'OpenAI',
    names: ['codex'],
    paths: IS_WIN
      ? [path.join(APPDATA, 'npm', 'codex.cmd'), winget('codex.exe'), path.join(HOME, '.local', 'bin', 'codex.exe')]
      : ['/usr/local/bin/codex', '/opt/homebrew/bin/codex', path.join(HOME, '.local', 'bin', 'codex')],
    // '-' で依頼文を標準入力から読む。task は作業フォルダ内の編集を自動で許可（--full-auto）
    args: {
      task: ['exec', '--full-auto', '-'],
      plan: ['exec', '--skip-git-repo-check', '-'],
      chat: ['exec', '--skip-git-repo-check', '-'],
    },
    npmPackage: '@openai/codex',
    vscodeExtension: 'openai.chatgpt',
    installUrl: 'https://developers.openai.com/codex/cli',
    statusPage: 'https://status.openai.com/api/v2/status.json',
    strengths: '処理の実装・API・スクリプト',
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    vendor: 'Google',
    // Antigravity CLI（agy）。公式のインストーラは %LOCALAPPDATA% の下に置く
    names: ['agy'],
    paths: IS_WIN
      ? [
          path.join(LOCALAPPDATA, 'agy', 'bin', 'agy.exe'),
          path.join(LOCALAPPDATA, 'Antigravity', 'agy.exe'),
          path.join(LOCALAPPDATA, 'Antigravity', 'bin', 'agy.exe'),
          path.join(LOCALAPPDATA, 'Programs', 'Antigravity', 'bin', 'agy.exe'),
        ]
      : [path.join(HOME, '.local', 'bin', 'agy'), '/usr/local/bin/agy', '/opt/homebrew/bin/agy'],
    // agy は依頼文を -p の引数で受け取る（.exe を直接起動するので安全）。
    // task で使う自動承認の旗は、入っている版の --help を見て使えるものだけを付ける
    promptArg: '-p',
    taskFlags: ['--dangerously-skip-permissions', '--sandbox'],
    // Antigravity のエディタ（IDE）
    ide: {
      names: ['antigravity'],
      paths: IS_WIN
        ? [path.join(LOCALAPPDATA, 'Programs', 'Antigravity', 'Antigravity.exe'), path.join(PROGRAM_FILES, 'Antigravity', 'Antigravity.exe')]
        : process.platform === 'darwin'
          ? ['/Applications/Antigravity.app/Contents/MacOS/Electron', '/Applications/Antigravity.app/Contents/MacOS/Antigravity']
          : ['/usr/share/antigravity/antigravity', '/opt/Antigravity/antigravity'],
    },
    installUrl: 'https://antigravity.google/docs/cli',
    downloadUrl: 'https://antigravity.google/download',
    statusPage: null,
    strengths: '画面・UI・ブラウザでの確認',
  },
];

const byId = (id) => AGENTS.find((a) => a.id === id);
const exists = (p) => {
  try {
    return Boolean(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
const needsShell = (p) => IS_WIN && /\.(cmd|bat)$/i.test(p);

// PATH の中から探す。Windows では .exe を優先し、拡張子のないファイル（bash 用）は使わない
function which(command) {
  return new Promise((resolve) => {
    execFile(IS_WIN ? 'where' : 'which', [command], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      if (err) return resolve(null);
      const found = String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (!IS_WIN) return resolve(found[0] ?? null);
      resolve(found.find((p) => /\.exe$/i.test(p)) ?? found.find((p) => /\.(cmd|bat)$/i.test(p)) ?? null);
    });
  });
}

// PATH → よくあるインストール先 の順に探す
async function locate({ names, paths }) {
  for (const name of names ?? []) {
    const found = await which(name);
    if (found) return { path: found, source: 'PATH' };
  }
  const known = (paths ?? []).find(exists);
  return known ? { path: known, source: 'インストール先' } : null;
}

// コマンドを起動する形に整える。シェル経由のときはパスを引用符で囲む（Windows のパスに " は使えない）
function spawnTarget(file) {
  const shell = needsShell(file);
  return { command: shell ? `"${file}"` : file, shell };
}

// 固定の引数でコマンドを実行する（利用者の文字列は渡さない）
function runFixed(file, args, { cwd, timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const { command, shell } = spawnTarget(file);
    const child = spawn(command, args, { cwd, shell, windowsHide: true });
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
    ? [path.join(LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'), path.join(PROGRAM_FILES, 'Microsoft VS Code', 'Code.exe')]
    : process.platform === 'darwin'
      ? ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code']
      : ['/usr/bin/code', '/usr/share/code/bin/code', '/snap/bin/code'];
  return candidates.find(exists) ?? null;
}

function createAgents({ openExternal }) {
  let cache = null;

  // インストール状況。重いので1分だけ覚えておく
  async function detect({ force = false } = {}) {
    if (!force && cache && Date.now() - cache.at < 60000) return cache.value;
    const [git, code, npm] = await Promise.all([which('git'), which('code'), which('npm')]);

    const agents = await Promise.all(
      AGENTS.map(async (agent) => {
        const cli = await locate(agent);
        const ide = agent.ide ? await locate(agent.ide) : null;
        let version = null;
        let help = '';
        if (cli) {
          const res = await runFixed(cli.path, ['--version'], { timeout: 15000 });
          version = res.ok ? res.output.split('\n')[0].slice(0, 60) : null;
          // 自動承認の旗が使えるかは、その版の --help で確かめる
          if (agent.taskFlags) help = (await runFixed(cli.path, ['--help'], { timeout: 15000 })).output;
        }
        return {
          id: agent.id,
          installed: Boolean(cli || ide),
          cli: cli ? { ...cli, version } : null,
          ide: ide ?? null,
          // 依頼を自動で実行できるか（CLI があるか）
          headless: Boolean(cli),
          taskFlags: (agent.taskFlags ?? []).filter((flag) => help.includes(flag)),
          // 画面の互換のため
          path: cli?.path ?? ide?.path ?? null,
          version,
        };
      }),
    );

    const value = {
      tools: { git: Boolean(git), vscode: Boolean(code || vscodeExe()), npm: Boolean(npm) },
      agents,
    };
    cache = { at: Date.now(), value };
    return value;
  }

  async function found(agentId) {
    return (await detect()).agents.find((a) => a.id === agentId);
  }

  function list() {
    return AGENTS.map(({ id, name, vendor, strengths, downloadUrl, installUrl, npmPackage, vscodeExtension, ide }) => ({
      id, name, vendor, strengths, downloadUrl, installUrl, npmPackage, vscodeExtension, hasIde: Boolean(ide),
      kind: ide ? 'app' : 'cli',
    }));
  }

  // 依頼を1回だけ実行する呼び出し方。mode: task（編集する）/ plan（司令塔）/ chat（会話）
  // CLI が見つからなければ null を返す
  async function invocation(agentId, { mode = 'task', prompt, cwd }) {
    const agent = byId(agentId);
    const info = await found(agentId);
    if (!agent || !info?.cli) return null;
    const { command, shell } = spawnTarget(info.cli.path);
    const text = String(prompt ?? '');

    if (agent.args) {
      return { command, args: agent.args[mode] ?? agent.args.task, shell, stdin: text };
    }

    // agy: 依頼文は引数で渡す。シェル経由になるとき・長すぎるときは、作業フォルダのファイルに書いて読ませる
    let promptText = text;
    if (shell || text.length > MAX_ARG_PROMPT) {
      if (!cwd) return null;
      fs.writeFileSync(path.join(cwd, TASK_FILE), `# OZ Assistant からの依頼\n\n${text}\n`, 'utf8');
      promptText = `このフォルダの ${TASK_FILE} に書かれた依頼を実行してください。終わったら ${TASK_FILE} は消してください。`;
    }
    const flags = mode === 'task' ? info.taskFlags : [];
    return { command, args: [agent.promptArg, promptText, ...flags], shell, stdin: '' };
  }

  // VS Code でフォルダを開く
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
  function openTerminal(agent, file, dir) {
    if (IS_WIN) {
      // パスはどちらも引用符で囲む（Windows のパスに " は使えない）
      const line = `/d /s /c start "OZ ${agent.name}" /D "${dir}" cmd /k "${file}"`;
      spawn(process.env.ComSpec ?? 'cmd.exe', [line], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
      return true;
    }
    if (process.platform === 'darwin') {
      const script = `tell application "Terminal" to do script "cd " & quoted form of "${dir.replace(/"/g, '')}" & " && " & quoted form of "${file.replace(/"/g, '')}"`;
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref();
      return true;
    }
    spawn('x-terminal-emulator', ['-e', file], { cwd: dir, detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    return true;
  }

  function openIde(idePath, dir) {
    const { command, shell } = spawnTarget(idePath);
    spawn(command, [shell ? `"${dir}"` : dir], { detached: true, stdio: 'ignore', shell }).unref();
  }

  // 単体起動: 作業場所をエディタで開き、エージェントを対話モードで立ち上げる
  // Antigravity はエディタ（IDE）があればそれで開き、なければ agy をターミナルで動かす
  async function launch(agentId, dir) {
    const agent = byId(agentId);
    if (!agent) throw new Error('知らないエージェントです');
    const info = await found(agentId);
    if (!info?.installed) throw new Error(`${agent.name} が見つかりません。単体起動の画面からインストールできます`);

    const opened = [];
    if (info.ide) {
      openIde(info.ide.path, dir);
      opened.push(`${agent.name}（エディタ）`);
    } else if (openInVSCode(dir)) {
      opened.push('VS Code');
    }
    if (info.cli) {
      openTerminal(agent, info.cli.path, dir);
      opened.push(`${agent.name}（ターミナル）`);
    }
    return { opened };
  }

  // 開発環境の準備: CLI のインストールと VS Code 拡張機能の追加（固定のコマンドだけを実行）
  async function install(agentId, what) {
    const agent = byId(agentId);
    if (!agent) throw new Error('知らないエージェントです');
    if (what === 'cli') {
      if (!agent.npmPackage) {
        openExternal(agent.installUrl);
        return { ok: true, opened: agent.installUrl };
      }
      const npm = await which('npm');
      if (!npm) throw new Error('npm が見つかりません。Node.js をインストールしてください');
      const res = await runFixed(npm, ['install', '-g', agent.npmPackage], { timeout: 300000 });
      cache = null;
      if (!res.ok) throw new Error(`インストールに失敗しました: ${res.output.slice(-300)}`);
      return { ok: true };
    }
    if (what === 'extension') {
      if (!agent.vscodeExtension) throw new Error('VS Code 拡張機能はありません');
      const code = await which('code');
      if (!code) throw new Error('VS Code の code コマンドが見つかりません');
      const res = await runFixed(code, ['--install-extension', agent.vscodeExtension, '--force'], { timeout: 300000 });
      if (!res.ok) throw new Error(`拡張機能を追加できませんでした: ${res.output.slice(-300)}`);
      return { ok: true };
    }
    if (what === 'download' && agent.downloadUrl) {
      openExternal(agent.downloadUrl);
      return { ok: true };
    }
    throw new Error('この操作はできません');
  }

  return { list, detect, invocation, launch, install, openInVSCode, byId, TASK_FILE };
}

module.exports = { createAgents, AGENTS, byId, IS_WIN, TASK_FILE };
