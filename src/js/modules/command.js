// 指令室: 1つの依頼を分担させる（司令塔が分担案を作る）／1つのエージェントに直接頼む
import { h, segmented, notice } from '../ui.js';
import { AGENT_NAMES, createJobList, statusChip } from './agent-ui.js';

const GROUP_STATUS = {
  starting: ['準備中', 'neutral'],
  running: ['作業中', 'active'],
  merged: ['統合済み', 'good'],
  conflict: ['衝突あり', 'warning'],
  finished: ['終了', 'neutral'],
  failed: ['失敗', 'critical'],
};

export function createCommandModule(oz) {
  let cleanup = [];

  return {
    mount(body) {
      const state = { mode: 'split', plan: null, groups: new Map() };
      const agentIds = Object.keys(AGENT_NAMES);

      const status = h('div');
      const area = h('div', { class: 'command-area' });
      const groupsEl = h('div', { class: 'groups' });
      const jobs = createJobList(oz, { empty: 'まだ依頼はありません' });

      body.append(
        h('div', { class: 'toolbar' },
          segmented([{ value: 'split', label: '分担して頼む' }, { value: 'direct', label: '1人に頼む' }], state.mode, (v) => { state.mode = v; renderArea(); }, '頼み方'),
        ),
        status,
        area,
        h('h3', { class: 'section-title' }, '分担の進み具合'),
        groupsEl,
        h('h3', { class: 'section-title' }, '依頼の一覧'),
        jobs.el,
      );

      const say = (text, kind = 'info') => status.replaceChildren(text ? notice(text, kind) : '');

      function agentSelect(value) {
        const select = h('select', { class: 'select', 'aria-label': 'エージェント' }, ...agentIds.map((id) => h('option', { value: id }, AGENT_NAMES[id])));
        select.value = value;
        return select;
      }

      function renderArea() {
        say('');
        if (state.mode === 'direct') {
          const select = agentSelect('claude-code');
          const text = h('textarea', { class: 'field', rows: 4, placeholder: '頼みたいこと（例: README に使い方を書いて）', 'aria-label': '依頼' });
          const send = h('button', { type: 'submit', class: 'btn btn-primary' }, '送る');
          const form = h('form', { class: 'command-form' }, h('div', { class: 'toolbar-group' }, select, send), text);
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!text.value.trim()) return;
            send.disabled = true;
            const job = await oz.jobs.submit({ agentId: select.value, prompt: text.value });
            send.disabled = false;
            if (job?.error) return say(job.error, 'error');
            jobs.upsert(job);
            text.value = '';
            say(`${AGENT_NAMES[job.agentId]} に依頼しました`);
          });
          area.replaceChildren(form);
          return;
        }

        const request = h('textarea', { class: 'field', rows: 4, placeholder: 'やりたいこと（例: ログイン画面とログインAPIを作って、テストも書いて）', 'aria-label': 'やりたいこと' });
        const planBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, '分担案を作る');
        const planEl = h('div', { class: 'plan' });
        const form = h('form', { class: 'command-form' }, request, h('div', { class: 'toolbar-group' }, planBtn));
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!request.value.trim()) return;
          planBtn.disabled = true;
          planBtn.textContent = '司令塔が考えています';
          const plan = await oz.command.plan(request.value);
          planBtn.disabled = false;
          planBtn.textContent = '分担案を作る';
          if (plan?.error) return say(plan.error, 'error');
          say(plan.reason ?? (plan.preview ? 'プレビュー用のサンプルの分担案です。' : 'Claude Code が分担案を作りました。必要なら直してから実行してください。'), plan.reason ? 'warning' : 'info');
          renderPlan(planEl, request.value, plan.assignments);
        });
        area.replaceChildren(form, planEl);
      }

      // 分担案は、担当と内容を直してから実行できる
      function renderPlan(el, request, assignments) {
        const rows = h('ul', { class: 'plan-rows' });
        const addRow = (a = { agentId: 'claude-code', task: '' }) => {
          const select = agentSelect(a.agentId);
          const task = h('textarea', { class: 'field', rows: 2, 'aria-label': '担当する作業' });
          task.value = a.task;
          const remove = h('button', { type: 'button', class: 'btn btn-small' }, '外す');
          const row = h('li', { class: 'plan-row' }, select, task, remove);
          remove.addEventListener('click', () => row.remove());
          rows.append(row);
        };
        assignments.forEach(addRow);

        const add = h('button', { type: 'button', class: 'btn', onclick: () => addRow() }, '担当を追加');
        const runBtn = h('button', { type: 'button', class: 'btn btn-primary' }, 'この分担で実行');
        runBtn.addEventListener('click', async () => {
          const list = [...rows.children].map((row) => ({
            agentId: row.querySelector('select').value,
            task: row.querySelector('textarea').value.trim(),
          })).filter((a) => a.task);
          const ids = list.map((a) => a.agentId);
          if (list.length === 0) return say('担当が空です', 'error');
          if (new Set(ids).size !== ids.length) return say('同じエージェントに2つの担当は割り振れません', 'error');
          runBtn.disabled = true;
          const group = await oz.command.run({ request, assignments: list });
          runBtn.disabled = false;
          if (group?.error) return say(group.error, 'error');
          state.groups.set(group.id, group);
          renderGroups();
          refreshJobs();
          el.replaceChildren();
          say('分担して作業を始めました。全員が終わると自動で統合します。');
        });
        el.replaceChildren(h('h3', { class: 'section-title' }, '分担案'), rows, h('div', { class: 'toolbar-group' }, add, runBtn));
      }

      function renderGroups() {
        const list = [...state.groups.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
        groupsEl.replaceChildren(...(list.length ? list.map((g) => {
          const [label, tone] = GROUP_STATUS[g.status] ?? [g.status, 'neutral'];
          const members = jobs.all().filter((j) => j.groupId === g.id);
          const merge = g.merge
            ? [
                g.merge.merged.length ? `${g.merge.base} に統合: ${g.merge.merged.map((id) => AGENT_NAMES[id] ?? id).join('、')}` : null,
                g.merge.conflicts.length ? `衝突: ${g.merge.conflicts.map((c) => `${AGENT_NAMES[c.agentId] ?? c.agentId}（${c.files.join('、')}）`).join(' / ')}` : null,
              ].filter(Boolean).join('  ·  ')
            : '';
          return h('section', { class: 'group' },
            h('div', { class: 'job-head' }, statusChip(label, tone), h('span', { class: 'muted' }, `担当 ${members.length}`)),
            h('p', { class: 'job-title' }, g.request),
            h('p', { class: 'muted job-detail' }, members.map((j) => `${AGENT_NAMES[j.agentId]}: ${j.title}`).join(' / ')),
            merge ? h('p', { class: 'job-detail' }, merge) : null,
          );
        }) : [h('p', { class: 'empty' }, 'まだ分担した依頼はありません')]));
      }

      async function refreshJobs() {
        const data = await oz.jobs.list();
        if (data?.error) return;
        jobs.set(data.jobs);
        for (const g of data.groups) state.groups.set(g.id, g);
        renderGroups();
      }

      cleanup.push(oz.jobs.onUpdate?.((job) => { jobs.upsert(job); renderGroups(); }) ?? (() => {}));
      cleanup.push(oz.jobs.onGroup?.((g) => { state.groups.set(g.id, g); renderGroups(); }) ?? (() => {}));
      renderArea();
      refreshJobs();
    },
    unmount() {
      cleanup.forEach((fn) => fn?.());
      cleanup = [];
    },
  };
}
