'use strict';

// Obsidian の保管庫（Vault）。ノートとリンクを読んでグラフにし、アプリからノートを追加する。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_VAULT_NAME = '開発環境001';
const OZ_FOLDER = 'OZ';
const MAX_NOTES = 5000;
const MAX_NOTE_BYTES = 1024 * 1024;
const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);

const WIKILINK = /\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const MDLINK = /\]\(([^)\s]+?\.md)(?:#[^)]*)?\)/g;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

// Obsidian が保管庫の一覧を書いている設定ファイル
function obsidianConfigPath() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? '', 'obsidian', 'obsidian.json');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'obsidian', 'obsidian.json');
}

function detectVaults() {
  try {
    const { vaults = {} } = JSON.parse(fs.readFileSync(obsidianConfigPath(), 'utf8'));
    return Object.values(vaults)
      .filter((v) => v?.path && fs.existsSync(v.path))
      .map((v) => ({ path: v.path, name: path.basename(v.path) }));
  } catch {
    return [];
  }
}

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const toPosix = (p) => p.split(path.sep).join('/');
const stripMd = (p) => p.replace(/\.md$/i, '');

function walk(root) {
  const files = [];
  const stack = [root];
  while (stack.length && files.length < MAX_NOTES) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        files.push(full);
      }
    }
  }
  return files;
}

function readNote(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_NOTE_BYTES) return { content: '', mtime: stat.mtimeMs };
    return { content: fs.readFileSync(file, 'utf8'), mtime: stat.mtimeMs };
  } catch {
    return { content: '', mtime: 0 };
  }
}

function extractLinks(content) {
  const targets = [];
  for (const m of content.matchAll(WIKILINK)) targets.push(m[1].trim());
  for (const m of content.matchAll(MDLINK)) {
    try {
      targets.push(stripMd(decodeURIComponent(m[1])).replace(/^\.?\//, ''));
    } catch {
      // 壊れたURLエンコードは無視する
    }
  }
  return targets.filter(Boolean);
}

function isOzNote(rel, content) {
  if (rel.split('/')[0] === OZ_FOLDER) return true;
  const fm = content.match(FRONTMATTER);
  return Boolean(fm && /^source:\s*oz-assistant\s*$/m.test(fm[1]));
}

// 保管庫全体をグラフにする。リンク先が見つからないものは「未作成」のノードにする
function buildGraph(root) {
  const files = walk(root);
  const notes = files.map((file) => {
    const rel = toPosix(path.relative(root, file));
    const { content, mtime } = readNote(file);
    return { rel, content, mtime };
  });

  const byPath = new Map();
  const byName = new Map();
  for (const note of notes) {
    const key = stripMd(note.rel).toLowerCase();
    byPath.set(key, note.rel);
    const name = path.posix.basename(key);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(note.rel);
  }

  const resolve = (target) => {
    const key = stripMd(target).toLowerCase();
    if (byPath.has(key)) return byPath.get(key);
    const candidates = byName.get(path.posix.basename(key));
    // 同じ名前が複数あるときは、パスが一番短いもの（Obsidian の解決方法に合わせる）
    return candidates ? [...candidates].sort((a, b) => a.length - b.length)[0] : null;
  };

  const nodes = new Map();
  for (const note of notes) {
    nodes.set(note.rel, {
      id: note.rel,
      name: path.posix.basename(stripMd(note.rel)),
      folder: note.rel.includes('/') ? note.rel.split('/')[0] : '',
      origin: isOzNote(note.rel, note.content) ? 'oz' : 'user',
      mtime: note.mtime,
      degree: 0,
    });
  }

  const links = [];
  const seen = new Set();
  for (const note of notes) {
    for (const target of extractLinks(note.content)) {
      let id = resolve(target);
      if (!id) {
        id = `ghost:${stripMd(target).toLowerCase()}`;
        if (!nodes.has(id)) {
          nodes.set(id, { id, name: path.posix.basename(stripMd(target)), folder: '', origin: 'ghost', mtime: 0, degree: 0 });
        }
      }
      if (id === note.rel) continue;
      const key = `${note.rel}\u0000${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: note.rel, target: id });
      nodes.get(note.rel).degree += 1;
      nodes.get(id).degree += 1;
    }
  }

  return { nodes: [...nodes.values()], links, truncated: files.length >= MAX_NOTES };
}

function safeFileName(name) {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || '無題';
}

function safeFolder(folder) {
  return String(folder ?? OZ_FOLDER)
    .split(/[\\/]+/)
    .map((part) => safeFileName(part))
    .filter((part) => part && part !== '.' && part !== '..' && part !== '無題')
    .join(path.sep);
}

function createVault({ getConfig, setConfig }) {
  let watcher = null;

  function info() {
    const detected = detectVaults();
    const configured = getConfig()?.path;
    let current = null;
    if (configured && isDir(configured)) current = configured;
    else current = detected.find((v) => v.name === DEFAULT_VAULT_NAME)?.path ?? null;
    return {
      path: current,
      name: current ? path.basename(current) : null,
      expectedName: DEFAULT_VAULT_NAME,
      detected,
    };
  }

  function requireVault() {
    const { path: root } = info();
    if (!root) throw new Error(`保管庫「${DEFAULT_VAULT_NAME}」が見つかりません`);
    return root;
  }

  function choose(dir) {
    if (!isDir(dir)) throw new Error('フォルダが見つかりません');
    setConfig({ path: dir });
    return info();
  }

  function graph() {
    const root = requireVault();
    return { vault: path.basename(root), ...buildGraph(root) };
  }

  // ノートを追加する。保管庫の外には書かず、同じ名前があれば番号を付ける
  function addNote({ title, body = '', folder = OZ_FOLDER, tags = [] } = {}) {
    const root = requireVault();
    const dir = path.resolve(root, safeFolder(folder));
    if (dir !== root && !dir.startsWith(root + path.sep)) throw new Error('保管庫の外には保存できません');
    fs.mkdirSync(dir, { recursive: true });

    const base = safeFileName(title);
    let file = path.join(dir, `${base}.md`);
    for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base} (${n}).md`);

    const tagLine = tags.length ? `tags: [${tags.map((t) => safeFileName(t).replace(/\s/g, '-')).join(', ')}]\n` : '';
    const frontmatter = `---\ncreated: ${new Date().toISOString()}\nsource: oz-assistant\n${tagLine}---\n\n`;
    fs.writeFileSync(file, frontmatter + String(body), 'utf8');
    return { path: toPosix(path.relative(root, file)), name: path.basename(file, '.md') };
  }

  // まとめ役のノート（例: AIニュース）がなければ作る
  function ensureHub(name, description) {
    const root = requireVault();
    const file = path.join(root, OZ_FOLDER, `${safeFileName(name)}.md`);
    if (!fs.existsSync(file)) {
      addNote({ title: name, body: `${description}\n` });
    }
  }

  function saveNews(item) {
    if (!item || typeof item.title !== 'string' || !/^https?:\/\//.test(item.url ?? '')) {
      throw new Error('保存できない記事です');
    }
    ensureHub('AIニュース', 'OZ Assistant が保存したAIニュースのまとめです。');
    const date = item.date ? new Date(item.date).toISOString().slice(0, 10) : '';
    const body = [
      `# ${item.title}`,
      '',
      `- 情報元: ${item.source ?? ''}`,
      date ? `- 日付: ${date}` : null,
      `- リンク: ${item.url}`,
      '',
      item.summary ? `${item.summary}\n` : null,
      '[[AIニュース]]',
      '',
    ]
      .filter((line) => line !== null)
      .join('\n');
    return addNote({ title: item.title, body, folder: `${OZ_FOLDER}/ニュース`, tags: ['ai-news'] });
  }

  function obsidianUrl(rel) {
    const root = requireVault();
    const file = stripMd(String(rel ?? ''));
    return `obsidian://open?vault=${encodeURIComponent(path.basename(root))}&file=${encodeURIComponent(file)}`;
  }

  // 保管庫の変更を見張る。まとめて変更されても1回だけ知らせる
  function watch(onChange) {
    unwatch();
    const root = info().path;
    if (!root) return;
    let timer = null;
    try {
      watcher = fs.watch(root, { recursive: true }, (_event, file) => {
        if (file && String(file).split(/[\\/]/)[0] === '.obsidian') return;
        clearTimeout(timer);
        timer = setTimeout(onChange, 800);
      });
      watcher.on('error', () => unwatch());
    } catch {
      watcher = null;
    }
  }

  function unwatch() {
    watcher?.close();
    watcher = null;
  }

  return { info, choose, graph, addNote, ensureHub, saveNews, obsidianUrl, watch, unwatch };
}

module.exports = { createVault, buildGraph, safeFileName };
