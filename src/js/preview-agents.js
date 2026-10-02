// ブラウザで画面を確認するときの、エージェント関連のサンプル（Electron では使わない）
const AGENTS = [
  { id: 'claude-code', name: 'Claude Code', vendor: 'Anthropic', kind: 'cli', strengths: '設計・レビュー・テスト・複雑な変更', npmPackage: '@anthropic-ai/claude-code', vscodeExtension: 'anthropic.claude-code', installed: true, version: 'サンプル 1.0' },
  { id: 'codex', name: 'Codex', vendor: 'OpenAI', kind: 'cli', strengths: '処理の実装・API・スクリプト', npmPackage: '@openai/codex', vscodeExtension: 'openai.chatgpt', installed: true, version: 'サンプル 0.1' },
  { id: 'antigravity', name: 'Antigravity', vendor: 'Google', kind: 'app', strengths: '画面・UI・ブラウザでの確認', downloadUrl: 'https://antigravity.google/download', installed: false, version: null },
];

export function createAgentPreview() {
  const jobListeners = new Set();
  const groupListeners = new Set();
  const quotaListeners = new Set();
  const now = Date.now();

  const quotas = {
    'claude-code': { agentId: 'claude-code', state: 'exhausted', resetAt: now + 2 * 3600000 + 14 * 60000, remaining: 0, source: 'output' },
    codex: { agentId: 'codex', state: 'ok', remaining: 0.63, resetAt: null, source: 'codex-session' },
    antigravity: { agentId: 'antigravity', state: 'unknown' },
  };

  const jobs = new Map();
  const groups = new Map();
  const talkSettings = { model: 'onnx-community/whisper-small', engine: 'windows', voice: '', rate: 1.05, pitch: 1.1, speaker: 2, autoListen: false };
  const addJob = (job) => jobs.set(job.id, { attempts: 1, output: [], createdAt: Date.now(), ...job });
  addJob({ id: 'j1', agentId: 'claude-code', title: 'ログイン画面のテストを書く', status: 'waiting-quota', resumeAt: quotas['claude-code'].resetAt, branch: 'oz/claude-code', output: ['Claude Code が作業を始めました（oz/claude-code）', 'Claude usage limit reached', '利用枠の上限に達しました。自動で再開します'], createdAt: now - 40 * 60000 });
  addJob({ id: 'j2', agentId: 'codex', title: 'ログインAPIを実装する', status: 'done', branch: 'oz/codex', commit: { hash: 'a1b2c3d', files: [] }, createdAt: now - 3 * 3600000 });

  const emitJob = (job) => jobListeners.forEach((fn) => fn({ ...job }));
  const emitGroup = (g) => groupListeners.forEach((fn) => fn({ ...g }));

  // 依頼を数秒で終わらせる
  function simulate(job) {
    setTimeout(() => {
      job.status = 'running';
      job.output = [`${job.agentId} が作業を始めました（サンプル）`];
      emitJob(job);
      setTimeout(() => {
        job.status = 'done';
        job.commit = { hash: Math.random().toString(16).slice(2, 9), files: [] };
        job.output.push('作業が終わりました（サンプル）');
        emitJob(job);
        for (const g of groups.values()) {
          if (g.jobIds.includes(job.id) && g.jobIds.every((id) => jobs.get(id).status === 'done')) {
            g.status = 'merged';
            g.merge = { base: 'main', merged: g.jobIds.map((id) => jobs.get(id).agentId), conflicts: [] };
            emitGroup(g);
          }
        }
      }, 3000);
    }, 600);
  }

  function submit({ agentId, prompt, groupId = null, title }) {
    const job = { id: crypto.randomUUID(), agentId, worktreeOf: agentId, title: (title ?? prompt).split('\n')[0].slice(0, 80), prompt, groupId, status: 'queued', attempts: 0, output: [], createdAt: Date.now(), branch: `oz/${agentId}` };
    jobs.set(job.id, job);
    if (quotas[agentId]?.state === 'exhausted') {
      job.status = 'waiting-quota';
      job.resumeAt = quotas[agentId].resetAt;
    } else {
      simulate(job);
    }
    return { ...job };
  }

  return {
    agents: {
      async list() {
        return { preview: true, agents: AGENTS.map((a) => ({ ...a, quota: quotas[a.id] })), tools: { git: true, vscode: true, npm: true } };
      },
      async launch(agentId) {
        return { opened: ['VS Code', `${agentId}（サンプル）`], branch: `oz/${agentId}` };
      },
      async install() {
        return { error: 'プレビューではインストールできません' };
      },
      async services() {
        return { fetchedAt: Date.now(), services: [
          { id: 'claude-code', indicator: 'none', description: 'All Systems Operational（サンプル）' },
          { id: 'codex', indicator: 'none', description: 'All Systems Operational（サンプル）' },
          { id: 'antigravity', indicator: 'unknown', description: '障害情報の公開ページがありません' },
        ] };
      },
    },
    jobs: {
      async list() {
        return { jobs: [...jobs.values()].map((j) => ({ ...j })), groups: [...groups.values()] };
      },
      async submit(args) {
        return submit(args);
      },
      async cancel(id) {
        const job = jobs.get(id);
        job.status = 'cancelled';
        emitJob(job);
        return { ...job };
      },
      async retry(id) {
        const job = jobs.get(id);
        job.status = 'queued';
        simulate(job);
        return { ...job };
      },
      async complete(id) {
        const job = jobs.get(id);
        job.status = 'done';
        return { ...job };
      },
      onUpdate(fn) {
        jobListeners.add(fn);
        return () => jobListeners.delete(fn);
      },
      onGroup(fn) {
        groupListeners.add(fn);
        return () => groupListeners.delete(fn);
      },
    },
    command: {
      async plan() {
        await new Promise((r) => setTimeout(r, 800));
        return { preview: true, source: 'claude-code', assignments: [
          { agentId: 'codex', task: 'ログインAPI（/api/login）を実装し、パスワードはハッシュで照合する' },
          { agentId: 'antigravity', task: 'ログイン画面を作り、ブラウザで表示を確認する' },
        ] };
      },
      async run({ request, assignments }) {
        const group = { id: crypto.randomUUID(), request, createdAt: Date.now(), status: 'running', jobIds: [], merge: null };
        groups.set(group.id, group);
        for (const a of assignments) group.jobIds.push(submit({ agentId: a.agentId, prompt: a.task, title: a.task, groupId: group.id }).id);
        return { ...group };
      },
    },
    quota: {
      async list() {
        return { preview: true, items: Object.values(quotas).map((q) => ({ ...q, waiting: [...jobs.values()].filter((j) => j.agentId === q.agentId && j.status === 'waiting-quota').length })) };
      },
      async set({ agentId, state, hours = 5 }) {
        quotas[agentId] = state === 'exhausted'
          ? { agentId, state, resetAt: Date.now() + hours * 3600000, remaining: 0, source: 'manual' }
          : { agentId, state: 'ok', remaining: null, resetAt: null };
        if (state !== 'exhausted') {
          for (const job of jobs.values()) {
            if (job.agentId === agentId && job.status === 'waiting-quota') {
              job.attempts += 1;
              simulate(job);
            }
          }
        }
        quotaListeners.forEach((fn) => fn(quotas[agentId]));
        return quotas[agentId];
      },
      onUpdate(fn) {
        quotaListeners.add(fn);
        return () => quotaListeners.delete(fn);
      },
    },
    git: {
      async overview() {
        return {
          workspace: 'C:\\Users\\you\\Documents\\OZ-Workspace（サンプル）',
          base: 'main',
          status: { repo: true, branch: 'main', changed: 0 },
          branches: [
            { agentId: 'claude-code', branch: 'oz/claude-code', ahead: 1, files: [{}, {}], added: 42, removed: 3 },
            { agentId: 'codex', branch: 'oz/codex', ahead: 0, files: [], added: 0, removed: 0 },
            { agentId: 'antigravity', branch: 'oz/antigravity', ahead: 0, files: [], added: 0, removed: 0 },
          ],
          commits: [
            { hash: 'f3e2d1c', subject: 'Claude Code: 利用枠の上限で中断（途中まで）— ログイン画面のテストを書く', time: Date.now() - 40 * 60000 },
            { hash: 'a1b2c3d', subject: 'OZ Assistant: codex の作業を統合', time: Date.now() - 2.9 * 3600000 },
            { hash: '9e8d7c6', subject: 'Codex: ログインAPIを実装する', time: Date.now() - 3 * 3600000 },
          ],
        };
      },
      async merge() {
        return { base: 'main', merged: ['claude-code'], conflicts: [] };
      },
    },
    settings: {
      async get() {
        return {
          preview: true,
          workspace: 'C:\\Users\\you\\Documents\\OZ-Workspace',
          gitUserName: '',
          gitUserEmail: '',
          autoMerge: true,
          githubToken: false,
          background: true,
          notifications: true,
          openAtLogin: false,
          vault: { path: 'C:\\Users\\you\\Documents\\開発環境001', name: '開発環境001', expectedName: '開発環境001' },
          version: '0.3.0',
        };
      },
      async set() {
        return { error: 'プレビューでは保存できません' };
      },
      async chooseWorkspace() {
        return { error: 'プレビューではフォルダを選べません' };
      },
    },
    workspace: {
      async open() {
        return { ok: false };
      },
    },
    talk: {
      async getSettings() {
        return { ...talkSettings, preview: true };
      },
      async setSettings(patch) {
        Object.assign(talkSettings, patch);
        return { ...talkSettings };
      },
      async ask({ text }) {
        await new Promise((r) => setTimeout(r, 700));
        if (/頼んで|お願い/.test(text) && /codex|コーデックス/i.test(text)) {
          return { reply: 'Codexに頼みました。終わったらお知らせします。（サンプル）', action: { type: 'delegate', agentId: 'codex' } };
        }
        if (/ニュース/.test(text)) return { reply: '新しいニュースを3件お伝えします。これはプレビュー用のサンプルです。', action: { type: 'news' } };
        if (/(PC|パソコン)/i.test(text)) return { reply: 'CPUは18パーセント、メモリは46パーセント使っています。（サンプル）', action: { type: 'system' } };
        return { reply: 'プレビューなので、決まった文面でお返事しています。アプリでは Claude Code が答えます。' };
      },
      async voicevox() {
        return { available: false };
      },
    },
    speech: {
      async models() {
        return [
          { id: 'onnx-community/whisper-small', label: '高精度（small・約250MB）', installed: false },
          { id: 'onnx-community/whisper-base', label: '軽量（base・約80MB）', installed: false },
        ];
      },
      async download() {
        return { error: 'プレビューではダウンロードできません' };
      },
    },
  };
}
