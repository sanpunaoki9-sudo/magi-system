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
prompt=$(cat)
if [ -f "$FAKE_DIR/claude-limit" ]; then echo "Claude usage limit reached. Try again in 0h 1m" >&2; echo partial > partial.txt; exit 1; fi
if echo "$prompt" | grep -q "司令塔"; then echo '[{"agentId":"claude-code","task":"画面を作る"},{"agentId":"codex","task":"APIを作る"}]'; exit 0; fi
if echo "$prompt" | grep -q "衝突マーカー"; then printf 'merged by claude\\n' > shared.txt; exit 0; fi
echo "$prompt" | grep -q "前回の作業は利用枠" && echo resumed > resumed.txt
echo ui > ui.txt; echo "from claude" > shared.txt; echo done
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'codex'), `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "fake-codex 0.1"; exit 0; fi
cat > /dev/null
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
    let runner = createRunner({ agents, git, quota, vault, dataDir: data });
    runner.startLoop();

    // 利用枠の上限
    fs.writeFileSync(path.join(dir, 'claude-limit'), '');
    const job = runner.submit({ agentId: 'claude-code', prompt: '画面を作る' });
    await until(() => runner.get(job.id).status === 'waiting-quota');
    assert.deepEqual(runner.get(job.id).commit.files.map((f) => f.file), ['partial.txt']);
    assert.ok(Math.abs(runner.get(job.id).resumeAt - Date.now() - 60000) < 5000);

    // アプリを再起動しても待ちは残る
    runner.stopAll();
    runner = createRunner({ agents, git, quota, vault, dataDir: data });
    runner.startLoop();
    assert.equal(runner.get(job.id).status, 'waiting-quota');

    // 回復したら続きから再開
    fs.rmSync(path.join(dir, 'claude-limit'));
    quota.markRecovered('claude-code');
    await until(() => runner.get(job.id).status === 'done');
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
