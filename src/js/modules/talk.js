// 話しかけモード: PCの中で動く音声認識（Whisper）で聞き取り、女性の声で返事をする
import { h, notice, formatBytes } from '../ui.js';
import { createRecorder } from '../speech/recorder.js';
import { createSpeaker, japaneseVoices, pickVoice } from '../speech/tts.js';
import { AGENT_NAMES } from './agent-ui.js';

const STATE_TEXT = {
  off: '「聞き続ける」を押すか、文字で話しかけてください',
  listening: '聞いています。話しかけてください',
  hearing: '聞き取っています',
  recognizing: '文字にしています',
  thinking: '考えています',
  speaking: '話しています',
  loading: '音声認識を準備しています',
};

const ACTION_TEXT = {
  delegate: (a) => `${AGENT_NAMES[a.agentId] ?? a.agentId} に依頼`,
  split: () => '分担して依頼',
  news: () => 'ニュース',
  system: () => 'PCの状態',
  quota: () => '利用枠',
};

// 会話はパネルを閉じても残す
const history = [];

export function createTalkModule(oz) {
  let cleanup = [];

  return {
    mount(body) {
      let alive = true;
      cleanup.push(() => { alive = false; });

      const speaker = createSpeaker(oz);
      let settings = null;
      let worker = null;
      let workerReady = false;
      let busy = false;
      let speaking = false;
      let seq = 0;
      const pending = new Map();

      // ---------- 画面 ----------
      const orb = h('div', { class: 'orb', 'aria-hidden': 'true' }, h('span', { class: 'orb-ring' }), h('span', { class: 'orb-core' }));
      const stateText = h('p', { class: 'talk-state', role: 'status' }, STATE_TEXT.off);
      const listenBtn = h('button', { type: 'button', class: 'btn btn-primary' }, '聞き続ける');
      const holdBtn = h('button', { type: 'button', class: 'btn' }, '押している間だけ聞く');
      const stopBtn = h('button', { type: 'button', class: 'btn' }, '読み上げを止める');
      const input = h('input', { type: 'text', class: 'field', placeholder: '文字で話しかける（例: Codex に README の更新を頼んで）', 'aria-label': '話しかける内容' });
      const sendBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, '送る');
      const form = h('form', { class: 'talk-input' }, input, sendBtn);
      const log = h('ol', { class: 'talk-log', 'aria-live': 'polite' });
      const status = h('div');
      const setup = h('div', { class: 'talk-setup' });

      body.append(
        h('div', { class: 'talk' },
          h('section', { class: 'talk-main' },
            orb,
            stateText,
            h('div', { class: 'talk-buttons' }, listenBtn, holdBtn, stopBtn),
            form,
            status,
          ),
          h('section', { class: 'talk-side' },
            h('h3', { class: 'section-title' }, '会話'),
            log,
          ),
        ),
        h('h3', { class: 'section-title' }, '音声の設定'),
        setup,
      );

      const say = (text, kind = 'info') => status.replaceChildren(text ? notice(text, kind) : '');

      function setState(state) {
        orb.dataset.state = state;
        stateText.textContent = STATE_TEXT[state] ?? '';
      }

      function renderLog() {
        log.replaceChildren(...(history.length
          ? history.map((m) => h('li', { class: `bubble bubble-${m.role}` },
              h('span', { class: 'bubble-who' }, m.role === 'user' ? 'あなた' : 'OZ'),
              h('p', {}, m.text),
              m.action ? h('span', { class: 'chip' }, ACTION_TEXT[m.action.type]?.(m.action) ?? m.action.type) : null))
          : [h('li', { class: 'empty' }, 'まだ会話はありません。「PCの状態は？」「ニュースを読んで」「Codex に〜を頼んで」などと話しかけてみてください。')]));
        log.lastElementChild?.scrollIntoView({ block: 'nearest' });
      }

      // ---------- マイクの音量で丸を動かす（点滅はしない） ----------
      let level = 0;
      let raf = 0;
      const animate = () => {
        orb.style.setProperty('--level', level.toFixed(3));
        raf = requestAnimationFrame(animate);
      };
      raf = requestAnimationFrame(animate);
      cleanup.push(() => cancelAnimationFrame(raf));

      // ---------- 音声認識 ----------
      function startWorker() {
        if (worker || !settings) return;
        worker = new Worker(new URL('../speech/whisper-worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
          if (data.type === 'ready') {
            workerReady = true;
            if (orb.dataset.state === 'loading') setState(recorder.mode === 'auto' ? 'listening' : 'off');
          } else if (data.type === 'text' || data.type === 'error') {
            pending.get(data.id)?.(data);
            pending.delete(data.id);
          }
        };
        worker.postMessage({ type: 'load', model: settings.model });
      }
      cleanup.push(() => worker?.terminate());

      function transcribe(audio) {
        return new Promise((resolve) => {
          const id = ++seq;
          pending.set(id, resolve);
          worker.postMessage({ type: 'transcribe', id, model: settings.model, audio }, [audio.buffer]);
        });
      }

      const recorder = createRecorder({
        onLevel: (v) => { level = level * 0.6 + Math.min(1, v * 8) * 0.4; },
        onState: (s) => { if (!busy) setState(s); },
        onUtterance: async (audio) => {
          if (!worker) return say('音声認識のモデルがまだありません。下の「音声の設定」からダウンロードしてください。', 'warning');
          busy = true;
          const auto = recorder.mode === 'auto';
          recorder.pause();
          setState(workerReady ? 'recognizing' : 'loading');
          const result = await transcribe(audio);
          busy = false;
          if (!alive) return;
          if (result.type === 'error') {
            say(`聞き取れませんでした: ${result.message}`, 'error');
          } else if (result.text && !/^[\s.。、…]*$/.test(result.text)) {
            await send(result.text);
          }
          if (alive && auto) recorder.listen().catch(() => {});
          else if (alive) setState('off');
        },
      });
      cleanup.push(() => recorder.stop());

      // ---------- 会話 ----------
      async function send(text) {
        say('');
        history.push({ role: 'user', text });
        renderLog();
        busy = true;
        setState('thinking');
        const result = await oz.talk.ask({ text, history: history.slice(0, -1) });
        if (!alive) return;
        const reply = result?.error ? `ごめんなさい、うまくいきませんでした。${result.error}` : result.reply;
        history.push({ role: 'oz', text: reply, action: result?.action ?? null });
        renderLog();
        busy = false;
        speaking = true;
        setState('speaking');
        await speaker.speak(reply, settings ?? {});
        speaking = false;
        if (alive) setState(recorder.mode === 'auto' ? 'listening' : 'off');
      }

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text || busy) return;
        // 読み上げ中に話しかけたら、読み上げを止めて次へ進む
        if (speaking) speaker.stop();
        input.value = '';
        const auto = recorder.mode === 'auto';
        if (auto) recorder.pause();
        await send(text);
        if (alive && auto) recorder.listen().catch(() => {});
      });

      async function micError(err) {
        say(`マイクを使えませんでした: ${err.message}`, 'error');
        setState('off');
      }

      listenBtn.addEventListener('click', async () => {
        if (recorder.mode === 'auto') {
          recorder.stop();
          listenBtn.textContent = '聞き続ける';
          oz.talk.setSettings?.({ autoListen: false });
          return;
        }
        startWorker();
        try {
          await recorder.listen();
          listenBtn.textContent = '聞くのをやめる';
          oz.talk.setSettings?.({ autoListen: true });
        } catch (err) {
          micError(err);
        }
      });
      holdBtn.addEventListener('pointerdown', async () => {
        startWorker();
        try {
          await recorder.hold();
        } catch (err) {
          micError(err);
        }
      });
      for (const ev of ['pointerup', 'pointerleave']) holdBtn.addEventListener(ev, () => recorder.release());
      stopBtn.addEventListener('click', () => speaker.stop());

      // ---------- 設定 ----------
      async function renderSetup() {
        const [models, voices, vv] = await Promise.all([
          oz.speech?.models?.() ?? [],
          japaneseVoices(),
          oz.talk.voicevox?.() ?? { available: false },
        ]);
        if (!alive) return;
        if (models?.error) return setup.replaceChildren(notice(models.error, 'error'));

        const current = models.find((m) => m.id === settings.model) ?? models[0];
        const modelSelect = h('select', { class: 'select', 'aria-label': '音声認識のモデル' }, ...models.map((m) => h('option', { value: m.id }, `${m.label}${m.installed ? '（入っています）' : ''}`)));
        modelSelect.value = current?.id ?? '';
        const progress = h('span', { class: 'meter talk-progress', hidden: true }, h('span', { class: 'meter-fill', style: 'width:0%' }));
        const progressText = h('span', { class: 'muted' }, '');
        const download = h('button', { type: 'button', class: current?.installed ? 'btn' : 'btn btn-primary' }, current?.installed ? '入っています' : 'ダウンロード');
        download.disabled = Boolean(current?.installed);

        modelSelect.addEventListener('change', async () => {
          settings = await oz.talk.setSettings({ model: modelSelect.value });
          worker?.terminate();
          worker = null;
          workerReady = false;
          renderSetup();
        });
        download.addEventListener('click', async () => {
          download.disabled = true;
          download.textContent = 'ダウンロード中';
          progress.hidden = false;
          const result = await oz.speech.download(modelSelect.value);
          if (!alive) return;
          if (result?.error) {
            say(`ダウンロードできませんでした: ${result.error}`, 'error');
            download.disabled = false;
            download.textContent = 'もう一度ダウンロード';
            return;
          }
          say('音声認識のモデルを入れました。マイクで話しかけられます。');
          renderSetup();
          startWorker();
        });
        const offProgress = oz.speech?.onProgress?.((p) => {
          if (p.id !== modelSelect.value || !p.total) return;
          progress.firstChild.style.width = `${((p.done / p.total) * 100).toFixed(1)}%`;
          progressText.textContent = `${formatBytes(p.done)} / ${formatBytes(p.total)}`;
        });
        if (offProgress) cleanup.push(offProgress);

        const engine = h('select', { class: 'select', 'aria-label': '読み上げの声' },
          h('option', { value: 'windows' }, 'Windows の声'),
          h('option', { value: 'voicevox' }, `VOICEVOX${vv.available ? '' : '（起動していません）'}`));
        engine.value = settings.engine;
        engine.addEventListener('change', async () => { settings = await oz.talk.setSettings({ engine: engine.value }); renderSetup(); });

        const defaultVoice = await pickVoice(settings.voice);
        const voiceSelect = h('select', { class: 'select', 'aria-label': 'Windows の声' },
          ...(voices.length ? voices.map((v) => h('option', { value: v.name }, v.name)) : [h('option', { value: '' }, '日本語の声が見つかりません')]));
        voiceSelect.value = defaultVoice?.name ?? '';
        voiceSelect.addEventListener('change', async () => { settings = await oz.talk.setSettings({ voice: voiceSelect.value }); });

        const speakerSelect = vv.available
          ? h('select', { class: 'select', 'aria-label': 'VOICEVOX の声' }, ...vv.speakers.map((s) => h('option', { value: s.id }, s.name)))
          : null;
        if (speakerSelect) {
          speakerSelect.value = String(settings.speaker);
          speakerSelect.addEventListener('change', async () => { settings = await oz.talk.setSettings({ speaker: Number(speakerSelect.value) }); });
        }

        const rate = h('input', { type: 'range', min: '0.7', max: '1.5', step: '0.05', value: String(settings.rate), 'aria-label': '話す速さ' });
        rate.addEventListener('change', async () => { settings = await oz.talk.setSettings({ rate: Number(rate.value) }); });
        const test = h('button', { type: 'button', class: 'btn' }, '声を試す');
        test.addEventListener('click', () => speaker.speak('こんにちは。OZです。今日もよろしくお願いします。', settings));

        setup.replaceChildren(
          h('div', { class: 'setting' },
            h('div', { class: 'setting-text' },
              h('h3', { class: 'setting-title' }, '音声認識'),
              h('p', { class: 'muted' }, '声を文字にする Whisper を、このPCの中だけで動かします。最初の1回だけモデルをダウンロードします。以後はインターネットなしで使えます。')),
            h('div', { class: 'setting-control' }, modelSelect, h('div', { class: 'toolbar-group' }, download, progressText), progress),
          ),
          h('div', { class: 'setting' },
            h('div', { class: 'setting-text' },
              h('h3', { class: 'setting-title' }, '返事の声'),
              h('p', { class: 'muted' }, 'Windows に入っている日本語の女性の声で読み上げます。VOICEVOX を起動しておくと、その声も選べます。')),
            h('div', { class: 'setting-control' }, engine, settings.engine === 'voicevox' && speakerSelect ? speakerSelect : voiceSelect,
              h('label', { class: 'switch' }, h('span', {}, '速さ'), rate), h('div', { class: 'toolbar-group' }, test)),
          ),
        );
        if (!current?.installed && !models.some((m) => m.downloading)) {
          say('話しかけるには、最初に音声認識のモデルをダウンロードしてください（下の「音声の設定」）。文字での会話はすぐに使えます。', 'warning');
        }
      }

      async function init() {
        settings = await oz.talk.getSettings();
        if (!alive) return;
        if (settings?.error) return say(settings.error, 'error');
        if (settings.preview) say('プレビュー用のサンプルです。返事はサンプルの文面で、音声認識は使えません。');
        await renderSetup();
        const models = await oz.speech?.models?.();
        const installed = Array.isArray(models) && models.find((m) => m.id === settings.model)?.installed;
        if (installed) {
          startWorker();
          if (settings.autoListen) {
            try {
              await recorder.listen();
              listenBtn.textContent = '聞くのをやめる';
            } catch (err) {
              micError(err);
            }
          }
        }
      }

      setState('off');
      renderLog();
      init();
    },
    unmount() {
      cleanup.forEach((fn) => fn?.());
      cleanup = [];
    },
  };
}
