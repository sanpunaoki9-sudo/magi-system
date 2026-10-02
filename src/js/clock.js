// 中央の時計: 時:分:秒:1/100秒
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const pad = (n) => String(n).padStart(2, '0');

export function startClock(timeEl, dateEl) {
  let lastText = '';
  let lastDate = '';

  function tick() {
    const now = new Date();
    const text = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}:${pad(Math.floor(now.getMilliseconds() / 10))}`;
    if (text !== lastText) {
      timeEl.textContent = text;
      lastText = text;
    }
    const date = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())} ${DAYS[now.getDay()]}`;
    if (date !== lastDate) {
      dateEl.textContent = date;
      lastDate = date;
    }
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}
