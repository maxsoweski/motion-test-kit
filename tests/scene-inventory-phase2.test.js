// Phase 2 self-tests for scene-inventory:
// - AC #7: composer pass enumeration
// - AC #8: renderer.info aggregate
// - AC #9: overlay-registry integration
// - AC #10: sample-capture inventory pass-through
// - AC #11: withPhaseBoundaryInventory + everyN + everyFrame cadence helpers

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  takeSceneInventory,
  withPhaseBoundaryInventory,
  everyN,
  everyFrame,
} from '../adapters/three/scene-inventory.js';
import { createOverlayRegistry } from '../adapters/dom/overlay-registry.js';
import { captureFrame, bindCaptureToBuffer } from '../adapters/three/sample-capture.js';
import { createRingBuffer } from '../core/recorder/ring-buffer.js';

// ─── Synthetic three-shape helpers (re-used pattern from Phase 1 tests) ──

function makeIdentityMatrix4() {
  const m = { elements: new Float64Array(16) };
  m.elements[0] = 1; m.elements[5] = 1; m.elements[10] = 1; m.elements[15] = 1;
  return m;
}

function makeIdentityCamera() {
  return {
    projectionMatrix: makeIdentityMatrix4(),
    matrixWorldInverse: makeIdentityMatrix4(),
  };
}

function makeMesh({ name }) {
  return {
    name, type: 'Mesh', uuid: `m-${name}`,
    visible: true, frustumCulled: true,
    matrixWorld: makeIdentityMatrix4(),
    position: { x: 0, y: 0, z: 0 },
    geometry: { uuid: `g-${name}`, boundingSphere: { center: { x: 0, y: 0, z: 0 }, radius: 0.3 } },
    material: { uuid: `mat-${name}` },
    layers: { mask: 1 },
  };
}

function makeScene(meshes) {
  return {
    traverseVisible(cb) {
      for (const m of meshes) if (m.visible !== false) cb(m);
    },
  };
}

// ─── AC #7: composer pass enumeration ────────────────────────────────────

test('takeSceneInventory: composer.passes enumerated when composer passed', () => {
  const composer = {
    passes: [
      { constructor: { name: 'RenderPass' }, enabled: true, renderToScreen: false, needsSwap: true },
      { constructor: { name: 'GlowPass' }, enabled: false, renderToScreen: false, needsSwap: true },
      { name: 'CustomPass', enabled: true, renderToScreen: true, needsSwap: false },
    ],
  };
  const inv = takeSceneInventory({ scene: makeScene([]), camera: makeIdentityCamera(), composer });
  assert.equal(inv.composerPasses.length, 3);
  assert.equal(inv.composerPasses[0].name, 'RenderPass');
  assert.equal(inv.composerPasses[0].enabled, true);
  assert.equal(inv.composerPasses[1].enabled, false);
  assert.equal(inv.composerPasses[2].name, 'CustomPass');
  assert.equal(inv.composerPasses[2].renderToScreen, true);
});

test('takeSceneInventory: composer omitted produces no composerPasses field', () => {
  const inv = takeSceneInventory({ scene: makeScene([]), camera: makeIdentityCamera() });
  assert.equal(inv.composerPasses, undefined);
});

test('takeSceneInventory: composer.passes undefined silently omits field', () => {
  const inv = takeSceneInventory({ scene: makeScene([]), camera: makeIdentityCamera(), composer: { /* no passes */ } });
  assert.equal(inv.composerPasses, undefined);
});

// ─── AC #8: renderer.info aggregate ──────────────────────────────────────

test('takeSceneInventory: renderer.info captured when renderer passed', () => {
  const renderer = {
    info: {
      render: { calls: 42, triangles: 12345, points: 100, lines: 50 },
      memory: { geometries: 7, textures: 9 },
      programs: [{}, {}, {}],
    },
  };
  const inv = takeSceneInventory({ scene: makeScene([]), camera: makeIdentityCamera(), renderer });
  assert.deepEqual(inv.rendererInfo, {
    drawCalls: 42, triangles: 12345, points: 100, lines: 50,
    programs: 3, geometries: 7, textures: 9,
  });
});

test('takeSceneInventory: renderer omitted produces no rendererInfo field', () => {
  const inv = takeSceneInventory({ scene: makeScene([]), camera: makeIdentityCamera() });
  assert.equal(inv.rendererInfo, undefined);
});

// ─── AC #9: overlayRegistry integration ──────────────────────────────────

test('takeSceneInventory: overlayRegistry.snapshot() pulled into domOverlays', () => {
  const fakeRegistry = {
    snapshot() {
      return [
        { id: 'reticle', visible: true, opacity: 1, display: 'block' },
        { id: 'splash', visible: false, opacity: 0, display: 'none' },
      ];
    },
  };
  const inv = takeSceneInventory({ scene: makeScene([]), camera: makeIdentityCamera(), overlayRegistry: fakeRegistry });
  assert.equal(inv.domOverlays.length, 2);
  assert.equal(inv.domOverlays[0].id, 'reticle');
  assert.equal(inv.domOverlays[1].visible, false);
});

test('takeSceneInventory: overlayRegistry omitted produces no domOverlays field', () => {
  const inv = takeSceneInventory({ scene: makeScene([]), camera: makeIdentityCamera() });
  assert.equal(inv.domOverlays, undefined);
});

test('takeSceneInventory: overlayRegistry returning empty array produces empty domOverlays (distinguishable from omitted)', () => {
  const fakeRegistry = { snapshot() { return []; } };
  const inv = takeSceneInventory({ scene: makeScene([]), camera: makeIdentityCamera(), overlayRegistry: fakeRegistry });
  assert.ok(Array.isArray(inv.domOverlays));
  assert.equal(inv.domOverlays.length, 0);
});

test('takeSceneInventory: full options — composer + renderer + overlayRegistry all populated', () => {
  const composer = { passes: [{ name: 'p1', enabled: true }] };
  const renderer = { info: { render: { calls: 1, triangles: 2, points: 3, lines: 4 }, memory: {}, programs: [] } };
  const fakeRegistry = { snapshot() { return [{ id: 'ui', visible: true, opacity: 1, display: 'block' }]; } };
  const inv = takeSceneInventory({
    scene: makeScene([makeMesh({ name: 'thing' })]),
    camera: makeIdentityCamera(),
    composer, renderer, overlayRegistry: fakeRegistry,
  });
  assert.equal(inv.meshes.length, 1);
  assert.equal(inv.composerPasses.length, 1);
  assert.equal(inv.rendererInfo.drawCalls, 1);
  assert.equal(inv.domOverlays.length, 1);
});

// ─── AC #10: sample-capture inventory pass-through ───────────────────────

test('captureFrame: inventory passed through into SampleRecord', () => {
  const inv = { meshes: [{ name: 'mesh1', visible: true, inFrustum: true }] };
  const sample = captureFrame({
    frame: 0, t: 100, dt: 16,
    anchor: { position: { x: 1, y: 2, z: 3 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } },
    inventory: inv,
  });
  assert.deepEqual(sample.inventory, inv);
});

test('captureFrame: inventory omitted means no inventory field on record', () => {
  const sample = captureFrame({
    frame: 0, t: 100, dt: 16,
    anchor: { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } },
  });
  assert.equal(sample.inventory, undefined);
});

test('bindCaptureToBuffer.tick: inventory pulled from extras + attached to sample', () => {
  const buffer = createRingBuffer({ capacity: 10 });
  const recorder = bindCaptureToBuffer({ buffer });
  const inv = { meshes: [] };
  const sample = recorder.tick(100, { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }, { inventory: inv });
  assert.deepEqual(sample.inventory, inv);
});

// ─── AC #11: cadence helpers ─────────────────────────────────────────────

function makeRecorder() {
  const buffer = createRingBuffer({ capacity: 100 });
  return bindCaptureToBuffer({ buffer });
}

function makeAnchor() {
  return { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
}

test('withPhaseBoundaryInventory: snapshot taken at first tick AND on state transition', () => {
  const recorder = makeRecorder();
  const wrapper = withPhaseBoundaryInventory({
    recorder,
    scene: makeScene([makeMesh({ name: 'thing' })]),
    camera: makeIdentityCamera(),
    stateFieldPath: 'phase',
  });
  // First tick — inventory attached
  let s = wrapper.tick(0, makeAnchor(), { state: { phase: 'idle' } });
  assert.ok(s.inventory, 'first-tick inventory present');
  // Same phase — no inventory
  s = wrapper.tick(16, makeAnchor(), { state: { phase: 'idle' } });
  assert.equal(s.inventory, undefined, 'no inventory on same-phase tick');
  // Transition — inventory attached
  s = wrapper.tick(32, makeAnchor(), { state: { phase: 'fold' } });
  assert.ok(s.inventory, 'transition inventory present');
  // Same phase again — no inventory
  s = wrapper.tick(48, makeAnchor(), { state: { phase: 'fold' } });
  assert.equal(s.inventory, undefined);
});

test('withPhaseBoundaryInventory: stateFieldPath required', () => {
  assert.throws(
    () => withPhaseBoundaryInventory({ recorder: makeRecorder(), scene: makeScene([]), camera: makeIdentityCamera() }),
    /stateFieldPath/,
  );
});

test('withPhaseBoundaryInventory: dotted path resolves nested state', () => {
  const recorder = makeRecorder();
  const wrapper = withPhaseBoundaryInventory({
    recorder,
    scene: makeScene([]),
    camera: makeIdentityCamera(),
    stateFieldPath: 'autopilot.phase',
  });
  let s = wrapper.tick(0, makeAnchor(), { state: { autopilot: { phase: 'cruise' } } });
  assert.ok(s.inventory);
  s = wrapper.tick(16, makeAnchor(), { state: { autopilot: { phase: 'cruise' } } });
  assert.equal(s.inventory, undefined);
  s = wrapper.tick(32, makeAnchor(), { state: { autopilot: { phase: 'station' } } });
  assert.ok(s.inventory);
});

test('withPhaseBoundaryInventory: reset re-arms first-tick capture', () => {
  const recorder = makeRecorder();
  const wrapper = withPhaseBoundaryInventory({
    recorder, scene: makeScene([]), camera: makeIdentityCamera(), stateFieldPath: 'p',
  });
  let s = wrapper.tick(0, makeAnchor(), { state: { p: 'a' } });
  assert.ok(s.inventory);
  wrapper.reset();
  s = wrapper.tick(0, makeAnchor(), { state: { p: 'a' } });
  assert.ok(s.inventory, 'after reset, first-tick captures again');
});

test('everyN: snapshots at frames 0, N, 2N, ...', () => {
  const recorder = makeRecorder();
  const wrapper = everyN(3, { recorder, scene: makeScene([]), camera: makeIdentityCamera() });
  const sampleHasInv = (i) => !!wrapper.tick(i * 16, makeAnchor()).inventory;
  assert.equal(sampleHasInv(0), true);
  assert.equal(sampleHasInv(1), false);
  assert.equal(sampleHasInv(2), false);
  assert.equal(sampleHasInv(3), true);
  assert.equal(sampleHasInv(4), false);
  assert.equal(sampleHasInv(5), false);
  assert.equal(sampleHasInv(6), true);
});

test('everyN: throws on non-positive n', () => {
  assert.throws(() => everyN(0, { recorder: makeRecorder(), scene: makeScene([]), camera: makeIdentityCamera() }), /positive integer/);
  assert.throws(() => everyN(-1, { recorder: makeRecorder(), scene: makeScene([]), camera: makeIdentityCamera() }), /positive integer/);
});

test('everyFrame: snapshots every tick', () => {
  const recorder = makeRecorder();
  const wrapper = everyFrame({ recorder, scene: makeScene([]), camera: makeIdentityCamera() });
  for (let i = 0; i < 5; i++) {
    const s = wrapper.tick(i * 16, makeAnchor());
    assert.ok(s.inventory, `frame ${i} should have inventory`);
  }
});

test('cadence: reset clears counter', () => {
  const recorder = makeRecorder();
  const wrapper = everyN(3, { recorder, scene: makeScene([]), camera: makeIdentityCamera() });
  wrapper.tick(0, makeAnchor()); // counter = 0 → captured
  wrapper.tick(16, makeAnchor()); // counter = 1
  wrapper.tick(32, makeAnchor()); // counter = 2
  wrapper.reset();
  const s = wrapper.tick(48, makeAnchor()); // counter = 0 → captured
  assert.ok(s.inventory);
});
