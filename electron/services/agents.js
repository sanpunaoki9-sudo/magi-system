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

// エディタの拡張機能フォルダ（VS Code の拡張には CLI 本体が同梱されている）
const EXTENSION_ROOTS = ['.vscode', '.vscode-insiders', '.cursor', '.windsurf', '.antigravity'].map((d) => path.join(HOME, d, 'extensions'));

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
    // VS Code 拡張と Claude デスクトップアプリに同梱されている本体も使える
    bundled: [
      { label: 'VS Code 拡張に同梱', extension: 'anthropic.claude-code' },
      { label: 'Claude アプリに同梱', root: path.join(IS_WIN ? APPDATA : process.platform === 'darwin' ? path.join(HOME, 'Library', 'Application Support') : path.join(HOME, '.config'), 'Claude', 'claude-code') },
    ],
    // WSL（Linux）側に入れている場合も使う
    wsl: true,
    npmPackage: '@anthropic-ai/claude-code',
    vscodeExtension: 'anthropic.claude-code',
    installUrl: 'https://docs.claude.com/en/docs/claude-code/setup',
    statusPage: 'https://status.anthropic.com/api/v2/status.json',
    // モデルとエフォート（考える深さ）。--help に載っている版でだけ付ける
    options: {
      model: { args: (m) => ['--model', m], help: '--model', suggestions: ['fable', 'opus', 'sonnet', 'haiku'], placeholder: '例: opus' },
      effort: { args: (e) => ['--effort', e], help: '--effort', levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    },
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
    bundled: [{ label: 'VS Code 拡張に同梱', extension: 'openai.chatgpt' }],
    wsl: true,
    npmPackage: '@openai/codex',
    vscodeExtension: 'openai.chatgpt',
    installUrl: 'https://developers.openai.com/codex/cli',
    statusPage: 'https://status.openai.com/api/v2/status.json',
    // エフォートは設定の上書き（-c model_reasoning_effort=...）で渡す
    options: {
      model: { args: (m) => ['-m', m], help: '--model', suggestions: [], placeholder: '例: gpt-5.4' },
      effort: { args: (e) => ['-c', `model_reasoning_effort=${e}`], help: '--config', levels: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
    },
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
    // agy はエフォートがモデル名に含まれる。選べるモデルは `agy models` で調べる
    options: {
      model: { args: (m) => ['--model', m], help: '--model', suggestions: [], placeholder: 'agy models の名前', listArgs: ['models'] },
    },
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

const execText = (file, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 8000, ...opts }, (err, stdout) => resolve(err ? null : String(stdout)));
  });

// Windows では、アプリを起動した後に入れたものも見えるように、レジストリに保存された最新の PATH を足す
// （エクスプローラーから起動したアプリは、ログイン時点の古い PATH を持っているため）
let registryPath = null;
let envCache = null;
async function agentEnv() {
  const env = { ...process.env };
  if (IS_WIN) {
    if (!registryPath) {
      registryPath = [];
      for (const key of ['HKCU\\Environment', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment']) {
        const out = await execText('reg', ['query', key, '/v', 'Path']);
        const m = out?.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
        if (m) registryPath.push(...m[1].trim().split(';'));
      }
    }
    const expand = (p) => p.replace(/%([^%]+)%/g, (all, name) => process.env[name] ?? all);
    const current = Object.keys(env).find((k) => /^path$/i.test(k));
    const merged = [...(env[current] ?? '').split(';'), ...registryPath.map(expand)].map((p) => p.trim()).filter(Boolean);
    for (const k of Object.keys(env)) if (/^path$/i.test(k)) delete env[k];
    env.Path = [...new Set(merged)].join(';');
  }
  envCache = env;
  return env;
}

// PATH の中から探す。Windows では .exe を優先し、拡張子のないファイル（bash 用）は使わない
async function whichAll(command) {
  const out = await execText(IS_WIN ? 'where' : 'which', [command], { env: await agentEnv() });
  const found = String(out ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!IS_WIN) return found.slice(0, 1);
  return [...found.filter((p) => /\.exe$/i.test(p)), ...found.filter((p) => /\.(cmd|bat)$/i.test(p))];
}
const which = async (command) => (await whichAll(command))[0] ?? null;

// npm のグローバルの置き場所（設定で変えている人もいる）。1回だけ調べる
let npmPrefix;
async function getNpmPrefix() {
  if (npmPrefix !== undefined) return npmPrefix;
  npmPrefix = null;
  const npm = await which('npm');
  if (npm) {
    const res = await runFixed(npm, ['config', 'get', 'prefix'], { timeout: 15000 });
    if (res.ok && res.output) npmPrefix = res.output.split(/\r?\n/).pop().trim();
  }
  return npmPrefix;
}

// Node.js のバージョン管理ツールやパッケージ管理ツールが CLI を置く場所（Windows）
async function commonDirs() {
  if (!IS_WIN) return [];
  const prefix = await getNpmPrefix();
  return [
    path.join(HOME, '.local', 'bin'),
    path.join(APPDATA, 'npm'),
    prefix,
    process.env.NVM_SYMLINK,
    path.join(PROGRAM_FILES, 'nodejs'),
    path.join(LOCALAPPDATA, 'Volta', 'bin'),
    path.join(HOME, 'scoop', 'shims'),
    path.join(LOCALAPPDATA, 'pnpm'),
    path.join(HOME, '.bun', 'bin'),
    path.join(LOCALAPPDATA, 'Yarn', 'bin'),
    path.join(LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'),
  ].filter(Boolean);
}

// フォルダの中から浅い順にファイルを探す（深さに上限をつける）
function findFile(root, fileName, maxDepth = 5) {
  let level = [root];
  for (let depth = 0; depth <= maxDepth && level.length; depth++) {
    const next = [];
    for (const dir of level) {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      const hit = entries.find((e) => e.isFile() && e.name.toLowerCase() === fileName.toLowerCase());
      if (hit) return path.join(dir, hit.name);
      for (const e of entries) if (e.isDirectory()) next.push(path.join(dir, e.name));
    }
    level = next;
  }
  return null;
}

// 新しい順に並べたサブフォルダ
function newestDirs(root, prefix = '') {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.toLowerCase().startsWith(prefix))
      .map((e) => path.join(root, e.name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch {
    return [];
  }
}

// エディタの拡張機能やアプリに同梱されている本体を探す
function bundledPaths(names, bundled = []) {
  const files = names.map((n) => (IS_WIN ? `${n}.exe` : n));
  const found = [];
  for (const b of bundled) {
    const dirs = b.extension
      ? EXTENSION_ROOTS.flatMap((root) => newestDirs(root, `${b.extension.toLowerCase()}-`))
      : newestDirs(b.root);
    for (const dir of dirs) {
      for (const file of files) {
        const p = findFile(dir, file);
        if (p) found.push({ path: p, source: b.label });
      }
    }
  }
  return found;
}

// 探す順: PATH → よくあるインストール先 → 同梱の本体
async function candidates({ names = [], paths = [], bundled }) {
  const list = [];
  for (const name of names) for (const p of await whichAll(name)) list.push({ path: p, source: 'PATH' });
  for (const p of paths) list.push({ path: p, source: 'インストール先' });
  for (const dir of await commonDirs()) {
    for (const name of names) for (const ext of ['.exe', '.cmd']) list.push({ path: path.join(dir, name + ext), source: 'インストール先' });
  }
  list.push(...bundledPaths(names, bundled));
  const seen = new Set();
  return list.filter((c) => {
    const key = path.resolve(c.path).toLowerCase();
    if (seen.has(key) || !exists(c.path)) return false;
    seen.add(key);
    return true;
  });
}

// 見つかったもののうち、実際に動くもの（--version が通るもの）を選ぶ。どれも通らなければ最初のもの
async function locate(spec, { checkVersion = false } = {}) {
  const list = await candidates(spec);
  if (!checkVersion) return list[0] ?? null;
  for (const c of list.slice(0, 4)) {
    const res = await runFixed(c.path, ['--version'], { timeout: 15000 });
    if (res.ok) return { ...c, version: res.output.split('\n')[0].slice(0, 60) };
  }
  return list[0] ? { ...list[0], version: null } : null;
}

// WSL（Windows の中の Linux）に入れている場合。ログイン時の設定（nvm など）を読むため bash -lic で動かす
const WSL_EXE = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe');
async function locateWsl(names) {
  if (!IS_WIN || !exists(WSL_EXE)) return null;
  for (const name of names) {
    const res = await runFixed(WSL_EXE, ['-e', 'bash', '-lic', `command -v ${name} && ${name} --version`], { timeout: 30000 });
    const lines = res.output.split(/\r?\n/).map((s) => s.trim());
    const at = lines.find((l) => l.startsWith('/'));
    if (res.ok && at) {
      const version = lines[lines.indexOf(at) + 1]?.slice(0, 60) || null;
      return { path: `WSL: ${at}`, source: 'WSL', wsl: true, command: name, version };
    }
  }
  return null;
}

// コマンドを起動する形に整える。シェル経由のときはパスを引用符で囲む（Windows のパスに " は使えない）
function spawnTarget(file) {
  const shell = needsShell(file);
  return { command: shell ? `"${file}"` : file, shell };
}

// 固定の引数でコマンドを実行する（利用者の文字列は渡さない）
async function runFixed(file, args, { cwd, timeout = 120000 } = {}) {
  const env = await agentEnv();
  return new Promise((resolve) => {
    const { command, shell } = spawnTarget(file);
    const child = spawn(command, args, { cwd, shell, env, windowsHide: true });
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

// モデル名はコマンドラインに載るので、使える文字を絞る（シェルの記号を通さない）
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,79}$/;

// 画面から来たモデルとエフォートを確かめて、保存できる形にする。空なら「CLI の設定のまま」
function cleanAgentSettings(agentId, input = {}) {
  const agent = byId(agentId);
  if (!agent) throw new Error('知らないエージェントです');
  const model = String(input.model ?? '').trim();
  const effort = String(input.effort ?? '').trim();
  if (model && !MODEL_RE.test(model)) throw new Error('モデル名に使えない文字が入っています（英数字と . _ - : / [ ] だけ）');
  if (effort && !agent.options?.effort?.levels.includes(effort)) throw new Error('このエージェントでは選べないエフォートです');
  return { model, effort };
}

// 保存してある指定のうち、入っている CLI が対応しているものだけを引数にする
function optionArgs(agent, info, settings = {}) {
  const out = [];
  const { model, effort } = settings;
  if (model && MODEL_RE.test(model) && agent.options?.model && info.supports?.model) out.push(...agent.options.model.args(model));
  if (effort && agent.options?.effort?.levels.includes(effort) && info.supports?.effort) out.push(...agent.options.effort.args(effort));
  return out;
}

// WSL の bash に渡す1行。引数はすべて ' で囲む（固定の文字列と確かめ済みの指定だけ）
const bashLine = (parts) => parts.map((p) => `'${String(p).replace(/'/g, `'\\''`)}'`).join(' ');

function vscodeExe() {
  const candidates = IS_WIN
    ? [path.join(LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'), path.join(PROGRAM_FILES, 'Microsoft VS Code', 'Code.exe')]
    : process.platform === 'darwin'
      ? ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code']
      : ['/usr/bin/code', '/usr/share/code/bin/code', '/snap/bin/code'];
  return candidates.find(exists) ?? null;
}

function createAgents({ openExternal, getSettings = () => ({}) }) {
  let cache = null;

  // 見つかった CLI を固定の引数で動かす（WSL 側のものは wsl.exe 経由）
  function runCli(cli, args, opts) {
    if (cli.wsl) return runFixed(WSL_EXE, ['-e', 'bash', '-lic', bashLine([cli.command, ...args])], opts);
    return runFixed(cli.path, args, opts);
  }

  // インストール状況。重いので1分だけ覚えておく
  async function detect({ force = false } = {}) {
    if (!force && cache && Date.now() - cache.at < 60000) return cache.value;
    const [git, code, npm] = await Promise.all([which('git'), which('code'), which('npm')]);

    const agents = await Promise.all(
      AGENTS.map(async (agent) => {
        let cli = await locate(agent, { checkVersion: true });
        if (!cli && agent.wsl) cli = await locateWsl(agent.names);
        const ide = agent.ide ? await locate(agent.ide) : null;
        const version = cli?.version ?? null;
        // 自動承認の旗・モデル・エフォートが使えるかは、その版の --help で確かめる
        const help = cli ? (await runCli(cli, ['--help'], { timeout: 15000 })).output : '';
        const supports = {
          model: Boolean(agent.options?.model && help.includes(agent.options.model.help)),
          effort: Boolean(agent.options?.effort && help.includes(agent.options.effort.help)),
        };
        // 選べるモデルの一覧を出せる CLI（agy models）は、その一覧を候補にする
        let models = agent.options?.model?.suggestions ?? [];
        if (cli && supports.model && agent.options.model.listArgs) {
          const res = await runCli(cli, agent.options.model.listArgs, { timeout: 20000 });
          const listed = res.ok
            ? res.output.split(/\r?\n/).map((l) => l.trim().replace(/^[-*•>]\s*/, '').split(/\s+/)[0]).filter((m) => m && MODEL_RE.test(m) && /\d|-/.test(m))
            : [];
          if (listed.length) models = [...new Set(listed)].slice(0, 40);
        }
        return {
          id: agent.id,
          installed: Boolean(cli || ide),
          cli,
          ide: ide ?? null,
          // 依頼を自動で実行できるか（CLI があるか）
          headless: Boolean(cli),
          taskFlags: (agent.taskFlags ?? []).filter((flag) => help.includes(flag)),
          supports,
          models,
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
    return AGENTS.map(({ id, name, vendor, strengths, downloadUrl, installUrl, npmPackage, vscodeExtension, ide, options }) => ({
      id, name, vendor, strengths, downloadUrl, installUrl, npmPackage, vscodeExtension, hasIde: Boolean(ide),
      kind: ide ? 'app' : 'cli',
      // 画面で選ぶための情報（エフォートの段階・モデル名の入力例）
      options: {
        model: options?.model ? { placeholder: options.model.placeholder } : null,
        effort: options?.effort ? { levels: options.effort.levels } : null,
      },
      settings: getSettings(id) ?? {},
    }));
  }

  // 依頼を1回だけ実行する呼び出し方。mode: task（編集する）/ plan（司令塔）/ chat（会話）
  // CLI が見つからなければ null を返す
  async function invocation(agentId, { mode = 'task', prompt, cwd }) {
    const agent = byId(agentId);
    const info = await found(agentId);
    if (!agent || !info?.cli) return null;
    const env = { ...(await agentEnv()), OZ_ASSISTANT: '1' };
    const text = String(prompt ?? '');
    const opts = optionArgs(agent, info, getSettings(agentId));
    // モデル・エフォートの指定は、最後の「-」（標準入力から読む印）より前に入れる
    const base = agent.args?.[mode] ?? agent.args?.task;
    const args = base && (base.at(-1) === '-' ? [...base.slice(0, -1), ...opts, '-'] : [...base, ...opts]);

    // WSL 側の CLI: 引数は固定の文字列と確かめ済みの指定だけ（依頼文は標準入力）。作業フォルダは /mnt/c/... として引き継がれる
    if (info.cli.wsl) {
      return { command: WSL_EXE, args: ['-e', 'bash', '-lic', bashLine([info.cli.command, ...args])], shell: false, stdin: text, env };
    }

    const { command, shell } = spawnTarget(info.cli.path);
    if (agent.args) {
      return { command, args, shell, stdin: text, env };
    }

    // agy: 依頼文は引数で渡す。シェル経由になるとき・長すぎるときは、作業フォルダのファイルに書いて読ませる
    let promptText = text;
    if (shell || text.length > MAX_ARG_PROMPT) {
      if (!cwd) return null;
      fs.writeFileSync(path.join(cwd, TASK_FILE), `# OZ Assistant からの依頼\n\n${text}\n`, 'utf8');
      promptText = `このフォルダの ${TASK_FILE} に書かれた依頼を実行してください。終わったら ${TASK_FILE} は消してください。`;
    }
    const flags = mode === 'task' ? info.taskFlags : [];
    return { command, args: [agent.promptArg, promptText, ...flags, ...opts], shell, stdin: '', env };
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
  // opts はモデル・エフォートの指定（確かめ済みで、空白や記号を含まない）
  function openTerminal(agent, cli, dir, opts = []) {
    const file = cli.path;
    const extra = opts.length ? ` ${opts.join(' ')}` : '';
    if (IS_WIN) {
      // パスはどちらも引用符で囲む（Windows のパスに " は使えない）。WSL 側のものは wsl.exe 経由で動かす
      const run = cli.wsl ? `wsl.exe -e bash -lic "${cli.command}${extra}"` : `"${file}"${extra}`;
      const line = `/d /s /c start "OZ ${agent.name}" /D "${dir}" cmd /k ${run}`;
      spawn(process.env.ComSpec ?? 'cmd.exe', [line], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true, env: envCache ?? process.env }).unref();
      return true;
    }
    if (process.platform === 'darwin') {
      const script = `tell application "Terminal" to do script "cd " & quoted form of "${dir.replace(/"/g, '')}" & " && " & quoted form of "${file.replace(/"/g, '')}" & "${extra}"`;
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref();
      return true;
    }
    spawn('x-terminal-emulator', ['-e', file, ...opts], { cwd: dir, detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
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
      openTerminal(agent, info.cli, dir, optionArgs(agent, info, getSettings(agentId)));
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

module.exports = { createAgents, cleanAgentSettings, AGENTS, byId, IS_WIN, TASK_FILE };
