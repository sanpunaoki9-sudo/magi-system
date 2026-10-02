// 返事の読み上げ。Windows の日本語の女性音声（Haruka など）か、VOICEVOX を使う

// 女性の声として知られている名前。先にあるものほど優先する
const FEMALE_HINTS = ['Nanami', 'Haruka', 'Ayumi', 'Sayaka', 'Mizuki', 'Kyoko', 'O-Ren', 'Female', '女性'];
const MALE_HINTS = ['Ichiro', 'Keita', 'Otoya', 'Hattori', 'Male', '男性'];

function voices() {
  return new Promise((resolve) => {
    const list = speechSynthesis.getVoices();
    if (list.length) return resolve(list);
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

export async function japaneseVoices() {
  return (await voices()).filter((v) => /^ja(-|_|$)/i.test(v.lang));
}

// 日本語の声の中から女性の声を選ぶ。名前の指定があればそれを使う
export async function pickVoice(name) {
  const list = await japaneseVoices();
  if (name) {
    const chosen = list.find((v) => v.name === name);
    if (chosen) return chosen;
  }
  for (const hint of FEMALE_HINTS) {
    const v = list.find((x) => x.name.includes(hint));
    if (v) return v;
  }
  return list.find((v) => !MALE_HINTS.some((m) => v.name.includes(m))) ?? list[0] ?? null;
}

export function createSpeaker(oz) {
  let audio = null;

  function stop() {
    speechSynthesis.cancel();
    if (audio) {
      audio.pause();
      URL.revokeObjectURL(audio.src);
      audio = null;
    }
  }

  async function speakWindows(text, settings) {
    if ((await japaneseVoices()).length === 0 && speechSynthesis.getVoices().length === 0) return;
    const voice = await pickVoice(settings.voice);
    await new Promise((resolve) => {
      // 終わりの知らせが来ない環境でも止まらないように、長さに応じて打ち切る
      const limit = setTimeout(resolve, Math.max(8000, text.length * 450));
      const done = () => {
        clearTimeout(limit);
        resolve();
      };
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      if (voice) u.voice = voice;
      u.rate = settings.rate ?? 1;
      u.pitch = settings.pitch ?? 1;
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
    });
  }

  async function speakVoicevox(text, settings) {
    const wav = await oz.talk.synthesize({ text, speaker: settings.speaker });
    if (wav?.error) throw new Error(wav.error);
    audio = new Audio(URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })));
    audio.playbackRate = settings.rate ?? 1;
    await new Promise((resolve) => {
      audio.onended = resolve;
      audio.onerror = resolve;
      audio.play().catch(resolve);
    });
    stop();
  }

  return {
    async speak(text, settings = {}) {
      stop();
      if (!text) return;
      if (settings.engine === 'voicevox' && oz.talk?.synthesize) {
        try {
          await speakVoicevox(text, settings);
          return;
        } catch {
          // VOICEVOX が使えないときは Windows の声で読む
        }
      }
      await speakWindows(text, settings);
    },
    stop,
  };
}
