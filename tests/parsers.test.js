'use strict';

// ニュース・GitHub・話しかけの聞き分け・利用枠の読み取りのテスト
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseFeed, parseAnthropic, parseHfPapers } = require('../electron/services/news');
const { parseTrending, createGithub } = require('../electron/services/github');
const { parseDelegation, parseSplit } = require('../electron/services/talk');
const { createQuota, parseResetTime } = require('../electron/services/quota');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('RSS 2.0 を読む（CDATA と文字参照）', () => {
  const items = parseFeed(`<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
    <item><title><![CDATA[GPT &amp; friends: <b>new</b>]]></title><link>https://example.com/a</link>
    <pubDate>Wed, 01 Oct 2026 17:00:00 GMT</pubDate><description><![CDATA[<p>Hello &amp; welcome</p>]]></description></item>
  </channel></rss>`);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'GPT & friends: new');
  assert.equal(items[0].url, 'https://example.com/a');
  assert.equal(items[0].date, '2026-10-01T17:00:00.000Z');
  assert.equal(items[0].summary, 'Hello & welcome');
});

test('RSS 1.0 (RDF) と Atom を読む', () => {
  const rdf = parseFeed(`<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <item rdf:about="https://a.jp/1"><title>RDF記事</title><link>https://a.jp/1</link><dc:date>2026-10-02T08:00:00+09:00</dc:date></item></rdf:RDF>`);
  assert.deepEqual([rdf[0].title, rdf[0].date], ['RDF記事', '2026-10-01T23:00:00.000Z']);

  const atom = parseFeed(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry><title>Atom 記事</title><link href="https://b.dev/x" rel="alternate"/><updated>2026-09-30T00:00:00Z</updated><summary>s</summary></entry></feed>`);
  assert.deepEqual([atom[0].title, atom[0].url], ['Atom 記事', 'https://b.dev/x']);
});

test('RSS でも Atom でもないものはエラーにする', () => {
  assert.throws(() => parseFeed('<html><body>not a feed</body></html>'));
});

test('Anthropic のニュース一覧ページを読む', () => {
  const items = parseAnthropic(fixture('anthropic-news.html'), 'https://www.anthropic.com/news');
  assert.equal(items.length, 2);
  assert.equal(items[0].url, 'https://www.anthropic.com/news/claude-frontier-academy');
  assert.equal(items[1].title, 'Barclays scales Claude & improves client experience');
  assert.ok(items[0].date);
});

test('Hugging Face の注目論文を読む', () => {
  const items = parseHfPapers(JSON.stringify([{ paper: { id: '2610.00001', title: 'A Paper', summary: 'abc' }, publishedAt: '2026-10-02T00:00:00Z' }]));
  assert.equal(items[0].url, 'https://huggingface.co/papers/2610.00001');
});

test('GitHub Trending を読み、増えたスターの多い順に並べる', () => {
  const repos = parseTrending(fixture('github-trending.html'));
  assert.deepEqual(repos.map((r) => [r.rank, r.fullName, r.stars, r.gained]), [
    [1, 'acme/agent-kit', 12345, 1234],
    [2, 'foo/bar', 987, 56],
  ]);
  assert.equal(repos[0].language, 'Python');
});

test('スターの伸びを記録から計算する', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oz-gh-'));
  const now = Date.now();
  fs.writeFileSync(path.join(dir, 'oz-github-stars.json'), JSON.stringify({
    'a/b': [{ t: now - 26 * 3600e3, stars: 100 }, { t: now - 2 * 3600e3, stars: 150 }, { t: now, stars: 180 }],
    'c/d': [{ t: now, stars: 5 }],
  }));
  const { repos } = createGithub({ fetch: null, dataDir: dir }).growth({ windowHours: 24 });
  assert.equal(repos.length, 1);
  assert.equal(repos[0].gained, 80);
});

test('話しかけ: エージェントへの依頼を聞き分ける', () => {
  assert.deepEqual(parseDelegation('Codexにログイン画面のテストを書くのを頼んで'), { agentId: 'codex', task: 'ログイン画面のテストを書く' });
  assert.deepEqual(parseDelegation('READMEの更新をクロードコードにお願い'), { agentId: 'claude-code', task: 'READMEの更新' });
  assert.deepEqual(parseDelegation('アンチグラビティに画面のデザインを直してもらって'), { agentId: 'antigravity', task: '画面のデザインを直して' });
  assert.equal(parseDelegation('クロードに頼んで'), null);
  assert.equal(parseDelegation('明日の予定を教えて'), null);
});

test('話しかけ: 分担の依頼を聞き分ける', () => {
  assert.equal(parseSplit('分担してログイン機能を作って'), 'ログイン機能を作って');
  assert.equal(parseSplit('みんなで分担して、ブログを作る。'), 'ブログを作る');
  assert.equal(parseSplit('ニュースを読んで'), null);
});

test('利用枠: 回復時刻の書き方を読む', () => {
  const now = new Date('2026-10-02T10:00:00').getTime();
  assert.equal(parseResetTime('Usage limit reached. Try again in 2h30m', now), now + 150 * 60000);
  assert.equal(new Date(parseResetTime('5-hour limit reached ∙ resets at 3pm', now)).getHours(), 15);
  assert.equal(new Date(parseResetTime('resets at 9am', now)).getDate(), 3); // 過ぎた時刻は翌日
  assert.equal(parseResetTime('nothing here', now), null);
});

test('利用枠: 上限を検知し、回復時刻を過ぎたら自動で回復とみなす', () => {
  const q = createQuota();
  const seen = [];
  q.subscribe((id, s) => seen.push(`${id}:${s.state}`));
  assert.equal(q.inspectOutput('claude-code', 'すべて順調です'), false);
  assert.equal(q.inspectOutput('claude-code', 'Claude usage limit reached. Try again in 1h'), true);
  assert.equal(q.get('claude-code').state, 'exhausted');
  q.set('codex', { state: 'exhausted', resetAt: Date.now() - 1 });
  assert.equal(q.get('codex').state, 'ok');
  assert.ok(seen.includes('claude-code:exhausted'));
});
