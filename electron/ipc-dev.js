'use strict';

// 段階3: エージェント・指令室・利用枠・Git・設定 の画面とのやりとり
const { app, BrowserWindow, Notification, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const secrets = require('./secrets');
const { createGit } = require('./services/git');
const { createQuota } = require('./services/quota');
const { createAgents, cleanAgentSettings } = require('./services/agents');
const { createRunner } = require('./services/runner');
const { createPlanner } = require('./services/planner');
const { createTalk } = require('./services/talk');
const system = require('./services/system');

const QUOTA_POLL_MS = 60000;

function defaultWorkspace() {
  return path.join(app.getPath('documents'), 'OZ-Workspace');
}

// 開発まわりの設定。作業フォルダが未設定なら「ドキュメント\OZ-Workspace」を使う
function devConfig() {
  const dev = config.get('dev') ?? {};
  if (!dev.workspace) {
    dev.workspace = defaultWorkspace();
    fs.mkdirSync(dev.workspace, { recursive: true });
    config.set('dev', dev);
  }
  return { autoMerge: true, ...dev };
}

const TALK_DEFAULTS = {
  model: 'onnx-community/whisper-small',
  engine: 'windows', // windows: Windows の音声 / voicevox: VOICEVOX
  voice: '',
  rate: 1.05,
  pitch: 1.1,
  speaker: 2,
  autoListen: false,
};

function talkConfig() {
  return { ...TALK_DEFAULTS, ...(config.get('talk') ?? {}) };
}

function registerDevIpc({ handle, broadcast, openExternal, vault, news, speechModels, fetch }) {
  const userData = app.getPath('userData');
  const git = createGit({ getConfig: devConfig });
  const quota = createQuota();
  // エージェントごとのモデルとエフォート（空なら各 CLI の設定のまま）
  const agentSettings = (agentId) => (config.get('agentSettings') ?? {})[agentId] ?? {};
  const agents = createAgents({ openExternal, getSettings: agentSettings });
  // 依頼の状態が変わったら Windows の通知で知らせる
  const lastStatus = new Map();
  const NOTIFY = {
    done: (j, name) => [`${name} の作業が終わりました`, j.title],
    failed: (j, name) => [`${name} の作業が失敗しました`, j.title],
    'waiting-quota': (j, name) => [`${name} が利用枠の上限です`, j.resumeAt ? `${new Date(j.resumeAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}ごろ自動で再開します` : '回復したら自動で再開します'],
    'handed-off': (j, name) => [`${name} で作業場所を開きました`, '終わったら「完了にする」を押してください'],
  };
  function notifyJob(job) {
    const prev = lastStatus.get(job.id);
    lastStatus.set(job.id, job.status);
    if (prev === job.status || !NOTIFY[job.status] || !Notification.isSupported()) return;
    if (config.get('app')?.notifications === false) return;
    const [title, body] = NOTIFY[job.status](job, agents.byId(job.agentId)?.name ?? job.agentId);
    new Notification({ title, body, silent: false }).show();
  }
  const NOTIFY_GROUP = {
    merged: '分担した作業をまとめました',
    conflict: '分担した作業の統合で衝突が残りました',
    partial: '分担した作業の一部が失敗しました',
    failed: '分担した作業の統合に失敗しました',
  };

  const runner = createRunner({
    getAutoMerge: () => devConfig().autoMerge !== false,
    agents,
    git,
    quota,
    vault,
    dataDir: userData,
    onJob: (job) => {
      broadcast('jobs:update', job);
      notifyJob(job);
    },
    onGroup: (group) => {
      broadcast('groups:update', group);
      if (NOTIFY_GROUP[group.status] && Notification.isSupported() && config.get('app')?.notifications !== false) {
        new Notification({ title: NOTIFY_GROUP[group.status], body: group.request }).show();
      }
    },
  });
  const planner = createPlanner({ agents, quota, git });

  quota.subscribe((agentId, q) => broadcast('quota:update', q));
  runner.startLoop();
  // ローカルの記録から利用枠を定期的に読み直す
  const poll = setInterval(() => agents.list().forEach((a) => quota.refresh(a.id)), QUOTA_POLL_MS);
  app.on('before-quit', () => {
    clearInterval(poll);
    runner.stopAll();
  });

  // ---------- エージェント ----------

  handle('agents:list', async (options) => {
    const detected = await agents.detect({ force: Boolean(options?.force) });
    return {
      agents: agents.list().map((a) => ({
        ...a,
        ...detected.agents.find((d) => d.id === a.id),
        quota: quota.refresh(a.id),
      })),
      tools: detected.tools,
    };
  });

  // モデルとエフォートを変える。次の依頼・会話・単体起動から使われる
  handle('agents:configure', ({ agentId, model, effort } = {}) => {
    const clean = cleanAgentSettings(String(agentId), { model, effort });
    config.set('agentSettings', { ...(config.get('agentSettings') ?? {}), [agentId]: clean });
    return { ok: true, settings: clean };
  });

  // 単体起動: そのエージェント専用の作業場所を用意して開く
  handle('agents:launch', async (agentId) => {
    const wt = await git.prepareWorktree(String(agentId));
    const result = await agents.launch(String(agentId), wt.path);
    return { ...result, path: wt.path, branch: wt.branch };
  });

  handle('agents:install', ({ agentId, what } = {}) => agents.install(String(agentId), String(what)));

  // 各社サービスの障害情報（Statuspage 形式のもの）
  handle('agents:services', async () => {
    const results = await Promise.all(
      agents.list().map(async (a) => {
        const def = agents.byId(a.id);
        if (!def.statusPage) return { id: a.id, indicator: 'unknown', description: '障害情報の公開ページがありません' };
        try {
          const res = await fetch(def.statusPage, { signal: AbortSignal.timeout(10000) });
          const body = await res.json();
          return { id: a.id, indicator: body.status?.indicator ?? 'unknown', description: body.status?.description ?? '' };
        } catch {
          return { id: a.id, indicator: 'unknown', description: '取得できませんでした' };
        }
      }),
    );
    return { fetchedAt: Date.now(), services: results };
  });

  // ---------- 依頼（ジョブ） ----------

  handle('jobs:list', () => ({ jobs: runner.list(), groups: runner.listGroups() }));
  handle('jobs:submit', ({ agentId, prompt } = {}) => runner.submit({ agentId: String(agentId), prompt: String(prompt ?? '') }));
  handle('jobs:cancel', (jobId) => runner.cancel(String(jobId)));
  handle('jobs:retry', (jobId) => runner.retry(String(jobId)));
  handle('jobs:complete', (jobId) => runner.complete(String(jobId)));
  handle('jobs:output', (jobId) => runner.get(String(jobId))?.output ?? []);

  // ---------- 指令室 ----------

  handle('command:plan', (request) => planner.plan(String(request ?? '')));
  handle('command:run', ({ request, assignments } = {}) => {
    const valid = (Array.isArray(assignments) ? assignments : [])
      .filter((a) => agents.byId(a?.agentId) && String(a?.task ?? '').trim())
      .map((a) => ({ agentId: a.agentId, task: String(a.task) }));
    return runner.createGroup({ request: String(request ?? ''), assignments: valid, autoMerge: devConfig().autoMerge });
  });

  // ---------- 利用枠 ----------

  handle('quota:list', () => agents.list().map((a) => ({ ...quota.refresh(a.id), waiting: runner.list().filter((j) => j.agentId === a.id && j.status === 'waiting-quota').length })));
  // 手動で「上限」「回復」を切り替える（自動で分からないエージェント用）
  handle('quota:set', ({ agentId, state, hours } = {}) => {
    if (!agents.byId(agentId)) throw new Error('知らないエージェントです');
    if (state === 'exhausted') {
      const h = Math.min(Math.max(Number(hours) || 5, 0.1), 24 * 7);
      return quota.markExhausted(agentId, Date.now() + h * 3600000);
    }
    return quota.markRecovered(agentId);
  });

  // ---------- Git ----------

  handle('git:overview', async () => {
    await git.ensureRepo();
    const base = await git.baseBranch();
    const [status, commits, diffs] = await Promise.all([
      git.status(),
      git.recentCommits(25),
      Promise.all(agents.list().map(async (a) => ({ agentId: a.id, ...(await git.branchDiff(a.id)) }))),
    ]);
    return { workspace: git.root(), base, status, commits, branches: diffs };
  });
  handle('git:merge', (agentIds) => git.mergeAgents((Array.isArray(agentIds) ? agentIds : []).filter((id) => agents.byId(id))));

  // ---------- 設定 ----------

  handle('settings:get', () => {
    const dev = devConfig();
    return {
      workspace: dev.workspace,
      gitUserName: dev.gitUserName ?? '',
      gitUserEmail: dev.gitUserEmail ?? '',
      autoMerge: dev.autoMerge !== false,
      githubToken: secrets.hasSecret('githubToken'),
      background: config.get('app')?.background !== false,
      notifications: config.get('app')?.notifications !== false,
      openAtLogin: Boolean(config.get('app')?.openAtLogin),
      vault: vault.info(),
      version: app.getVersion(),
    };
  });

  handle('settings:set', async (patch = {}) => {
    const dev = devConfig();
    if (typeof patch.gitUserName === 'string') dev.gitUserName = patch.gitUserName.trim().slice(0, 100);
    if (typeof patch.gitUserEmail === 'string') dev.gitUserEmail = patch.gitUserEmail.trim().slice(0, 200);
    if (typeof patch.autoMerge === 'boolean') dev.autoMerge = patch.autoMerge;
    config.set('dev', dev);
    if (typeof patch.githubToken === 'string') secrets.setSecret('githubToken', patch.githubToken.trim());
    const appSettings = config.get('app') ?? {};
    for (const key of ['background', 'notifications', 'openAtLogin']) {
      if (typeof patch[key] === 'boolean') appSettings[key] = patch[key];
    }
    config.set('app', appSettings);
    if (typeof patch.openAtLogin === 'boolean' && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: patch.openAtLogin, args: ['--hidden'] });
    }
    if (patch.gitUserName !== undefined || patch.gitUserEmail !== undefined) {
      await git.ensureRepo({ userName: dev.gitUserName || undefined, userEmail: dev.gitUserEmail || undefined }).catch(() => null);
    }
    return { ok: true };
  });

  handle('settings:chooseWorkspace', async () => {
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
      title: '作業フォルダを選ぶ',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { workspace: devConfig().workspace };
    const dev = devConfig();
    dev.workspace = result.filePaths[0];
    config.set('dev', dev);
    await git.ensureRepo().catch(() => null);
    return { workspace: dev.workspace };
  });

  handle('workspace:open', () => ({ ok: agents.openInVSCode(git.root()) }));

  // ---------- 話しかけモード ----------

  const talk = createTalk({
    agents,
    quota,
    runner,
    planner,
    news,
    system,
    vault,
    dataDir: userData,
    fetch,
    getSettings: devConfig,
  });

  handle('talk:ask', ({ text, history } = {}) => {
    const safeHistory = (Array.isArray(history) ? history : [])
      .slice(-12)
      .map((h) => ({ role: h?.role === 'user' ? 'user' : 'oz', text: String(h?.text ?? '').slice(0, 1000) }));
    return talk.ask({ text: String(text ?? ''), history: safeHistory });
  });
  handle('talk:voicevox', () => talk.voicevoxStatus());
  handle('talk:synthesize', ({ text, speaker } = {}) => talk.synthesize({ text, speaker }));
  handle('talk:getSettings', () => talkConfig());
  handle('talk:setSettings', (patch = {}) => {
    const next = talkConfig();
    if (speechModels.MODELS.some((m) => m.id === patch.model)) next.model = patch.model;
    if (patch.engine === 'windows' || patch.engine === 'voicevox') next.engine = patch.engine;
    if (typeof patch.voice === 'string') next.voice = patch.voice.slice(0, 200);
    if (Number.isFinite(patch.rate)) next.rate = Math.min(Math.max(patch.rate, 0.5), 2);
    if (Number.isFinite(patch.pitch)) next.pitch = Math.min(Math.max(patch.pitch, 0.5), 2);
    if (Number.isInteger(patch.speaker)) next.speaker = patch.speaker;
    if (typeof patch.autoListen === 'boolean') next.autoListen = patch.autoListen;
    config.set('talk', next);
    return next;
  });

  handle('speech:models', () => speechModels.list());
  handle('speech:download', (id) => speechModels.download(String(id)));
  handle('speech:remove', (id) => speechModels.remove(String(id)));

  return { getGithubToken: () => secrets.getSecret('githubToken') };
}

module.exports = { registerDevIpc };
