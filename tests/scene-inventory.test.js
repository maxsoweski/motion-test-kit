// Phase 1 self-tests for scene-inventory: takeSceneInventory + frustum math
// helpers. Uses synthetic three-shaped objects (not real THREE — keeps the
// kit dep-free; the manual-frustum math is what's actually under test).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  takeSceneInventory,
  extractFrustumPlanes,
  sphereIntersectsFrustum,
  multiplyMatrix4,
  invertMatrix4,
} from '../adapters/three/scene-inventory.js';
import { MissingInventoryFieldError, InventoryEntityNotFoundError } from '../core/inventory/errors.js';

// ─── Frustum math ────────────────────────────────────────────────────────

test('extractFrustumPlanes: identity matrix produces canonical NDC frustum', () => {
  const identity = new Float64Array(16);
  identity[0] = 1; identity[5] = 1; identity[10] = 1; identity[15] = 1;
  const planes = extractFrustumPlanes(identity);
  assert.equal(planes.length, 24);
  // Identity matrix means clip = world. Frustum is the NDC cube [-1,1]^3.
  // Each plane should be unit-normalized.
  for (let i = 0; i < 6; i++) {
    const o = i * 4;
    const len = Math.hypot(planes[o], planes[o + 1], planes[o + 2]);
    assert.ok(Math.abs(len - 1) < 1e-9, `plane ${i} normal not unit length: ${len}`);
  }
});

test('sphereIntersectsFrustum: identity-NDC frustum, sphere at origin radius 0.5 is inside', () => {
  const identity = new Float64Array(16);
  identity[0] = 1; identity[5] = 1; identity[10] = 1; identity[15] = 1;
  const planes = extractFrustumPlanes(identity);
  assert.equal(sphereIntersectsFrustum(0, 0, 0, 0.5, planes), true);
});

test('sphereIntersectsFrustum: identity-NDC frustum, sphere far outside is rejected', () => {
  const identity = new Float64Array(16);
  identity[0] = 1; identity[5] = 1; identity[10] = 1; identity[15] = 1;
  const planes = extractFrustumPlanes(identity);
  // Sphere at (10, 0, 0) radius 0.5 — well outside [-1, 1] cube.
  assert.equal(sphereIntersectsFrustum(10, 0, 0, 0.5, planes), false);
});

test('sphereIntersectsFrustum: edge case — sphere intersects frustum boundary', () => {
  const identity = new Float64Array(16);
  identity[0] = 1; identity[5] = 1; identity[10] = 1; identity[15] = 1;
  const planes = extractFrustumPlanes(identity);
  // Sphere center at (1.4, 0, 0) radius 0.5 — center outside [-1, 1] but
  // sphere extends back to x=0.9 so it intersects the right face.
  assert.equal(sphereIntersectsFrustum(1.4, 0, 0, 0.5, planes), true);
});

test('multiplyMatrix4: identity * identity = identity', () => {
  const identity = new Float64Array(16);
  identity[0] = 1; identity[5] = 1; identity[10] = 1; identity[15] = 1;
  const r = multiplyMatrix4(identity, identity);
  for (let i = 0; i < 16; i++) {
    assert.equal(r[i], identity[i], `mismatch at ${i}`);
  }
});

test('invertMatrix4: invert(identity) is identity', () => {
  const identity = new Float64Array(16);
  identity[0] = 1; identity[5] = 1; identity[10] = 1; identity[15] = 1;
  const inv = invertMatrix4(identity);
  for (let i = 0; i < 16; i++) {
    assert.equal(inv[i], identity[i], `mismatch at ${i}`);
  }
});

test('invertMatrix4: invert is right inverse (M * M^-1 = I) for a translation', () => {
  // Column-major translation by (5, -3, 7): identity with translation in last column
  const T = new Float64Array(16);
  T[0] = 1; T[5] = 1; T[10] = 1; T[15] = 1;
  T[12] = 5; T[13] = -3; T[14] = 7;
  const Tinv = invertMatrix4(T);
  const product = multiplyMatrix4(T, Tinv);
  // product should equal identity
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      const expected = (col === row) ? 1 : 0;
      const actual = product[col * 4 + row];
      assert.ok(Math.abs(actual - expected) < 1e-12, `T*T^-1[${col}][${row}]=${actual}, expected ${expected}`);
    }
  }
});

// ─── takeSceneInventory ──────────────────────────────────────────────────

// Synthetic three-shaped helper: build a minimal Scene + Camera + Mesh tree.
// Matches Three.js's relevant interface — traverseVisible, projectionMatrix,
// matrixWorld, etc.

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

function makeMesh({ name, x = 0, y = 0, z = 0, visible = true, frustumCulled = true, radius = 0.5 }) {
  return {
    name,
    type: 'Mesh',
    uuid: `mesh-${name}`,
    visible,
    frustumCulled,
    matrixWorld: makeTranslationMatrix4(x, y, z),
    position: { x, y, z },
    geometry: { uuid: `geom-${name}`, boundingSphere: { center: { x: 0, y: 0, z: 0 }, radius } },
    material: { uuid: `mat-${name}` },
    layers: { mask: 1 },
  };
}

function makeScene(meshes) {
  return {
    traverseVisible(cb) {
      for (const m of meshes) {
        if (m.visible === false) continue;
        cb(m);
      }
    },
  };
}

function makeIdentityCamera() {
  return {
    projectionMatrix: makeIdentityMatrix4(),
    matrixWorldInverse: makeIdentityMatrix4(),
  };
}

test('takeSceneInventory: three meshes, one inside / one outside frustum / one not visible', () => {
  const inside = makeMesh({ name: 'tunnelMesh', x: 0, y: 0, z: 0, radius: 0.3 });
  const outside = makeMesh({ name: 'farMesh', x: 100, y: 0, z: 0, radius: 0.5 });
  const hidden = makeMesh({ name: 'reticleMesh', x: 0, y: 0, z: 0, radius: 0.5, visible: false });
  const scene = makeScene([inside, outside, hidden]);
  const camera = makeIdentityCamera();

  const inv = takeSceneInventory({ scene, camera });

  assert.equal(inv.meshes.length, 2, 'hidden mesh should not appear in inventory');

  const inEntry = inv.meshes.find((m) => m.name === 'tunnelMesh');
  assert.ok(inEntry, 'tunnelMesh entry present');
  assert.equal(inEntry.inFrustum, true, 'tunnelMesh inFrustum');
  assert.equal(inEntry.visible, true);
  assert.equal(inEntry.frustumCulled, true);

  const outEntry = inv.meshes.find((m) => m.name === 'farMesh');
  assert.ok(outEntry, 'farMesh entry present');
  assert.equal(outEntry.inFrustum, false, 'farMesh inFrustum should be false');
});

test('takeSceneInventory: frustumCulled=false makes inFrustum always true', () => {
  const m = makeMesh({ name: 'always', x: 100, y: 0, z: 0, radius: 0.5, frustumCulled: false });
  const scene = makeScene([m]);
  const camera = makeIdentityCamera();
  const inv = takeSceneInventory({ scene, camera });
  assert.equal(inv.meshes[0].inFrustum, true, 'frustumCulled=false should bypass frustum check');
});

test('takeSceneInventory: throws when scene missing traverseVisible', () => {
  assert.throws(
    () => takeSceneInventory({ scene: {}, camera: makeIdentityCamera() }),
    /traverseVisible/,
  );
});

test('takeSceneInventory: throws when camera missing projectionMatrix', () => {
  assert.throws(
    () => takeSceneInventory({ scene: makeScene([]), camera: {} }),
    /projectionMatrix/,
  );
});

test('takeSceneInventory: verbose mode warns on unnamed meshes', () => {
  const unnamed = makeMesh({ name: '', x: 0, y: 0, z: 0 });
  const scene = makeScene([unnamed]);
  const camera = makeIdentityCamera();

  const origWarn = console.warn;
  let warnCount = 0;
  let warnMsg = '';
  console.warn = (...args) => { warnCount++; warnMsg = args.join(' '); };
  try {
    takeSceneInventory({ scene, camera, verbose: true });
  } finally {
    console.warn = origWarn;
  }
  assert.equal(warnCount, 1, 'verbose mode emits exactly one warning per unnamed mesh');
  assert.match(warnMsg, /unnamed mesh/);
});

test('takeSceneInventory: verbose=false (default) does NOT warn on unnamed meshes', () => {
  const unnamed = makeMesh({ name: '', x: 0, y: 0, z: 0 });
  const scene = makeScene([unnamed]);
  const camera = makeIdentityCamera();

  const origWarn = console.warn;
  let warnCount = 0;
  console.warn = () => { warnCount++; };
  try {
    takeSceneInventory({ scene, camera });
  } finally {
    console.warn = origWarn;
  }
  assert.equal(warnCount, 0, 'silent by default');
});

test('takeSceneInventory: includeBoundingSphere=true populates the field', () => {
  const m = makeMesh({ name: 'thing', radius: 1.7 });
  const inv = takeSceneInventory({ scene: makeScene([m]), camera: makeIdentityCamera(), includeBoundingSphere: true });
  assert.equal(inv.meshes[0].boundingSphereRadius, 1.7);
});

test('takeSceneInventory: includeBoundingSphere=false (default) omits the field', () => {
  const m = makeMesh({ name: 'thing', radius: 1.7 });
  const inv = takeSceneInventory({ scene: makeScene([m]), camera: makeIdentityCamera() });
  assert.equal(inv.meshes[0].boundingSphereRadius, undefined);
});

test('takeSceneInventory: meshNamePrefix filters mesh entries', () => {
  const a = makeMesh({ name: 'warpA' });
  const b = makeMesh({ name: 'warpB' });
  const c = makeMesh({ name: 'shipC' });
  const inv = takeSceneInventory({ scene: makeScene([a, b, c]), camera: makeIdentityCamera(), meshNamePrefix: 'warp' });
  assert.equal(inv.meshes.length, 2);
  assert.ok(inv.meshes.every((m) => m.name.indexOf('warp') === 0));
});

test('takeSceneInventory: pure-data invariant — JSON.stringify works', () => {
  const inside = makeMesh({ name: 'foo', x: 0, y: 0, z: 0 });
  const inv = takeSceneInventory({ scene: makeScene([inside]), camera: makeIdentityCamera() });
  // Pure-data invariant: must JSON-roundtrip without loss.
  const round = JSON.parse(JSON.stringify(inv));
  assert.deepEqual(round.meshes[0].name, 'foo');
  assert.equal(round.meshes[0].visible, true);
  assert.deepEqual(round.meshes[0].worldPos, [0, 0, 0]);
});

test('takeSceneInventory: derives matrixWorldInverse from matrixWorld when only matrixWorld provided', () => {
  // Camera with only matrixWorld set — adapter should invert internally
  const m = makeMesh({ name: 'thing', x: 0, y: 0, z: 0 });
  const camera = { projectionMatrix: makeIdentityMatrix4(), matrixWorld: makeIdentityMatrix4() };
  const inv = takeSceneInventory({ scene: makeScene([m]), camera });
  assert.equal(inv.meshes.length, 1);
});

// ─── Errors module ───────────────────────────────────────────────────────

test('MissingInventoryFieldError carries name + path metadata', () => {
  const e = new MissingInventoryFieldError('meshVisibleAt', 42, 'inventory.meshes');
  assert.equal(e.name, 'MissingInventoryFieldError');
  assert.equal(e.predicate, 'meshVisibleAt');
  assert.equal(e.frameIdx, 42);
  assert.equal(e.fieldPath, 'inventory.meshes');
  assert.match(e.message, /meshVisibleAt/);
  assert.match(e.message, /frame 42/);
});

test('InventoryEntityNotFoundError carries entity kind + key', () => {
  const e = new InventoryEntityNotFoundError('overlayVisibleAt', 7, 'overlay', 'reticle');
  assert.equal(e.name, 'InventoryEntityNotFoundError');
  assert.equal(e.entityKind, 'overlay');
  assert.equal(e.entityKey, 'reticle');
  assert.match(e.message, /reticle/);
});
