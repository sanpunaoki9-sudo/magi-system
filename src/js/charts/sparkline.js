// 1系列の小さな折れ線グラフ（Canvas）。2pxの線と10%の面、ホバーで値と時刻を表示する。
const LINE_WIDTH = 2;
const DOT_RADIUS = 4;
const RING = 2;

function cssVar(el, name) {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

export function createSparkline({ capacity = 60, min = 0, max = null, format = (v) => String(v), label = '' } = {}) {
  const root = document.createElement('div');
  root.className = 'spark';

  const canvas = document.createElement('canvas');
  canvas.className = 'spark-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);

  const tip = document.createElement('div');
  tip.className = 'spark-tip';
  tip.hidden = true;

  root.append(canvas, tip);

  const points = []; // { t, v }
  let hover = null;
  let width = 0;
  let height = 0;

  const resizeObserver = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  });
  resizeObserver.observe(canvas);

  function scale() {
    const values = points.map((p) => p.v).filter(Number.isFinite);
    const top = max ?? Math.max(1, ...values) * 1.15;
    const pad = DOT_RADIUS + RING;
    const x = (i) => pad + (i / Math.max(1, capacity - 1)) * (width - pad * 2);
    const y = (v) => height - pad - ((v - min) / (top - min || 1)) * (height - pad * 2);
    // 右端を最新にそろえる
    const offset = capacity - points.length;
    return { x: (i) => x(i + offset), y };
  }

  function draw() {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    if (!width || points.length === 0) return;

    const accent = cssVar(root, '--pink') || '#e0508c';
    const grid = cssVar(root, '--line') || '#d6d6d6';
    const surface = cssVar(root, '--surface') || '#fff';
    const { x, y } = scale();

    // 下端に基準線を1本だけ引く
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height - 0.5);
    ctx.lineTo(width, height - 0.5);
    ctx.stroke();

    const valid = points.map((p, i) => ({ ...p, i })).filter((p) => Number.isFinite(p.v));
    if (valid.length === 0) return;

    ctx.beginPath();
    valid.forEach((p, k) => (k === 0 ? ctx.moveTo(x(p.i), y(p.v)) : ctx.lineTo(x(p.i), y(p.v))));
    ctx.lineTo(x(valid[valid.length - 1].i), height);
    ctx.lineTo(x(valid[0].i), height);
    ctx.closePath();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    valid.forEach((p, k) => (k === 0 ? ctx.moveTo(x(p.i), y(p.v)) : ctx.lineTo(x(p.i), y(p.v))));
    ctx.strokeStyle = accent;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // 最新の点、またはホバー中の点
    const focus = hover != null ? valid.find((p) => p.i === hover) ?? valid[valid.length - 1] : valid[valid.length - 1];
    if (hover != null) {
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x(focus.i)) + 0.5, 0);
      ctx.lineTo(Math.round(x(focus.i)) + 0.5, height);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x(focus.i), y(focus.v), DOT_RADIUS + RING, 0, Math.PI * 2);
    ctx.fillStyle = surface;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x(focus.i), y(focus.v), DOT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
  }

  function showTip(clientX) {
    if (points.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const { x } = scale();
    let best = null;
    points.forEach((p, i) => {
      if (!Number.isFinite(p.v)) return;
      const d = Math.abs(x(i) - (clientX - rect.left));
      if (!best || d < best.d) best = { i, d };
    });
    if (!best) return;
    hover = best.i;
    const p = points[best.i];
    const t = new Date(p.t);
    tip.textContent = `${format(p.v)}  ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
    tip.hidden = false;
    const left = Math.min(Math.max(x(best.i), 40), width - 40);
    tip.style.left = `${left}px`;
    draw();
  }

  canvas.addEventListener('pointermove', (e) => showTip(e.clientX));
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    tip.hidden = true;
    draw();
  });

  return {
    el: root,
    push(t, v) {
      points.push({ t, v });
      if (points.length > capacity) points.shift();
      if (hover != null) hover = Math.max(0, hover - (points.length === capacity ? 1 : 0));
      draw();
    },
    destroy() {
      resizeObserver.disconnect();
    },
  };
}
