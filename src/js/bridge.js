// Electron の preload が公開する window.oz を返す。
// ブラウザで画面だけ確認するとき（npm run dev:web）は、localStorage とサンプルデータを使う代替を返す。
import { createPreviewApi } from './preview-data.js';

function createBrowserMock() {
  const KEY = 'oz-dev-password';
  const digest = async (text) => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  };
  const read = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };

  return {
    preview: true,
    ...createPreviewApi(),
    auth: {
      async status() {
        return { hasPassword: Boolean(read()) };
      },
      async setPassword(password) {
        if (typeof password !== 'string' || password.length < 4) {
          return { ok: false, reason: 'パスワードは4文字以上にしてください' };
        }
        try {
          localStorage.setItem(KEY, await digest(password));
        } catch {
          // ストレージが使えない環境でも画面確認は続けられるようにする
        }
        return { ok: true };
      },
      async verify(password) {
        return { ok: read() === (await digest(String(password))) };
      },
    },
  };
}

export const oz = window.oz ?? createBrowserMock();
