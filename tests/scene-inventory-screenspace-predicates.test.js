// Phase A unit tests for the 4 new screen-space predicates.
// Builds synthetic inventories directly (no adapter required) — pure
// predicate-logic exercise.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  meshOnScreen,
  meshAtViewportPosition,
  meshApparentSize,
  cameraNear,
} from '../core/inventory/predicates.js';
import { MissingInventoryFieldError } from '../core/inventory/errors.js';

function inventoryWithMesh(entry) {
  const inv = { meshes: [entry] };
  return new Map([['p', inv]]);
}

function makeMeshEntry(overrides = {}) {
  return {
    name: 'm', type: 'Mesh', uuid: 'u1', source: 'main',
    visible: true, frustumCulled: true, inFrustum: true,
    worldPos: [0, 0, 0], layer: 1, materialUuid: '', geometryUuid: '',
    cameraDistance: 5,
    screenSpace: { x: 960, y: 540, depth: 0.5, inViewport: true, behindCamera: false },
    projectedSize: { width: 100, height: 100, pixelArea: 10000 },
    apparentDegrees: 22.6,
    estimatedPixelCoverage: 25000,
    realFrustumIntersect: true,
    ...overrides,
  };
}

// ── meshOnScreen ────────────────────────────────────────────────────────

test('meshOnScreen: on-screen entry passes', () => {
  const r = meshOnScreen(inventoryWithMesh(makeMeshEntry()), { phaseKey: 'p', meshName: 'm' });
  assert.equal(r.passed, true);
  assert.equal(r.violations.length, 0);
});

test('meshOnScreen: inViewport=false fails', () => {
  const e = makeMeshEntry({ screenSpace: { x: 0, y: 0, depth: 0, inViewport: false, behindCamera: false } });
  const r = meshOnScreen(inventoryWithMesh(e), { phaseKey: 'p', meshName: 'm' });
  assert.equal(r.passed, false);
  assert.match(r.violations[0].reason, /inViewport=false/);
});

test('meshOnScreen: realFrustumIntersect=false fails', () => {
  const e = makeMeshEntry({ realFrustumIntersect: false });
  const r = meshOnScreen(inventoryWithMesh(e), { phaseKey: 'p', meshName: 'm' });
  assert.equal(r.passed, false);
  assert.match(r.violations[0].reason, /realFrustumIntersect=false/);
});

test('meshOnScreen: pixelArea below minPixelArea fails', () => {
  const e = makeMeshEntry({ projectedSize: { width: 1, height: 1, pixelArea: 1 } });
  const r = meshOnScreen(inventoryWithMesh(e), { phaseKey: 'p', meshName: 'm', minPixelArea: 100 });
  assert.equal(r.passed, false);
  assert.match(r.violations[0].reason, /pixelArea=1 < minPixelArea=100/);
});

test('meshOnScreen: projectedSize=null + minPixelArea>0 fails', () => {
  const e = makeMeshEntry({ projectedSize: null });
  const r = meshOnScreen(inventoryWithMesh(e), { phaseKey: 'p', meshName: 'm' });
  assert.equal(r.passed, false);
  assert.match(r.violations[0].reason, /projectedSize is null/);
});

test('meshOnScreen: missing screenSpace throws MissingInventoryFieldError', () => {
  const e = makeMeshEntry();
  delete e.screenSpace;
  assert.throws(
    () => meshOnScreen(inventoryWithMesh(e), { phaseKey: 'p', meshName: 'm' }),
    MissingInventoryFieldError
  );
});

test('meshOnScreen: mesh-not-found returns FAIL violation, not throw', () => {
  const r = meshOnScreen(inventoryWithMesh(makeMeshEntry()), { phaseKey: 'p', meshName: 'absent' });
  assert.equal(r.passed, false);
  assert.match(r.violations[0].reason, /mesh not found/);
});

test('meshOnScreen: missing required options throws', () => {
  assert.throws(() => meshOnScreen(inventoryWithMesh(makeMeshEntry()), {}), /required/);
  assert.throws(() => meshOnScreen(inventoryWithMesh(makeMeshEntry()), { phaseKey: 'p' }), /required/);
});

// ── meshAtViewportPosition ──────────────────────────────────────────────

test('meshAtViewportPosition: at center with region=center passes', () => {
  const r = meshAtViewportPosition(inventoryWithMesh(makeMeshEntry()), {
    phaseKey: 'p', meshName: 'm', region: 'center',
    viewport: { width: 1920, height: 1080 },
  });
  assert.equal(r.passed, true);
});

test('meshAtViewportPosition: at center, region=top fails', () => {
  const r = meshAtViewportPosition(inventoryWithMesh(makeMeshEntry()), {
    phaseKey: 'p', meshName: 'm', region: 'top',
    viewport: { width: 1920, height: 1080 },
  });
  assert.equal(r.passed, false);
});

test('meshAtViewportPosition: pixel coords mode with within-tolerance passes', () => {
  const e = makeMeshEntry({ screenSpace: { x: 1000, y: 540, depth: 0, inViewport: true, behindCamera: false } });
  const r = meshAtViewportPosition(inventoryWithMesh(e), {
    phaseKey: 'p', meshName: 'm', x: 1020, y: 540, tolerance: 50,
  });
  assert.equal(r.passed, true);
});

test('meshAtViewportPosition: pixel coords mode out-of-tolerance fails', () => {
  const e = makeMeshEntry({ screenSpace: { x: 1000, y: 540, depth: 0, inViewport: true, behindCamera: false } });
  const r = meshAtViewportPosition(inventoryWithMesh(e), {
    phaseKey: 'p', meshName: 'm', x: 200, y: 540, tolerance: 50,
  });
  assert.equal(r.passed, false);
  assert.match(r.violations[0].reason, /from target/);
});

test('meshAtViewportPosition: region without viewport throws', () => {
  assert.throws(
    () => meshAtViewportPosition(inventoryWithMesh(makeMeshEntry()), {
      phaseKey: 'p', meshName: 'm', region: 'center',
    }),
    /requires options.viewport/
  );
});

test('meshAtViewportPosition: unknown region throws', () => {
  assert.throws(
    () => meshAtViewportPosition(inventoryWithMesh(makeMeshEntry()), {
      phaseKey: 'p', meshName: 'm', region: 'nowhere',
      viewport: { width: 1920, height: 1080 },
    }),
    /unknown region/
  );
});

test('meshAtViewportPosition: missing both region AND xy throws', () => {
  assert.throws(
    () => meshAtViewportPosition(inventoryWithMesh(makeMeshEntry()), {
      phaseKey: 'p', meshName: 'm',
    }),
    /provide either/
  );
});

// ── meshApparentSize ────────────────────────────────────────────────────

test('meshApparentSize: within [min, max] passes', () => {
  const r = meshApparentSize(inventoryWithMesh(makeMeshEntry({ apparentDegrees: 30 })), {
    phaseKey: 'p', meshName: 'm', min: 10, max: 50,
  });
  assert.equal(r.passed, true);
});

test('meshApparentSize: below min fails', () => {
  const r = meshApparentSize(inventoryWithMesh(makeMeshEntry({ apparentDegrees: 5 })), {
    phaseKey: 'p', meshName: 'm', min: 10,
  });
  assert.equal(r.passed, false);
  assert.match(r.violations[0].reason, /outside \[10/);
});

test('meshApparentSize: above max fails', () => {
  const r = meshApparentSize(inventoryWithMesh(makeMeshEntry({ apparentDegrees: 100 })), {
    phaseKey: 'p', meshName: 'm', max: 50,
  });
  assert.equal(r.passed, false);
});

test('meshApparentSize: only min specified, no max → uses Infinity', () => {
  const r = meshApparentSize(inventoryWithMesh(makeMeshEntry({ apparentDegrees: 1000 })), {
    phaseKey: 'p', meshName: 'm', min: 10,
  });
  assert.equal(r.passed, true);
});

test('meshApparentSize: apparentDegrees=null reports specific reason', () => {
  const e = makeMeshEntry({ apparentDegrees: null });
  const r = meshApparentSize(inventoryWithMesh(e), { phaseKey: 'p', meshName: 'm', min: 0, max: 90 });
  assert.equal(r.passed, false);
  assert.match(r.violations[0].reason, /apparentDegrees is null/);
});

// ── cameraNear ──────────────────────────────────────────────────────────

test('cameraNear: distance < max passes', () => {
  const r = cameraNear(inventoryWithMesh(makeMeshEntry({ cameraDistance: 50 })), {
    phaseKey: 'p', meshName: 'm', maxDistance: 100,
  });
  assert.equal(r.passed, true);
});

test('cameraNear: distance > max fails', () => {
  const r = cameraNear(inventoryWithMesh(makeMeshEntry({ cameraDistance: 1e8 })), {
    phaseKey: 'p', meshName: 'm', maxDistance: 1000,
  });
  assert.equal(r.passed, false);
  assert.match(r.violations[0].reason, /cameraDistance=100000000.0 > maxDistance=1000/);
});

test('cameraNear: maxDistance=0 throws', () => {
  assert.throws(
    () => cameraNear(inventoryWithMesh(makeMeshEntry()), {
      phaseKey: 'p', meshName: 'm', maxDistance: 0,
    }),
    /maxDistance must be > 0/
  );
});

test('cameraNear: missing cameraDistance field throws MissingInventoryFieldError', () => {
  const e = makeMeshEntry();
  delete e.cameraDistance;
  assert.throws(
    () => cameraNear(inventoryWithMesh(e), { phaseKey: 'p', meshName: 'm', maxDistance: 100 }),
    MissingInventoryFieldError
  );
});

test('cameraNear: mesh-not-found returns FAIL not throw', () => {
  const r = cameraNear(inventoryWithMesh(makeMeshEntry()), { phaseKey: 'p', meshName: 'absent', maxDistance: 100 });
  assert.equal(r.passed, false);
  assert.match(r.violations[0].reason, /mesh not found/);
});
