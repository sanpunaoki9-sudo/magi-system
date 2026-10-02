// src/index.html の importmap の sha256 を計算して CSP に書き込む
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../src/index.html', import.meta.url);
const html = readFileSync(file, 'utf8');
const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
if (!match) throw new Error('importmap が見つかりません');

const hash = createHash('sha256').update(match[1], 'utf8').digest('base64');
const updated = html.replace(/'sha256-[^']*'/, `'sha256-${hash}'`);
writeFileSync(file, updated);
console.log(`sha256-${hash}`);
