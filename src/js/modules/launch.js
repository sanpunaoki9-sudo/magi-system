// 単体起動: エージェントを1つずつ起動する。インストールや VS Code 拡張の追加もここから行う
import { h, notice, loading, openExternal } from '../ui.js';
import { quotaChip, statusChip } from './agent-ui.js';

export function createLaunchModule(oz) {
  let alive = false;

  return {
    mount(body) {
      alive = true;
      const status = h('div');
      const tools = h('div', { class: 'tools' });
      const cards = h('div', { class: 'agent-cards' }, loading('エージェントを確認しています'));
      const openWs = h('button', { type: 'button', class: 'btn' }, '作業フォルダを VS Code で開く');
      const recheck = h('button', { type: 'button', class: 'btn' }, '再確認');

      body.append(
        h('p', { class: 'module-meta' }, '起動すると、そのエージェント専用の作業場所（専用ブランチ）を VS Code で開き、ターミナルでエージェントを立ち上げます。AIの書き換えは VS Code にそのまま映ります。'),
        h('div', { class: 'toolbar' }, tools, h('div', { class: 'toolbar-group' }, openWs, recheck)),
        status,
        cards,
      );

      const say = (text, kind = 'info') => status.replaceChildren(notice(text, kind));

      async function run(button, fn, done) {
        button.disabled = true;
        const label = button.textContent;
        button.textContent = '実行中';
        const result = await fn();
        button.disabled = false;
        button.textContent = label;
        if (result?.error) say(result.error, 'error');
        else if (done) say(typeof done === 'function' ? done(result) : done);
        return result;
      }

      function card(agent) {
        const actions = [];
        if (agent.installed) {
          const btn = h('button', { type: 'button', class: 'btn btn-primary' }, '起動');
          btn.addEventListener('click', () => run(btn, () => oz.agents.launch(agent.id), (r) => `${r.opened.join(' と ')} を開きました（${r.branch}）`));
          actions.push(btn);
        }
        // CLI がなければ入れ方を出す（npm で入るものはここから入れる。agy は公式の手順を開く）
        if (!agent.cli) {
          const label = agent.npmPackage ? 'CLI をインストール' : 'CLI の入れ方を開く';
          const btn = h('button', { type: 'button', class: agent.installed ? 'btn' : 'btn btn-primary' }, label);
          btn.addEventListener('click', async () => {
            const r = await run(btn, () => oz.agents.install({ agentId: agent.id, what: 'cli' }), agent.npmPackage ? `${agent.name} をインストールしました` : null);
            if (!r?.error && agent.npmPackage) load(true);
          });
          actions.push(btn);
        }
        if (agent.hasIde && !agent.ide && agent.downloadUrl) {
          actions.push(h('button', { type: 'button', class: 'btn', onclick: () => openExternal(oz, agent.downloadUrl) }, 'エディタをダウンロード'));
        }
        if (agent.vscodeExtension) {
          const btn = h('button', { type: 'button', class: 'btn' }, 'VS Code 拡張を追加');
          btn.addEventListener('click', () => run(btn, () => oz.agents.install({ agentId: agent.id, what: 'extension' }), `${agent.name} の VS Code 拡張を追加しました`));
          actions.push(btn);
        }

        // 見つかった場所（なければ「見つかりません」）
        const where = (label, item, extra = '') =>
          h('li', {}, h('span', { class: 'found-label' }, label),
            item ? h('code', { class: 'found-path' }, item.path) : h('span', { class: 'muted' }, '見つかりません'),
            item ? h('span', { class: 'muted' }, ` ${[item.version ?? extra, item.source].filter(Boolean).join(' · ')}`) : null);

        const note = agent.id === 'antigravity'
          ? agent.headless
            ? '指令室から依頼すると、agy が自動で作業します（ほかの2つと同じ）。'
            : agent.ide
              ? 'agy（CLI）がないため、依頼は OZ_TASK.md に書いてエディタで開きます。終わったら「完了にする」を押してください。agy を入れると自動になります。'
              : null
          : null;

        return h(
          'section',
          { class: 'agent-card' },
          h('div', { class: 'agent-card-head' },
            h('h3', { class: 'agent-name' }, agent.name),
            h('span', { class: 'muted' }, agent.vendor),
          ),
          h('div', { class: 'agent-card-states' },
            agent.headless ? statusChip('自動で作業できる', 'good') : agent.installed ? statusChip('手動の受け渡し', 'warning') : statusChip('未インストール', 'neutral'),
            quotaChip(agent.quota),
          ),
          h('ul', { class: 'found' },
            where('CLI', agent.cli),
            agent.hasIde ? where('エディタ', agent.ide) : null,
          ),
          h('p', { class: 'agent-strengths' }, `得意: ${agent.strengths}`),
          note ? h('p', { class: 'muted agent-note' }, note) : null,
          h('div', { class: 'agent-actions' }, ...actions),
        );
      }

      async function load(force = false) {
        const data = await oz.agents.list({ force });
        if (!alive) return;
        if (data?.error) {
          say(data.error, 'error');
          cards.replaceChildren();
          return;
        }
        if (data.preview) say('プレビュー用のサンプルです。アプリではこのPCにあるエージェントを起動します。');
        const t = data.tools;
        tools.replaceChildren(
          h('span', { class: 'toolbar-group' },
            statusChip(`Git ${t.git ? 'あり' : 'なし'}`, t.git ? 'good' : 'critical'),
            statusChip(`VS Code ${t.vscode ? 'あり' : 'なし'}`, t.vscode ? 'good' : 'warning'),
            statusChip(`npm ${t.npm ? 'あり' : 'なし'}`, t.npm ? 'good' : 'warning'),
          ),
        );
        cards.replaceChildren(...data.agents.map(card));
      }

      openWs.addEventListener('click', () => run(openWs, () => oz.workspace.open(), '作業フォルダを VS Code で開きました'));
      recheck.addEventListener('click', () => load(true));
      load();
    },
    unmount() {
      alive = false;
    },
  };
}
