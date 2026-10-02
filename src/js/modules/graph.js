// グラフビュー: Obsidian の保管庫のノートとリンクを3Dで表示する。保管庫が変わると自動で更新する。
import { h, notice, loading } from '../ui.js';

const LIB_URL = new URL('../../../node_modules/3d-force-graph/dist/3d-force-graph.min.js', import.meta.url);

const COLORS = {
  oz: '#e0508c',
  user: '#3a3a3a',
  ghost: '#c4c4c4',
  dim: '#ececec',
  link: '#cfcfcf',
  background: '#ffffff',
};
const LEGEND = [
  { key: 'oz', label: 'OZ が追加したノート' },
  { key: 'user', label: 'あなたのノート' },
  { key: 'ghost', label: 'まだないノート（リンクだけ）' },
];

let libPromise = null;
function loadLibrary() {
  if (window.ForceGraph3D) return Promise.resolve(window.ForceGraph3D);
  libPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = LIB_URL.href;
    script.onload = () => resolve(window.ForceGraph3D);
    script.onerror = () => {
      libPromise = null;
      reject(new Error('グラフ表示の部品を読み込めませんでした'));
    };
    document.head.append(script);
  });
  return libPromise;
}

export function createGraphModule(oz) {
  let cleanup = [];

  return {
    mount(body) {
      body.classList.add('is-flush');
      const state = { graph: null, data: null, selected: null, query: '', neighbors: new Set(), fitted: false, previewShown: false };
      let alive = true;
      cleanup.push(() => { alive = false; });

      const canvas = h('div', { class: 'graph-canvas' });
      const stats = h('p', { class: 'graph-stats' }, '');
      const search = h('input', { type: 'search', class: 'search', placeholder: 'ノートを探す', 'aria-label': 'ノートを探す' });
      const legend = h('ul', { class: 'legend' }, ...LEGEND.map((l) => h('li', {}, h('span', { class: 'swatch', style: `background:${COLORS[l.key]}` }), l.label)));
      const addBtn = h('button', { type: 'button', class: 'btn btn-primary' }, 'メモを追加');
      const detail = h('aside', { class: 'graph-card graph-detail', hidden: true });
      const form = h('form', { class: 'graph-card graph-form', hidden: true });
      const message = h('div', { class: 'graph-message' });

      body.append(
        h('div', { class: 'graph-wrap' },
          canvas,
          h('div', { class: 'graph-hud' }, stats, search, legend),
          h('div', { class: 'graph-actions' }, addBtn),
          detail,
          form,
          message,
        ),
      );

      // ノートの色: 選択中はつながっているノートだけを濃く、検索中は一致したノートだけを濃くする
      function colorOf(node) {
        const q = state.query.trim().toLowerCase();
        if (state.selected && node.id !== state.selected.id && !state.neighbors.has(node.id)) return COLORS.dim;
        if (q && !node.name.toLowerCase().includes(q)) return COLORS.dim;
        return COLORS[node.origin] ?? COLORS.user;
      }

      function refreshColors() {
        if (!state.graph) return;
        state.graph.nodeColor(colorOf);
        state.graph.linkColor((link) => {
          if (!state.selected) return COLORS.link;
          const s = link.source.id ?? link.source;
          const t = link.target.id ?? link.target;
          return s === state.selected.id || t === state.selected.id ? COLORS.oz : COLORS.dim;
        });
      }

      // 最初の表示では全体が収まるように寄る（ノードを選んでいるときはそのまま）
      function fit() {
        if (state.fitted || state.selected || !state.graph) return;
        state.fitted = true;
        state.graph.zoomToFit(800, 60);
      }

      function select(node) {
        state.selected = node;
        state.neighbors = new Set();
        if (node) {
          for (const link of state.data.links) {
            const s = link.source.id ?? link.source;
            const t = link.target.id ?? link.target;
            if (s === node.id) state.neighbors.add(t);
            if (t === node.id) state.neighbors.add(s);
          }
          const distance = 90;
          const len = Math.hypot(node.x, node.y, node.z) || 1;
          const r = 1 + distance / len;
          state.graph.cameraPosition({ x: node.x * r, y: node.y * r, z: node.z * r }, node, 900);
        }
        refreshColors();
        renderDetail();
      }

      function renderDetail() {
        const node = state.selected;
        if (!node) {
          detail.hidden = true;
          return;
        }
        const originLabel = LEGEND.find((l) => l.key === node.origin)?.label ?? '';
        const action =
          node.origin === 'ghost'
            ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => createNote(node.name, '', '') }, 'このノートを作る')
            : h('button', { type: 'button', class: 'btn btn-primary', onclick: () => oz.vault.open(node.id) }, 'Obsidianで開く');
        detail.replaceChildren(
          h('h3', { class: 'graph-card-title' }, node.name),
          h('p', { class: 'muted' }, node.origin === 'ghost' ? originLabel : node.id),
          h('p', {}, `つながり ${state.neighbors.size}件`),
          h('div', { class: 'graph-card-actions' }, action, h('button', { type: 'button', class: 'btn', onclick: () => select(null) }, '閉じる')),
        );
        detail.hidden = false;
      }

      async function createNote(title, text, folder) {
        const result = await oz.vault.add({ title, body: text, folder });
        if (result?.error) {
          message.replaceChildren(notice(`保存できませんでした: ${result.error}`, 'error'));
          return false;
        }
        message.replaceChildren(notice(`「${result.name}」を保存しました`));
        setTimeout(() => message.replaceChildren(), 4000);
        await reload();
        return true;
      }

      function renderForm() {
        const title = h('input', { type: 'text', class: 'field', placeholder: 'タイトル', 'aria-label': 'タイトル', required: true });
        const text = h('textarea', { class: 'field', rows: 6, placeholder: '本文（[[ノート名]] でほかのノートにつなげられます）', 'aria-label': '本文' });
        form.replaceChildren(
          h('h3', { class: 'graph-card-title' }, 'メモを追加'),
          h('p', { class: 'muted' }, '保管庫の OZ フォルダに保存します'),
          title,
          text,
          h('div', { class: 'graph-card-actions' },
            h('button', { type: 'submit', class: 'btn btn-primary' }, '保存'),
            h('button', { type: 'button', class: 'btn', onclick: () => { form.hidden = true; } }, 'やめる'),
          ),
        );
        form.onsubmit = async (e) => {
          e.preventDefault();
          if (!title.value.trim()) return;
          if (await createNote(title.value, text.value, 'OZ')) form.hidden = true;
        };
        form.hidden = false;
        title.focus();
      }

      // 位置を保ったままデータを入れ替える（更新のたびにグラフが崩れないように）
      function merge(next) {
        const prev = new Map((state.data?.nodes ?? []).map((n) => [n.id, n]));
        const nodes = next.nodes.map((n) => {
          const old = prev.get(n.id);
          return old ? Object.assign(old, n) : n;
        });
        return { nodes, links: next.links.map((l) => ({ ...l })) };
      }

      async function reload() {
        const result = await oz.vault.graph();
        if (!alive) return;
        if (result?.error) {
          showEmpty(result.error);
          return;
        }
        const notes = result.nodes.filter((n) => n.origin !== 'ghost').length;
        stats.replaceChildren(h('b', {}, result.vault), `  ノート ${notes}  ·  リンク ${result.links.length}`, result.truncated ? '（一部のみ表示）' : '');
        const first = !state.data;
        state.data = merge(result);
        state.graph.graphData(state.data);
        // 遅いPCでは配置が落ち着くまで時間がかかるので、少し待ってからも寄る
        if (first) setTimeout(() => alive && fit(), 1500);
        if (state.selected) {
          state.selected = state.data.nodes.find((n) => n.id === state.selected.id) ?? null;
          renderDetail();
        }
        if (result.preview && !state.previewShown) {
          state.previewShown = true;
          message.replaceChildren(notice('プレビュー用のサンプルです。アプリでは保管庫「開発環境001」を表示します。'));
        }
      }

      async function showEmpty(reason) {
        const info = await oz.vault.info();
        if (!alive) return;
        canvas.replaceChildren();
        const choose = oz.vault.choose
          ? h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
              const next = await oz.vault.choose();
              if (next?.path) start();
            } }, '保管庫を選ぶ')
          : null;
        const detected = info?.detected?.length
          ? h('p', { class: 'muted' }, `見つかった保管庫: ${info.detected.map((v) => v.name).join('、')}`)
          : null;
        message.replaceChildren(
          h('div', { class: 'graph-empty' },
            h('p', { class: 'graph-empty-title' }, reason),
            h('p', { class: 'muted' }, 'Obsidian で使っている保管庫のフォルダを選ぶと表示できます。'),
            detected,
            choose,
          ),
        );
      }

      async function start() {
        message.replaceChildren(loading('保管庫を読み込んでいます'));
        let ForceGraph3D;
        try {
          ForceGraph3D = await loadLibrary();
        } catch (err) {
          message.replaceChildren(notice(err.message, 'error'));
          return;
        }
        if (!alive) return;

        const info = await oz.vault.info();
        if (!alive) return;
        if (!info?.path) {
          showEmpty(`保管庫「${info?.expectedName ?? '開発環境001'}」が見つかりません`);
          return;
        }
        message.replaceChildren();

        if (!state.graph) {
          const graph = ForceGraph3D({ controlType: 'orbit' })(canvas)
            .backgroundColor(COLORS.background)
            .showNavInfo(false)
            .nodeId('id')
            .nodeLabel((n) => n.name)
            .nodeRelSize(3.5)
            .nodeVal((n) => 1 + Math.sqrt(n.degree) * 1.6)
            .nodeOpacity(0.95)
            .linkOpacity(0.55)
            .linkWidth(0)
            .cooldownTicks(120)
            .onNodeClick((node) => select(node))
            .onBackgroundClick(() => select(null))
            // 配置が落ち着いたら、全体が収まるように寄る
            .onEngineStop(() => fit());
          const controls = graph.controls();
          if (controls) {
            controls.autoRotate = true;
            controls.autoRotateSpeed = 0.5;
          }
          state.graph = graph;
          refreshColors();

          const resize = new ResizeObserver(() => {
            graph.width(canvas.clientWidth).height(canvas.clientHeight);
          });
          resize.observe(canvas);
          cleanup.push(() => {
            resize.disconnect();
            graph.pauseAnimation();
            graph._destructor?.();
            canvas.replaceChildren();
          });
        }

        await reload();
      }

      search.addEventListener('input', () => {
        state.query = search.value;
        refreshColors();
      });
      search.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !state.data) return;
        const q = search.value.trim().toLowerCase();
        const hit = state.data.nodes.find((n) => n.name.toLowerCase().includes(q));
        if (hit) select(hit);
      });
      addBtn.addEventListener('click', renderForm);

      const off = oz.vault.onChange?.(() => state.graph && reload());
      if (off) cleanup.push(off);

      start();
    },
    unmount() {
      cleanup.forEach((fn) => fn());
      cleanup = [];
    },
  };
}
