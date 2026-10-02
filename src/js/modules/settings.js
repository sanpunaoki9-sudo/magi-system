// 設定: 作業フォルダ・Git の名前とメール・自動統合・GitHub トークン・Obsidian の保管庫
import { h, notice, loading } from '../ui.js';

export function createSettingsModule(oz) {
  let alive = false;

  return {
    mount(body) {
      alive = true;
      const status = h('div');
      const form = h('div', { class: 'settings' }, loading());
      body.append(status, form);

      const say = (text, kind = 'info') => status.replaceChildren(notice(text, kind));

      function section(title, description, ...content) {
        return h('section', { class: 'setting' },
          h('div', { class: 'setting-text' }, h('h3', { class: 'setting-title' }, title), description ? h('p', { class: 'muted' }, description) : null),
          h('div', { class: 'setting-control' }, ...content),
        );
      }

      async function load() {
        const s = await oz.settings.get();
        if (!alive) return;
        if (s?.error) return say(s.error, 'error');
        if (s.preview) say('プレビュー用のサンプルです。アプリではここで設定を変更できます。');

        const ws = h('code', { class: 'path' }, s.workspace);
        const chooseWs = h('button', { type: 'button', class: 'btn' }, '変更');
        chooseWs.addEventListener('click', async () => {
          const r = await oz.settings.chooseWorkspace();
          if (r?.error) return say(r.error, 'error');
          ws.textContent = r.workspace;
          say('作業フォルダを変更しました');
        });
        const openWs = h('button', { type: 'button', class: 'btn', onclick: () => oz.workspace.open() }, 'VS Code で開く');

        const name = h('input', { type: 'text', class: 'field', placeholder: '名前', 'aria-label': 'Git の名前' });
        name.value = s.gitUserName;
        const email = h('input', { type: 'email', class: 'field', placeholder: 'メールアドレス', 'aria-label': 'Git のメールアドレス' });
        email.value = s.gitUserEmail;
        const saveGit = h('button', { type: 'button', class: 'btn btn-primary' }, '保存');
        saveGit.addEventListener('click', async () => {
          const r = await oz.settings.set({ gitUserName: name.value, gitUserEmail: email.value });
          say(r?.error ? r.error : 'Git の設定を保存しました', r?.error ? 'error' : 'info');
        });

        const auto = h('input', { type: 'checkbox', id: 'autoMerge' });
        auto.checked = s.autoMerge;
        auto.addEventListener('change', async () => {
          const r = await oz.settings.set({ autoMerge: auto.checked });
          say(r?.error ? r.error : auto.checked ? '分担が終わったら自動で統合します' : '統合は手動で行います', r?.error ? 'error' : 'info');
        });

        const token = h('input', { type: 'password', class: 'field', placeholder: s.githubToken ? '保存済み（変えるときだけ入力）' : 'ghp_...', 'aria-label': 'GitHub のトークン', autocomplete: 'off' });
        const saveToken = h('button', { type: 'button', class: 'btn btn-primary' }, '保存');
        saveToken.addEventListener('click', async () => {
          if (!token.value.trim()) return;
          const r = await oz.settings.set({ githubToken: token.value });
          token.value = '';
          say(r?.error ? r.error : 'GitHub のトークンを暗号化して保存しました', r?.error ? 'error' : 'info');
          if (!r?.error) load();
        });
        const clearToken = h('button', { type: 'button', class: 'btn' }, '削除');
        clearToken.addEventListener('click', async () => {
          const r = await oz.settings.set({ githubToken: '' });
          say(r?.error ? r.error : 'GitHub のトークンを削除しました', r?.error ? 'error' : 'info');
          if (!r?.error) load();
        });

        // オン・オフの切り替え。変えたらすぐ保存する
        const toggle = (key, label, onText, offText) => {
          const input = h('input', { type: 'checkbox', id: `set-${key}` });
          input.checked = Boolean(s[key]);
          input.addEventListener('change', async () => {
            const r = await oz.settings.set({ [key]: input.checked });
            say(r?.error ? r.error : input.checked ? onText : offText, r?.error ? 'error' : 'info');
          });
          return h('label', { class: 'switch', for: `set-${key}` }, input, h('span', {}, label));
        };

        const vaultName = h('code', { class: 'path' }, s.vault?.path ?? `見つかりません（${s.vault?.expectedName ?? '開発環境001'}）`);
        const chooseVault = h('button', { type: 'button', class: 'btn' }, '選ぶ');
        chooseVault.addEventListener('click', async () => {
          const r = await oz.vault.choose?.();
          if (r?.path) vaultName.textContent = r.path;
        });

        form.replaceChildren(
          section('作業フォルダ', 'エージェントが作業するフォルダです。Git で管理し、エージェントごとの作業場所は .oz-worktrees に作ります。', ws, h('div', { class: 'toolbar-group' }, chooseWs, openWs)),
          section('Git', 'コミットに記録する名前とメールアドレスです。', name, email, h('div', { class: 'toolbar-group' }, saveGit)),
          section('分担後の自動統合', '指令室で分担した作業が全員終わったら、まとめ先のブランチに自動で統合します。衝突は Claude Code に解決を頼みます。',
            h('label', { class: 'switch', for: 'autoMerge' }, auto, h('span', {}, '自動で統合する'))),
          section('GitHub のトークン', 'GitHub ランキングの取得回数の上限を上げます。Windows の暗号化で保護して保存します。', token, h('div', { class: 'toolbar-group' }, saveToken, s.githubToken ? clearToken : null)),
          section('Obsidian の保管庫', 'グラフビューと作業ログの保存先です。', vaultName, h('div', { class: 'toolbar-group' }, chooseVault)),
          section('アプリの動き', '閉じてもタスクトレイで動き続けると、利用枠の回復後の自動再開や作業中の依頼が止まりません。終了はタスクトレイのアイコンから行います。',
            toggle('background', '閉じてもバックグラウンドで動かす', '閉じてもタスクトレイで動き続けます', '閉じると終了します'),
            toggle('notifications', '作業の完了などを通知する', '通知を出します', '通知を出しません'),
            toggle('openAtLogin', 'Windows の起動時に開く', 'Windows の起動時にタスクトレイで開きます', 'Windows の起動時には開きません')),
          section('バージョン', null, h('span', {}, `OZ Assistant ${s.version}`)),
        );
      }

      load();
    },
    unmount() {
      alive = false;
    },
  };
}
