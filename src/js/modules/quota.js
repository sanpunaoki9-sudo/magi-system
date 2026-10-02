// AGENTSの利用枠: 残りの枠・回復までの時間・回復待ちの依頼。上限になった依頼は回復後に自動で再開する
import { h, notice, loading } from '../ui.js';
import { AGENT_NAMES, quotaChip, formatClock, formatCountdown } from './agent-ui.js';

const HOURS = [
  { value: 1, label: '1時間' },
  { value: 5, label: '5時間' },
  { value: 24, label: '1日' },
  { value: 168, label: '1週間' },
];

const SOURCE = {
  output: 'エージェントの出力から検知',
  'codex-session': 'Codex の記録から読み取り',
  manual: '手動で設定',
};

export function createQuotaModule(oz) {
  let cleanup = [];

  return {
    mount(body) {
      let alive = true;
      cleanup.push(() => { alive = false; });
      const status = h('div');
      const list = h('div', { class: 'quota-list' }, loading());
      let data = [];

      body.append(
        h('p', { class: 'module-meta' }, '利用枠の上限に達すると、エージェントは途中までの作業を保存して待機します。枠が回復したら、自動で続きから再開します（アプリを閉じていても、次に起動したときに再開します）。'),
        status,
        list,
      );

      function row(q) {
        const name = AGENT_NAMES[q.agentId] ?? q.agentId;
        const remaining = Number.isFinite(q.remaining) ? q.remaining : null;
        const select = h('select', { class: 'select', 'aria-label': '上限にする時間' }, ...HOURS.map((o) => h('option', { value: o.value }, o.label)));
        select.value = '5';
        const setBtn = h('button', { type: 'button', class: 'btn btn-small' }, '上限にする');
        setBtn.addEventListener('click', async () => {
          const r = await oz.quota.set({ agentId: q.agentId, state: 'exhausted', hours: Number(select.value) });
          if (r?.error) status.replaceChildren(notice(r.error, 'error'));
          else load();
        });
        const okBtn = h('button', { type: 'button', class: 'btn btn-small' }, '回復した');
        okBtn.addEventListener('click', async () => {
          const r = await oz.quota.set({ agentId: q.agentId, state: 'ok' });
          if (r?.error) status.replaceChildren(notice(r.error, 'error'));
          else load();
        });

        return h('section', { class: `quota quota-${q.state}` },
          h('div', { class: 'agent-card-head' }, h('h3', { class: 'agent-name' }, name), quotaChip(q)),
          remaining != null
            ? h('div', { class: 'quota-meter' },
                h('span', { class: 'meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(remaining * 100), 'aria-label': `${name} の残り` },
                  h('span', { class: 'meter-fill', style: `width:${(remaining * 100).toFixed(1)}%` })),
                h('b', {}, `残り ${Math.round(remaining * 100)}%`))
            : h('p', { class: 'muted' }, q.state === 'exhausted' ? '' : '残りの量はこのエージェントからは読み取れません。上限に達すると出力から自動で検知します。'),
          q.state === 'exhausted' && q.resetAt
            ? h('p', { class: 'quota-reset' }, `${formatClock(q.resetAt)}ごろ回復`, h('b', { class: 'countdown', dataset: { at: q.resetAt } }, `  ${formatCountdown(q.resetAt)}`))
            : null,
          h('p', { class: 'agent-meta' }, `回復待ちの依頼 ${q.waiting ?? 0}件`, q.source ? h('span', { class: 'muted' }, `  ·  ${SOURCE[q.source] ?? q.source}`) : null),
          h('div', { class: 'agent-actions' }, q.state === 'exhausted' ? okBtn : h('span', { class: 'toolbar-group' }, select, setBtn)),
        );
      }

      function render() {
        list.replaceChildren(...data.map(row));
      }

      async function load() {
        const result = await oz.quota.list();
        if (!alive) return;
        if (result?.error) return status.replaceChildren(notice(result.error, 'error'));
        data = result.items ?? result;
        if (result.preview) status.replaceChildren(notice('プレビュー用のサンプルです。'));
        render();
      }

      // 回復までの残り時間を毎分更新する
      const timer = setInterval(() => {
        for (const el of list.querySelectorAll('.countdown')) el.textContent = `  ${formatCountdown(Number(el.dataset.at))}`;
      }, 30000);
      cleanup.push(() => clearInterval(timer));
      cleanup.push(oz.quota.onUpdate?.(() => load()) ?? (() => {}));
      cleanup.push(oz.jobs.onUpdate?.(() => load()) ?? (() => {}));
      load();
    },
    unmount() {
      cleanup.forEach((fn) => fn?.());
      cleanup = [];
    },
  };
}
