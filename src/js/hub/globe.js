// 線のない地球儀: 海は透明、陸だけピンク。
import * as THREE from 'three';
import { geoEquirectangular, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

const LAND_URL = '../node_modules/world-atlas/land-50m.json';
const TEXTURE_WIDTH = 4096;
const LAND_COLOR = '#e0508c';
const JAPAN_LONGITUDE = 138;
const SPIN_SPEED = 0.035; // rad/s

async function createLandTexture() {
  const topology = await (await fetch(LAND_URL)).json();
  const land = feature(topology, topology.objects.land);

  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_WIDTH / 2;
  const ctx = canvas.getContext('2d');

  const projection = geoEquirectangular()
    .scale(TEXTURE_WIDTH / (2 * Math.PI))
    .translate([canvas.width / 2, canvas.height / 2]);

  ctx.beginPath();
  geoPath(projection, ctx)(land);
  ctx.fillStyle = LAND_COLOR;
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// SphereGeometry の UV で、指定した経度がカメラ(+Z)を向く回転角
function yawFacing(longitude) {
  const phi = ((longitude + 180) / 360) * Math.PI * 2;
  return Math.PI / 2 - phi;
}

export function createGlobe({ radius, maxAnisotropy }) {
  const group = new THREE.Group();
  group.rotation.z = THREE.MathUtils.degToRad(-12);
  group.rotation.x = THREE.MathUtils.degToRad(14);

  const spinner = new THREE.Group();
  spinner.rotation.y = yawFacing(JAPAN_LONGITUDE);
  group.add(spinner);

  const geometry = new THREE.SphereGeometry(radius, 128, 64);

  // 裏側の陸は薄く透けて見える
  const back = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.16,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  back.renderOrder = -2;

  const front = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
    }),
  );
  front.renderOrder = 2;

  // 見えない球で奥行きだけを書き込み、地球儀の後ろを通る軌道リングを隠す
  const occluder = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.995, 64, 32),
    // transparent にして描画順(renderOrder)を「裏側の陸 → 遮蔽 → 軌道リング → 表側の陸」にする
    new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, depthWrite: true }),
  );
  occluder.renderOrder = -1;
  group.add(occluder);

  back.visible = false;
  front.visible = false;
  spinner.add(back, front);

  createLandTexture()
    .then((texture) => {
      texture.anisotropy = maxAnisotropy;
      back.material.map = texture;
      front.material.map = texture;
      back.material.needsUpdate = true;
      front.material.needsUpdate = true;
      back.visible = true;
      front.visible = true;
    })
    .catch((err) => console.error('[globe] 陸地データの読み込みに失敗しました', err));

  return {
    object: group,
    update(dt) {
      spinner.rotation.y += SPIN_SPEED * dt;
    },
  };
}
