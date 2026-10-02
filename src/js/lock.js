// 起動画面: ピンクの鍵穴とパスワード入力。
// 解錠すると鍵穴が「穴」になり、そこからハブ画面へ抜けていく。
import { oz } from './bridge.js';

const KEYHOLE_OFFSET_Y = -60; // 画面中央から鍵穴の中心までのずれ(px)
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const easeInCubic = (t) => t * t * t;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;

function animate(duration, step) {
  return new Promise((resolve) => {
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      step(t);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

function playClick() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
    osc.onended = () => ctx.close();
  } catch {
    // 音が出せない環境では無音で続ける
  }
}

export function createLock({ onUnlock }) {
  const root = document.getElementById('lock');
  const svg = document.getElementById('lockSvg');
  const pinkKeyhole = document.getElementById('pinkKeyhole');
  const maskKeyhole = document.getElementById('maskKeyhole');
  const form = document.getElementById('lockForm');
  const message = document.getElementById('lockMessage');
  const password = document.getElementById('lockPassword');
  const error = document.getElementById('lockError');

  let setupMode = false;
  let opening = false;
  let keyScale = 1;

  function layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const transform = `translate(${w / 2} ${h / 2 + KEYHOLE_OFFSET_Y}) scale(${keyScale})`;
    pinkKeyhole.setAttribute('transform', transform);
    maskKeyhole.setAttribute('transform', transform);
  }

  function shake(text) {
    error.textContent = text;
    form.classList.remove('is-shaking');
    void form.offsetWidth; // アニメーションを最初から再生させる
    form.classList.add('is-shaking');
    password.select();
  }

  async function open() {
    if (opening) return;
    opening = true;
    password.blur();
    password.disabled = true;
    root.classList.add('is-opening');
    playClick();

    // カチッ: 少し押し込んで戻る
    await animate(reduceMotion ? 1 : 180, (t) => {
      keyScale = 1 - 0.08 * Math.sin(Math.PI * t);
      layout();
    });

    // ピンクが抜けて、鍵穴の向こうにハブが見える
    await animate(reduceMotion ? 1 : 320, (t) => {
      pinkKeyhole.style.opacity = String(1 - easeOutCubic(t));
    });

    onUnlock?.();

    // 鍵穴を通り抜ける
    await animate(reduceMotion ? 1 : 1100, (t) => {
      keyScale = 1 + 60 * easeInCubic(t);
      layout();
    });

    root.remove();
  }

  // 正しいパスワードを打ち終えた瞬間に解錠する
  password.addEventListener('input', async () => {
    if (setupMode || opening) return;
    error.textContent = '';
    const typed = password.value;
    if (!typed) return;
    const { ok } = await oz.auth.verify(typed);
    if (ok && password.value === typed) open();
  });

  // Enter: 初回はパスワードの決定、2回目以降は間違いの通知
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (opening) return;

    if (setupMode) {
      const result = await oz.auth.setPassword(password.value);
      if (result.ok) open();
      else shake(result.reason ?? '設定できませんでした');
      return;
    }

    const typed = password.value;
    const { ok } = await oz.auth.verify(typed);
    if (ok) open();
    else if (password.value === typed) shake('パスワードが違います');
  });

  window.addEventListener('resize', layout);
  layout();

  return {
    async init() {
      const { hasPassword } = await oz.auth.status();
      setupMode = !hasPassword;
      if (setupMode) {
        message.textContent = '最初に起動パスワードを決めて Enter を押してください';
      }
      password.focus();
    },
  };
}
