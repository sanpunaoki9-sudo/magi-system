'use strict';

// 音声認識（Whisper）のモデル。初回だけ Hugging Face からダウンロードし、以後は PC の中だけで動く。
// 保存先: userData/models/<モデルID>/...（画面からは app://oz/models/ で読む）
const fs = require('node:fs');
const path = require('node:path');

const MODELS = [
  { id: 'onnx-community/whisper-small', label: '高精度（small・約250MB）', recommended: true },
  { id: 'onnx-community/whisper-base', label: '軽量（base・約80MB）' },
];

// q8（量子化）版を使う。ファイル名の末尾は _quantized
const ONNX_FILES = ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
const JSON_FILES = new Set([
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'added_tokens.json',
  'normalizer.json',
  'vocab.json',
  'merges.txt',
]);
const TIMEOUT_MS = 30 * 60 * 1000;

function createSpeechModels({ fetch, dataDir, onProgress }) {
  const root = path.join(dataDir, 'models');
  const downloading = new Map(); // modelId -> promise

  const known = (id) => MODELS.find((m) => m.id === id);
  const dirOf = (id) => path.join(root, ...id.split('/'));
  const markerOf = (id) => path.join(dirOf(id), '.oz-complete');

  function list() {
    return MODELS.map((m) => ({
      ...m,
      installed: fs.existsSync(markerOf(m.id)),
      downloading: downloading.has(m.id),
    }));
  }

  // リポジトリのファイル一覧から、必要なものだけを選ぶ
  async function fileList(id) {
    const res = await fetch(`https://huggingface.co/api/models/${id}/tree/main?recursive=true`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`モデルの情報を取得できませんでした (HTTP ${res.status})`);
    const entries = await res.json();
    const files = entries
      .filter((e) => e.type === 'file' && (JSON_FILES.has(e.path) || ONNX_FILES.includes(e.path)))
      .map((e) => ({ path: e.path, size: e.lfs?.size ?? e.size ?? 0 }));
    for (const required of ONNX_FILES) {
      if (!files.some((f) => f.path === required)) throw new Error(`モデルに必要なファイルがありません: ${required}`);
    }
    return files;
  }

  async function downloadFile(id, file, report) {
    const target = path.join(dirOf(id), ...file.path.split('/'));
    if (fs.existsSync(target) && (!file.size || fs.statSync(target).size === file.size)) {
      report(file.size);
      return;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const res = await fetch(`https://huggingface.co/${id}/resolve/main/${file.path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok || !res.body) throw new Error(`${file.path} をダウンロードできませんでした (HTTP ${res.status})`);

    const part = `${target}.part`;
    const out = fs.createWriteStream(part);
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!out.write(value)) await new Promise((resolve) => out.once('drain', resolve));
        report(value.byteLength);
      }
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
      fs.renameSync(part, target);
    } catch (err) {
      out.destroy();
      fs.rmSync(part, { force: true });
      throw err;
    }
  }

  function download(id) {
    if (!known(id)) throw new Error('知らないモデルです');
    if (fs.existsSync(markerOf(id))) return Promise.resolve({ ok: true });
    if (downloading.has(id)) return downloading.get(id);

    const job = (async () => {
      const files = await fileList(id);
      const total = files.reduce((sum, f) => sum + (f.size || 0), 0);
      let done = 0;
      let lastSent = 0;
      const report = (bytes) => {
        done += bytes;
        if (Date.now() - lastSent > 300) {
          lastSent = Date.now();
          onProgress?.({ id, done, total });
        }
      };
      for (const file of files) await downloadFile(id, file, report);
      fs.writeFileSync(markerOf(id), new Date().toISOString());
      onProgress?.({ id, done: total, total, complete: true });
      return { ok: true };
    })().finally(() => downloading.delete(id));

    downloading.set(id, job);
    return job;
  }

  function remove(id) {
    if (!known(id)) throw new Error('知らないモデルです');
    fs.rmSync(dirOf(id), { recursive: true, force: true });
    return { ok: true };
  }

  // app://oz/models/<id>/<file> の読み込み先。models フォルダの外は返さない
  function resolve(relPath) {
    const full = path.normalize(path.join(root, decodeURIComponent(relPath)));
    return full.startsWith(root + path.sep) ? full : null;
  }

  return { list, download, remove, resolve, MODELS };
}

module.exports = { createSpeechModels, MODELS };
