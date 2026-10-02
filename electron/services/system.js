'use strict';

// PCの状態。重い項目（GPU・ディスク）は間隔をあけて取り、軽い項目は毎回取る。
const si = require('systeminformation');

const SLOW_INTERVAL = { graphics: 5000, disks: 30000 };

const cache = {
  static: null,
  graphics: { at: 0, value: null },
  disks: { at: 0, value: [] },
};

const safe = (promise, fallback = null) => promise.catch(() => fallback);

async function staticInfo() {
  if (!cache.static) {
    const [cpu, os] = await Promise.all([safe(si.cpu()), safe(si.osInfo())]);
    cache.static = {
      cpu: cpu ? `${cpu.manufacturer} ${cpu.brand}`.trim() : null,
      cores: cpu?.cores ?? null,
      os: os ? `${os.distro} ${os.release}`.trim() : null,
      host: os?.hostname ?? null,
    };
  }
  return cache.static;
}

async function refreshed(key, loader) {
  const entry = cache[key];
  if (Date.now() - entry.at > SLOW_INTERVAL[key]) {
    entry.value = await loader();
    entry.at = Date.now();
  }
  return entry.value;
}

async function graphics() {
  const result = await safe(si.graphics());
  // 内蔵GPUより使用率の取れるGPU（主に専用GPU）を優先する
  const controllers = result?.controllers ?? [];
  const gpu = controllers.find((c) => c.utilizationGpu != null) ?? controllers[0];
  if (!gpu) return null;
  return {
    name: gpu.model ?? null,
    load: gpu.utilizationGpu ?? null,
    memoryUsed: gpu.memoryUsed ?? null,
    memoryTotal: gpu.memoryTotal ?? gpu.vram ?? null,
    temperature: gpu.temperatureGpu ?? null,
  };
}

async function disks() {
  const result = await safe(si.fsSize(), []);
  return result
    .filter((d) => d.size > 0)
    .map((d) => ({ mount: d.mount, used: d.used, size: d.size }));
}

async function snapshot() {
  const [info, load, mem, temp, net, gpu, drives] = await Promise.all([
    staticInfo(),
    safe(si.currentLoad()),
    safe(si.mem()),
    safe(si.cpuTemperature()),
    safe(si.networkStats('*'), []),
    refreshed('graphics', graphics),
    refreshed('disks', disks),
  ]);

  const sum = (key) => net.reduce((total, n) => total + (Number.isFinite(n[key]) ? n[key] : 0), 0);

  return {
    time: Date.now(),
    info,
    cpu: { load: load?.currentLoad ?? null },
    memory: mem ? { used: mem.active, total: mem.total } : null,
    gpu,
    temperature: { cpu: temp?.main ?? null, gpu: gpu?.temperature ?? null },
    network: { rx: sum('rx_sec'), tx: sum('tx_sec') },
    disks: drives,
    uptime: si.time().uptime,
  };
}

module.exports = { snapshot };
