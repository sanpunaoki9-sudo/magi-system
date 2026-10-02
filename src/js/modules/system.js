// PCの状態: CPU・メモリ・GPU・ネットワークを1秒ごとに更新し、直近60秒を折れ線で表示する
import { h, notice, formatBytes, formatRate, formatDuration } from '../ui.js';
import { createSparkline } from '../charts/sparkline.js';

const INTERVAL_MS = 1000;
const percent = (v) => (Number.isFinite(v) ? `${Math.round(v)}%` : '--');
const celsius = (v) => (Number.isFinite(v) ? `${Math.round(v)}℃` : '--');

function tile(label, chartOptions) {
  const value = h('div', { class: 'tile-value' }, '--');
  const sub = h('div', { class: 'tile-sub' }, '');
  const chart = chartOptions ? createSparkline({ label, ...chartOptions }) : null;
  const el = h('section', { class: 'tile' }, h('h3', { class: 'tile-label' }, label), value, sub, chart?.el);
  return {
    el,
    chart,
    set(v, s = '') {
      value.textContent = v;
      sub.textContent = s;
    },
  };
}

function diskRow(disk) {
  const ratio = disk.size ? disk.used / disk.size : 0;
  const level = ratio >= 0.9 ? 'critical' : ratio >= 0.8 ? 'warning' : 'normal';
  const state = level === 'critical' ? '残りわずか' : level === 'warning' ? '残り少なめ' : '';
  return h(
    'li',
    { class: `disk disk-${level}` },
    h('span', { class: 'disk-mount' }, disk.mount),
    h(
      'span',
      { class: 'meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(ratio * 100), 'aria-label': `${disk.mount} の使用率` },
      h('span', { class: 'meter-fill', style: `width:${(ratio * 100).toFixed(1)}%` }),
    ),
    h('span', { class: 'disk-text' }, `${formatBytes(disk.used)} / ${formatBytes(disk.size)}`, h('b', {}, ` ${Math.round(ratio * 100)}%`)),
    state ? h('span', { class: `status-chip status-${level}` }, state) : null,
  );
}

export function createSystemModule(oz) {
  let timer = null;
  let pending = false;
  let charts = [];

  return {
    mount(body) {
      const info = h('p', { class: 'module-meta' }, '読み込み中');
      const error = h('div');
      let previewShown = false;

      const cpu = tile('CPU 使用率', { max: 100, format: percent });
      const mem = tile('メモリ', { max: 100, format: percent });
      const gpu = tile('GPU 使用率', { max: 100, format: percent });
      const rx = tile('受信', { format: formatRate });
      const tx = tile('送信', { format: formatRate });
      const temp = tile('温度');
      charts = [cpu, mem, gpu, rx, tx].map((t) => t.chart);

      const disks = h('ul', { class: 'disks' });

      body.append(
        info,
        error,
        h('div', { class: 'tiles' }, cpu.el, mem.el, gpu.el, rx.el, tx.el, temp.el),
        h('h3', { class: 'section-title' }, 'ディスク'),
        disks,
      );

      let lastDisks = '';

      async function update() {
        if (pending) return;
        pending = true;
        try {
          const s = await oz.system.snapshot();
          if (s?.error) {
            error.replaceChildren(notice(`PCの状態を取得できませんでした: ${s.error}`, 'error'));
            return;
          }
          error.replaceChildren();
          if (s.preview && !previewShown) {
            previewShown = true;
            info.before(notice('プレビュー用のサンプルです。アプリではこのPCの実際の状態を表示します。'));
          }

          const parts = [s.info?.cpu, s.info?.cores ? `${s.info.cores}コア` : null, s.info?.os, `起動から ${formatDuration(s.uptime)}`];
          info.textContent = parts.filter(Boolean).join('  ·  ');

          cpu.set(percent(s.cpu?.load));
          cpu.chart.push(s.time, s.cpu?.load);

          const memRatio = s.memory ? (s.memory.used / s.memory.total) * 100 : null;
          mem.set(percent(memRatio), s.memory ? `${formatBytes(s.memory.used)} / ${formatBytes(s.memory.total)}` : '');
          mem.chart.push(s.time, memRatio);

          if (s.gpu && Number.isFinite(s.gpu.load)) {
            const vram = s.gpu.memoryTotal ? `VRAM ${formatBytes(s.gpu.memoryUsed * 1024 * 1024)} / ${formatBytes(s.gpu.memoryTotal * 1024 * 1024)}` : '';
            gpu.set(percent(s.gpu.load), [s.gpu.name, vram].filter(Boolean).join('  ·  '));
          } else {
            gpu.set('--', s.gpu?.name ? `${s.gpu.name}（使用率は取得できません）` : '取得できません');
          }
          gpu.chart.push(s.time, s.gpu?.load);

          rx.set(formatRate(s.network?.rx));
          rx.chart.push(s.time, s.network?.rx);
          tx.set(formatRate(s.network?.tx));
          tx.chart.push(s.time, s.network?.tx);

          const temps = [`CPU ${celsius(s.temperature?.cpu)}`, `GPU ${celsius(s.temperature?.gpu)}`];
          temp.set(celsius(s.temperature?.cpu ?? s.temperature?.gpu), temps.join('  ·  '));

          const diskKey = JSON.stringify(s.disks);
          if (diskKey !== lastDisks) {
            lastDisks = diskKey;
            disks.replaceChildren(...(s.disks.length ? s.disks.map(diskRow) : [h('li', { class: 'muted' }, '取得できません')]));
          }
        } finally {
          pending = false;
        }
      }

      update();
      timer = setInterval(update, INTERVAL_MS);
    },
    unmount() {
      clearInterval(timer);
      timer = null;
      charts.forEach((c) => c?.destroy());
      charts = [];
    },
  };
}
