'use strict';

// 起動パスワードの保存と照合。平文は保存せず scrypt のハッシュだけを持つ。
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const config = require('./config');

const scryptAsync = promisify(crypto.scrypt);
const MIN_LENGTH = 4;

function status() {
  return { hasPassword: Boolean(config.get('auth')) };
}

function setPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    return { ok: false, reason: `パスワードは${MIN_LENGTH}文字以上にしてください` };
  }
  if (config.get('auth')) {
    return { ok: false, reason: 'パスワードは設定済みです' };
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  config.set('auth', { salt: salt.toString('hex'), hash: hash.toString('hex') });
  return { ok: true };
}

// メインプロセスを止めないように非同期版を使う
async function verify(password) {
  const auth = config.get('auth');
  if (!auth || typeof password !== 'string') return { ok: false };
  const expected = Buffer.from(auth.hash, 'hex');
  const actual = await scryptAsync(password, Buffer.from(auth.salt, 'hex'), 64);
  return { ok: crypto.timingSafeEqual(expected, actual) };
}

module.exports = { status, setPassword, verify };
