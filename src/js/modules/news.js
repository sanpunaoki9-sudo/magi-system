// AIニュース: 各社公式・研究・コミュニティ・メディア・日本語の情報元をまとめて新しい順に表示する
import { h, segmented, notice, loading, openExternal, formatRelative, formatTime } from '../ui.js';

const MAX_VISIBLE = 200;

export function createNewsModule(oz) {
  let alive = false;

  return {
    mount(body) {
      alive = true;
      const state = { category: 'all', query: '', data: null, saved: new Set() };

      const filters = h('div', { class: 'toolbar-group' });
      const search = h('input', { type: 'search', class: 'search', placeholder: 'キーワードで絞り込み', 'aria-label': 'キーワードで絞り込み' });
      const updated = h('span', { class: 'muted' }, '');
      const refresh = h('button', { type: 'button', class: 'btn' }, '更新');
      const status = h('div');
      const list = h('ul', { class: 'news-list' });
      const count = h('p', { class: 'module-meta' }, '');

      body.append(
        h('div', { class: 'toolbar' }, filters, h('div', { class: 'toolbar-group' }, search, updated, refresh)),
        status,
        count,
        list,
      );

      function render() {
        const { data } = state;
        if (!data) return;
        const labels = Object.fromEntries(data.categories.map((c) => [c.id, c.label]));
        const q = state.query.trim().toLowerCase();
        const items = data.items.filter(
          (item) =>
            (state.category === 'all' || item.category === state.category) &&
            (!q || `${item.title} ${item.summary} ${item.source}`.toLowerCase().includes(q)),
        );

        count.textContent = `${items.length}件${items.length > MAX_VISIBLE ? `（新しい${MAX_VISIBLE}件を表示）` : ''}`;
        list.replaceChildren(
          ...items.slice(0, MAX_VISIBLE).map((item) => {
            const saveBtn = h('button', { type: 'button', class: 'btn btn-small' }, state.saved.has(item.id) ? '保存済み' : 'Obsidianに保存');
            saveBtn.disabled = state.saved.has(item.id);
            saveBtn.addEventListener('click', async () => {
              saveBtn.disabled = true;
              saveBtn.textContent = '保存中';
              const result = await oz.news.save(item);
              if (result?.error) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Obsidianに保存';
                status.replaceChildren(notice(`保存できませんでした: ${result.error}`, 'error'));
                return;
              }
              state.saved.add(item.id);
              saveBtn.textContent = '保存済み';
            });

            return h(
              'li',
              { class: 'news-item' },
              h('div', { class: 'news-meta' }, h('span', { class: 'chip' }, labels[item.category] ?? ''), h('span', {}, item.source), h('span', {}, formatRelative(item.date))),
              h('a', { class: 'news-title', href: item.url, onclick: (e) => { e.preventDefault(); openExternal(oz, item.url); } }, item.title),
              item.summary ? h('p', { class: 'news-summary' }, item.summary) : null,
              h('div', { class: 'news-actions' }, saveBtn),
            );
          }),
        );
        if (items.length === 0) list.replaceChildren(h('li', { class: 'empty' }, '条件に合う記事はありません'));
      }

      function renderFilters() {
        const options = [{ value: 'all', label: 'すべて' }, ...state.data.categories.map((c) => ({ value: c.id, label: c.label }))];
        filters.replaceChildren(
          segmented(options, state.category, (value) => {
            state.category = value;
            render();
          }, 'カテゴリ'),
        );
      }

      async function load(force = false) {
        refresh.disabled = true;
        if (!state.data) list.replaceChildren(h('li', {}, loading('ニュースを集めています')));
        const data = await oz.news.list({ force });
        refresh.disabled = false;
        if (!alive) return;

        if (data?.error) {
          status.replaceChildren(notice(`ニュースを取得できませんでした: ${data.error}`, 'error'));
          if (!state.data) list.replaceChildren();
          return;
        }

        state.data = data;
        updated.textContent = `最終更新 ${formatTime(data.fetchedAt)}`;
        status.replaceChildren();
        if (data.preview) status.append(notice('プレビュー用のサンプルです。アプリでは実際のニュースを表示します。'));
        if (data.failed?.length) {
          status.append(
            h(
              'details',
              { class: 'notice notice-warning' },
              h('summary', {}, `取得できなかった情報元が ${data.failed.length} 件あります（全 ${data.sourceCount} 件）`),
              h('ul', {}, ...data.failed.map((f) => h('li', {}, `${f.source}: ${f.reason}`))),
            ),
          );
        }
        renderFilters();
        render();
      }

      search.addEventListener('input', () => {
        state.query = search.value;
        render();
      });
      refresh.addEventListener('click', () => load(true));
      load();
    },
    unmount() {
      alive = false;
    },
  };
}
