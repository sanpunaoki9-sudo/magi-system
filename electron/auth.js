'use strict';

// 起動パスワードの保存と照合。平文は保存せず scrypt のハッシュだけを持つ。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const scryptAsync = promisify(crypto.scrypt);

const MIN_LENGTH = 4;
let configPath = null;

function init(userDataDir) {
  configPath = path.join(userDataDir, 'oz-config.json');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

function hash(password, salt) {
  return crypto.scryptSync(String(password), salt, 64);
}

function status() {
  return { hasPassword: Boolean(readConfig().auth) };
}

function setPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    return { ok: false, reason: `パスワードは${MIN_LENGTH}文字以上にしてください` };
  }
  const config = readConfig();
  if (config.auth) {
    return { ok: false, reason: 'パスワードは設定済みです' };
  }
  const salt = crypto.randomBytes(16);
  config.auth = { salt: salt.toString('hex'), hash: hash(password, salt).toString('hex') };
  writeConfig(config);
  return { ok: true };
}

// 入力のたびに呼ばれるので、メインプロセスを止めない非同期版を使う
async function verify(password) {
  const { auth } = readConfig();
  if (!auth || typeof password !== 'string') return { ok: false };
  const expected = Buffer.from(auth.hash, 'hex');
  const actual = await scryptAsync(password, Buffer.from(auth.salt, 'hex'), 64);
  return { ok: crypto.timingSafeEqual(expected, actual) };
}

module.exports = { init, status, setPassword, verify };
