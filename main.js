// Rendering only. All geometry and every certificate number come from src/core.mjs.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fracture, Frac } from './src/core.mjs';

const host = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 100);
camera.position.set(2.1, 1.7, 2.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x0a1018, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(3, 5, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0x88aaff, 1.0);
rim.position.set(-4, -2, -3);
scene.add(rim);

const num = (s) => { const [a, b] = String(s).split('/'); return Number(a) / (b ? Number(b) : 1); };
const fof = (s) => { const [a, b] = String(s).split('/'); return b ? new Frac(BigInt(a), BigInt(b)) : new Frac(BigInt(a), 1n); };
const data = await (await fetch('./data/fracture.json')).json();
const picker = document.getElementById('scene');
data.scenes.forEach((s, i) => picker.add(new Option(s.name, String(i))));
const root = new THREE.Group();
scene.add(root);
let shards = [];
let current = 0;

function clear() {
  for (const s of shards) { s.mesh.geometry.dispose(); s.mesh.material.dispose(); root.remove(s.mesh); }
  shards = [];
}

function build(index) {
  clear();
  current = index;
  const sc = data.scenes[index];
  const edge = num(sc.boxEdge);
  const center = new THREE.Vector3(edge / 2, edge / 2, edge / 2);
  sc.cells.forEach((cell, i) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(cell.positions, 3));
    g.setIndex(cell.indices);
    g.computeVertexNormals();
    const hue = (i / sc.cells.length) * 0.75 + 0.02;
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hue, 0.55, 0.55),
      metalness: 0.15, roughness: 0.45, flatShading: true,
    });
    const mesh = new THREE.Mesh(g, m);
    const seed = new THREE.Vector3(...cell.seed.map(num));
    mesh.userData.dir = seed.clone().sub(center).normalize();
    mesh.userData.base = seed.clone();
    root.add(mesh);
    shards.push({ mesh, cell, seed });
  });
  applyExplode(Number(document.getElementById('explode').value));
  document.getElementById('cert').textContent =
    `${sc.summary.shards} shards · ${sc.summary.triangles} triangles\n` +
    `watertight ${sc.summary.watertightShards}/${sc.summary.shards}\n` +
    `volume error (exact) ${sc.summary.volumeError}`;
}

function applyExplode(t) {
  document.getElementById('exVal').textContent = t.toFixed(2);
  for (const s of shards) {
    s.mesh.position.copy(s.mesh.userData.dir).multiplyScalar(t * 0.55);
  }
}

document.getElementById('explode').addEventListener('input', (e) => applyExplode(Number(e.target.value)));
picker.addEventListener('change', () => build(Number(picker.value)));

document.getElementById('recompute').addEventListener('click', () => {
  const sc = data.scenes[current];
  const t0 = performance.now();
  const S = fof(sc.boxEdge);
  const seeds = sc.seeds.map((p) => p.map(fof));
  const f = fracture({ seeds, S });
  const ms = performance.now() - t0;
  const wt = f.cells.filter((c) => c.watertight.paired === c.watertight.undirected && c.watertight.bad === 0).length;
  const el = document.getElementById('cert');
  el.className = 'ok';
  el.textContent =
    `exact recompute in this tab: ${ms.toFixed(0)} ms\n` +
    `shards ${f.cells.length} · sum(volume) ${f.totalVolume.toString()} · box^3 ${f.boxVolume.toString()}\n` +
    `relative volume error ${f.volumeError.toString()} (exact fraction)\n` +
    `watertight ${wt}/${f.cells.length} · triangles ${f.triangles}\n` +
    `match committed data: ${f.triangles === sc.summary.triangles && f.volumeError.isZero() ? 'yes' : 'NO'}`;
});

build(0);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

(function loop() {
  requestAnimationFrame(loop);
  controls.update();
  renderer.render(scene, camera);
})();
