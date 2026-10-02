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

## 構成

| 場所 | 内容 |
|---|---|
| `electron/main.js` | ウィンドウとアプリ全体の管理 |
| `electron/preload.js` | 画面から使える機能の窓口 |
| `electron/auth.js` | 起動パスワード（ハッシュで保存） |
| `src/index.html` | 画面 |
| `src/js/lock.js` | 起動画面（鍵穴） |
| `src/js/hub/` | ハブ画面（地球儀・丸タブ・軌道リング） |
| `src/js/panel.js` | 丸タブから開くパネル |
| `src/js/tabs.js` | 丸タブの一覧 |

パスワードを忘れたときは、`%APPDATA%\OZ Assistant\oz-config.json` を削除すると最初の設定からやり直せます。

## 進み具合

- [x] 段階1: 土台・起動画面・ハブ画面
- [ ] 段階2: PCの状態・AIニュース・GitHubランキング・グラフビュー
- [ ] 段階3: AGENTS（単体起動・指令室・状態・利用枠・VS Code / Git 連携）
- [ ] 段階4: 話しかけモード
- [ ] 段階5: .exe の仕上げ
