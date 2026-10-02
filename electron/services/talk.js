'use strict';

// 話しかけモードの頭脳。
// - 「Codex に〜を頼んで」「分担して〜」「ニュースを読んで」「PCの状態は」などは、アプリの機能として実行する
// - それ以外は Claude Code（会話だけでファイルは編集しない）が答え、上限なら Codex が代わりに答える
// - VOICEVOX が起動していれば、その女性ボイスで読み上げる音声を作る
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const TIMEOUT_MS = 2 * 60 * 1000;
const HISTORY_TURNS = 6;
const VOICEVOX = 'http://127.0.0.1:50021';

const AGENT_WORDS = [
  { id: 'claude-code', re: /(claude\s*code|クロード\s*コード|claude|クロード)/i },
  { id: 'codex', re: /(codex|コーデックス)/i },
  { id: 'antigravity', re: /(antigravity|アンチグラビティ)/i },
];
const DELEGATE_VERB = /(に|へ)?\s*(頼んで|頼む|お願いして|お願い|依頼して|任せて|やらせて|やってもらって)(ください|下さい)?[。.!！]*$/;

const PERSONA = [
  'あなたは「OZ」という名前の、パソコン作業を手伝う音声アシスタントです。',
  '親しみやすく丁寧な話し言葉で、日本語で短く（2〜4文）答えてください。',
  '読み上げに使うので、マークダウン・箇条書きの記号・絵文字・URLは使わないでください。',
  'ファイルの編集やコマンドの実行はせず、会話だけで答えてください。',
].join('\n');

const pad = (n) => String(n).padStart(2, '0');
const clock = (ms) => {
  const d = new Date(ms);
  return `${d.getHours()}時${pad(d.getMinutes())}分`;
};

// 発話から「どのエージェントに・何を頼むか」を読み取る
function parseDelegation(text) {
  const t = text.trim().replace(/[。.!！]+$/, '');
  const agent = AGENT_WORDS.find((a) => a.re.test(t));
  if (!agent) return null;

  // 「Xに〜を直してもらって」「Xに〜しておいて」の形
  const favor = t.match(/^(.*?)\s*(に|へ)\s*(.+?)(てもらって|ておいて|といて)(ください|下さい)?$/);
  if (favor && agent.re.test(favor[1])) {
    const task = `${favor[3]}て`.trim();
    return task.length >= 3 ? { agentId: agent.id, task } : null;
  }

  if (!DELEGATE_VERB.test(t)) return null;
  const task = t
    .replace(DELEGATE_VERB, '')
    .replace(agent.re, '')
    .replace(/^\s*(に|へ|さん)\s*/, '')
    .replace(/\s*(に|へ)\s*$/, '')
    .replace(/(を|、|,)\s*$/, '')
    .replace(/の$/, '')
    .trim();
  return task.length >= 2 ? { agentId: agent.id, task } : null;
}

function parseSplit(text) {
  const m = text.trim().match(/^(?:みんなで|全員で)?分担して(?:、|,)?\s*(.+)$/);
  if (!m) return null;
  const task = m[1].replace(/[。.!！]+$/, '').trim();
  return task.length >= 2 ? task : null;
}

function clean(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*#`>_]/g, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}

function createTalk({ agents, quota, runner, planner, news, system, vault, dataDir, fetch, getSettings, spawnImpl = spawn }) {
  const cwd = path.join(dataDir, 'talk');
  fs.mkdirSync(cwd, { recursive: true });

  async function run(agentId, input) {
    const inv = await agents.invocation(agentId, { mode: 'chat', prompt: input, cwd });
    if (!inv) return { ok: false, out: '', err: '見つかりません' };
    return new Promise((resolve) => {
      const child = spawnImpl(inv.command, inv.args, { cwd, shell: inv.shell, windowsHide: true });
      let out = '';
      let err = '';
      const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
      child.stdout?.on('data', (d) => { out += d; });
      child.stderr?.on('data', (d) => { err += d; });
      child.stdin?.on('error', () => {});
      child.stdin?.end(inv.stdin);
      child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, out, err: e.message }); });
      child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, out, err }); });
    });
  }

  function limited(agentId, result) {
    let hit = false;
    for (const line of `${result.out}\n${result.err}`.split(/\r?\n/)) {
      if (quota.inspectOutput(agentId, line)) hit = true;
    }
    return hit;
  }

  // 会話の答え。Claude Code → Codex の順に使える方で答える
  async function chat(text, history) {
    const lines = history.slice(-HISTORY_TURNS * 2).map((h) => `${h.role === 'user' ? 'ユーザー' : 'OZ'}: ${h.text}`);
    const prompt = `${PERSONA}\n\n${lines.join('\n')}\nユーザー: ${text}\nOZ:`;
    const detected = await agents.detect();
    const installed = new Set(detected.agents.filter((a) => a.installed).map((a) => a.id));

    const brains = [{ id: 'claude-code' }, { id: 'codex' }];
    for (const brain of brains) {
      if (!installed.has(brain.id) || quota.get(brain.id).state === 'exhausted') continue;
      const result = await run(brain.id, prompt);
      if (limited(brain.id, result)) continue;
      const reply = clean(result.out);
      if (result.ok && reply) return { reply, source: brain.id };
    }

    const waits = brains.map((b) => quota.get(b.id)).filter((q) => q.state === 'exhausted' && q.resetAt);
    if (waits.length) {
      const soonest = Math.min(...waits.map((q) => q.resetAt));
      return { reply: `いまは会話に使えるAIが利用枠の上限です。${clock(soonest)}ごろに回復します。`, source: 'oz' };
    }
    if (!installed.has('claude-code') && !installed.has('codex')) {
      return { reply: '会話に使う Claude Code か Codex が見つかりません。単体起動の画面からインストールできます。', source: 'oz' };
    }
    return { reply: 'ごめんなさい、うまく答えを作れませんでした。もう一度話しかけてください。', source: 'oz' };
  }

  async function newsReply() {
    const data = await news.list();
    const items = (data.items ?? []).slice(0, 3);
    if (!items.length) return 'いまはニュースを取得できませんでした。';
    return `新しいニュースを${items.length}件お伝えします。${items.map((i, n) => `${n + 1}つ目、${i.source}から。${i.title}。`).join('')}`;
  }

  async function systemReply() {
    const s = await system.snapshot();
    const cpu = Number.isFinite(s.cpu?.load) ? `CPUは${Math.round(s.cpu.load)}パーセント` : 'CPUは分かりません';
    const mem = s.memory ? `メモリは${Math.round((s.memory.used / s.memory.total) * 100)}パーセント使っています` : '';
    const temp = Number.isFinite(s.temperature?.cpu) ? `温度は${Math.round(s.temperature.cpu)}度です` : '';
    return `${[cpu, mem].filter(Boolean).join('、')}。${temp}`;
  }

  function quotaReply() {
    const parts = agents.list().map((a) => {
      const q = quota.get(a.id);
      if (q.state === 'exhausted') return `${a.name}は上限で、${q.resetAt ? `${clock(q.resetAt)}ごろ回復します` : '回復を待っています'}`;
      if (q.state === 'ok' && Number.isFinite(q.remaining)) return `${a.name}は残り${Math.round(q.remaining * 100)}パーセントです`;
      return `${a.name}は使えます`;
    });
    return `${parts.join('。')}。`;
  }

  function log(text, reply) {
    try {
      const d = new Date();
      const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      vault.appendNote({
        folder: 'OZ/会話ログ',
        title: date,
        header: `# ${date} の会話\n\n[[会話ログ]]\n`,
        text: `\n**${pad(d.getHours())}:${pad(d.getMinutes())} あなた**: ${text}\n\n**OZ**: ${reply}\n`,
      });
      vault.ensureHub('会話ログ', 'OZ Assistant との会話の記録です。');
    } catch {
      // 保管庫がないときは記録しない
    }
  }

  async function ask({ text, history = [] } = {}) {
    const said = String(text ?? '').trim().slice(0, 2000);
    if (!said) throw new Error('話した内容が空です');
    let result;

    const delegation = parseDelegation(said);
    const split = !delegation && parseSplit(said);
    if (delegation) {
      const agent = agents.byId(delegation.agentId);
      runner.submit({ agentId: delegation.agentId, prompt: delegation.task });
      const q = quota.get(delegation.agentId);
      result = {
        reply: q.state === 'exhausted'
          ? `${agent.name}に頼みました。いまは利用枠の上限なので、回復したら自動で始めます。`
          : `${agent.name}に「${delegation.task}」を頼みました。終わったらお知らせします。`,
        source: 'oz',
        action: { type: 'delegate', ...delegation },
      };
    } else if (split) {
      const plan = await planner.plan(split);
      const group = runner.createGroup({ request: split, assignments: plan.assignments, autoMerge: getSettings().autoMerge !== false });
      const who = plan.assignments.map((a) => agents.byId(a.agentId).name).join('と');
      result = { reply: `${who}で分担して始めました。全員が終わったら自動でまとめます。`, source: 'oz', action: { type: 'split', groupId: group.id } };
    } else if (/ニュース/.test(said) && /(読んで|教えて|ある|知りたい|は[?？]?$)/.test(said)) {
      result = { reply: await newsReply(), source: 'oz', action: { type: 'news' } };
    } else if (/(PC|パソコン|CPU|メモリ)/i.test(said) && /(状態|どう|使用率|重い)/.test(said)) {
      result = { reply: await systemReply(), source: 'oz', action: { type: 'system' } };
    } else if (/(利用枠|残り枠|上限)/.test(said)) {
      result = { reply: quotaReply(), source: 'oz', action: { type: 'quota' } };
    } else if (/(今|いま)何時/.test(said)) {
      result = { reply: `いまは${clock(Date.now())}です。`, source: 'oz' };
    } else {
      result = await chat(said, history);
    }

    log(said, result.reply);
    return result;
  }

  // ---------- VOICEVOX ----------

  async function voicevoxStatus() {
    try {
      const res = await fetch(`${VOICEVOX}/version`, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return { available: false };
      const speakers = await (await fetch(`${VOICEVOX}/speakers`, { signal: AbortSignal.timeout(3000) })).json();
      return {
        available: true,
        version: (await res.text()).replace(/"/g, ''),
        speakers: speakers.flatMap((s) => s.styles.map((st) => ({ id: st.id, name: `${s.name}（${st.name}）` }))),
      };
    } catch {
      return { available: false };
    }
  }

  async function synthesize({ text, speaker }) {
    const id = Number.isInteger(Number(speaker)) ? Number(speaker) : 2;
    const said = String(text ?? '').slice(0, 1000);
    const query = await fetch(`${VOICEVOX}/audio_query?text=${encodeURIComponent(said)}&speaker=${id}`, { method: 'POST', signal: AbortSignal.timeout(15000) });
    if (!query.ok) throw new Error('VOICEVOX で読み上げを準備できませんでした');
    const res = await fetch(`${VOICEVOX}/synthesis?speaker=${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await query.text(),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error('VOICEVOX で音声を作れませんでした');
    return new Uint8Array(await res.arrayBuffer());
  }

  return { ask, voicevoxStatus, synthesize, _parseDelegation: parseDelegation, _parseSplit: parseSplit };
}

module.exports = { createTalk, parseDelegation, parseSplit };
