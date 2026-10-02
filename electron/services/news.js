'use strict';

// AIニュースの収集。RSS / Atom / 一部のページを読み、1つの一覧にまとめる。
const { XMLParser } = require('fast-xml-parser');
const { parse: parseHtml } = require('node-html-parser');
const { CATEGORIES, SOURCES } = require('./news-sources');

const CACHE_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 12000;
const DEFAULT_LIMIT = 25;
const SUMMARY_LENGTH = 180;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OZAssistant/0.1';

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: true,
});

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// 要素の中身を文字列として取り出す（CDATA や属性付きの要素にも対応）
function text(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === 'object') return text(value['#text'] ?? value.__cdata ?? '');
  return '';
}

function plain(html) {
  return text(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function summarize(html) {
  const s = plain(html);
  return s.length > SUMMARY_LENGTH ? `${s.slice(0, SUMMARY_LENGTH)}…` : s;
}

function isoDate(value) {
  const d = new Date(text(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function atomLink(link) {
  const links = asArray(link);
  const alt = links.find((l) => typeof l === 'object' && (!l['@_rel'] || l['@_rel'] === 'alternate')) ?? links[0];
  return typeof alt === 'object' ? alt['@_href'] ?? '' : text(alt);
}

function parseFeed(body) {
  const doc = xml.parse(body);

  // RSS 2.0
  if (doc.rss?.channel) {
    return asArray(doc.rss.channel.item).map((item) => ({
      title: plain(item.title),
      url: text(item.link) || text(item.guid),
      date: isoDate(item.pubDate ?? item['dc:date']),
      summary: summarize(item.description ?? item['content:encoded']),
    }));
  }

  // RSS 1.0 (RDF)
  if (doc['rdf:RDF']) {
    return asArray(doc['rdf:RDF'].item).map((item) => ({
      title: plain(item.title),
      url: text(item.link),
      date: isoDate(item['dc:date']),
      summary: summarize(item.description),
    }));
  }

  // Atom
  if (doc.feed) {
    return asArray(doc.feed.entry).map((entry) => ({
      title: plain(entry.title),
      url: atomLink(entry.link),
      date: isoDate(entry.published ?? entry.updated),
      summary: summarize(entry.summary ?? entry.content),
    }));
  }

  throw new Error('RSS / Atom として読めませんでした');
}

// Anthropic には RSS がないので、ニュース一覧ページから日付と見出しを読む
function parseAnthropic(body, baseUrl) {
  const root = parseHtml(body);
  const items = [];
  for (const a of root.querySelectorAll('a[href^="/news/"]')) {
    const time = a.querySelector('time');
    const title =
      a.querySelector('[class*="title"]') ?? a.querySelector('h2, h3, h4') ?? a.querySelector('span:last-child');
    if (!time || !title) continue;
    items.push({
      title: plain(title.innerHTML),
      url: new URL(a.getAttribute('href'), baseUrl).toString(),
      date: isoDate(time.getAttribute('datetime') ?? time.text),
      summary: '',
    });
  }
  return items;
}

function parseHfPapers(body) {
  return asArray(JSON.parse(body)).map((entry) => {
    const paper = entry.paper ?? entry;
    return {
      title: plain(paper.title ?? entry.title),
      url: `https://huggingface.co/papers/${paper.id}`,
      date: isoDate(entry.publishedAt ?? paper.publishedAt),
      summary: summarize(paper.summary ?? ''),
    };
  });
}

function parseSource(source, body) {
  switch (source.type) {
    case 'anthropic':
      return parseAnthropic(body, source.url);
    case 'hf-papers':
      return parseHfPapers(body);
    default:
      return parseFeed(body);
  }
}

function createNews({ fetch }) {
  let cache = null;

  async function load(source) {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseSource(source, await res.text());
    return items
      .filter((item) => item.title && /^https?:\/\//.test(item.url))
      .slice(0, source.limit ?? DEFAULT_LIMIT)
      .map((item) => ({
        ...item,
        id: item.url,
        source: source.name,
        sourceId: source.id,
        category: source.category,
      }));
  }

  async function list({ force = false } = {}) {
    if (!force && cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache;

    const results = await Promise.allSettled(SOURCES.map(load));
    const seen = new Set();
    const items = [];
    const failed = [];

    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        failed.push({ source: SOURCES[i].name, reason: String(result.reason?.message ?? result.reason) });
        return;
      }
      for (const item of result.value) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        items.push(item);
      }
    });

    // 日付のないものは一番下へ
    items.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

    cache = { fetchedAt: Date.now(), categories: CATEGORIES, items, failed, sourceCount: SOURCES.length };
    return cache;
  }

  return { list };
}

module.exports = { createNews, parseFeed, parseAnthropic, parseHfPapers };
