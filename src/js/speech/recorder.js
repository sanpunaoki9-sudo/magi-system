// マイクの録音と、話している区間の切り出し（音の大きさで判定するシンプルな方式）。
// 1回の発話ごとに 16kHz の Float32Array を onUtterance に渡す。
const SAMPLE_RATE = 16000;
const FRAME_MS = 30;
const START_FRAMES = 3; // 90ms 続けて声がしたら話し始め
const END_SILENCE_MS = 900; // 0.9秒黙ったら話し終わり
const PRE_ROLL_FRAMES = 10; // 話し始めの直前 300ms も含める
const MIN_SPEECH_MS = 350;
const MAX_SPEECH_MS = 25000;

const rms = (frame) => {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
};

export function createRecorder({ onUtterance, onLevel, onState }) {
  let ctx = null;
  let stream = null;
  let node = null;
  let source = null;
  let mode = 'off'; // off | auto（自動で区切る） | manual（押している間）
  let noise = 0.01;
  let voiced = 0;
  let silenceMs = 0;
  let speaking = false;
  let frames = [];
  const preRoll = [];

  function setState(state) {
    onState?.(state);
  }

  function flush() {
    const length = frames.reduce((n, f) => n + f.length, 0);
    const ms = (length / SAMPLE_RATE) * 1000;
    const audio = new Float32Array(length);
    let offset = 0;
    for (const f of frames) {
      audio.set(f, offset);
      offset += f.length;
    }
    frames = [];
    speaking = false;
    voiced = 0;
    silenceMs = 0;
    if (ms >= MIN_SPEECH_MS) onUtterance?.(audio);
    setState(mode === 'off' ? 'off' : 'listening');
  }

  function onFrame(frame) {
    const level = rms(frame);
    onLevel?.(level);
    if (mode === 'off') return;

    if (mode === 'manual') {
      frames.push(frame);
      return;
    }

    const threshold = Math.max(0.012, noise * 3);
    if (!speaking) {
      preRoll.push(frame);
      if (preRoll.length > PRE_ROLL_FRAMES) preRoll.shift();
      // 黙っている間に周りの雑音の大きさを学ぶ
      if (level < threshold) noise = noise * 0.95 + level * 0.05;
      voiced = level > threshold ? voiced + 1 : 0;
      if (voiced >= START_FRAMES) {
        speaking = true;
        frames = [...preRoll];
        preRoll.length = 0;
        setState('hearing');
      }
      return;
    }

    frames.push(frame);
    silenceMs = level > threshold * 0.7 ? 0 : silenceMs + FRAME_MS;
    const speechMs = frames.length * FRAME_MS;
    if (silenceMs >= END_SILENCE_MS || speechMs >= MAX_SPEECH_MS) flush();
  }

  async function open() {
    if (ctx) return;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
    source = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, 'oz-capture');
    node.port.onmessage = (e) => onFrame(e.data);
    source.connect(node);
  }

  return {
    // 自動で話し始め・話し終わりを判定して聞き続ける
    async listen() {
      await open();
      mode = 'auto';
      setState('listening');
    },
    // ボタンを押している間だけ録る
    async hold() {
      await open();
      mode = 'manual';
      frames = [];
      setState('hearing');
    },
    release() {
      if (mode !== 'manual') return;
      mode = 'off';
      flush();
    },
    // 読み上げ中など、一時的に聞かない
    pause() {
      if (speaking) {
        frames = [];
        speaking = false;
      }
      mode = 'off';
      setState('off');
    },
    stop() {
      mode = 'off';
      frames = [];
      speaking = false;
      node?.disconnect();
      source?.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close();
      ctx = stream = node = source = null;
      setState('off');
    },
    get mode() {
      return mode;
    },
  };
}
