// パネルの中身を組み立てるための小さな道具

// h('div', { class: 'x', onclick }, 'text', child) のように要素を作る
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// 切り替えボタンの列。onChange(value) を呼ぶ
export function segmented(options, value, onChange, label) {
  const root = h('div', { class: 'seg', role: 'tablist', 'aria-label': label });
  const buttons = options.map((opt) => {
    const btn = h('button', { type: 'button', class: 'seg-btn', role: 'tab', 'aria-selected': String(opt.value === value) }, opt.label);
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      onChange(opt.value);
    });
    return btn;
  });
  root.append(...buttons);
  return root;
}

export function notice(text, kind = 'info') {
  return h('p', { class: `notice notice-${kind}`, role: kind === 'error' ? 'alert' : null }, text);
}

export function loading(text = '読み込み中') {
  return h('p', { class: 'loading' }, text);
}

// 画面の外（ブラウザの既定のアプリ）で開く
export function openExternal(oz, url) {
  if (oz.openExternal) oz.openExternal(url);
  else window.open(url, '_blank', 'noopener');
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes, digits = 1) {
  if (!Number.isFinite(bytes)) return '--';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : digits)} ${BYTE_UNITS[unit]}`;
}

export function formatRate(bytesPerSec) {
  return Number.isFinite(bytesPerSec) ? `${formatBytes(bytesPerSec)}/s` : '--';
}

export function formatCompact(n) {
  if (!Number.isFinite(n)) return '--';
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('ja-JP');
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '--';
  const d = Math.floor(seconds / 86400);
  const hrs = Math.floor((seconds % 86400) / 3600);
  const min = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}日 ${hrs}時間` : `${hrs}時間 ${min}分`;
}

export function formatTime(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 「3時間前」のような表示。1週間より前は日付にする
export function formatRelative(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return 'たった今';
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}日前`;
  const d = new Date(t);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
