// ハブ画面: 奥に地球儀と軌道リング、そのまわりに丸タブ。
// 丸タブは HTML で描き、3D 空間の位置を毎フレーム画面座標に投影して置く。
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { createGlobe } from './globe.js';
import { createOrbits } from './orbits.js';

const FOV = 38;
const GLOBE_RADIUS = 1.5;
const GLOBE_CENTER = new THREE.Vector3(0, 0, -2);
// 丸タブを並べる円。r: 円の半径 / tab: 丸タブの直径（どちらも3D空間の単位）
// globe: 地球儀の大きさの倍率。縦長の画面では地球儀を少し小さくして、丸タブを大きめにする
const RINGS = {
  landscape: { r: 3.0, tab: 1.18, globe: 1 },
  portrait: { r: 2.8, tab: 1.3, globe: 0.8 },
};
const FIT_MARGIN = 0.3;
const INTRO_PULLBACK = 1.45;

const COLORS = {
  connector: 0xc4c4c4,
  pulse: 0xe0508c,
};

const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

function createCircleSprite() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createHub({ canvas, tabLayer, tabs, onSelect }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);

  scene.add(new THREE.AmbientLight(0xffffff, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(-5, 4, 6);
  scene.add(sun);

  // 地球儀の後ろを回る軌道（中をコードが流れる）
  const orbits = createOrbits({ center: GLOBE_CENTER, globeRadius: GLOBE_RADIUS });
  scene.add(orbits.object);

  // 地球儀
  const globe = createGlobe({ radius: GLOBE_RADIUS, maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
  globe.object.position.copy(GLOBE_CENTER);
  scene.add(globe.object);

  // 丸タブ・つなぐ線・線上を流れる点
  const pulseGeometry = new THREE.BufferGeometry();
  pulseGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tabs.length * 3), 3));
  const pulses = new THREE.Points(
    pulseGeometry,
    new THREE.PointsMaterial({
      color: COLORS.pulse,
      size: 6,
      sizeAttenuation: false,
      map: createCircleSprite(),
      transparent: true,
      alphaTest: 0.4,
      depthWrite: false,
    }),
  );
  pulses.renderOrder = 4;
  scene.add(pulses);

  const nodes = tabs.map((tab, i) => {
    const angle = Math.PI / 2 - (i / tabs.length) * Math.PI * 2;
    const home = new THREE.Vector3();

    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tab';
    el.dataset.tab = tab.id;
    el.setAttribute('aria-label', `${tab.ja}を開く`);
    el.innerHTML = `<span class="tab-inner"><span class="tab-en"></span><span class="tab-ja"></span></span>`;
    el.querySelector('.tab-en').textContent = tab.en;
    el.querySelector('.tab-ja').textContent = tab.ja;
    el.addEventListener('click', () => onSelect(tab, el));
    tabLayer.append(el);

    const geometry = new LineGeometry();
    geometry.setPositions([0, 0, 0, 0, 0, 0]);
    const connector = new Line2(
      geometry,
      new LineMaterial({ color: COLORS.connector, linewidth: 1.2, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    connector.renderOrder = 3;
    scene.add(connector);

    return { tab, el, angle, home, pos: new THREE.Vector3(), connector, phase: i * 1.37, diameter: 0 };
  });

  // カメラ
  const view = {
    homeDistance: 11,
    distance: 11 * INTRO_PULLBACK,
    targetDistance: 11 * INTRO_PULLBACK,
    look: new THREE.Vector3(),
    targetLook: new THREE.Vector3(),
    pointer: new THREE.Vector2(),
    revealed: false,
    focused: null,
  };

  const size = { w: 1, h: 1 };
  let ring = RINGS.landscape;

  function resize() {
    size.w = window.innerWidth;
    size.h = window.innerHeight;
    renderer.setSize(size.w, size.h, false);
    camera.aspect = size.w / size.h;
    camera.updateProjectionMatrix();

    ring = camera.aspect < 1 ? RINGS.portrait : RINGS.landscape;
    globe.object.scale.setScalar(ring.globe);
    for (const node of nodes) {
      node.home.set(ring.r * Math.cos(node.angle), ring.r * Math.sin(node.angle), 0);
    }

    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const reach = ring.r + ring.tab / 2 + FIT_MARGIN;
    view.homeDistance = Math.max(reach / tanHalf, reach / (tanHalf * camera.aspect));
    if (!view.focused) {
      view.targetDistance = view.revealed ? view.homeDistance : view.homeDistance * INTRO_PULLBACK;
    }

    orbits.setResolution(size.w, size.h);
    for (const node of nodes) node.connector.material.resolution.set(size.w, size.h);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', (e) => {
    view.pointer.set((e.clientX / size.w) * 2 - 1, -((e.clientY / size.h) * 2 - 1));
  });
  resize();

  const tmp = new THREE.Vector3();
  const camSpace = new THREE.Vector3();
  const start = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const timer = new THREE.Timer();
  const tanHalf = () => Math.tan(THREE.MathUtils.degToRad(FOV / 2));

  function updateCamera(dt) {
    view.distance += (view.targetDistance - view.distance) * damp(2.4, dt);
    view.look.lerp(view.targetLook, damp(3, dt));

    const parallax = view.focused ? 0 : 1;
    const px = view.pointer.x * 0.55 * parallax;
    const py = view.pointer.y * 0.35 * parallax;
    tmp.set(view.look.x + px, view.look.y + py, view.distance);
    camera.position.lerp(tmp, damp(3.5, dt));
    camera.lookAt(view.look);
    camera.updateMatrixWorld();
  }

  function updateTabs(t) {
    const pulseAttr = pulseGeometry.getAttribute('position');

    nodes.forEach((node, i) => {
      node.pos.set(
        node.home.x + 0.05 * Math.cos(t * 0.5 + node.phase),
        node.home.y + 0.08 * Math.sin(t * 0.7 + node.phase),
        node.home.z,
      );

      // つなぐ線: 地球儀の表面の少し外から丸タブの中心まで
      dir.copy(node.pos).sub(GLOBE_CENTER).normalize();
      start.copy(GLOBE_CENTER).addScaledVector(dir, GLOBE_RADIUS * ring.globe * 1.08);
      node.connector.geometry.setPositions([start.x, start.y, start.z, node.pos.x, node.pos.y, node.pos.z]);

      // 線の上を地球儀から丸タブへ流れる点
      const progress = ((t * 0.32 + i / nodes.length) % 1) * 0.8 + 0.08;
      tmp.copy(start).lerp(node.pos, progress);
      pulseAttr.setXYZ(i, tmp.x, tmp.y, tmp.z);

      // 画面座標と大きさ
      camSpace.copy(node.pos).applyMatrix4(camera.matrixWorldInverse);
      const depth = -camSpace.z;
      const pxPerUnit = size.h / (2 * tanHalf() * depth);
      const diameter = Math.round(ring.tab * pxPerUnit);

      tmp.copy(node.pos).project(camera);
      const x = (tmp.x * 0.5 + 0.5) * size.w;
      const y = (-tmp.y * 0.5 + 0.5) * size.h;

      node.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      if (diameter !== node.diameter) {
        node.el.style.setProperty('--d', `${diameter}px`);
        node.diameter = diameter;
      }
      node.el.style.zIndex = String(1000 - Math.round(depth * 10));
    });

    pulseAttr.needsUpdate = true;
  }

  renderer.setAnimationLoop((timestamp) => {
    timer.update(timestamp);
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();

    globe.update(dt);
    orbits.update(dt);

    updateCamera(dt);
    updateTabs(t);
    renderer.render(scene, camera);
  });

  return {
    reveal() {
      view.revealed = true;
      view.targetDistance = view.homeDistance;
    },
    focus(tabId) {
      const node = nodes.find((n) => n.tab.id === tabId);
      if (!node) return;
      view.focused = tabId;
      view.targetLook.copy(node.home).multiplyScalar(0.35);
      view.targetDistance = view.homeDistance * 0.72;
    },
    unfocus() {
      view.focused = null;
      view.targetLook.set(0, 0, 0);
      view.targetDistance = view.homeDistance;
    },
    elementFor(tabId) {
      return nodes.find((n) => n.tab.id === tabId)?.el ?? null;
    },
  };
}
