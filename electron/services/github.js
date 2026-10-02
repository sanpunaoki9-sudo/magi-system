'use strict';

// GitHub のスター数ランキング。
// 急上昇: github.com/trending を読む（公式APIがないため）
// 総スター: Search API
// 伸び: 取得のたびにスター数を記録し、前の記録との差を出す
const fs = require('node:fs');
const path = require('node:path');
const { parse: parseHtml } = require('node-html-parser');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OZAssistant/0.1';
const TIMEOUT_MS = 15000;
const CACHE_MS = { trending: 30 * 60 * 1000, top: 60 * 60 * 1000 };
const HISTORY_KEEP_MS = 35 * 24 * 60 * 60 * 1000;
const HISTORY_MIN_GAP_MS = 60 * 60 * 1000;
const AI_TOPICS = ['llm', 'artificial-intelligence', 'machine-learning', 'deep-learning', 'ai-agents'];

const SINCE = new Set(['daily', 'weekly', 'monthly']);
const LANGUAGE_PATTERN = /^[a-z0-9+#.-]{1,30}$/i;

const toNumber = (s) => Number(String(s ?? '').replace(/[^\d]/g, '')) || 0;
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// 期間中に増えたスターの多い順に並べ、順位を付け直す
function parseTrending(body) {
  const root = parseHtml(body);
  const repos = root.querySelectorAll('article.Box-row').map((row) => {
    const link = row.querySelector('h2 a') ?? row.querySelector('h1 a');
    const fullName = clean(link?.getAttribute('href')).replace(/^\//, '');
    const starLink = row.querySelector('a[href$="/stargazers"]');
    const forkLink = row.querySelector('a[href$="/forks"]') ?? row.querySelector('a[href$="/network/members"]');
    const gained = row.querySelectorAll('span').map((s) => clean(s.text)).find((t) => /stars? (today|this week|this month)/.test(t));
    return {
      fullName,
      url: `https://github.com/${fullName}`,
      description: clean(row.querySelector('p')?.text),
      language: clean(row.querySelector('[itemprop="programmingLanguage"]')?.text) || null,
      stars: toNumber(starLink?.text),
      forks: toNumber(forkLink?.text),
      gained: toNumber(gained),
    };
  });
  return repos
    .filter((repo) => repo.fullName.includes('/'))
    .sort((a, b) => b.gained - a.gained)
    .map((repo, i) => ({ ...repo, rank: i + 1 }));
}

function fromSearchItem(item) {
  return {
    fullName: item.full_name,
    url: item.html_url,
    description: clean(item.description),
    language: item.language ?? null,
    stars: item.stargazers_count,
    forks: item.forks_count,
    topics: item.topics ?? [],
  };
}

function createGithub({ fetch, dataDir, getToken = () => null }) {
  const historyPath = path.join(dataDir, 'oz-github-stars.json');
  const cache = new Map();

  function readHistory() {
    try {
      return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    } catch {
      return {};
    }
  }

  // スター数の記録。同じリポジトリは1時間に1回まで、35日より古い記録は捨てる
  function record(repos) {
    const history = readHistory();
    const now = Date.now();
    for (const repo of repos) {
      if (!repo.fullName || !repo.stars) continue;
      const entries = (history[repo.fullName] ?? []).filter((e) => now - e.t < HISTORY_KEEP_MS);
      const last = entries[entries.length - 1];
      if (!last || now - last.t >= HISTORY_MIN_GAP_MS) entries.push({ t: now, stars: repo.stars });
      else last.stars = repo.stars;
      history[repo.fullName] = entries;
    }
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.writeFileSync(historyPath, JSON.stringify(history), 'utf8');
  }

  async function get(url, accept) {
    const headers = { 'User-Agent': USER_AGENT, Accept: accept };
    const token = getToken();
    if (token && url.startsWith('https://api.github.com/')) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 403 || res.status === 429) throw new Error('GitHub の取得回数の上限に達しました。しばらくしてから更新してください');
    if (!res.ok) throw new Error(`GitHub から取得できませんでした (HTTP ${res.status})`);
    return res;
  }

  async function cached(key, ttl, loader, force) {
    const hit = cache.get(key);
    if (!force && hit && Date.now() - hit.fetchedAt < ttl) return hit;
    const value = { fetchedAt: Date.now(), ...(await loader()) };
    cache.set(key, value);
    return value;
  }

  async function trending({ since = 'daily', language = '', force = false } = {}) {
    if (!SINCE.has(since)) since = 'daily';
    if (language && !LANGUAGE_PATTERN.test(language)) language = '';
    return cached(`trending:${since}:${language}`, CACHE_MS.trending, async () => {
      const lang = language ? `/${encodeURIComponent(language.toLowerCase())}` : '';
      const res = await get(`https://github.com/trending${lang}?since=${since}`, 'text/html');
      const repos = parseTrending(await res.text());
      record(repos);
      return { repos };
    }, force);
  }

  async function search(query, perPage) {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}`;
    const res = await get(url, 'application/vnd.github+json');
    const body = await res.json();
    return (body.items ?? []).map(fromSearchItem);
  }

  async function top({ scope = 'all', force = false } = {}) {
    if (scope !== 'ai') scope = 'all';
    return cached(`top:${scope}`, CACHE_MS.top, async () => {
      let repos;
      if (scope === 'ai') {
        const lists = await Promise.all(AI_TOPICS.map((topic) => search(`topic:${topic} stars:>1000`, 30)));
        const merged = new Map();
        for (const repo of lists.flat()) merged.set(repo.fullName, repo);
        repos = [...merged.values()].sort((a, b) => b.stars - a.stars).slice(0, 50);
      } else {
        repos = await search('stars:>10000', 50);
      }
      record(repos);
      return { repos: repos.map((repo, i) => ({ ...repo, rank: i + 1 })) };
    }, force);
  }

  // 記録が2回以上あるリポジトリについて、指定期間のスターの増え方を出す
  function growth({ windowHours = 24 } = {}) {
    const history = readHistory();
    const now = Date.now();
    const windowMs = Math.min(Math.max(Number(windowHours) || 24, 1), 24 * 30) * 60 * 60 * 1000;
    const repos = [];

    for (const [fullName, entries] of Object.entries(history)) {
      if (entries.length < 2) continue;
      const latest = entries[entries.length - 1];
      // 期間の始まりに一番近い、それより前（なければ一番古い）記録と比べる
      const base = [...entries].reverse().find((e) => latest.t - e.t >= windowMs) ?? entries[0];
      if (base === latest) continue;
      repos.push({
        fullName,
        url: `https://github.com/${fullName}`,
        stars: latest.stars,
        gained: latest.stars - base.stars,
        sinceHours: Math.round((latest.t - base.t) / 3600000),
        updatedAt: latest.t,
      });
    }

    repos.sort((a, b) => b.gained - a.gained);
    const tracked = Object.keys(history).length;
    return { fetchedAt: now, tracked, repos: repos.slice(0, 50).map((repo, i) => ({ ...repo, rank: i + 1 })) };
  }

  return { trending, top, growth };
}

module.exports = { createGithub, parseTrending };
