'use strict';

// 保管庫・Git・依頼の実行（利用枠の回復待ちと自動再開・分担と統合）のテスト。
// 偽物の claude / codex コマンドを使うので、シェルスクリプトが動く環境（Linux / macOS）だけで実行する。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { createVault } = require('../electron/services/vault');
const { createGit } = require('../electron/services/git');
const { createQuota } = require('../electron/services/quota');
const { createAgents } = require('../electron/services/agents');
const { createRunner } = require('../electron/services/runner');
const { createPlanner } = require('../electron/services/planner');

const POSIX = process.platform !== 'win32';
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `oz-${name}-`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await fn()) return;
    await wait(50);
  }
  throw new Error('時間内に終わりませんでした');
}

test('保管庫: ノートとリンクをグラフにし、保管庫の外には書かない', () => {
  const root = path.join(tmp('vault'), '開発環境001');
  fs.mkdirSync(path.join(root, 'プロジェクト'), { recursive: true });
  fs.writeFileSync(path.join(root, '計画.md'), '[[メモ]] [[未作成|別名]] [設計](プロジェクト/設計.md)');
  fs.writeFileSync(path.join(root, 'メモ.md'), '[[計画#見出し]]');
  fs.writeFileSync(path.join(root, 'プロジェクト', '設計.md'), '[[計画]]');

  let cfg = { path: root };
  const vault = createVault({ getConfig: () => cfg, setConfig: (c) => { cfg = c; } });
  const graph = vault.graph();
  assert.equal(graph.nodes.find((n) => n.id === '計画.md').degree, 5);
  assert.ok(graph.nodes.some((n) => n.id === 'ghost:未作成' && n.origin === 'ghost'));

  const escaped = vault.addNote({ title: '../../escape', folder: '../../..', body: 'x' });
  assert.ok(fs.existsSync(path.join(root, escaped.path)));
  assert.ok(!escaped.path.includes('..' + path.sep));

  const saved = vault.saveNews({ title: 'Test: a/b', url: 'https://example.com/x', source: 'Ex' });
  assert.equal(saved.path, 'OZ/ニュース/Test a b.md');
  assert.match(fs.readFileSync(path.join(root, saved.path), 'utf8'), /\[\[AIニュース\]\]/);

  vault.appendNote({ folder: 'OZ/会話ログ', title: '2026-10-02', header: '# log\n', text: 'a\n' });
  vault.appendNote({ folder: 'OZ/会話ログ', title: '2026-10-02', header: '# log\n', text: 'b\n' });
  assert.match(fs.readFileSync(path.join(root, 'OZ/会話ログ/2026-10-02.md'), 'utf8'), /# log\na\nb\n$/);

  assert.throws(() => vault.saveNews({ title: 'x', url: 'javascript:alert(1)' }));
});

test('Git: エージェントごとの作業場所で並行作業し、衝突は統合せずに報告する', { skip: !POSIX }, async () => {
  const ws = tmp('ws');
  const git = createGit({ getConfig: () => ({ workspace: ws }) });
  await git.ensureRepo();
  fs.writeFileSync(path.join(ws, 'shared.txt'), 'base\n');
  await git.commitAll(ws, 'base');

  const a = await git.prepareWorktree('claude-code');
  const b = await git.prepareWorktree('codex');
  fs.writeFileSync(path.join(a.path, 'ui.js'), 'ui\n');
  fs.writeFileSync(path.join(a.path, 'shared.txt'), 'claude\n');
  fs.writeFileSync(path.join(b.path, 'shared.txt'), 'codex\n');
  await git.commitAll(a.path, 'a');
  await git.commitAll(b.path, 'b');

  const result = await git.mergeAgents(['claude-code', 'codex']);
  assert.deepEqual(result.merged, ['claude-code']);
  assert.deepEqual(result.conflicts.map((c) => [c.agentId, c.files]), [['codex', ['shared.txt']]]);
  assert.equal((await git.status()).changed, 0); // 作業場所の置き場は Git の管理外
});

function fakeCli(dir) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "fake-claude 1.0"; exit 0; fi
if [ "$1" = "--help" ]; then printf '  --model <model>\\n  --effort <level>\\n'; exit 0; fi
prompt=$(cat)
if [ -f "$FAKE_DIR/claude-limit" ]; then echo "Claude usage limit reached. Try again in 0h 1m" >&2; echo partial > partial.txt; exit 1; fi
if echo "$prompt" | grep -q "司令塔"; then echo '[{"agentId":"claude-code","task":"画面を作る"},{"agentId":"codex","task":"APIを作る"}]'; exit 0; fi
if echo "$prompt" | grep -q "衝突マーカー"; then printf 'merged by claude\\n' > shared.txt; exit 0; fi
echo "$prompt" | grep -q "前回の作業は利用枠" && echo resumed > resumed.txt
echo ui > ui.txt; echo "from claude" > shared.txt; echo done
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'codex'), `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "fake-codex 0.1"; exit 0; fi
if [ "$1" = "--help" ]; then printf '  -m, --model <MODEL>\\n  -c, --config <key=value>\\n'; exit 0; fi
cat > /dev/null
if [ -f "$FAKE_DIR/codex-fail" ]; then echo "codex: error" >&2; exit 3; fi
echo api > api.txt; echo "from codex" > shared.txt; echo done
`, { mode: 0o755 });
  return bin;
}

test('依頼: 利用枠の上限で途中まで保存して待ち、回復したら続きから自動で再開する。分担は衝突を解決して統合する', { skip: !POSIX, timeout: 120000 }, async () => {
  const dir = tmp('runner');
  const bin = fakeCli(dir);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  process.env.FAKE_DIR = dir;
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: ws });
  fs.writeFileSync(path.join(ws, 'shared.txt'), 'base\n');
  execFileSync('git', ['add', '-A'], { cwd: ws });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base'], { cwd: ws });

  try {
    const git = createGit({ getConfig: () => ({ workspace: ws }) });
    const quota = createQuota();
    const agents = createAgents({ openExternal: () => true });
    const vault = { ensureHub() {}, addNote() {}, appendNote() {} };
    const data = path.join(dir, 'data');
    // 1人に頼んだ作業はここでは統合しない（後の分担で衝突の解決まで確かめるため）
    let runner = createRunner({ agents, git, quota, vault, dataDir: data, getAutoMerge: () => false });
    runner.startLoop();

    // 利用枠の上限
    fs.writeFileSync(path.join(dir, 'claude-limit'), '');
    const job = runner.submit({ agentId: 'claude-code', prompt: '画面を作る' });
    await until(() => runner.get(job.id).status === 'waiting-quota');
    assert.deepEqual(runner.get(job.id).commit.files.map((f) => f.file), ['partial.txt']);
    assert.ok(Math.abs(runner.get(job.id).resumeAt - Date.now() - 60000) < 5000);

    // アプリを再起動しても待ちは残る
    runner.stopAll();
    runner = createRunner({ agents, git, quota, vault, dataDir: data, getAutoMerge: () => false });
    runner.startLoop();
    assert.equal(runner.get(job.id).status, 'waiting-quota');

    // 回復したら続きから再開
    fs.rmSync(path.join(dir, 'claude-limit'));
    quota.markRecovered('claude-code');
    await until(() => runner.get(job.id).status === 'done').catch((e) => { console.log('DEBUG', JSON.stringify(runner.get(job.id))); throw e; });
    assert.equal(runner.get(job.id).attempts, 2);
    assert.ok(fs.existsSync(path.join(git.worktreePath('claude-code'), 'resumed.txt')));

    // 分担: 衝突は Claude Code が解決してから統合する
    const plan = await createPlanner({ agents, quota, git }).plan('ログイン機能を作る');
    assert.equal(plan.source, 'claude-code');
    const group = runner.createGroup({ request: 'ログイン機能を作る', assignments: plan.assignments });
    await until(() => runner.listGroups().find((g) => g.id === group.id).status !== 'running', 60000);
    const done = runner.listGroups().find((g) => g.id === group.id);
    assert.equal(done.status, 'merged');
    assert.equal(fs.readFileSync(path.join(ws, 'shared.txt'), 'utf8').trim(), 'merged by claude');
    assert.ok(fs.existsSync(path.join(ws, 'api.txt')) && fs.existsSync(path.join(ws, 'ui.txt')));
    runner.stopAll();
  } finally {
    process.env.PATH = oldPath;
  }
});

function fakeAgy(bin) {
  // --help には自動承認の旗のうち1つだけを載せる（入っている版で使える旗だけを付けるかの確認）
  fs.writeFileSync(path.join(bin, 'agy'), `#!/usr/bin/env bash
case "$1" in
  --version) echo "agy 1.2.3"; exit 0 ;;
  --help) printf 'Usage: agy [flags]\\n  -p, --prompt string\\n  --model string\\n  --dangerously-skip-permissions\\n'; exit 0 ;;
  models) printf 'Available models:\\n  gemini-3.5-flash   (default)\\n  gemini-3.5-pro-high\\n'; exit 0 ;;
esac
if [ "$1" = "-p" ]; then
  shift; prompt="$1"; shift
  echo "$*" > agy-flags.txt
  [ -f OZ_TASK.md ] && cp OZ_TASK.md task-copy.txt
  echo "$prompt" | head -c 200 > agy-prompt.txt
  echo done; exit 0
fi
exit 2
`, { mode: 0o755 });
}

test('Antigravity CLI（agy）: 見つけて、使える旗だけで自動実行する。長い依頼はファイルで渡してコミットには含めない', { skip: !POSIX, timeout: 60000 }, async () => {
  const dir = tmp('agy');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fakeAgy(bin);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws);
  try {
    const agents = createAgents({ openExternal: () => true });
    const info = (await agents.detect({ force: true })).agents.find((a) => a.id === 'antigravity');
    assert.equal(info.headless, true);
    assert.equal(info.cli.version, 'agy 1.2.3');
    assert.deepEqual(info.taskFlags, ['--dangerously-skip-permissions']);

    const inv = await agents.invocation('antigravity', { mode: 'task', prompt: '画面を作る', cwd: ws });
    assert.deepEqual(inv.args, ['-p', '画面を作る', '--dangerously-skip-permissions']);
    assert.equal(inv.shell, false);
    const chat = await agents.invocation('antigravity', { mode: 'chat', prompt: 'こんにちは', cwd: ws });
    assert.deepEqual(chat.args, ['-p', 'こんにちは']);

    const git = createGit({ getConfig: () => ({ workspace: ws }) });
    const runner = createRunner({ agents, git, quota: createQuota(), vault: { ensureHub() {}, addNote() {} }, dataDir: path.join(dir, 'data') });
    runner.startLoop();
    const long = `長い依頼 ${'あ'.repeat(25000)}`;
    const job = runner.submit({ agentId: 'antigravity', prompt: long });
    await until(() => ['done', 'failed'].includes(runner.get(job.id).status));
    const done = runner.get(job.id);
    assert.equal(done.status, 'done', done.error ?? '');
    const committed = done.commit.files.map((f) => f.file).sort();
    assert.ok(committed.includes('task-copy.txt'));
    assert.ok(!committed.includes('OZ_TASK.md'));
    assert.match(fs.readFileSync(path.join(git.worktreePath('antigravity'), 'agy-prompt.txt'), 'utf8'), /OZ_TASK\.md/);
    runner.stopAll();
  } finally {
    process.env.PATH = oldPath;
  }
});

test('PATH に無くても、よくあるインストール先から見つける', { skip: !POSIX }, async () => {
  const home = tmp('home');
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  fakeAgy(path.join(home, '.local', 'bin'));
  // Claude Code と Codex は VS Code 拡張に同梱の本体から見つける。拡張が複数の版あれば新しい方を使う
  const ext = (name, ...sub) => {
    const dir = path.join(home, '.vscode', 'extensions', name, ...sub);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const claudeDir = ext('anthropic.claude-code-2.1.0-linux-x64', 'resources', 'native-binary');
  fs.writeFileSync(path.join(claudeDir, 'claude'), '#!/usr/bin/env bash\necho "2.1.0 (Claude Code)"\n', { mode: 0o755 });
  const oldCodex = ext('openai.chatgpt-0.1.0-linux-x64', 'bin', 'linux-x86_64');
  fs.writeFileSync(path.join(oldCodex, 'codex'), '#!/usr/bin/env bash\necho "codex-cli 0.1.0"\n', { mode: 0o755 });
  const newCodex = ext('openai.chatgpt-0.2.0-linux-x64', 'bin', 'linux-x86_64');
  fs.writeFileSync(path.join(newCodex, 'codex'), '#!/usr/bin/env bash\necho "codex-cli 0.2.0"\n', { mode: 0o755 });
  fs.utimesSync(path.dirname(path.dirname(oldCodex)), new Date(2020, 0, 1), new Date(2020, 0, 1));

  const oldHome = process.env.HOME;
  const oldPath = process.env.PATH;
  process.env.HOME = home;
  process.env.PATH = '/usr/bin:/bin';
  const modPath = require.resolve('../electron/services/agents');
  delete require.cache[modPath];
  try {
    const { createAgents: fresh } = require('../electron/services/agents');
    const agents = (await fresh({ openExternal: () => true }).detect({ force: true })).agents;
    const info = agents.find((a) => a.id === 'antigravity');
    assert.equal(info.cli.path, path.join(home, '.local', 'bin', 'agy'));
    assert.equal(info.cli.source, 'インストール先');

    const claude = agents.find((a) => a.id === 'claude-code');
    assert.equal(claude.cli.path, path.join(claudeDir, 'claude'));
    assert.equal(claude.cli.source, 'VS Code 拡張に同梱');
    assert.equal(claude.version, '2.1.0 (Claude Code)');
    assert.equal(claude.headless, true);

    const codex = agents.find((a) => a.id === 'codex');
    assert.equal(codex.cli.path, path.join(newCodex, 'codex'));
    assert.equal(codex.version, 'codex-cli 0.2.0');
  } finally {
    process.env.HOME = oldHome;
    process.env.PATH = oldPath;
    delete require.cache[modPath];
  }
});

test('モデルとエフォート: CLI が対応している指定だけを、各 CLI の書き方で付ける。危ない文字は通さない', { skip: !POSIX }, async () => {
  const dir = tmp('model');
  const bin = fakeCli(dir);
  fakeAgy(bin);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  try {
    const { cleanAgentSettings } = require('../electron/services/agents');
    const settings = {
      'claude-code': cleanAgentSettings('claude-code', { model: 'opus', effort: 'xhigh' }),
      codex: cleanAgentSettings('codex', { model: 'gpt-5.4', effort: 'high' }),
      antigravity: cleanAgentSettings('antigravity', { model: 'gemini-3.5-pro-high' }),
    };
    const agents = createAgents({ openExternal: () => true, getSettings: (id) => settings[id] });
    const found = Object.fromEntries((await agents.detect({ force: true })).agents.map((a) => [a.id, a]));
    assert.deepEqual(found['claude-code'].supports, { model: true, effort: true });
    assert.deepEqual(found.antigravity.supports, { model: true, effort: false });
    // agy は「agy models」の一覧を候補にする
    assert.deepEqual(found.antigravity.models, ['gemini-3.5-flash', 'gemini-3.5-pro-high']);

    const claude = await agents.invocation('claude-code', { mode: 'task', prompt: 'x', cwd: dir });
    assert.deepEqual(claude.args, ['-p', '--output-format', 'text', '--permission-mode', 'acceptEdits', '--model', 'opus', '--effort', 'xhigh']);
    const plan = await agents.invocation('claude-code', { mode: 'plan', prompt: 'x', cwd: dir });
    assert.deepEqual(plan.args, ['-p', '--output-format', 'text', '--model', 'opus', '--effort', 'xhigh']);
    // Codex は「-」（標準入力から読む印）より前に入れる
    const codex = await agents.invocation('codex', { mode: 'task', prompt: 'x', cwd: dir });
    assert.deepEqual(codex.args, ['exec', '--full-auto', '-m', 'gpt-5.4', '-c', 'model_reasoning_effort=high', '-']);
    const agy = await agents.invocation('antigravity', { mode: 'task', prompt: 'x', cwd: dir });
    assert.deepEqual(agy.args, ['-p', 'x', '--dangerously-skip-permissions', '--model', 'gemini-3.5-pro-high']);

    // 空なら CLI の設定のまま（何も付けない）
    settings['claude-code'] = cleanAgentSettings('claude-code', {});
    assert.deepEqual((await agents.invocation('claude-code', { mode: 'chat', prompt: 'x', cwd: dir })).args, ['-p', '--output-format', 'text']);

    // シェルの記号や、そのエージェントにないエフォートは保存できない
    assert.throws(() => cleanAgentSettings('codex', { model: 'gpt & calc' }));
    assert.throws(() => cleanAgentSettings('codex', { model: '"opus"' }));
    assert.throws(() => cleanAgentSettings('codex', { effort: 'max' }));
    assert.throws(() => cleanAgentSettings('antigravity', { effort: 'high' }));
    assert.throws(() => cleanAgentSettings('unknown', {}));
  } finally {
    process.env.PATH = oldPath;
  }
});

test('分担: 新しい作業フォルダで3人が同時に始めてもぶつからない。一部が失敗したら「一部失敗」にし、やり直して成功したら統合する', { skip: !POSIX, timeout: 120000 }, async () => {
  const dir = tmp('fresh');
  const bin = fakeCli(dir);
  fakeAgy(bin);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  process.env.FAKE_DIR = dir;
  // まだ Git になっていない、空の作業フォルダ
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws);
  try {
    // 同時に3つ用意しても、初期化や worktree の追加がぶつからない
    const git = createGit({ getConfig: () => ({ workspace: ws }) });
    const prepared = await Promise.all(['claude-code', 'codex', 'antigravity'].map((id) => git.prepareWorktree(id)));
    assert.deepEqual(prepared.map((p) => p.branch), ['oz/claude-code', 'oz/codex', 'oz/antigravity']);
    fs.rmSync(path.join(ws, '.git'), { recursive: true, force: true });
    fs.rmSync(path.join(ws, '.oz-worktrees'), { recursive: true, force: true });

    // Codex だけ失敗させる
    fs.writeFileSync(path.join(dir, 'codex-fail'), '');
    const agents = createAgents({ openExternal: () => true });
    const runner = createRunner({ agents, git, quota: createQuota(), vault: { ensureHub() {}, addNote() {}, appendNote() {} }, dataDir: path.join(dir, 'data') });
    runner.startLoop();
    const group = runner.createGroup({
      request: '天気アプリ',
      assignments: [{ agentId: 'claude-code', task: '画面' }, { agentId: 'codex', task: 'データ' }, { agentId: 'antigravity', task: '見た目' }],
    });
    const groupNow = () => runner.listGroups().find((g) => g.id === group.id);
    await until(() => !['starting', 'running'].includes(groupNow().status), 60000);
    assert.equal(groupNow().status, 'partial');
    assert.deepEqual(groupNow().failedAgents, ['codex']);
    assert.deepEqual(groupNow().merge.merged.sort(), ['antigravity', 'claude-code']);
    assert.ok(fs.existsSync(path.join(ws, 'ui.txt')));

    // やり直して成功したら、改めて統合する（shared.txt の衝突は Claude Code が解決）
    fs.rmSync(path.join(dir, 'codex-fail'));
    const codexJob = runner.list().find((j) => j.groupId === group.id && j.agentId === 'codex');
    runner.retry(codexJob.id);
    assert.equal(groupNow().status, 'running');
    await until(() => !['starting', 'running'].includes(groupNow().status), 60000);
    assert.equal(groupNow().status, 'merged', JSON.stringify(groupNow()));
    assert.deepEqual(groupNow().failedAgents, []);
    assert.ok(fs.existsSync(path.join(ws, 'api.txt')));
    runner.stopAll();
  } finally {
    process.env.PATH = oldPath;
  }
});

test('1人に頼んだ作業も、終わったら自動で統合する。衝突したら Claude Code が解決してから統合する。設定でオフにできる', { skip: !POSIX, timeout: 120000 }, async () => {
  const dir = tmp('direct');
  const bin = fakeCli(dir);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  process.env.FAKE_DIR = dir;
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws);
  try {
    let autoMerge = true;
    const git = createGit({ getConfig: () => ({ workspace: ws }) });
    const agents = createAgents({ openExternal: () => true });
    const runner = createRunner({ agents, git, quota: createQuota(), vault: { ensureHub() {}, addNote() {}, appendNote() {} }, dataDir: path.join(dir, 'data'), getAutoMerge: () => autoMerge });
    runner.startLoop();

    // 2人に同時に頼む。どちらも shared.txt を書くので、後に終わった方が衝突する
    const a = runner.submit({ agentId: 'claude-code', prompt: '画面を作る' });
    const b = runner.submit({ agentId: 'codex', prompt: 'API を作る' });
    await until(() => [a, b].every((j) => ['merged', 'conflict', 'failed'].includes(runner.get(j.id).mergeState)), 60000);
    assert.equal(runner.get(a.id).mergeState, 'merged', JSON.stringify(runner.get(a.id)));
    assert.equal(runner.get(b.id).mergeState, 'merged', JSON.stringify(runner.get(b.id)));
    const resolve = runner.list().find((j) => j.kind === 'resolve');
    assert.ok(resolve && [a.id, b.id].includes(resolve.parentJobId));
    assert.equal(fs.readFileSync(path.join(ws, 'shared.txt'), 'utf8').trim(), 'merged by claude');
    assert.ok(fs.existsSync(path.join(ws, 'ui.txt')) && fs.existsSync(path.join(ws, 'api.txt')));

    // オフなら統合しない（専用ブランチに残す）
    autoMerge = false;
    fs.rmSync(path.join(ws, 'api.txt'));
    await git.commitAll(ws, 'remove api');
    const c = runner.submit({ agentId: 'codex', prompt: 'もう一度 API を作る' });
    await until(() => runner.get(c.id).status === 'done');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(runner.get(c.id).mergeState, 'off');
    assert.ok(!fs.existsSync(path.join(ws, 'api.txt')));
    runner.stopAll();
  } finally {
    process.env.PATH = oldPath;
  }
});
