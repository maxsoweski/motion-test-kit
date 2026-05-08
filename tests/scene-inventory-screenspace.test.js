// Phase A unit tests for the inspection-layer-v2 cheap analytic primitives.
// Exercises: normalizeViewport, projectPoint, transformAABBCorners,
// boxIntersectsFrustum, and end-to-end takeSceneInventory with viewport.
//
// Synthetic three-shaped objects (duck-typed) per the kit convention.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  takeSceneInventory,
  normalizeViewport,
  projectPoint,
  transformAABBCorners,
  boxIntersectsFrustum,
  extractFrustumPlanes,
  multiplyMatrix4,
} from '../adapters/three/scene-inventory.js';

// ── Synthetic builders ──────────────────────────────────────────────────

function identityM4() {
  const m = new Float64Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

// Column-major translation matrix.
function translationM4(x, y, z) {
  const m = identityM4();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

// Three.js PerspectiveCamera.projectionMatrix (column-major).
// Convention: looks down -Z; near/far positive; right-handed.
function perspectiveProjection(fovDeg, aspect, near, far) {
  const m = new Float64Array(16);
  const fovRad = fovDeg * Math.PI / 180;
  const top = near * Math.tan(fovRad / 2);
  const right = top * aspect;
  m[0] = near / right;
  m[5] = near / top;
  m[10] = -(far + near) / (far - near);
  m[11] = -1;
  m[14] = -2 * far * near / (far - near);
  return m;
}

function makePerspectiveCamera({ fov = 60, aspect = 1.6, near = 0.1, far = 1000, posZ = 5 } = {}) {
  // Camera at (0, 0, posZ) looking toward -Z (so an object at origin is in front).
  // matrixWorld translates by (0,0,posZ); matrixWorldInverse translates by (0,0,-posZ).
  return {
    name: '', type: 'PerspectiveCamera',
    isCamera: true, isPerspectiveCamera: true,
    uuid: `cam-${Math.random().toString(36).slice(2, 8)}`,
    fov, aspect, near, far,
    projectionMatrix: { elements: perspectiveProjection(fov, aspect, near, far) },
    matrixWorld: { elements: translationM4(0, 0, posZ) },
    matrixWorldInverse: { elements: translationM4(0, 0, -posZ) },
    position: { x: 0, y: 0, z: posZ },
    visible: true,
  };
}

function makeMesh({
  name = 'm', x = 0, y = 0, z = 0,
  sphereRadius = 0.5,
  hasBoundingBox = true,
  boxHalfExtent = 0.5,
  visible = true, frustumCulled = true,
} = {}) {
  const geometry = {
    uuid: `geo-${name}`,
  };
  geometry.boundingSphere = { center: { x: 0, y: 0, z: 0 }, radius: sphereRadius };
  if (hasBoundingBox) {
    geometry.boundingBox = {
      min: { x: -boxHalfExtent, y: -boxHalfExtent, z: -boxHalfExtent },
      max: { x: boxHalfExtent, y: boxHalfExtent, z: boxHalfExtent },
    };
  }
  return {
    name, type: 'Mesh',
    uuid: `mesh-${Math.random().toString(36).slice(2, 8)}`,
    visible, frustumCulled,
    matrixWorld: { elements: translationM4(x, y, z) },
    layers: { mask: 1 },
    geometry,
    material: { uuid: 'mat' },
  };
}

function makeScene(meshes) {
  return {
    traverseVisible(cb) { for (const m of meshes) if (m.visible) cb(m); },
    traverse(cb) { for (const m of meshes) cb(m); },
  };
}

// ── normalizeViewport ───────────────────────────────────────────────────

test('normalizeViewport: undefined returns null', () => {
  assert.equal(normalizeViewport(undefined), null);
});

test('normalizeViewport: valid object passes through', () => {
  assert.deepEqual(normalizeViewport({ width: 1920, height: 1080 }), { width: 1920, height: 1080 });
});

test('normalizeViewport: missing width throws', () => {
  assert.throws(() => normalizeViewport({ height: 1080 }), /viewport must be/);
});

test('normalizeViewport: zero/negative dims throw', () => {
  assert.throws(() => normalizeViewport({ width: 0, height: 1080 }), /must be > 0/);
  assert.throws(() => normalizeViewport({ width: 100, height: -1 }), /must be > 0/);
});

// ── projectPoint ────────────────────────────────────────────────────────

test('projectPoint: origin in front of camera projects near viewport center', () => {
  const cam = makePerspectiveCamera({ posZ: 5 });
  const clipE = multiplyMatrix4(cam.projectionMatrix.elements, cam.matrixWorldInverse.elements);
  const viewport = { width: 1920, height: 1080 };
  const p = projectPoint(0, 0, 0, clipE, viewport);
  assert.ok(p, 'projection should not be null');
  assert.ok(Math.abs(p.x - viewport.width / 2) < 1, `x near center, got ${p.x}`);
  assert.ok(Math.abs(p.y - viewport.height / 2) < 1, `y near center, got ${p.y}`);
  assert.equal(p.inViewport, true);
  assert.equal(p.behindCamera, false);
  assert.ok(p.depth > -1 && p.depth < 1, `NDC depth in [-1,1], got ${p.depth}`);
});

test('projectPoint: point above origin is in upper half of viewport (lower y)', () => {
  const cam = makePerspectiveCamera({ posZ: 5 });
  const clipE = multiplyMatrix4(cam.projectionMatrix.elements, cam.matrixWorldInverse.elements);
  const viewport = { width: 1920, height: 1080 };
  const p = projectPoint(0, 1, 0, clipE, viewport);
  assert.ok(p);
  assert.ok(p.y < viewport.height / 2, `point above origin → upper screen (y < half), got ${p.y}`);
  assert.equal(p.inViewport, true);
});

test('projectPoint: point behind camera flagged behindCamera + not inViewport', () => {
  const cam = makePerspectiveCamera({ posZ: 5 });
  const clipE = multiplyMatrix4(cam.projectionMatrix.elements, cam.matrixWorldInverse.elements);
  const viewport = { width: 1920, height: 1080 };
  // Camera at z=5 looking down -Z. A point at z=10 is behind the camera.
  const p = projectPoint(0, 0, 10, clipE, viewport);
  assert.ok(p);
  assert.equal(p.behindCamera, true);
  assert.equal(p.inViewport, false);
});

test('projectPoint: point far off-axis is outside viewport bounds', () => {
  const cam = makePerspectiveCamera({ posZ: 5 });
  const clipE = multiplyMatrix4(cam.projectionMatrix.elements, cam.matrixWorldInverse.elements);
  const viewport = { width: 1920, height: 1080 };
  // Far to the right of origin → projects beyond viewport.width
  const p = projectPoint(50, 0, 0, clipE, viewport);
  assert.ok(p);
  assert.equal(p.behindCamera, false);
  assert.equal(p.inViewport, false, `far off-axis should be outside viewport, got x=${p.x}`);
});

// ── transformAABBCorners ────────────────────────────────────────────────

test('transformAABBCorners: identity returns 8 local corners', () => {
  const corners = transformAABBCorners({ x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, undefined);
  assert.equal(corners.length, 24);
  // Each corner's component is ±1.
  for (let i = 0; i < 24; i++) {
    assert.ok(corners[i] === -1 || corners[i] === 1, `corner element ${i} is ±1`);
  }
});

test('transformAABBCorners: translation shifts all corners', () => {
  const mwE = translationM4(10, 20, 30);
  const corners = transformAABBCorners({ x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }, mwE);
  for (let i = 0; i < 8; i++) {
    const x = corners[i * 3];
    const y = corners[i * 3 + 1];
    const z = corners[i * 3 + 2];
    assert.ok(x === 9 || x === 11);
    assert.ok(y === 19 || y === 21);
    assert.ok(z === 29 || z === 31);
  }
});

// ── boxIntersectsFrustum ────────────────────────────────────────────────

test('boxIntersectsFrustum: box at origin intersects camera-at-positive-Z frustum', () => {
  const cam = makePerspectiveCamera({ posZ: 5 });
  const clipE = multiplyMatrix4(cam.projectionMatrix.elements, cam.matrixWorldInverse.elements);
  const planes = extractFrustumPlanes(clipE);
  const corners = transformAABBCorners({ x: -0.5, y: -0.5, z: -0.5 }, { x: 0.5, y: 0.5, z: 0.5 }, undefined);
  assert.equal(boxIntersectsFrustum(corners, planes), true);
});

test('boxIntersectsFrustum: box far behind camera is outside', () => {
  const cam = makePerspectiveCamera({ posZ: 5 });
  const clipE = multiplyMatrix4(cam.projectionMatrix.elements, cam.matrixWorldInverse.elements);
  const planes = extractFrustumPlanes(clipE);
  // Box at z=100 is way behind camera (camera at z=5 looking -Z).
  const mwE = translationM4(0, 0, 100);
  const corners = transformAABBCorners({ x: -0.5, y: -0.5, z: -0.5 }, { x: 0.5, y: 0.5, z: 0.5 }, mwE);
  assert.equal(boxIntersectsFrustum(corners, planes), false);
});

test('boxIntersectsFrustum: box far to the right is outside', () => {
  const cam = makePerspectiveCamera({ posZ: 5 });
  const clipE = multiplyMatrix4(cam.projectionMatrix.elements, cam.matrixWorldInverse.elements);
  const planes = extractFrustumPlanes(clipE);
  const mwE = translationM4(1000, 0, 0);
  const corners = transformAABBCorners({ x: -0.5, y: -0.5, z: -0.5 }, { x: 0.5, y: 0.5, z: 0.5 }, mwE);
  assert.equal(boxIntersectsFrustum(corners, planes), false);
});

// ── End-to-end takeSceneInventory with viewport ─────────────────────────

test('takeSceneInventory + viewport: mesh at origin gets all 5 new fields', () => {
  const camera = makePerspectiveCamera({ posZ: 5 });
  const mesh = makeMesh({ name: 'body.planet.earth', x: 0, y: 0, z: 0, sphereRadius: 1, boxHalfExtent: 1 });
  const scene = makeScene([mesh]);
  const inv = takeSceneInventory({
    scenes: [{ name: 'main', scene, camera }],
    viewport: { width: 1920, height: 1080 },
  });
  assert.equal(inv.meshes.length, 1);
  const e = inv.meshes[0];
  assert.equal(e.name, 'body.planet.earth');
  // cameraDistance: (0,0,0) to camera at (0,0,5) → 5
  assert.ok(Math.abs(e.cameraDistance - 5) < 0.001);
  // screenSpace: should be near viewport center, in viewport.
  assert.ok(Math.abs(e.screenSpace.x - 960) < 1);
  assert.ok(Math.abs(e.screenSpace.y - 540) < 1);
  assert.equal(e.screenSpace.inViewport, true);
  assert.equal(e.screenSpace.behindCamera, false);
  // apparentDegrees: 2*atan(1/5)*180/PI ≈ 22.62°
  assert.ok(Math.abs(e.apparentDegrees - 22.6199) < 0.01, `apparentDegrees ~22.62, got ${e.apparentDegrees}`);
  // estimatedPixelCoverage > 0
  assert.ok(e.estimatedPixelCoverage > 0);
  // projectedSize.pixelArea > 0
  assert.ok(e.projectedSize.pixelArea > 0, `projectedSize present, got ${JSON.stringify(e.projectedSize)}`);
  // realFrustumIntersect = true (origin box is dead center)
  assert.equal(e.realFrustumIntersect, true);
});

test('takeSceneInventory without viewport: none of the new fields appear (backward-compat)', () => {
  const camera = makePerspectiveCamera({ posZ: 5 });
  const mesh = makeMesh({ name: 'm1', sphereRadius: 1 });
  const inv = takeSceneInventory({
    scenes: [{ name: 'main', scene: makeScene([mesh]), camera }],
  });
  const e = inv.meshes[0];
  assert.equal(e.cameraDistance, undefined);
  assert.equal(e.screenSpace, undefined);
  assert.equal(e.projectedSize, undefined);
  assert.equal(e.apparentDegrees, undefined);
  assert.equal(e.estimatedPixelCoverage, undefined);
  assert.equal(e.realFrustumIntersect, undefined);
  // Existing fields preserved.
  assert.equal(e.name, 'm1');
  assert.equal(e.inFrustum, true);
});

test('takeSceneInventory + viewport: mesh far to the side has inViewport=false', () => {
  const camera = makePerspectiveCamera({ posZ: 5 });
  const mesh = makeMesh({ name: 'm-far', x: 100, y: 0, z: 0, sphereRadius: 0.5 });
  const inv = takeSceneInventory({
    scenes: [{ name: 'main', scene: makeScene([mesh]), camera }],
    viewport: { width: 1920, height: 1080 },
  });
  const e = inv.meshes[0];
  assert.equal(e.screenSpace.inViewport, false);
  assert.equal(e.realFrustumIntersect, false);
});

test('takeSceneInventory + viewport: mesh without boundingBox emits projectedSize=null', () => {
  const camera = makePerspectiveCamera({ posZ: 5 });
  const mesh = makeMesh({ name: 'no-box', sphereRadius: 1, hasBoundingBox: false });
  const inv = takeSceneInventory({
    scenes: [{ name: 'main', scene: makeScene([mesh]), camera }],
    viewport: { width: 1920, height: 1080 },
  });
  const e = inv.meshes[0];
  assert.equal(e.projectedSize, null);
  // realFrustumIntersect falls back to sphere-vs-frustum result.
  assert.equal(e.realFrustumIntersect, true);
  // apparentDegrees still computed from sphere.
  assert.ok(e.apparentDegrees > 0);
});

test('takeSceneInventory + viewport: mesh without boundingSphere emits apparentDegrees=null', () => {
  const camera = makePerspectiveCamera({ posZ: 5 });
  const mesh = makeMesh({ name: 'no-sphere', sphereRadius: 0, hasBoundingBox: true });
  // Strip the boundingSphere
  delete mesh.geometry.boundingSphere;
  const inv = takeSceneInventory({
    scenes: [{ name: 'main', scene: makeScene([mesh]), camera }],
    viewport: { width: 1920, height: 1080 },
  });
  const e = inv.meshes[0];
  assert.equal(e.apparentDegrees, null);
  assert.equal(e.estimatedPixelCoverage, null);
  // projectedSize still present from boundingBox.
  assert.ok(e.projectedSize);
});

test('takeSceneInventory + viewport: mesh at exact camera position handles cameraDistance=0', () => {
  const camera = makePerspectiveCamera({ posZ: 5 });
  const mesh = makeMesh({ name: 'on-cam', x: 0, y: 0, z: 5, sphereRadius: 1 });
  const inv = takeSceneInventory({
    scenes: [{ name: 'main', scene: makeScene([mesh]), camera }],
    viewport: { width: 1920, height: 1080 },
  });
  const e = inv.meshes[0];
  assert.equal(e.cameraDistance, 0);
  // apparentDegrees clamped to 180 when cameraDistance=0 (sphere encloses camera).
  assert.equal(e.apparentDegrees, 180);
});

test('takeSceneInventory + viewport: bad viewport throws', () => {
  const camera = makePerspectiveCamera();
  const mesh = makeMesh();
  assert.throws(() => takeSceneInventory({
    scenes: [{ name: 'main', scene: makeScene([mesh]), camera }],
    viewport: { width: 0, height: 1080 },
  }), /must be > 0/);
});
