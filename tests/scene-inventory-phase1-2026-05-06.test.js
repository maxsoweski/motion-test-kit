// Phase 1 self-tests for the welldipper-scene-inspection-layer-2026-05-06
// extension: multi-scene API, cameras + lights traversal, the 7 host-
// supplied categories, and the 9 new predicates.
//
// Uses synthetic three-shaped objects (duck-typed). The kit doesn't
// depend on THREE; these tests exercise the adapter's contract surface.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeSceneInventory } from '../adapters/three/scene-inventory.js';
import {
  meshVisibleAt,
  meshHiddenAt,
  cameraConfigAt,
  lightActiveAt,
  uniformValueAt,
  clockProgressedSince,
  modeIs,
  renderTargetSize,
  phaseEquals,
  audioPlayingAt,
  inputContains,
} from '../core/inventory/predicates.js';
import { MissingInventoryFieldError } from '../core/inventory/errors.js';

// ─── Synthetic three-shaped builders ────────────────────────────────────

function identityM4() {
  const m = new Float64Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

function makeCamera({ name, fov = 60, aspect = 1.6, near = 0.1, far = 1000, isPerspective = true } = {}) {
  return {
    name: name ?? '',
    type: isPerspective ? 'PerspectiveCamera' : 'OrthographicCamera',
    isCamera: true,
    isPerspectiveCamera: isPerspective,
    isOrthographicCamera: !isPerspective,
    uuid: `cam-${Math.random().toString(36).slice(2, 8)}`,
    fov, aspect, near, far,
    projectionMatrix: { elements: identityM4() },
    matrixWorld: { elements: identityM4() },
    matrixWorldInverse: { elements: identityM4() },
    position: { x: 0, y: 0, z: 0 },
    visible: true,
  };
}

function makeLight({ name, type = 'PointLight', visible = true, intensity = 1, color = 'ffffff' } = {}) {
  return {
    name: name ?? '',
    type,
    isLight: true,
    visible,
    intensity,
    color: { getHexString: () => color, r: 1, g: 1, b: 1 },
    uuid: `light-${Math.random().toString(36).slice(2, 8)}`,
    matrixWorld: { elements: identityM4() },
    position: { x: 0, y: 0, z: 0 },
  };
}

function makeMesh({ name = '', visible = true, frustumCulled = true, sphereRadius = 0.5 } = {}) {
  const m = identityM4();
  return {
    name,
    type: 'Mesh',
    uuid: `mesh-${Math.random().toString(36).slice(2, 8)}`,
    visible,
    frustumCulled,
    matrixWorld: { elements: m },
    layers: { mask: 1 },
    geometry: {
      uuid: 'geo',
      boundingSphere: { center: { x: 0, y: 0, z: 0 }, radius: sphereRadius },
    },
    material: { uuid: 'mat' },
  };
}

function makeScene({ children = [] } = {}) {
  return {
    children,
    traverseVisible(cb) {
      const walk = (node) => {
        if (node.visible === false) return;
        cb(node);
        if (Array.isArray(node.children)) for (const c of node.children) walk(c);
      };
      for (const c of children) walk(c);
    },
    traverse(cb) {
      const walk = (node) => {
        cb(node);
        if (Array.isArray(node.children)) for (const c of node.children) walk(c);
      };
      for (const c of children) walk(c);
    },
  };
}

// ─── Multi-scene API + source tagging ────────────────────────────────────

test('multi-scene: meshes from each scene tagged with their source', () => {
  const mainScene = makeScene({ children: [makeMesh({ name: 'body.planet.earth' })] });
  const skyScene = makeScene({ children: [makeMesh({ name: 'sky.starfield.main', sphereRadius: 100 })] });
  const inv = takeSceneInventory({
    scenes: [
      { name: 'main', scene: mainScene, camera: makeCamera({ name: 'camera.player' }) },
      { name: 'sky',  scene: skyScene,  camera: makeCamera({ name: 'camera.sky' })   },
    ],
  });
  const earth = inv.meshes.find((m) => m.name === 'body.planet.earth');
  const sky = inv.meshes.find((m) => m.name === 'sky.starfield.main');
  assert.ok(earth, 'earth mesh present');
  assert.ok(sky, 'sky mesh present');
  assert.equal(earth.source, 'main');
  assert.equal(sky.source, 'sky');
});

test('legacy single-scene shape still works; mesh source defaults to "main"', () => {
  const scene = makeScene({ children: [makeMesh({ name: 'body.planet.mars' })] });
  const inv = takeSceneInventory({ scene, camera: makeCamera() });
  const mars = inv.meshes.find((m) => m.name === 'body.planet.mars');
  assert.ok(mars);
  assert.equal(mars.source, 'main');
});

test('multi-scene: empty scenes array throws', () => {
  assert.throws(
    () => takeSceneInventory({ scenes: [] }),
    /scenes array must contain at least one entry/,
  );
});

test('multi-scene: duplicate scene names throw', () => {
  const sc = makeScene();
  const cam = makeCamera();
  assert.throws(
    () => takeSceneInventory({
      scenes: [
        { name: 'main', scene: sc, camera: cam },
        { name: 'main', scene: sc, camera: cam },
      ],
    }),
    /duplicate scene name 'main'/,
  );
});

test('multi-scene: missing both shapes throws', () => {
  assert.throws(
    () => takeSceneInventory({}),
    /provide either \{ scenes:/,
  );
});

// ─── Cameras + lights traversal ──────────────────────────────────────────

test('cameras: explicit per-scene camera collected even when not on scene-graph', () => {
  const scene = makeScene();
  const cam = makeCamera({ name: 'camera.player' });
  const inv = takeSceneInventory({ scene, camera: cam });
  assert.equal(inv.cameras.length, 1);
  assert.equal(inv.cameras[0].name, 'camera.player');
  assert.equal(inv.cameras[0].source, 'main');
  assert.equal(inv.cameras[0].fov, 60);
});

test('cameras: scene-graph cameras traversed; deduplication by uuid', () => {
  const cam = makeCamera({ name: 'camera.player' });
  const scene = makeScene({ children: [cam] });   // camera attached to scene
  const inv = takeSceneInventory({ scene, camera: cam });   // same camera passed
  assert.equal(inv.cameras.length, 1, 'no duplicate from traverse + explicit');
});

test('lights: traversed via .isLight duck-type with source tag', () => {
  const sun = makeLight({ name: 'light.star.sol', intensity: 1.5 });
  const ambient = makeLight({ name: 'light.ambient.system', intensity: 0.2, type: 'AmbientLight' });
  const scene = makeScene({ children: [sun, ambient] });
  const inv = takeSceneInventory({ scene, camera: makeCamera() });
  assert.equal(inv.lights.length, 2);
  const star = inv.lights.find((l) => l.name === 'light.star.sol');
  assert.equal(star.intensity, 1.5);
  assert.equal(star.source, 'main');
  assert.equal(star.color, 'ffffff');
});

// ─── Materials watchlist ─────────────────────────────────────────────────

test('materials: declared watchlist captures uniform values; missing uniforms record null', () => {
  const material = {
    uniforms: {
      uTime: { value: 12.34 },
      uPhase: { value: 'hyper' },
      uColor: { value: { r: 1, g: 0.5, b: 0.2 } },
      uPos: { value: { x: 1, y: 2, z: 3 } },
    },
    transparent: true,
    depthTest: true,
  };
  const inv = takeSceneInventory({
    scene: makeScene(),
    camera: makeCamera(),
    materials: [
      { role: 'warp.tunnel', material, watch: ['uTime', 'uPhase', 'uColor', 'uPos', 'uMissing'] },
    ],
  });
  assert.equal(inv.materials.length, 1);
  const m = inv.materials[0];
  assert.equal(m.role, 'warp.tunnel');
  assert.equal(m.uniforms.uTime, 12.34);
  assert.equal(m.uniforms.uPhase, 'hyper');
  assert.deepEqual(m.uniforms.uColor, { r: 1, g: 0.5, b: 0.2 });
  assert.deepEqual(m.uniforms.uPos, { x: 1, y: 2, z: 3 });
  assert.equal(m.uniforms.uMissing, null, 'missing uniform recorded as null (not undefined)');
  assert.equal(m.transparent, true);
});

test('materials: throws when missing role', () => {
  assert.throws(
    () => takeSceneInventory({
      scene: makeScene(), camera: makeCamera(),
      materials: [{ material: { uniforms: {} }, watch: [] }],
    }),
    /materials\[i\]\.role/,
  );
});

// ─── Clocks / modes / phases / renderTargets / audio / input ─────────────

test('clocks: numerical values captured; non-number values dropped', () => {
  const inv = takeSceneInventory({
    scene: makeScene(), camera: makeCamera(),
    clocks: { warp: 12.4, beat: 0, broken: 'oops' },
  });
  assert.equal(inv.clocks.warp, 12.4);
  assert.equal(inv.clocks.beat, 0);
  assert.equal('broken' in inv.clocks, false);
});

test('modes: string values captured; arrays-as-input throw', () => {
  const inv = takeSceneInventory({
    scene: makeScene(), camera: makeCamera(),
    modes: { viewport: 'system', pipeline: 'composer', dropMe: 42 },
  });
  assert.equal(inv.modes.viewport, 'system');
  assert.equal('dropMe' in inv.modes, false);
  assert.throws(
    () => takeSceneInventory({
      scene: makeScene(), camera: makeCamera(),
      modes: ['system'],   // wrong shape — must be Record
    }),
    /modes must be a plain object/,
  );
});

test('phases: cross-system map captured', () => {
  const inv = takeSceneInventory({
    scene: makeScene(), camera: makeCamera(),
    phases: { autopilot: 'CRUISE', warp: 'idle' },
  });
  assert.deepEqual(inv.phases, { autopilot: 'CRUISE', warp: 'idle' });
});

test('renderTargets: name + dimensions + samples captured', () => {
  const target = { width: 1920, height: 1080, depthBuffer: true, samples: 4, texture: { uuid: 't1' } };
  const inv = takeSceneInventory({
    scene: makeScene(), camera: makeCamera(),
    renderTargets: [{ name: 'composer.read', target }],
  });
  assert.equal(inv.renderTargets.length, 1);
  assert.equal(inv.renderTargets[0].name, 'composer.read');
  assert.equal(inv.renderTargets[0].width, 1920);
  assert.equal(inv.renderTargets[0].samples, 4);
  assert.equal(inv.renderTargets[0].textureUuid, 't1');
});

test('audio: per-track playback state captured', () => {
  const inv = takeSceneInventory({
    scene: makeScene(), camera: makeCamera(),
    audio: [
      { track: 'bgm', isPlaying: true, currentTime: 12.4, volume: 0.8 },
      { track: 'warp-rumble', isPlaying: false },
    ],
  });
  assert.equal(inv.audio.length, 2);
  assert.equal(inv.audio[0].isPlaying, true);
  assert.equal(inv.audio[1].volume, 0);
});

test('input: JSON-serializable record captured; non-serializable throws', () => {
  const inv = takeSceneInventory({
    scene: makeScene(), camera: makeCamera(),
    input: { 'held-keys': ['Space', 'W'], 'last-action': 'fire' },
  });
  assert.deepEqual(inv.input['held-keys'], ['Space', 'W']);
  assert.equal(inv.input['last-action'], 'fire');

  // Cyclic input should fail loudly.
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(
    () => takeSceneInventory({ scene: makeScene(), camera: makeCamera(), input: cyclic }),
    /not JSON-serializable/,
  );
});

test('opt-in: categories absent from options are omitted from inventory (not [])', () => {
  const inv = takeSceneInventory({ scene: makeScene(), camera: makeCamera() });
  // Always-present:
  assert.ok(Array.isArray(inv.cameras));
  assert.ok(Array.isArray(inv.lights));
  // Opt-in fields: must be undefined when not passed.
  assert.equal('materials' in inv, false);
  assert.equal('clocks' in inv, false);
  assert.equal('modes' in inv, false);
  assert.equal('renderTargets' in inv, false);
  assert.equal('phases' in inv, false);
  assert.equal('audio' in inv, false);
  assert.equal('input' in inv, false);
});

// ─── Mesh predicates with source filter ──────────────────────────────────

test('meshVisibleAt: source filter scopes lookup to that scene', () => {
  // Two scenes, two meshes named the same. Source must disambiguate.
  const earthMain = makeMesh({ name: 'body.planet.earth' });
  const earthSky = makeMesh({ name: 'body.planet.earth' });
  earthSky.visible = false;

  const inv = takeSceneInventory({
    scenes: [
      { name: 'main', scene: makeScene({ children: [earthMain] }), camera: makeCamera() },
      { name: 'sky',  scene: makeScene({ children: [earthSky] }),  camera: makeCamera() },
    ],
  });
  const invs = new Map([['T0', inv]]);
  // Without source: finds main (first match).
  assert.equal(meshVisibleAt(invs, { phaseKey: 'T0', meshName: 'body.planet.earth' }).passed, true);
  // With source='sky': finds the hidden one.
  assert.equal(meshVisibleAt(invs, { phaseKey: 'T0', meshName: 'body.planet.earth', source: 'sky' }).passed, false);
  // With source='nonexistent': mesh-not-found.
  const r = meshVisibleAt(invs, { phaseKey: 'T0', meshName: 'body.planet.earth', source: 'nonexistent' });
  assert.equal(r.passed, false);
  assert.match(r.violations[0].reason, /not found/);
});

// ─── New predicates: PASS + FAIL paths ───────────────────────────────────

const exampleInv = {
  meshes: [],
  cameras: [
    { name: 'camera.player', type: 'PerspectiveCamera', uuid: 'c1', source: 'main',
      fov: 60, aspect: 1.6, near: 0.1, far: 1000, isOrthographic: false, worldPos: [0,0,0] },
  ],
  lights: [
    { name: 'light.star.sol', type: 'PointLight', uuid: 'l1', source: 'main',
      visible: true, intensity: 1.5, color: 'ffffff', worldPos: [0,0,0] },
    { name: 'light.dim', type: 'PointLight', uuid: 'l2', source: 'main',
      visible: true, intensity: 0.05, color: 'ffffff', worldPos: [0,0,0] },
  ],
  materials: [
    { role: 'warp.tunnel', uniforms: { uTime: 12.4, uPhase: 'hyper', uMissing: null }, transparent: true, depthTest: true, depthWrite: true, blending: null, visible: true },
  ],
  clocks: { warp: 5.0 },
  modes: { viewport: 'system' },
  renderTargets: [
    { name: 'composer.read', width: 1920, height: 1080, depthBuffer: true, samples: 4, textureUuid: 't1' },
  ],
  phases: { autopilot: 'CRUISE', warp: 'idle' },
  audio: [
    { track: 'bgm', isPlaying: true, currentTime: 12.4, volume: 0.8 },
  ],
  input: { 'held-keys': ['Space', 'W'], 'last-action': 'fire' },
};
const laterInv = { ...exampleInv, clocks: { warp: 7.5 } };
const invs = new Map([['T0', exampleInv], ['T1', laterInv]]);

test('cameraConfigAt: PASS on matching fov/aspect; FAIL on mismatch', () => {
  assert.equal(cameraConfigAt(invs, { phaseKey: 'T0', cameraRole: 'camera.player', expected: { fov: 60, aspect: 1.6 } }).passed, true);
  const r = cameraConfigAt(invs, { phaseKey: 'T0', cameraRole: 'camera.player', expected: { fov: 90 } });
  assert.equal(r.passed, false);
  assert.equal(r.violations[0].field, 'fov');
});

test('cameraConfigAt: FAIL with role-not-found when camera missing', () => {
  const r = cameraConfigAt(invs, { phaseKey: 'T0', cameraRole: 'camera.gallery', expected: { fov: 60 } });
  assert.equal(r.passed, false);
  assert.match(r.violations[0].reason, /not found/);
});

test('cameraConfigAt: throws on missing inventory.cameras field', () => {
  const bad = new Map([['T0', { meshes: [] /* no cameras field */ }]]);
  assert.throws(() => cameraConfigAt(bad, { phaseKey: 'T0', cameraRole: 'x', expected: { fov: 60 } }), MissingInventoryFieldError);
});

test('lightActiveAt: PASS at default intensityMin=0; FAIL at intensityMin=1.0 for dim light', () => {
  assert.equal(lightActiveAt(invs, { phaseKey: 'T0', lightId: 'light.star.sol' }).passed, true);
  const r = lightActiveAt(invs, { phaseKey: 'T0', lightId: 'light.dim', intensityMin: 1.0 });
  assert.equal(r.passed, false);
  assert.match(r.violations[0].reason, /below threshold/);
});

test('uniformValueAt: PASS on numeric within tolerance; FAIL on absent uniform', () => {
  assert.equal(uniformValueAt(invs, { phaseKey: 'T0', materialRole: 'warp.tunnel', uniformName: 'uTime', expected: 12.4 }).passed, true);
  // tolerance respected
  assert.equal(uniformValueAt(invs, { phaseKey: 'T0', materialRole: 'warp.tunnel', uniformName: 'uTime', expected: 12.4001, tolerance: 1e-3 }).passed, true);
  // string uniform strict-equal
  assert.equal(uniformValueAt(invs, { phaseKey: 'T0', materialRole: 'warp.tunnel', uniformName: 'uPhase', expected: 'hyper' }).passed, true);
  // missing uniform → distinct failure mode
  const r = uniformValueAt(invs, { phaseKey: 'T0', materialRole: 'warp.tunnel', uniformName: 'uMissing', expected: 0 });
  assert.equal(r.passed, false);
  assert.match(r.violations[0].reason, /declared in watch but absent/);
});

test('clockProgressedSince: PASS when clock advanced past min; FAIL when not enough', () => {
  assert.equal(clockProgressedSince(invs, { phaseKey: 'T1', sincePhase: 'T0', clockSystem: 'warp', byMinSeconds: 1.0 }).passed, true);
  const r = clockProgressedSince(invs, { phaseKey: 'T1', sincePhase: 'T0', clockSystem: 'warp', byMinSeconds: 5.0 });
  assert.equal(r.passed, false);
  assert.equal(r.violations[0].delta, 2.5);
});

test('modeIs: PASS on equal; FAIL on slot-not-found', () => {
  assert.equal(modeIs(invs, { phaseKey: 'T0', slot: 'viewport', expected: 'system' }).passed, true);
  const r = modeIs(invs, { phaseKey: 'T0', slot: 'nonexistent', expected: 'x' });
  assert.equal(r.passed, false);
  assert.match(r.violations[0].reason, /not found/);
});

test('renderTargetSize: PASS on exact match; FAIL on mismatch', () => {
  assert.equal(renderTargetSize(invs, { phaseKey: 'T0', rtName: 'composer.read', expected: [1920, 1080] }).passed, true);
  const r = renderTargetSize(invs, { phaseKey: 'T0', rtName: 'composer.read', expected: [3840, 2160] });
  assert.equal(r.passed, false);
});

test('phaseEquals: PASS on cross-system coherence; FAIL on mismatch', () => {
  assert.equal(phaseEquals(invs, { phaseKey: 'T0', system: 'autopilot', expected: 'CRUISE' }).passed, true);
  const r = phaseEquals(invs, { phaseKey: 'T0', system: 'warp', expected: 'hyper' });
  assert.equal(r.passed, false);
  assert.equal(r.violations[0].got, 'idle');
});

test('audioPlayingAt: PASS when track playing; FAIL when not in inventory', () => {
  assert.equal(audioPlayingAt(invs, { phaseKey: 'T0', track: 'bgm' }).passed, true);
  assert.equal(audioPlayingAt(invs, { phaseKey: 'T0', track: 'nonexistent' }).passed, false);
});

test('inputContains: array uses .includes; string uses substring; other uses strict-equal', () => {
  assert.equal(inputContains(invs, { phaseKey: 'T0', kind: 'held-keys', expected: 'Space' }).passed, true);
  assert.equal(inputContains(invs, { phaseKey: 'T0', kind: 'held-keys', expected: 'X' }).passed, false);
  assert.equal(inputContains(invs, { phaseKey: 'T0', kind: 'last-action', expected: 'fir' }).passed, true);
  assert.equal(inputContains(invs, { phaseKey: 'T0', kind: 'last-action', expected: 'noop' }).passed, false);
});

// ─── Pure-data invariant for new categories ──────────────────────────────

test('pure-data: full inventory with all 9 categories is JSON.stringify safe', () => {
  const inv = takeSceneInventory({
    scenes: [{ name: 'main', scene: makeScene({ children: [makeMesh({ name: 'body.star.sol' }), makeLight({ name: 'light.star.sol' })] }), camera: makeCamera({ name: 'camera.player' }) }],
    materials: [{ role: 'r', material: { uniforms: { u: { value: 1 } } }, watch: ['u'] }],
    clocks: { c: 1 },
    modes: { m: 'x' },
    phases: { p: 'a' },
    renderTargets: [{ name: 'rt', target: { width: 100, height: 100 } }],
    audio: [{ track: 'a', isPlaying: true }],
    input: { k: ['v'] },
  });
  const json = JSON.stringify(inv);
  const round = JSON.parse(json);
  assert.deepEqual(round.cameras.length, inv.cameras.length);
  assert.equal(typeof round.materials[0].uniforms.u, 'number');
});
