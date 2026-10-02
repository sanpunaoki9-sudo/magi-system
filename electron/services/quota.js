'use strict';

// エージェントの利用枠。CLIの出力やローカルの記録から「枠が尽きたか」「いつ回復するか」を追う。
// 回復したら自動でキューを再開するために、状態の変化を購読できるようにする。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// CLI が枠切れのときに出す文言と、リセット時刻の手がかり
const LIMIT_PATTERNS = [
  /usage limit reached/i,
  /rate limit(?:ed| reached| exceeded)/i,
  /you(?:'ve| have) (?:hit|reached) your/i,
  /quota (?:exceeded|exhausted)/i,
  /too many requests/i,
  /利用.{0,4}(?:上限|制限).{0,6}(?:達|到達|超)/,
  /(?:5-hour|weekly) limit/i,
  /(?:individual )?quota (?:reached|limit)/i,
  /RESOURCE_EXHAUSTED/,
];

// 「resets at 3pm」「try again in 2h30m」などから回復時刻(ms)を読む
function parseResetTime(text, now = Date.now()) {
  const inMatch = text.match(/(?:try again|retry|reset[s]?)\s+in\s+(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?/i);
  if (inMatch && (inMatch[1] || inMatch[2])) {
    const hours = Number(inMatch[1] || 0);
    const mins = Number(inMatch[2] || 0);
    if (hours || mins) return now + (hours * 60 + mins) * 60000;
  }
  const atMatch = text.match(/reset[s]?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (atMatch) {
    const d = new Date(now);
    let hour = Number(atMatch[1]);
    const minute = Number(atMatch[2] || 0);
    const ap = atMatch[3]?.toLowerCase();
    if (ap === 'pm' && hour < 12) hour += 12;
    if (ap === 'am' && hour === 12) hour = 0;
    d.setHours(hour, minute, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  const iso = text.match(/reset[^0-9]{0,12}(\d{4}-\d{2}-\d{2}T[\d:.+Z-]+)/i);
  if (iso) {
    const t = new Date(iso[1]).getTime();
    if (Number.isFinite(t)) return t;
  }
  return null;
}

// Codex はセッション記録に残り枠を書くことがある。一番新しいものから読む
function readCodexQuota() {
  try {
    const dir = path.join(os.homedir(), '.codex', 'sessions');
    const files = [];
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name.endsWith('.jsonl') || entry.name.endsWith('.json')) {
          files.push({ full, mtime: fs.statSync(full).mtimeMs });
        }
      }
    }
    files.sort((a, b) => b.mtime - a.mtime);
    for (const { full } of files.slice(0, 5)) {
      const lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean).reverse();
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          const rl = obj.rate_limits ?? obj.rate_limit ?? obj.usage?.rate_limits;
          if (!rl) continue;
          const primary = rl.primary ?? rl['5h'] ?? rl.secondary ?? rl;
          const usedPercent = primary.used_percent ?? primary.usedPercent;
          if (usedPercent == null) continue;
          const resetSeconds = primary.resets_in_seconds ?? primary.reset_in_seconds;
          return {
            remaining: Math.max(0, 100 - usedPercent) / 100,
            resetAt: resetSeconds ? Date.now() + resetSeconds * 1000 : null,
            source: 'codex-session',
          };
        } catch {
          // 壊れた行は飛ばす
        }
      }
    }
  } catch {
    // 記録がなければ unknown
  }
  return null;
}

function createQuota() {
  // agentId -> { state, resetAt, remaining, source, updatedAt }
  const quotas = new Map();
  const listeners = new Set();

  function emit(agentId) {
    const snapshot = get(agentId);
    for (const fn of listeners) fn(agentId, snapshot);
  }

  function get(agentId) {
    const q = quotas.get(agentId) ?? { state: 'unknown' };
    // リセット時刻を過ぎていたら自動で回復とみなす
    if (q.state === 'exhausted' && q.resetAt && Date.now() >= q.resetAt) {
      const recovered = { state: 'ok', resetAt: null, remaining: null, source: q.source, updatedAt: Date.now() };
      quotas.set(agentId, recovered);
      return { agentId, ...recovered };
    }
    return { agentId, ...q };
  }

  function set(agentId, patch) {
    const prev = quotas.get(agentId) ?? {};
    const next = { ...prev, ...patch, updatedAt: Date.now() };
    quotas.set(agentId, next);
    emit(agentId);
    return get(agentId);
  }

  // CLI の出力1行を見て、枠切れなら exhausted にする。戻り値は枠切れを検知したか
  function inspectOutput(agentId, line) {
    if (!LIMIT_PATTERNS.some((re) => re.test(line))) return false;
    const resetAt = parseResetTime(line) ?? Date.now() + 5 * 60 * 60 * 1000; // 手がかりがなければ5時間後
    set(agentId, { state: 'exhausted', resetAt, remaining: 0, source: 'output' });
    return true;
  }

  function markExhausted(agentId, resetAt) {
    set(agentId, { state: 'exhausted', resetAt: resetAt ?? Date.now() + 5 * 60 * 60 * 1000, remaining: 0, source: 'manual' });
    return get(agentId);
  }

  function markRecovered(agentId) {
    set(agentId, { state: 'ok', resetAt: null, remaining: null });
    return get(agentId);
  }

  // ローカルの記録から分かる範囲で最新化する
  function refresh(agentId) {
    if (agentId === 'codex') {
      const info = readCodexQuota();
      if (info) {
        const current = quotas.get(agentId);
        // output で exhausted にした判断は、記録が「まだ余裕あり」でも上書きしない
        if (current?.state === 'exhausted' && (!current.resetAt || Date.now() < current.resetAt)) return get(agentId);
        set(agentId, { state: info.remaining > 0 ? 'ok' : 'exhausted', ...info });
      }
    }
    return get(agentId);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function all(agentIds) {
    return agentIds.map((id) => get(id));
  }

  return { get, set, inspectOutput, markExhausted, markRecovered, refresh, subscribe, all, _parseResetTime: parseResetTime };
}

module.exports = { createQuota, parseResetTime };
