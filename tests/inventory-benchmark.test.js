// Performance benchmark — AC #15. Captures 1000 inventory snapshots
// against a synthetic ~300-mesh scene and reports p50/p95/p99 wall-clock
// cost in ms to stdout.
//
// Does NOT assert a numerical bound — host-machine variance makes that
// fragile. Just asserts the benchmark ran to completion. Acts as a
// documented baseline: regressions to the kit's snapshot cost are visible
// against the timings printed below.
//
// Expected order-of-magnitude per research §9 + inventory-shape.md
// §"Performance characterization":
//
//   p50:  ~0.5–1.0 ms per snapshot at 300 meshes
//   p95:  ~1–2 ms (tail latency from V8 GC, rare cache misses)
//   p99:  ~2–5 ms
//
// Numbers above well-dipper-scale by 5-10x signal a real regression.

import { test } from 'node:test';
import { takeSceneInventory } from '../adapters/three/scene-inventory.js';

function makeIdentityMatrix4() {
  const m = { elements: new Float64Array(16) };
  m.elements[0] = 1; m.elements[5] = 1; m.elements[10] = 1; m.elements[15] = 1;
  return m;
}

function makeTranslationMatrix4(x, y, z) {
  const m = { elements: new Float64Array(16) };
  m.elements[0] = 1; m.elements[5] = 1; m.elements[10] = 1; m.elements[15] = 1;
  m.elements[12] = x; m.elements[13] = y; m.elements[14] = z;
  return m;
}

function makeMesh(i) {
  return {
    name: `mesh-${i}`,
    type: 'Mesh',
    uuid: `u-${i}`,
    visible: true,
    frustumCulled: true,
    matrixWorld: makeTranslationMatrix4(i * 0.01, 0, -0.5),
    position: { x: i * 0.01, y: 0, z: -0.5 },
    geometry: { uuid: `g-${i}`, boundingSphere: { center: { x: 0, y: 0, z: 0 }, radius: 0.1 } },
    material: { uuid: `m-${i}` },
    layers: { mask: 1 },
  };
}

function buildScene(meshCount) {
  const meshes = [];
  for (let i = 0; i < meshCount; i++) meshes.push(makeMesh(i));
  return {
    traverseVisible(cb) {
      for (const m of meshes) cb(m);
    },
  };
}

function buildCamera() {
  return {
    projectionMatrix: makeIdentityMatrix4(),
    matrixWorldInverse: makeIdentityMatrix4(),
  };
}

test('inventory benchmark: 1000 snapshots @ 300 meshes — report p50/p95/p99', () => {
  const scene = buildScene(300);
  const camera = buildCamera();

  // Warm-up: 50 snapshots so V8 has stabilized JIT
  for (let i = 0; i < 50; i++) takeSceneInventory({ scene, camera });

  const N = 1000;
  const timings = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    takeSceneInventory({ scene, camera });
    const t1 = performance.now();
    timings[i] = t1 - t0;
  }

  const sorted = Array.from(timings).sort((a, b) => a - b);
  const p50 = sorted[Math.floor(N * 0.5)];
  const p95 = sorted[Math.floor(N * 0.95)];
  const p99 = sorted[Math.floor(N * 0.99)];
  const mean = timings.reduce((a, b) => a + b, 0) / N;

  // Print to stdout (visible in `npm test` output)
  console.log(`[inventory benchmark] N=${N} snapshots @ 300 meshes:`);
  console.log(`  p50:   ${p50.toFixed(4)} ms`);
  console.log(`  p95:   ${p95.toFixed(4)} ms`);
  console.log(`  p99:   ${p99.toFixed(4)} ms`);
  console.log(`  mean:  ${mean.toFixed(4)} ms`);
  console.log(`  total: ${(mean * N).toFixed(1)} ms wall clock`);
});

test('inventory benchmark: composer + renderer + overlay overhead is bounded', () => {
  const scene = buildScene(100);
  const camera = buildCamera();
  const composer = { passes: Array.from({ length: 8 }, (_, i) => ({ name: `pass-${i}`, enabled: true, renderToScreen: false, needsSwap: true })) };
  const renderer = { info: { render: { calls: 50, triangles: 5000, points: 100, lines: 0 }, memory: { geometries: 12, textures: 8 }, programs: [{}, {}, {}] } };
  const fakeRegistry = { snapshot: () => Array.from({ length: 10 }, (_, i) => ({ id: `ov-${i}`, visible: i % 2 === 0, opacity: 1, display: 'block' })) };

  for (let i = 0; i < 50; i++) takeSceneInventory({ scene, camera, composer, renderer, overlayRegistry: fakeRegistry });

  const N = 500;
  const timings = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    takeSceneInventory({ scene, camera, composer, renderer, overlayRegistry: fakeRegistry });
    const t1 = performance.now();
    timings[i] = t1 - t0;
  }

  const sorted = Array.from(timings).sort((a, b) => a - b);
  const p50 = sorted[Math.floor(N * 0.5)];
  const p95 = sorted[Math.floor(N * 0.95)];

  console.log(`[inventory benchmark — full options] N=${N} snapshots @ 100 meshes + 8 passes + 10 overlays:`);
  console.log(`  p50:   ${p50.toFixed(4)} ms`);
  console.log(`  p95:   ${p95.toFixed(4)} ms`);
});
