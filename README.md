# OZ Assistant

映画『サマーウォーズ』の OZ をモチーフにした、Windows 向けの AI アシスタントアプリです。

## インストール

### いちばん簡単な方法（.exe をダウンロード）

1. GitHub のこのリポジトリの **Actions** タブ → 一番上の「Build」の実行結果を開く
2. 下の **Artifacts** にある `OZ-Assistant-Windows` をダウンロードして展開する
3. `OZ-Assistant-Setup-x.x.x.exe`（インストーラ）を実行する。インストールせずに使うなら `OZ-Assistant-x.x.x-portable.exe`

※ コード署名をしていないため、初回は Windows SmartScreen の警告が出ます。「詳細情報」→「実行」で起動できます。
※ `v1.0.0` のようなタグを付けると、Releases にも .exe が置かれます。

### 自分で動かす・作る

必要なもの: Windows 10 / 11、[Node.js](https://nodejs.org/) 20 以上、[Git](https://git-scm.com/)

```powershell
git clone https://github.com/sanpunaoki9-sudo/magi-system.git
cd magi-system
git checkout claude/jarvis-assistant-app-3dhco3
npm install
npm start          # そのまま起動
npm run dist       # dist\ にインストーラ版とポータブル版の .exe を作る
npm test           # テスト
```

## はじめて使うとき

1. 起動パスワードを決めて Enter（次からはそのパスワードで解錠）
2. **SETTINGS** で Git の名前とメールアドレスを保存（作業フォルダは `ドキュメント\OZ-Workspace` が自動で作られます）
3. **LAUNCH** で Claude Code / Codex の「インストール」と「VS Code 拡張を追加」を押す。Antigravity は「ダウンロードページ」から入れる
   - Claude Code と Codex は、初回だけターミナルで `claude` / `codex` を起動してログインしておいてください
4. **TALK** の「音声の設定」で音声認識のモデルをダウンロード（初回だけ）
5. **GRAPH** で Obsidian の保管庫「開発環境001」が表示されることを確認（見つからなければ「保管庫を選ぶ」）

あとは **COMMAND** から依頼するか、**TALK** で「Codex に〜を頼んで」「分担して〜」と話しかけます。

### 閉じても動き続ける

閉じるボタンを押しても終了せず、タスクトレイで動き続けます（利用枠の回復後の自動再開や、作業中の依頼を止めないため）。
終了はタスクトレイのアイコンを右クリック →「終了」。作業の完了や利用枠の上限は Windows の通知で知らせます。
設定で「Windows の起動時に開く」をオンにすると、起動時からタスクトレイで待機します。

## 画面だけをブラウザで確認する

```powershell
npm run dev:web
```

表示された URL（`http://localhost:5173/src/index.html`）をブラウザで開きます。サンプルデータで画面を確認できます。

## 機能

| 丸タブ | できること |
|---|---|
| SYSTEM（PCの状態） | CPU・メモリ・GPU・ネットワークを1秒ごとに更新し、直近60秒を折れ線で表示。ディスクの使用量と温度も表示 |
| NEWS（AIニュース） | 各社公式・研究・コミュニティ・メディア・日本語の24の情報元から集めて新しい順に表示。絞り込み・検索・Obsidianへの保存 |
| RANKING（GitHubランキング） | 急上昇（今日・今週・今月、言語別）、総スター（全体・AI関連）、伸び（取得のたびに記録したスター数の増加） |
| GRAPH（グラフビュー） | Obsidian の保管庫「開発環境001」のノートとリンクを3Dで表示。保管庫が変わると自動で更新。メモの追加・検索・Obsidianで開く |
| LAUNCH（単体起動） | Claude Code / Codex / Antigravity を1つずつ起動。専用の作業場所を VS Code で開き、ターミナルでエージェントを立ち上げる。CLI と VS Code 拡張のインストールもここから |
| COMMAND（指令室） | 「分担して頼む」: Claude Code が依頼を分けて各エージェントに割り振り、同時に作業させて最後に統合。「1人に頼む」: 1つのエージェントに直接依頼 |
| AGENTS（状態） | 各エージェントの作業状況・順番待ち・回復待ち・各社の障害情報、作業ブランチの差分と最近のコミット |
| QUOTA（利用枠） | 残りの枠と回復までの時間。上限になった依頼は回復後に自動で再開 |
| TALK（話しかけモード） | マイクで話しかけると、女性の声で返事をする。「Codex に〜を頼んで」「分担して〜」「ニュースを読んで」「PCの状態は」などはアプリの機能として実行し、それ以外は Claude Code（上限なら Codex）が答える。会話は Obsidian の `OZ/会話ログ` に記録 |
| SETTINGS（設定） | 作業フォルダ・Git の名前とメール・自動統合・GitHub トークン（暗号化して保存）・Obsidian の保管庫 |

### エージェントの動かし方

- 作業フォルダ（初期値は `ドキュメント\OZ-Workspace`）を Git で管理し、エージェントごとに専用ブランチ `oz/<名前>` と専用の作業場所 `.oz-worktrees/<名前>` を作ります。同時に作業してもぶつかりません。
- Claude Code は `claude -p`、Codex は `codex exec --full-auto` で動かします。依頼の文面は標準入力で渡します。
- Antigravity は外から指示を送る公式の方法がないため、依頼を `OZ_TASK.md` に書いて作業場所を Antigravity で開きます。終わったら「完了にする」を押すと変更を保存します。
- 作業が終わると自動でコミットし、Obsidian の `OZ/作業ログ` に記録を残します。
- 分担した作業が全員終わると、まとめ先のブランチ（main など）に自動で統合します。衝突したときは Claude Code に解決を頼んでから、もう一度統合します。

### 話しかけモード

- 音声認識は Whisper（transformers.js）を PC の中だけで動かします。最初の1回だけ「音声の設定」からモデルをダウンロードします（高精度 small 約250MB / 軽量 base 約80MB）。以後はインターネットなしで使えます。
- 「聞き続ける」で話し始め・話し終わりを自動で判定します。「押している間だけ聞く」も使えます。文字で話しかけることもできます。
- 返事は Windows に入っている日本語の女性の声（Haruka など）で読み上げます。[VOICEVOX](https://voicevox.hiroshiba.jp/) を起動しておくと、その声も選べます。
- 会話の返事は Claude Code が作ります（ファイルは編集しません）。利用枠の上限のときは Codex が答えます。

### 利用枠と自動再開

- エージェントの出力に「usage limit reached」などが出たら上限と判断し、出力に書かれた回復時刻（例: 「try again in 2h」「resets at 3pm」）を読み取ります。時刻が分からないときは5時間後とします。
- 上限になった依頼は、途中までの変更をコミットして「利用枠の回復待ち」にします。回復時刻を過ぎると、続きから再開するよう伝えて自動で再開します。
- 待ち状態はファイルに保存するので、アプリを閉じても次に起動したときに再開します。
- Codex は記録ファイル（`~/.codex/sessions`）から残りの割合も読み取ります。Antigravity は利用枠の画面から手動で「上限にする」「回復した」を切り替えられます。

### Obsidian の保管庫

Obsidian に登録されている保管庫の中から「開発環境001」を自動で探します。
見つからないときは、グラフビューの「保管庫を選ぶ」からフォルダを選んでください。
アプリが追加するノートは保管庫の `OZ` フォルダに入ります（ニュースは `OZ/ニュース`）。

### GitHub の取得回数

GitHub の総スターは、ログインなしだと1時間あたりの取得回数に上限があります。
上限にかかる場合は、設定画面で個人用アクセストークンを保存すると上限が上がります（Windows の暗号化で保護して保存します）。

## 構成

| 場所 | 内容 |
|---|---|
| `electron/main.js` | ウィンドウとアプリ全体の管理、画面とのやりとり |
| `electron/preload.js` | 画面から使える機能の窓口 |
| `electron/config.js` | 設定ファイル（`oz-config.json`） |
| `electron/auth.js` | 起動パスワード（ハッシュで保存） |
| `electron/services/system.js` | PCの状態 |
| `electron/services/news.js` | AIニュースの収集（情報元は `news-sources.js`） |
| `electron/services/github.js` | GitHubランキング |
| `electron/services/vault.js` | Obsidian の保管庫 |
| `electron/services/agents.js` | エージェントの定義・インストール確認・起動 |
| `electron/services/runner.js` | 依頼の実行・利用枠の回復待ちと自動再開・分担の統合 |
| `electron/services/planner.js` | 指令室の司令塔（分担案づくり） |
| `electron/services/quota.js` | 利用枠の検知と回復 |
| `electron/services/git.js` | 作業フォルダの Git（専用ブランチ・統合） |
| `electron/ipc-dev.js` | 段階3の画面とのやりとり |
| `electron/services/talk.js` | 話しかけモードの頭脳（依頼・分担・ニュースなどの聞き分けと会話） |
| `electron/services/speech-models.js` | 音声認識モデルのダウンロード |
| `src/js/speech/` | マイク・話している区間の判定・Whisper・読み上げ |
| `src/vendor/three-addons/` | three.js の線の描画（electron-builder が examples フォルダを同梱しないため） |
| `electron-builder.config.cjs` | .exe の作り方（同梱するファイルの絞り込み・安全設定） |
| `.github/workflows/build.yml` | テストと Windows 用 .exe の自動ビルド |
| `tests/` | 自動テスト（`npm test`） |
| `stubs/onnxruntime-node` | 使わないネイティブ版の代わりの空パッケージ（インストールを軽くするため） |
| `src/index.html` | 画面 |
| `src/js/lock.js` | 起動画面（鍵穴） |
| `src/js/hub/` | ハブ画面（地球儀・丸タブ・軌道） |
| `src/js/panel.js` | 丸タブから開くパネル |
| `src/js/modules/` | 各パネルの中身 |
| `src/js/preview-data.js` | ブラウザ確認用のサンプルデータ |

設定は `%APPDATA%\OZ Assistant\oz-config.json` に保存されます。
パスワードを忘れたときは、このファイルの `auth` の部分を消すと最初の設定からやり直せます。

## 進み具合

- [x] 段階1: 土台・起動画面・ハブ画面
- [x] 段階2: PCの状態・AIニュース・GitHubランキング・グラフビュー
- [x] 段階3: AGENTS（単体起動・指令室・状態・利用枠・VS Code / Git 連携）・設定
- [x] 段階4: 話しかけモード
- [x] 段階5: .exe の仕上げ（アイコン・タスクトレイ・通知・自動起動・二重起動の防止・同梱ファイルの削減・Electron の安全設定・GitHub での自動ビルド）
