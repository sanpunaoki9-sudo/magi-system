'use strict';

// アプリの設定（userData/oz-config.json）。起動パスワードや保管庫の場所などをまとめて持つ。
const fs = require('node:fs');
const path = require('node:path');

let configPath = null;

function init(userDataDir) {
  configPath = path.join(userDataDir, 'oz-config.json');
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

function write(config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

function get(key) {
  return read()[key];
}

function set(key, value) {
  const config = read();
  config[key] = value;
  write(config);
}

module.exports = { init, read, write, get, set };
