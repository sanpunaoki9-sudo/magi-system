// 単体起動: エージェントを1つずつ起動する。インストールや VS Code 拡張の追加もここから行う
import { h, notice, loading, openExternal } from '../ui.js';
import { quotaChip, statusChip } from './agent-ui.js';

// エフォート（考える深さ）の表示名
const EFFORT_LABEL = { minimal: '最小', low: '低', medium: '中', high: '高', xhigh: 'とても高い', max: '最大' };

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

      // モデルとエフォート。空なら各 CLI の設定のまま。次の依頼・会話・単体起動から使われる
      function modelBox(agent) {
        const { model: modelOpt, effort: effortOpt } = agent.options ?? {};
        if (!modelOpt && !effortOpt) return null;
        const s = agent.settings ?? {};
        const listId = `models-${agent.id}`;
        const model = h('input', {
          type: 'text', class: 'field', list: listId, spellcheck: 'false', autocomplete: 'off',
          placeholder: `${modelOpt?.placeholder ?? ''}（空なら既定）`,
          'aria-label': `${agent.name} のモデル`,
        });
        model.value = s.model ?? '';
        const options = h('datalist', { id: listId }, ...(agent.models ?? []).map((m) => h('option', { value: m })));
        const effort = effortOpt
          ? h('select', { class: 'select', 'aria-label': `${agent.name} のエフォート` },
            h('option', { value: '' }, '既定'),
            ...effortOpt.levels.map((l) => h('option', { value: l }, `${EFFORT_LABEL[l] ?? l}（${l}）`)))
          : null;
        if (effort) effort.value = s.effort ?? '';
        const save = h('button', { type: 'button', class: 'btn btn-small' }, '保存');
        save.addEventListener('click', async () => {
          const r = await run(save, () => oz.agents.configure({ agentId: agent.id, model: model.value, effort: effort?.value ?? '' }), (res) => {
            const m = res.settings.model || 'CLI の設定のまま';
            const e = res.settings.effort ? ` / エフォート ${EFFORT_LABEL[res.settings.effort] ?? res.settings.effort}` : '';
            return `${agent.name}: モデル ${m}${e}。次の依頼から使います`;
          });
          if (r && !r.error) agent.settings = r.settings;
        });

        // 入っている CLI が対応していない指定は使われないことを知らせる
        const notes = [];
        if (agent.cli && modelOpt && agent.supports && !agent.supports.model) notes.push('この版の CLI はモデルの指定に対応していないため、保存しても使われません。');
        if (agent.cli && effortOpt && agent.supports && !agent.supports.effort) notes.push('この版の CLI はエフォートの指定に対応していないため、保存しても使われません。');
        if (!effortOpt) notes.push('エフォートはモデル名に含まれます（候補は agy models の一覧）。');

        return h('div', { class: 'agent-model' },
          h('div', { class: 'agent-model-row' },
            h('label', { class: 'found-label' }, 'モデル'), model, options,
          ),
          effort ? h('div', { class: 'agent-model-row' }, h('label', { class: 'found-label' }, 'エフォート'), effort) : null,
          h('div', { class: 'agent-model-row agent-model-save' }, save),
          ...notes.map((n) => h('p', { class: 'muted agent-note' }, n)),
        );
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
          modelBox(agent),
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
