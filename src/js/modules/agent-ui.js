// エージェント関連の画面で共通の部品（依頼の行・状態の表示）
import { h, formatRelative } from '../ui.js';

export const AGENT_NAMES = { 'claude-code': 'Claude Code', codex: 'Codex', antigravity: 'Antigravity' };

const JOB_STATUS = {
  queued: { label: '順番待ち', tone: 'neutral' },
  running: { label: '作業中', tone: 'active' },
  'waiting-quota': { label: '利用枠の回復待ち', tone: 'warning' },
  'handed-off': { label: 'アプリで作業中', tone: 'active' },
  done: { label: '完了', tone: 'good' },
  failed: { label: '失敗', tone: 'critical' },
  cancelled: { label: '取り消し', tone: 'neutral' },
};

const QUOTA_STATE = {
  ok: { label: '使える', tone: 'good' },
  exhausted: { label: '上限', tone: 'warning' },
  unknown: { label: '不明', tone: 'neutral' },
};

export function statusChip(label, tone) {
  return h('span', { class: `state state-${tone}` }, label);
}

export function jobStatusChip(job) {
  const s = JOB_STATUS[job.status] ?? { label: job.status, tone: 'neutral' };
  return statusChip(s.label, s.tone);
}

export function quotaChip(q) {
  const s = QUOTA_STATE[q?.state] ?? QUOTA_STATE.unknown;
  return statusChip(s.label, s.tone);
}

export function formatClock(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

export function formatCountdown(ms) {
  if (!ms) return '';
  const left = Math.max(0, ms - Date.now());
  if (left === 0) return 'まもなく';
  const total = Math.ceil(left / 60000);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return hours > 0 ? `あと${hours}時間${mins}分` : `あと${mins}分`;
}

// 依頼1件の行。操作ボタンは状態に応じて出す
export function jobRow(job, oz, { onChange } = {}) {
  const act = (fn, label, primary = false) =>
    h('button', {
      type: 'button',
      class: `btn btn-small${primary ? ' btn-primary' : ''}`,
      onclick: async (e) => {
        e.target.disabled = true;
        const result = await fn(job.id);
        e.target.disabled = false;
        onChange?.(result);
      },
    }, label);

  const actions = [];
  if (['queued', 'running', 'waiting-quota', 'handed-off'].includes(job.status)) actions.push(act(oz.jobs.cancel, '取り消す'));
  if (job.status === 'handed-off') actions.push(act(oz.jobs.complete, '完了にする', true));
  if (['failed', 'cancelled', 'waiting-quota'].includes(job.status)) actions.push(act(oz.jobs.retry, job.status === 'waiting-quota' ? '今すぐ再開' : 'やり直す'));

  const detail = [
    job.status === 'waiting-quota' && job.resumeAt ? `${formatClock(job.resumeAt)}ごろ自動で再開（${formatCountdown(job.resumeAt)}）` : null,
    job.attempts > 1 ? `${job.attempts}回目` : null,
    job.branch,
    job.commit?.hash ? `コミット ${job.commit.hash}` : null,
  ].filter(Boolean).join('  ·  ');

  return h(
    'li',
    { class: `job job-${job.status}`, dataset: { id: job.id } },
    h('div', { class: 'job-head' },
      jobStatusChip(job),
      h('span', { class: 'job-agent' }, AGENT_NAMES[job.agentId] ?? job.agentId),
      h('span', { class: 'job-time muted' }, formatRelative(new Date(job.createdAt).toISOString())),
    ),
    h('p', { class: 'job-title' }, job.title),
    detail ? h('p', { class: 'job-detail muted' }, detail) : null,
    job.error && job.status === 'failed' ? h('p', { class: 'job-error' }, job.error) : null,
    job.output?.length
      ? h('details', { class: 'job-output' }, h('summary', {}, '出力を見る'), h('pre', {}, job.output.slice(-40).join('\n')))
      : null,
    actions.length ? h('div', { class: 'job-actions' }, ...actions) : null,
  );
}

// 依頼の一覧。main からの知らせで差し替える
export function createJobList(oz, { filter = () => true, empty = 'まだ依頼はありません', limit = 30 } = {}) {
  const el = h('ul', { class: 'jobs' });
  const jobs = new Map();

  function render() {
    const list = [...jobs.values()].filter(filter).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    el.replaceChildren(...(list.length ? list.map((job) => jobRow(job, oz, { onChange: (j) => j?.id && upsert(j) })) : [h('li', { class: 'empty' }, empty)]));
  }

  function upsert(job) {
    jobs.set(job.id, job);
    render();
  }

  return {
    el,
    set(list) {
      jobs.clear();
      for (const job of list) jobs.set(job.id, job);
      render();
    },
    upsert,
    render,
    all: () => [...jobs.values()],
  };
}
