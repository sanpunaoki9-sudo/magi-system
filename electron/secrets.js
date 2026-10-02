'use strict';

// GitHub トークンなどの秘密の値を、OS の暗号化（Windows では DPAPI）で守って設定ファイルに保存する
const { safeStorage } = require('electron');
const config = require('./config');

function setSecret(key, value) {
  const secrets = config.get('secrets') ?? {};
  if (!value) {
    delete secrets[key];
  } else if (safeStorage.isEncryptionAvailable()) {
    secrets[key] = { enc: safeStorage.encryptString(String(value)).toString('base64') };
  } else {
    // 暗号化が使えない環境では保存しない（平文では残さない）
    throw new Error('この環境では安全に保存できません');
  }
  config.set('secrets', secrets);
}

function getSecret(key) {
  const entry = config.get('secrets')?.[key];
  if (!entry?.enc) return null;
  try {
    return safeStorage.decryptString(Buffer.from(entry.enc, 'base64'));
  } catch {
    return null;
  }
}

function hasSecret(key) {
  return Boolean(config.get('secrets')?.[key]?.enc);
}

module.exports = { setSecret, getSecret, hasSecret };
