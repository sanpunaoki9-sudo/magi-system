// AGENTSの状態: 各エージェントの稼働状況・各社の障害情報・作業ブランチの進み具合
import { h, notice, loading, formatRelative } from '../ui.js';
import { AGENT_NAMES, quotaChip, statusChip, createJobList } from './agent-ui.js';

const SERVICE = {
  none: ['正常', 'good'],
  minor: ['一部に障害', 'warning'],
  major: ['障害', 'critical'],
  critical: ['重大な障害', 'critical'],
  maintenance: ['メンテナンス中', 'warning'],
  unknown: ['不明', 'neutral'],
};

export function createAgentsModule(oz) {
  let cleanup = [];

  return {
    mount(body) {
      let alive = true;
      cleanup.push(() => { alive = false; });

      const status = h('div');
      const cards = h('div', { class: 'agent-cards' }, loading());
      const gitEl = h('div', {}, loading('作業フォルダを確認しています'));
      const jobs = createJobList(oz, { filter: (j) => ['running', 'queued', 'waiting-quota', 'handed-off'].includes(j.status), empty: '動いている依頼はありません' });

      body.append(
        status,
        cards,
        h('h3', { class: 'section-title' }, '動いている依頼'),
        jobs.el,
        h('h3', { class: 'section-title' }, '作業ブランチ'),
        gitEl,
      );

      let services = {};
      let agentsData = [];

      function renderCards() {
        const all = jobs.all();
        cards.replaceChildren(...agentsData.map((a) => {
          const mine = all.filter((j) => j.agentId === a.id || j.worktreeOf === a.id);
          const running = mine.find((j) => j.status === 'running' || j.status === 'handed-off');
          const waiting = mine.filter((j) => j.status === 'waiting-quota').length;
          const queued = mine.filter((j) => j.status === 'queued').length;
          const [label, tone] = running ? ['作業中', 'active'] : waiting ? ['回復待ち', 'warning'] : a.installed ? ['待機中', 'neutral'] : ['未インストール', 'neutral'];
          const svc = services[a.id];
          const [svcLabel, svcTone] = SERVICE[svc?.indicator] ?? SERVICE.unknown;
          return h('section', { class: 'agent-card' },
            h('div', { class: 'agent-card-head' }, h('h3', { class: 'agent-name' }, a.name), h('span', { class: 'muted' }, a.vendor)),
            h('div', { class: 'agent-card-states' }, statusChip(label, tone), quotaChip(a.quota)),
            h('p', { class: 'agent-meta' }, running ? `いまの作業: ${running.title}` : 'いまの作業: なし'),
            h('p', { class: 'agent-meta' }, `順番待ち ${queued}件  ·  回復待ち ${waiting}件`),
            h('p', { class: 'agent-meta' }, 'サービス: ', statusChip(svcLabel, svcTone), svc?.description ? h('span', { class: 'muted' }, ` ${svc.description}`) : null),
          );
        }));
      }

      async function loadGit() {
        const data = await oz.git.overview();
        if (!alive) return;
        if (data?.error) {
          gitEl.replaceChildren(notice(data.error, 'error'));
          return;
        }
        const mergeBtn = h('button', { type: 'button', class: 'btn' }, 'すべての作業を統合');
        mergeBtn.addEventListener('click', async () => {
          mergeBtn.disabled = true;
          const result = await oz.git.merge(data.branches.filter((b) => b.ahead > 0).map((b) => b.agentId));
          mergeBtn.disabled = false;
          if (result?.error) return status.replaceChildren(notice(result.error, 'error'));
          const text = [
            result.merged.length ? `${result.base} に統合しました: ${result.merged.map((id) => AGENT_NAMES[id]).join('、')}` : '統合する変更はありませんでした',
            result.conflicts.length ? `衝突したため統合しなかった: ${result.conflicts.map((c) => AGENT_NAMES[c.agentId]).join('、')}（指令室から Claude Code に解決を頼めます）` : null,
          ].filter(Boolean).join(' / ');
          status.replaceChildren(notice(text, result.conflicts.length ? 'warning' : 'info'));
          loadGit();
        });

        gitEl.replaceChildren(
          h('p', { class: 'module-meta' }, `${data.workspace}  ·  まとめ先 ${data.base}  ·  未保存の変更 ${data.status.changed ?? 0}件`),
          h('ul', { class: 'branches' }, ...data.branches.map((b) =>
            h('li', { class: 'branch' },
              h('span', { class: 'branch-name' }, AGENT_NAMES[b.agentId] ?? b.agentId, h('span', { class: 'muted' }, `  ${b.branch}`)),
              h('span', { class: 'branch-stat' }, b.ahead ? `${b.ahead}コミット先行  ·  ${b.files.length}ファイル  ` : 'まとめ先と同じ', b.ahead ? h('b', { class: 'plus' }, `+${b.added}`) : null, b.ahead ? h('b', { class: 'minus' }, ` -${b.removed}`) : null),
            ))),
          h('div', { class: 'toolbar-group' }, mergeBtn),
          h('h3', { class: 'section-title' }, '最近のコミット'),
          h('ul', { class: 'commits' }, ...data.commits.slice(0, 15).map((c) =>
            h('li', {}, h('code', {}, c.hash), h('span', {}, c.subject), h('span', { class: 'muted' }, formatRelative(new Date(c.time).toISOString()))))),
        );
      }

      async function load() {
        const [agentList, jobList, svc] = await Promise.all([oz.agents.list(), oz.jobs.list(), oz.agents.services()]);
        if (!alive) return;
        if (agentList?.error) return status.replaceChildren(notice(agentList.error, 'error'));
        if (agentList.preview) status.replaceChildren(notice('プレビュー用のサンプルです。'));
        agentsData = agentList.agents;
        if (!jobList?.error) jobs.set(jobList.jobs);
        if (!svc?.error) services = Object.fromEntries(svc.services.map((s) => [s.id, s]));
        renderCards();
      }

      cleanup.push(oz.jobs.onUpdate?.((job) => { jobs.upsert(job); renderCards(); }) ?? (() => {}));
      cleanup.push(oz.quota.onUpdate?.((q) => {
        const a = agentsData.find((x) => x.id === q.agentId);
        if (a) { a.quota = q; renderCards(); }
      }) ?? (() => {}));
      load();
      loadGit();
    },
    unmount() {
      cleanup.forEach((fn) => fn?.());
      cleanup = [];
    },
  };
}
