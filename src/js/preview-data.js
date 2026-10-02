// ブラウザだけで画面を確認するときのサンプルデータ（Electron では使わない）。
// どの応答にも preview: true を付け、画面に「サンプル」と表示させる。

const now = () => Date.now();
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();

function createSystemSample() {
  let cpu = 18;
  let mem = 0.46;
  let gpu = 9;
  let rx = 220000;
  let tx = 40000;
  const walk = (v, step, min, max) => Math.min(max, Math.max(min, v + (Math.random() - 0.5) * step));
  const started = Date.now() - 3 * 3600000;

  return async () => {
    cpu = walk(cpu, 14, 3, 96);
    mem = walk(mem, 0.02, 0.3, 0.9);
    gpu = walk(gpu, 10, 0, 90);
    rx = walk(rx, 180000, 10000, 2400000);
    tx = walk(tx, 50000, 2000, 600000);
    const total = 32 * 1024 ** 3;
    return {
      preview: true,
      time: now(),
      info: { cpu: 'サンプル CPU', cores: 8, os: 'Windows 11（サンプル）' },
      cpu: { load: cpu },
      memory: { used: total * mem, total },
      gpu: { name: 'サンプル GPU', load: gpu, memoryUsed: 2400, memoryTotal: 8192, temperature: 48 },
      temperature: { cpu: 52, gpu: 48 },
      network: { rx, tx },
      disks: [
        { mount: 'C:', used: 412 * 1024 ** 3, size: 476 * 1024 ** 3 },
        { mount: 'D:', used: 620 * 1024 ** 3, size: 1863 * 1024 ** 3 },
      ],
      uptime: (Date.now() - started) / 1000,
    };
  };
}

const NEWS_CATEGORIES = [
  { id: 'official', label: '公式' },
  { id: 'research', label: '研究' },
  { id: 'community', label: 'コミュニティ' },
  { id: 'media', label: 'メディア' },
  { id: 'japanese', label: '日本語' },
];

const NEWS_ITEMS = [
  ['official', 'サンプル公式ブログ', 'サンプル: 新しいモデルの提供を開始しました', 'ここに記事の要約が入ります。アプリでは各社の公式発表を集めて表示します。', 1],
  ['japanese', 'サンプル日本語メディア', 'サンプル: 生成AIを業務に取り入れる企業が増加', '日本語の情報元からの記事は「日本語」で絞り込めます。', 2],
  ['research', 'サンプル論文フィード', 'サンプル: 長い文脈を効率よく扱う手法の提案', '研究カテゴリには arXiv や注目論文が入ります。', 3],
  ['community', 'サンプル掲示板', 'サンプル: ローカルで動く小型モデルを試してみた', '開発者コミュニティで話題の投稿です。', 5],
  ['media', 'サンプルテックメディア', 'サンプル: AIエージェントの最新動向まとめ', 'テック系メディアの記事です。', 8],
  ['official', 'サンプル公式ブログ', 'サンプル: 開発者向けツールの更新', '「Obsidianに保存」を押すと、保管庫にノートとして残せます。', 20],
  ['japanese', 'サンプル技術ブログ', 'サンプル: エージェントで開発を分担する方法', 'Zenn や Qiita などの記事も集めます。', 30],
];

const REPOS = [
  ['example', 'agent-toolkit', 'エージェントを組み立てるためのツール集（サンプル）', 'Python', 48200, 3100, 1240],
  ['sample-org', 'local-llm-runner', '手元のPCで言語モデルを動かす（サンプル）', 'Rust', 31500, 1800, 860],
  ['demo', 'vector-notes', 'ノートをベクトル検索する（サンプル）', 'TypeScript', 12800, 640, 510],
  ['example', 'prompt-lab', 'プロンプトを試す実験場（サンプル）', 'TypeScript', 9100, 420, 330],
  ['sample-org', 'code-review-bot', 'コードレビューを手伝うボット（サンプル）', 'Go', 7600, 380, 240],
  ['demo', 'speech-kit', '音声認識と読み上げ（サンプル）', 'C++', 5300, 260, 150],
];

function repoList(metric) {
  return REPOS.map(([owner, name, description, language, stars, forks, gained]) => ({
    fullName: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
    description,
    language,
    stars,
    forks,
    gained,
    sinceHours: 24,
  }))
    .sort((a, b) => b[metric] - a[metric])
    .map((repo, i) => ({ ...repo, rank: i + 1 }));
}

const VAULT_NOTES = [
  ['ホーム.md', 'user', ['プロジェクト/OZ Assistant', '日記/2026-10-02', '学習/Claude Code']],
  ['プロジェクト/OZ Assistant.md', 'user', ['プロジェクト/設計メモ', '学習/Electron', 'OZ/AIニュース']],
  ['プロジェクト/設計メモ.md', 'user', ['学習/Three.js', 'プロジェクト/OZ Assistant']],
  ['学習/Claude Code.md', 'user', ['学習/Codex', '学習/Antigravity', 'Git の使い方']],
  ['学習/Codex.md', 'user', ['学習/Claude Code']],
  ['学習/Antigravity.md', 'user', ['学習/Claude Code']],
  ['学習/Electron.md', 'user', ['学習/Three.js']],
  ['学習/Three.js.md', 'user', []],
  ['日記/2026-10-02.md', 'user', ['プロジェクト/OZ Assistant']],
  ['OZ/AIニュース.md', 'oz', []],
  ['OZ/ニュース/サンプル記事 1.md', 'oz', ['OZ/AIニュース']],
  ['OZ/ニュース/サンプル記事 2.md', 'oz', ['OZ/AIニュース']],
  ['OZ/ニュース/サンプル記事 3.md', 'oz', ['OZ/AIニュース', '学習/Claude Code']],
  ['OZ/会話ログ.md', 'oz', ['ホーム']],
];

function vaultGraph(extra) {
  const all = [...VAULT_NOTES, ...extra];
  const ids = new Set(all.map(([rel]) => rel));
  const nodes = new Map(all.map(([rel, origin]) => [rel, {
    id: rel,
    name: rel.split('/').pop().replace(/\.md$/, ''),
    folder: rel.includes('/') ? rel.split('/')[0] : '',
    origin,
    degree: 0,
  }]));
  const links = [];
  for (const [rel, , targets] of all) {
    for (const target of targets) {
      let id = `${target}.md`;
      if (!ids.has(id)) {
        id = `ghost:${target}`;
        if (!nodes.has(id)) nodes.set(id, { id, name: target.split('/').pop(), folder: '', origin: 'ghost', degree: 0 });
      }
      links.push({ source: rel, target: id });
      nodes.get(rel).degree += 1;
      nodes.get(id).degree += 1;
    }
  }
  return { preview: true, vault: '開発環境001（サンプル）', nodes: [...nodes.values()], links, truncated: false };
}

export function createPreviewApi() {
  const extraNotes = [];
  const listeners = new Set();

  return {
    system: { snapshot: createSystemSample() },
    news: {
      async list() {
        return {
          preview: true,
          fetchedAt: now(),
          categories: NEWS_CATEGORIES,
          items: NEWS_ITEMS.map(([category, source, title, summary, h], i) => ({
            id: `sample-${i}`,
            url: 'https://example.com/',
            title,
            summary,
            source,
            category,
            date: hoursAgo(h),
          })),
          failed: [],
          sourceCount: NEWS_ITEMS.length,
        };
      },
      async save(item) {
        extraNotes.push([`OZ/ニュース/${item.title}.md`, 'oz', ['OZ/AIニュース']]);
        listeners.forEach((fn) => fn());
        return { path: `OZ/ニュース/${item.title}.md`, name: item.title };
      },
    },
    github: {
      async trending() {
        return { preview: true, fetchedAt: now(), repos: repoList('gained') };
      },
      async top() {
        return { preview: true, fetchedAt: now(), repos: repoList('stars') };
      },
      async growth() {
        return { preview: true, fetchedAt: now(), tracked: REPOS.length, repos: repoList('gained') };
      },
    },
    vault: {
      async info() {
        return { path: 'sample', name: '開発環境001', expectedName: '開発環境001', detected: [] };
      },
      async graph() {
        return vaultGraph(extraNotes);
      },
      async add({ title, folder = 'OZ' }) {
        const rel = `${folder ? `${folder}/` : ''}${title}.md`;
        extraNotes.push([rel, 'oz', ['ホーム']]);
        return { path: rel, name: title };
      },
      async open() {
        return { ok: false };
      },
      onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
  };
}
