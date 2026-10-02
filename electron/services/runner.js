'use strict';

// エージェントへの依頼（ジョブ）を順番に動かす。
// - エージェントごとの作業場所（worktree）で、1か所につき1件ずつ実行する
// - 利用枠の上限を検知したら、途中までを保存して「回復待ち」にし、回復したら自動で続きから再開する
// - 待ち状態はファイルに保存し、アプリを再起動しても続きから動く
// - 指令室の分担（グループ）は、全員が終わったらまとめ先へ統合し、衝突は Claude Code に解決を頼む
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const OUTPUT_LINES = 200;
const JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const TICK_MS = 30000;
const KEEP_FINISHED = 200;
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

const RESUME_NOTE =
  '（前回の作業は利用枠の上限で中断しました。作業フォルダの今の状態を確認し、終わっていない部分から続けてください。）\n\n';

function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

function createRunner({ agents, git, quota, vault, dataDir, onJob, onGroup, spawnImpl = spawn }) {
  const file = path.join(dataDir, 'oz-jobs.json');
  const jobs = new Map();
  const groups = new Map();
  const processes = new Map(); // jobId -> child
  let timer = null;

  // ---------- 保存と読み込み ----------

  function save() {
    const finished = [...jobs.values()].filter((j) => TERMINAL.has(j.status)).sort((a, b) => b.createdAt - a.createdAt);
    const keep = new Set(finished.slice(0, KEEP_FINISHED).map((j) => j.id));
    const list = [...jobs.values()].filter((j) => !TERMINAL.has(j.status) || keep.has(j.id));
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ jobs: list, groups: [...groups.values()] }), 'utf8');
    } catch {
      // 保存に失敗しても動作は続ける
    }
  }

  function load() {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const job of data.jobs ?? []) {
        // 前回、実行中のままアプリが閉じた依頼は、続きから再開する
        if (job.status === 'running') {
          job.status = 'queued';
          job.resume = true;
          job.output = [...(job.output ?? []), '— アプリの再起動により、続きから再開します —'];
        }
        jobs.set(job.id, job);
      }
      for (const group of data.groups ?? []) groups.set(group.id, group);
    } catch {
      // 記録がなければ空から始める
    }
  }

  function publicJob(job) {
    const { output, ...rest } = job;
    return { ...rest, output: output.slice(-40) };
  }

  function update(job, patch = {}) {
    Object.assign(job, patch);
    save();
    onJob?.(publicJob(job));
    if (job.groupId) checkGroup(job.groupId);
  }

  // fromAgent: エージェントの出力のときだけ、利用枠の上限の文言を調べる（アプリ自身のメッセージは調べない）
  function log(job, text, { fromAgent = false } = {}) {
    for (const line of String(text).split(/\r?\n/)) {
      if (!line.trim()) continue;
      job.output.push(line);
      if (job.output.length > OUTPUT_LINES) job.output.shift();
      if (fromAgent && quota.inspectOutput(job.agentId, line)) job.limitHit = true;
    }
    onJob?.(publicJob(job));
  }

  // ---------- 依頼の受付 ----------

  function submit({ agentId, prompt, title, groupId = null, worktreeOf = null, kind = 'task' }) {
    const agent = agents.byId(agentId);
    if (!agent) throw new Error('知らないエージェントです');
    if (!String(prompt ?? '').trim()) throw new Error('依頼の内容が空です');
    const job = {
      id: crypto.randomUUID(),
      agentId,
      worktreeOf: worktreeOf ?? agentId,
      kind,
      title: String(title || prompt).split('\n')[0].slice(0, 80),
      prompt: String(prompt),
      groupId,
      status: 'queued',
      attempts: 0,
      resume: false,
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      resumeAt: null,
      output: [],
      commit: null,
      error: null,
    };
    jobs.set(job.id, job);
    update(job);
    schedule();
    return publicJob(job);
  }

  // ---------- 実行 ----------

  function busyWorktrees() {
    return new Set([...jobs.values()].filter((j) => j.status === 'running').map((j) => j.worktreeOf));
  }

  function schedule() {
    const busy = busyWorktrees();
    const queued = [...jobs.values()].filter((j) => j.status === 'queued').sort((a, b) => a.createdAt - b.createdAt);
    for (const job of queued) {
      if (busy.has(job.worktreeOf)) continue;
      const q = quota.get(job.agentId);
      if (q.state === 'exhausted') {
        update(job, { status: 'waiting-quota', resumeAt: q.resetAt ?? null });
        continue;
      }
      busy.add(job.worktreeOf);
      start(job).catch((err) => {
        log(job, err.message);
        update(job, { status: 'failed', error: err.message, endedAt: Date.now() });
        schedule();
      });
    }
  }

  async function start(job) {
    const agent = agents.byId(job.agentId);
    update(job, { status: 'running', startedAt: Date.now(), attempts: job.attempts + 1, error: null, resumeAt: null });
    // 前回の試行の結果を持ち越さない
    job.limitHit = false;
    job.spawnError = false;
    job.timedOut = false;
    job.exitCode = null;

    const wt = await git.prepareWorktree(job.worktreeOf);
    job.worktree = wt.path;
    job.branch = wt.branch;

    // 衝突の解決: まとめ先を取り込み、衝突した状態のまま渡す
    let prompt = job.prompt;
    if (job.kind === 'resolve') {
      const files = await git.startMerge(job.worktreeOf);
      if (files.length === 0) {
        const commit = await git.commitAll(wt.path, `OZ Assistant: ${wt.base} を取り込み`);
        update(job, { status: 'done', endedAt: Date.now(), commit });
        schedule();
        return;
      }
      prompt += `\n\n衝突しているファイル:\n${files.map((f) => `- ${f}`).join('\n')}`;
    }

    const text = (job.resume || job.attempts > 1 ? RESUME_NOTE : '') + prompt;
    const inv = await agents.invocation(job.agentId, { mode: 'task', prompt: text, cwd: wt.path });

    if (!inv) {
      // CLI がなくエディタだけある（Antigravity のエディタのみ）: 依頼をファイルに書いて作業場所を開き、「完了」を押してもらう
      const detected = (await agents.detect()).agents.find((a) => a.id === job.agentId);
      if (detected?.ide) {
        fs.writeFileSync(path.join(wt.path, agents.TASK_FILE), `# OZ Assistant からの依頼\n\n${prompt}\n`, 'utf8');
        await agents.launch(agent.id, wt.path).catch((err) => log(job, err.message));
        log(job, `${agent.name} のエディタで作業場所を開きました。依頼は ${agents.TASK_FILE} にあります。終わったら「完了にする」を押してください。`);
        log(job, `自動で動かすには Antigravity CLI（agy）を入れてください。`);
        update(job, { status: 'handed-off' });
        return;
      }
      throw new Error(`${agent.name} が見つかりません。単体起動の画面からインストールしてください`);
    }

    const child = spawnImpl(inv.command, inv.args, {
      cwd: wt.path,
      shell: inv.shell,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, OZ_ASSISTANT: '1' },
    });
    processes.set(job.id, child);
    log(job, `${agent.name} が作業を始めました（${wt.branch}）`);

    const timeout = setTimeout(() => {
      log(job, '時間がかかりすぎたため停止しました');
      job.timedOut = true;
      killTree(child);
    }, JOB_TIMEOUT_MS);

    child.stdout?.on('data', (d) => log(job, d, { fromAgent: true }));
    child.stderr?.on('data', (d) => log(job, d, { fromAgent: true }));
    child.stdin?.on('error', () => {});
    child.stdin?.end(inv.stdin);

    await new Promise((resolve) => {
      child.on('error', (err) => {
        log(job, `起動できませんでした: ${err.message}`);
        job.spawnError = true;
        resolve();
      });
      child.on('close', (code) => {
        job.exitCode = code;
        resolve();
      });
    });
    clearTimeout(timeout);
    processes.delete(job.id);
    await finish(job);
  }

  async function finish(job) {
    const agent = agents.byId(job.agentId);
    // 依頼を書いたファイルが残っていたら、コミットに含めないように消す
    if (job.worktree) fs.rmSync(path.join(job.worktree, agents.TASK_FILE), { force: true });
    if (job.status === 'cancelled') {
      await git.commitAll(job.worktree, `${agent.name}: 取り消し時点の保存`).catch(() => null);
      schedule();
      return;
    }

    // 利用枠の上限: 途中までを保存し、回復を待って自動で再開する
    if (job.limitHit) {
      const commit = await git.commitAll(job.worktree, `${agent.name}: 利用枠の上限で中断（途中まで）— ${job.title}`).catch(() => null);
      const q = quota.get(job.agentId);
      log(job, `利用枠の上限に達しました。${q.resetAt ? new Date(q.resetAt).toLocaleString('ja-JP') : '回復'}に自動で再開します`);
      update(job, { status: 'waiting-quota', resumeAt: q.resetAt ?? null, commit: commit?.committed ? commit : job.commit });
      schedule();
      return;
    }

    const ok = !job.spawnError && !job.timedOut && job.exitCode === 0;
    const commit = await git
      .commitAll(job.worktree, `${agent.name}: ${job.title}`)
      .catch((err) => ({ committed: false, error: err.message }));
    update(job, {
      status: ok ? 'done' : 'failed',
      endedAt: Date.now(),
      commit: commit?.committed ? commit : null,
      error: ok ? null : job.output.slice(-3).join(' / ') || `終了コード ${job.exitCode}`,
    });
    writeLog(job);
    schedule();
  }

  // 作業の記録を Obsidian に残す（保管庫がなければ何もしない）
  function writeLog(job) {
    try {
      const agent = agents.byId(job.agentId);
      const files = job.commit?.files ?? [];
      const body = [
        `# ${job.title}`,
        '',
        `- エージェント: ${agent.name}`,
        `- 結果: ${job.status === 'done' ? '完了' : '失敗'}`,
        `- ブランチ: ${job.branch ?? ''}`,
        job.commit ? `- コミット: ${job.commit.hash}` : null,
        `- 開始: ${new Date(job.startedAt).toLocaleString('ja-JP')}`,
        `- 終了: ${new Date(job.endedAt).toLocaleString('ja-JP')}`,
        '',
        '## 依頼',
        '',
        job.prompt,
        '',
        files.length ? '## 変更したファイル' : null,
        files.length ? files.map((f) => `- ${f.file}（+${f.added} / -${f.removed}）`).join('\n') : null,
        '',
        '## 出力（最後の部分）',
        '',
        '```',
        job.output.slice(-30).join('\n'),
        '```',
        '',
        `[[作業ログ]] [[${agent.name}]]`,
        '',
      ]
        .filter((line) => line !== null)
        .join('\n');
      vault.ensureHub('作業ログ', 'OZ Assistant のエージェントが行った作業の記録です。');
      vault.ensureHub(agent.name, `${agent.name}（${agent.vendor}）の作業のまとめです。`);
      vault.addNote({ title: `${new Date(job.endedAt).toISOString().slice(0, 10)} ${agent.name} ${job.title}`, body, folder: 'OZ/作業ログ', tags: ['oz-log'] });
    } catch {
      // 保管庫がない・書けないときは記録を省く
    }
  }

  // ---------- 利用枠の回復による再開 ----------

  function tick() {
    let resumed = false;
    for (const job of jobs.values()) {
      if (job.status !== 'waiting-quota') continue;
      quota.refresh(job.agentId);
      const q = quota.get(job.agentId);
      if (q.state !== 'exhausted') {
        job.resume = true;
        log(job, '利用枠が回復しました。続きから再開します');
        update(job, { status: 'queued', resumeAt: null });
        resumed = true;
      }
    }
    if (resumed) schedule();
  }

  quota.subscribe((agentId, q) => {
    if (q.state !== 'exhausted') tick();
  });

  // ---------- 操作 ----------

  function cancel(jobId) {
    const job = jobs.get(jobId);
    if (!job || TERMINAL.has(job.status)) return job ? publicJob(job) : null;
    const child = processes.get(jobId);
    update(job, { status: 'cancelled', endedAt: Date.now() });
    if (child) killTree(child);
    else schedule();
    return publicJob(job);
  }

  // アプリに渡した依頼（Antigravity）の完了。作業場所の変更を保存する
  async function complete(jobId) {
    const job = jobs.get(jobId);
    if (!job || job.status !== 'handed-off') throw new Error('完了にできる依頼ではありません');
    const agent = agents.byId(job.agentId);
    try {
      fs.rmSync(path.join(job.worktree, agents.TASK_FILE), { force: true });
    } catch {
      // 消せなくても続ける
    }
    const commit = await git.commitAll(job.worktree, `${agent.name}: ${job.title}`).catch(() => null);
    update(job, { status: 'done', endedAt: Date.now(), commit: commit?.committed ? commit : null });
    writeLog(job);
    schedule();
    return publicJob(job);
  }

  function retry(jobId) {
    const job = jobs.get(jobId);
    if (!job || !['failed', 'cancelled', 'waiting-quota'].includes(job.status)) throw new Error('やり直せない依頼です');
    job.resume = job.attempts > 0;
    update(job, { status: 'queued', error: null, resumeAt: null });
    schedule();
    return publicJob(job);
  }

  function list() {
    return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map(publicJob);
  }

  function get(jobId) {
    const job = jobs.get(jobId);
    return job ? { ...job } : null;
  }

  // ---------- 指令室: 分担と統合 ----------

  function createGroup({ request, assignments, autoMerge = true }) {
    if (!Array.isArray(assignments) || assignments.length === 0) throw new Error('分担が空です');
    const group = {
      id: crypto.randomUUID(),
      request: String(request ?? ''),
      createdAt: Date.now(),
      // 依頼をすべて登録し終わるまでは、終わったかどうかを判定しない
      status: 'starting',
      autoMerge,
      jobIds: [],
      merge: null,
      resolveAttempts: 0,
    };
    groups.set(group.id, group);
    for (const a of assignments) {
      const prompt = [
        `全体の目的: ${group.request}`,
        '',
        `あなたの担当: ${a.task}`,
        '',
        'ほかのエージェントが別の部分を同時に担当しています。担当の範囲だけを変更し、終わったら作業内容を短くまとめてください。',
      ].join('\n');
      const job = submit({ agentId: a.agentId, prompt, title: a.task, groupId: group.id });
      group.jobIds.push(job.id);
    }
    group.status = 'running';
    save();
    onGroup?.({ ...group });
    checkGroup(group.id);
    return { ...group };
  }

  let checking = new Set();
  async function checkGroup(groupId) {
    const group = groups.get(groupId);
    if (!group || group.status !== 'running' || checking.has(groupId) || group.jobIds.length === 0) return;
    const members = group.jobIds.map((id) => jobs.get(id)).filter(Boolean);
    if (members.length < group.jobIds.length) return;
    if (!members.every((j) => TERMINAL.has(j.status))) return;

    checking.add(groupId);
    try {
      const doneAgents = [...new Set(members.filter((j) => j.status === 'done').map((j) => j.worktreeOf))];
      if (!group.autoMerge || doneAgents.length === 0) {
        group.status = 'finished';
      } else {
        group.merge = await git.mergeAgents(doneAgents);
        if (group.merge.conflicts.length && group.resolveAttempts < 1) {
          // 衝突は Claude Code に解決を頼み、終わったらもう一度統合する
          group.resolveAttempts += 1;
          for (const c of group.merge.conflicts) {
            const job = submit({
              agentId: 'claude-code',
              worktreeOf: c.agentId,
              kind: 'resolve',
              groupId: group.id,
              title: `${c.agentId} の衝突を解決`,
              prompt: `このフォルダでは、まとめ先のブランチを取り込んだときに衝突が起きています。両方の変更の意図を保つように衝突マーカー（<<<<<<< ======= >>>>>>>）を解消してください。全体の目的: ${group.request}`,
            });
            group.jobIds.push(job.id);
          }
        } else {
          group.status = group.merge.conflicts.length ? 'conflict' : 'merged';
        }
      }
      save();
      onGroup?.({ ...group });
    } catch (err) {
      group.status = 'failed';
      group.error = err.message;
      save();
      onGroup?.({ ...group });
    } finally {
      checking.delete(groupId);
    }
  }

  function listGroups() {
    return [...groups.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30).map((g) => ({ ...g }));
  }

  // ---------- 開始・終了 ----------

  function startLoop() {
    load();
    timer = setInterval(tick, TICK_MS);
    tick();
    schedule();
  }

  function stopAll() {
    clearInterval(timer);
    for (const child of processes.values()) killTree(child);
    save();
  }

  return { submit, cancel, complete, retry, list, get, createGroup, listGroups, startLoop, stopAll, tick, schedule };
}

module.exports = { createRunner, RESUME_NOTE };
