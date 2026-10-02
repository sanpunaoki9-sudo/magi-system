// 音声認識（Whisper）を画面とは別のスレッドで動かす。モデルは app://oz/models/ から読み、外へは通信しない。
import { env, pipeline } from '../../../node_modules/@huggingface/transformers/dist/transformers.min.js';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('../../../models/', import.meta.url).href;
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = new URL('../../../node_modules/onnxruntime-web/dist/', import.meta.url).href;
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

let recognizer = null;

// 「それが、それが、それが…」のような繰り返しを1回にまとめる
function collapseRepeats(text) {
  return text.replace(/(.{1,12}?)(?:[、,\s]*\1){2,}/g, '$1');
}
let loadedModel = null;

async function load(model) {
  if (recognizer && loadedModel === model) return;
  recognizer = null;
  recognizer = await pipeline('automatic-speech-recognition', model, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p) => {
      if (p.status === 'progress') self.postMessage({ type: 'loading', file: p.file, progress: p.progress });
    },
  });
  loadedModel = model;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      await load(data.model);
      self.postMessage({ type: 'ready', model: data.model });
      return;
    }
    if (data.type === 'transcribe') {
      await load(data.model);
      const started = performance.now();
      const result = await recognizer(data.audio, {
        language: data.language ?? 'japanese',
        task: 'transcribe',
        chunk_length_s: 30,
        return_timestamps: false,
        // 同じ言葉を繰り返し続ける失敗を防ぐ
        max_new_tokens: 160,
        no_repeat_ngram_size: 4,
        repetition_penalty: 1.15,
      });
      self.postMessage({ type: 'text', id: data.id, text: collapseRepeats(String(result?.text ?? '').trim()), ms: Math.round(performance.now() - started) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: data.id, message: String(err?.message ?? err) });
  }
};
