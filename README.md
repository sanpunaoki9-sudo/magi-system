# OZ Assistant

映画『サマーウォーズ』の OZ をモチーフにした、Windows 向けの AI アシスタントアプリです。

## 必要なもの

- Windows 10 / 11
- [Node.js](https://nodejs.org/) 20 以上
- Git

## 起動のしかた

```powershell
git clone https://github.com/sanpunaoki9-sudo/magi-system.git
cd magi-system
git checkout claude/jarvis-assistant-app-3dhco3
npm install
npm start
```

最初の起動では、起動パスワードを決める画面が出ます。次からは、そのパスワードで解錠します。

## .exe を作る

```powershell
npm run dist
```

`dist/` にインストーラ版とポータブル版ができます。

## 画面だけをブラウザで確認する

```powershell
npm run dev:web
```

表示された URL（`http://localhost:5173/src/index.html`）をブラウザで開きます。
ブラウザ版では、パスワードはブラウザの中にだけ保存されます。

## 機能

| 丸タブ | できること |
|---|---|
| SYSTEM（PCの状態） | CPU・メモリ・GPU・ネットワークを1秒ごとに更新し、直近60秒を折れ線で表示。ディスクの使用量と温度も表示 |
| NEWS（AIニュース） | 各社公式・研究・コミュニティ・メディア・日本語の24の情報元から集めて新しい順に表示。絞り込み・検索・Obsidianへの保存 |
| RANKING（GitHubランキング） | 急上昇（今日・今週・今月、言語別）、総スター（全体・AI関連）、伸び（取得のたびに記録したスター数の増加） |
| GRAPH（グラフビュー） | Obsidian の保管庫「開発環境001」のノートとリンクを3Dで表示。保管庫が変わると自動で更新。メモの追加・検索・Obsidianで開く |

### Obsidian の保管庫

Obsidian に登録されている保管庫の中から「開発環境001」を自動で探します。
見つからないときは、グラフビューの「保管庫を選ぶ」からフォルダを選んでください。
アプリが追加するノートは保管庫の `OZ` フォルダに入ります（ニュースは `OZ/ニュース`）。

### GitHub の取得回数

GitHub の総スターは、ログインなしだと1時間あたりの取得回数に上限があります。
上限にかかる場合は、`oz-config.json` に `"github": { "token": "<個人用アクセストークン>" }` を書くと上限が上がります（設定画面は段階3で作ります）。

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
- [ ] 段階3: AGENTS（単体起動・指令室・状態・利用枠・VS Code / Git 連携）・設定
- [ ] 段階4: 話しかけモード
- [ ] 段階5: .exe の仕上げ
