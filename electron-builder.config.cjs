'use strict';

// electron-builder の設定。
// 画面側のライブラリは1ファイルにまとまった版（3d-force-graph.min.js / transformers.min.js など）を読むので、
// それらが依存するパッケージは同梱しない。メインプロセスが require するものだけを依存関係ごと残す。
const lock = require('./package-lock.json');

// メインプロセスで require するパッケージ（依存関係も含めて残す）
const MAIN_PROCESS = ['systeminformation', 'fast-xml-parser', 'node-html-parser'];
// 画面で直接ファイルを読むパッケージ（パッケージ本体だけ残す。中身は下の files で絞る）
const RENDERER_FILES = [
  'three',
  'd3-geo',
  'd3-array',
  'internmap',
  'topojson-client',
  'world-atlas',
  '3d-force-graph',
  '@huggingface/transformers',
  'onnxruntime-web',
];

const packages = lock.packages;
const nameOf = (key) => key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);

// Node の探し方（入れ子の node_modules → 上の階層）で依存先を見つける
function resolve(fromKey, dep) {
  let base = fromKey;
  for (;;) {
    const candidate = `${base ? `${base}/` : ''}node_modules/${dep}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const idx = base.lastIndexOf('/node_modules/');
    base = idx === -1 ? '' : base.slice(0, idx);
  }
}

const keep = new Set();
const stack = MAIN_PROCESS.map((name) => `node_modules/${name}`);
while (stack.length) {
  const key = stack.pop();
  if (!key || keep.has(key) || !packages[key]) continue;
  keep.add(key);
  for (const dep of Object.keys({ ...packages[key].dependencies, ...packages[key].optionalDependencies })) {
    stack.push(resolve(key, dep));
  }
}
for (const name of RENDERER_FILES) keep.add(`node_modules/${name}`);

const exclude = Object.keys(packages)
  .filter((key) => key.startsWith('node_modules/') && !packages[key].dev && !packages[key].link)
  .filter((key) => !keep.has(key) && !key.slice('node_modules/'.length).includes('/node_modules/'))
  .map((key) => `!${key}/**`);

module.exports = {
  appId: 'com.oz.assistant',
  productName: 'OZ Assistant',
  copyright: 'Copyright © 2026 OZ Assistant',
  directories: { output: 'dist', buildResources: 'build' },
  files: [
    'electron/**',
    'src/**',
    'package.json',
    '!**/*.map',
    '!**/*.d.ts',
    '!**/{README,CHANGELOG,HISTORY}.md',
    // 画面で使うファイルだけを残す
    '!node_modules/onnxruntime-web/dist/!(ort-wasm-simd-threaded.asyncify.*)',
    '!node_modules/onnxruntime-web/lib/**',
    '!node_modules/@huggingface/transformers/src/**',
    '!node_modules/@huggingface/transformers/types/**',
    '!node_modules/@huggingface/transformers/dist/!(transformers.min.js)',
    '!node_modules/three/src/**',
    '!node_modules/three/build/!(three.module.js|three.core.js)',
    '!node_modules/3d-force-graph/dist/!(3d-force-graph.min.js)',
    '!node_modules/world-atlas/!(land-50m.json|package.json)',
    '!node_modules/d3-geo/dist/**',
    '!node_modules/d3-array/dist/**',
    '!node_modules/onnxruntime-node/**',
    ...exclude,
  ],
  asar: true,
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },
  win: {
    icon: 'build/icon.png',
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] },
    ],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'OZ Assistant',
    artifactName: 'OZ-Assistant-Setup-${version}.${ext}',
  },
  portable: { artifactName: 'OZ-Assistant-${version}-portable.${ext}' },
  linux: { target: ['dir'], icon: 'build/icon.png', category: 'Utility' },
};
