// 地球儀のまわりを回る青い軌道。2本の線の間をコードが流れる。
// 軌道はすべて地球儀より奥に置き、地球儀と重なる部分は地球儀の遮蔽で隠れる。
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const COLOR = '#5b86d6';
const BAND_WIDTH = 0.34;
const SEGMENTS = 512;
const TEXTURE = { width: 2048, height: 64, font: 'bold 28px Arial, sans-serif' };

// r: 半径 / tilt: 手前への倒れ具合 / roll: 画面上の傾き / speed: コードの流れる速さ
const ORBITS = [
  { r: 4.6, tilt: 74, roll: -8, speed: 0.035 },
];

const CODE = [
  'const agent = await launch("claude-code")',
  'git checkout -b agent/codex',
  'codex exec "build the hub"',
  'antigravity --open ./workspace',
  'git commit -m "feat: oz hub"',
  'vault.write("開発環境001/log.md")',
  'quota.fetch().then(render)',
  'task.split(3).assign(agents)',
  'git merge agent/claude',
  'while (online) sync(memory)',
  'status: ALL GREEN',
  'npm run dist',
  'news.collect({ sources: 24 })',
  'github.trending("daily")',
  'cpu: 12%  mem: 41%',
  'speak("おかえりなさい")',
];

function createCodeTexture(seed) {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE.width;
  canvas.height = TEXTURE.height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(91, 134, 214, 0.06)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = TEXTURE.font;
  ctx.fillStyle = COLOR;
  ctx.textBaseline = 'middle';

  // 端でつなぎ目が切れないように、はみ出す前で止める
  const gap = 56;
  let x = gap / 2;
  for (let i = seed; ; i++) {
    const text = CODE[i % CODE.length];
    const w = ctx.measureText(text).width;
    if (x + w > canvas.width - gap / 2) break;
    ctx.fillText(text, x, canvas.height / 2 + 1);
    x += w + gap;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function ringPoints({ r, tilt, roll }, center, depth) {
  const rotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(THREE.MathUtils.degToRad(tilt), 0, THREE.MathUtils.degToRad(roll), 'ZXY'),
  );
  // 手前に一番出る点でも地球儀の中心より奥になるように下げる
  const pushBack = r * Math.sin(THREE.MathUtils.degToRad(tilt)) + depth;
  const origin = center.clone().add(new THREE.Vector3(0, 0, -pushBack));

  const points = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    points.push(new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), 0).applyQuaternion(rotation).add(origin));
  }
  return points;
}

// 帯はカメラの方を向けて、文字が読める向きにする
function createBand(points, texture) {
  const forward = new THREE.Vector3(0, 0, 1);
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const tileLength = BAND_WIDTH * (TEXTURE.width / TEXTURE.height);

  const positions = [];
  const uvs = [];
  const edgeA = [];
  const edgeB = [];
  let length = 0;

  points.forEach((p, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    tangent.subVectors(next, prev).normalize();
    // 文字の上側を輪の内側に向ける（奥側では逆さまになるが、鏡文字にはならない）
    side.crossVectors(forward, tangent).normalize().multiplyScalar(BAND_WIDTH / 2);
    if (i > 0) length += p.distanceTo(points[i - 1]);

    const a = p.clone().add(side);
    const b = p.clone().sub(side);
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uvs.push(length / tileLength, 1, length / tileLength, 0);
    edgeA.push(a.x, a.y, a.z);
    edgeB.push(b.x, b.y, b.z);
  });

  // 一周でタイルがちょうど終わるように繰り返し数をそろえる
  const scale = Math.round(length / tileLength) / (length / tileLength);
  for (let i = 0; i < uvs.length; i += 2) uvs[i] *= scale;

  const indices = [];
  for (let i = 0; i < points.length - 1; i++) {
    const k = i * 2;
    indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  const band = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  band.renderOrder = 0;
  return { band, edges: [edgeA, edgeB] };
}

function createEdge(positions) {
  const geometry = new LineGeometry();
  geometry.setPositions(positions);
  const line = new Line2(
    geometry,
    new LineMaterial({ color: COLOR, linewidth: 1.3, transparent: true, opacity: 0.6, depthWrite: false }),
  );
  line.renderOrder = 0;
  return line;
}

export function createOrbits({ center, globeRadius }) {
  const group = new THREE.Group();
  const rings = ORBITS.map((spec, i) => {
    const texture = createCodeTexture(i * 5);
    const { band, edges } = createBand(ringPoints(spec, center, globeRadius * 0.2), texture);
    const lines = edges.map(createEdge);
    group.add(band, ...lines);
    return { texture, lines, speed: spec.speed };
  });

  return {
    object: group,
    update(dt) {
      for (const ring of rings) ring.texture.offset.x += ring.speed * dt;
    },
    setResolution(w, h) {
      for (const ring of rings) for (const line of ring.lines) line.material.resolution.set(w, h);
    },
  };
}
