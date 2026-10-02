// GitHubランキング: 急上昇（日/週/月）・総スター（全体/AI関連）・伸び（記録からの増加）
import { h, segmented, notice, loading, openExternal, formatCompact, formatTime } from '../ui.js';

const MODES = [
  { value: 'trending', label: '急上昇' },
  { value: 'top', label: '総スター' },
  { value: 'growth', label: '伸び' },
];
const SINCE = [
  { value: 'daily', label: '今日', unit: '今日' },
  { value: 'weekly', label: '今週', unit: '今週' },
  { value: 'monthly', label: '今月', unit: '今月' },
];
const SCOPES = [
  { value: 'all', label: 'すべて' },
  { value: 'ai', label: 'AI関連' },
];
const WINDOWS = [
  { value: 24, label: '24時間' },
  { value: 24 * 7, label: '7日' },
  { value: 24 * 30, label: '30日' },
];
const LANGUAGES = ['', 'Python', 'TypeScript', 'JavaScript', 'Rust', 'Go', 'C++', 'Java', 'Swift', 'Kotlin', 'Jupyter Notebook'];

function repoRow(repo, metric, maxMetric, metricLabel, oz) {
  const [owner, name] = repo.fullName.split('/');
  const ratio = maxMetric > 0 ? Math.max(0, metric) / maxMetric : 0;
  return h(
    'li',
    {},
    h(
      'a',
      { class: 'repo', href: repo.url, onclick: (e) => { e.preventDefault(); openExternal(oz, repo.url); } },
      h('span', { class: 'repo-rank' }, repo.rank),
      h(
        'span',
        { class: 'repo-main' },
        h('span', { class: 'repo-name' }, h('span', { class: 'muted' }, `${owner} / `), h('b', {}, name)),
        repo.description ? h('span', { class: 'repo-desc' }, repo.description) : null,
        h(
          'span',
          { class: 'repo-meta' },
          repo.language ? h('span', {}, repo.language) : null,
          h('span', {}, `スター ${formatCompact(repo.stars)}`),
          repo.forks ? h('span', {}, `フォーク ${formatCompact(repo.forks)}`) : null,
        ),
      ),
      h(
        'span',
        { class: 'repo-metric' },
        h('span', { class: 'bar-track' }, h('span', { class: 'bar', style: `width:${(ratio * 100).toFixed(1)}%` })),
        h('span', { class: 'bar-value' }, metricLabel),
      ),
    ),
  );
}

export function createRankingModule(oz) {
  let alive = false;

  return {
    mount(body) {
      alive = true;
      const state = { mode: 'trending', since: 'daily', language: '', scope: 'all', windowHours: 24, seq: 0 };

      const options = h('div', { class: 'toolbar-group' });
      const updated = h('span', { class: 'muted' }, '');
      const refresh = h('button', { type: 'button', class: 'btn' }, '更新');
      const status = h('div');
      const list = h('ol', { class: 'repo-list' });

      body.append(
        h(
          'div',
          { class: 'toolbar' },
          h('div', { class: 'toolbar-group' }, segmented(MODES, state.mode, (v) => { state.mode = v; renderOptions(); load(); }, '表示'), options),
          h('div', { class: 'toolbar-group' }, updated, refresh),
        ),
        status,
        list,
      );

      function renderOptions() {
        options.replaceChildren();
        if (state.mode === 'trending') {
          const select = h('select', { class: 'select', 'aria-label': '言語' }, ...LANGUAGES.map((lang) => h('option', { value: lang }, lang || 'すべての言語')));
          select.value = state.language;
          select.addEventListener('change', () => { state.language = select.value; load(); });
          options.append(segmented(SINCE, state.since, (v) => { state.since = v; load(); }, '期間'), select);
        } else if (state.mode === 'top') {
          options.append(segmented(SCOPES, state.scope, (v) => { state.scope = v; load(); }, '範囲'));
        } else {
          options.append(segmented(WINDOWS, state.windowHours, (v) => { state.windowHours = v; load(); }, '期間'));
        }
      }

      async function fetchMode(force) {
        if (state.mode === 'trending') return oz.github.trending({ since: state.since, language: state.language, force });
        if (state.mode === 'top') return oz.github.top({ scope: state.scope, force });
        return oz.github.growth({ windowHours: state.windowHours });
      }

      async function load(force = false) {
        const seq = ++state.seq;
        refresh.disabled = true;
        list.replaceChildren(h('li', {}, loading('ランキングを取得しています')));
        status.replaceChildren();
        const data = await fetchMode(force);
        if (!alive || seq !== state.seq) return;
        refresh.disabled = false;

        if (data?.error) {
          list.replaceChildren();
          status.replaceChildren(notice(data.error, 'error'));
          return;
        }
        updated.textContent = `最終更新 ${formatTime(data.fetchedAt)}`;
        if (data.preview) status.append(notice('プレビュー用のサンプルです。アプリでは GitHub から実際のランキングを取得します。'));

        const repos = data.repos ?? [];
        if (repos.length === 0) {
          list.replaceChildren(
            h('li', { class: 'empty' }, state.mode === 'growth'
              ? `まだ記録が足りません。急上昇や総スターを開くたびにスター数を記録し、2回目以降から伸びを計算します（記録中 ${data.tracked ?? 0} 件）。`
              : '該当するリポジトリがありません'),
          );
          return;
        }

        const unit = SINCE.find((s) => s.value === state.since)?.unit;
        const metricOf = (repo) => (state.mode === 'top' ? repo.stars : repo.gained);
        const max = Math.max(...repos.map(metricOf));
        const labelOf = (repo) => {
          if (state.mode === 'top') return formatCompact(repo.stars);
          if (state.mode === 'trending') return `+${formatCompact(repo.gained)} ${unit}`;
          return `+${formatCompact(repo.gained)} / ${repo.sinceHours}時間`;
        };
        list.replaceChildren(...repos.map((repo) => repoRow(repo, metricOf(repo), max, labelOf(repo), oz)));
      }

      refresh.addEventListener('click', () => load(true));
      renderOptions();
      load();
    },
    unmount() {
      alive = false;
    },
  };
}
