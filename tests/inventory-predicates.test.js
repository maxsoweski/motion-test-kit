// Phase 3 self-tests: inventory predicates + diff API + snapshotAtPhaseBoundaries.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  meshVisibleAt,
  meshHiddenAt,
  overlayVisibleAt,
  overlayHiddenAt,
  passEnabledAt,
  drawCallBudget,
  triangleBudget,
  snapshotAtPhaseBoundaries,
} from '../core/inventory/predicates.js';
import { diffInventories } from '../core/inventory/diff.js';
import { MissingInventoryFieldError, InventoryEntityNotFoundError } from '../core/inventory/errors.js';

// Test fixtures
const invHyper = {
  meshes: [
    { name: 'tunnelMesh', type: 'Mesh', visible: true, inFrustum: true, frustumCulled: true, worldPos: [0,0,0], uuid: 'u1', layer: 1, materialUuid: 'm1', geometryUuid: 'g1' },
    { name: 'starfield', type: 'Points', visible: true, inFrustum: true, frustumCulled: true, worldPos: [0,0,-100], uuid: 'u2', layer: 1, materialUuid: 'm2', geometryUuid: 'g2' },
  ],
  domOverlays: [
    { id: 'reticle', visible: false, opacity: 0, display: 'none' },
    { id: 'speedometer', visible: true, opacity: 1, display: 'block' },
  ],
  composerPasses: [
    { name: 'RenderPass', enabled: true, renderToScreen: false, needsSwap: true },
    { name: 'GlowPass', enabled: false, renderToScreen: true, needsSwap: false },
  ],
  rendererInfo: { drawCalls: 30, triangles: 5000, points: 1000, lines: 0, programs: 5, geometries: 10, textures: 8 },
};
const invExit = {
  meshes: [
    { name: 'starfield', type: 'Points', visible: true, inFrustum: true, frustumCulled: true, worldPos: [0,0,-100], uuid: 'u2', layer: 1, materialUuid: 'm2', geometryUuid: 'g2' },
    { name: 'sunMesh', type: 'Mesh', visible: true, inFrustum: true, frustumCulled: true, worldPos: [0,0,-200], uuid: 'u3', layer: 1, materialUuid: 'm3', geometryUuid: 'g3' },
  ],
  domOverlays: [
    { id: 'reticle', visible: true, opacity: 1, display: 'block' },
  ],
  composerPasses: [
    { name: 'RenderPass', enabled: true, renderToScreen: false, needsSwap: true },
    { name: 'GlowPass', enabled: true, renderToScreen: true, needsSwap: false },
  ],
  rendererInfo: { drawCalls: 35, triangles: 6500, points: 1000, lines: 0, programs: 5, geometries: 11, textures: 8 },
};
const invs = new Map([['HYPER', invHyper], ['EXIT', invExit]]);

// ─── meshVisibleAt / meshHiddenAt ────────────────────────────────────────

test('meshVisibleAt: PASS when mesh is visible AND inFrustum', () => {
  const r = meshVisibleAt(invs, { phaseKey: 'HYPER', meshName: 'tunnelMesh' });
  assert.equal(r.passed, true);
  assert.equal(r.violations.length, 0);
});

test('meshVisibleAt: FAIL when mesh absent at phase', () => {
  const r = meshVisibleAt(invs, { phaseKey: 'EXIT', meshName: 'tunnelMesh' });
  assert.equal(r.passed, false);
  assert.equal(r.violations.length, 1);
  assert.match(r.violations[0].reason, /not found/);
});

test('meshHiddenAt: PASS when mesh absent', () => {
  const r = meshHiddenAt(invs, { phaseKey: 'EXIT', meshName: 'tunnelMesh' });
  assert.equal(r.passed, true);
});

test('meshHiddenAt: FAIL when mesh visible+inFrustum at phase', () => {
  const r = meshHiddenAt(invs, { phaseKey: 'HYPER', meshName: 'tunnelMesh' });
  assert.equal(r.passed, false);
  assert.match(r.violations[0].reason, /expected hidden/);
});

test('meshVisibleAt: violation flags unnamed-meshes-present when mesh not found', () => {
  const invWithUnnamed = { meshes: [{ name: '', visible: true, inFrustum: true, frustumCulled: true, worldPos: [0,0,0], uuid: 'x', layer: 1, materialUuid: '', geometryUuid: '' }] };
  const m = new Map([['X', invWithUnnamed]]);
  const r = meshVisibleAt(m, { phaseKey: 'X', meshName: 'tunnelMesh' });
  assert.equal(r.passed, false);
  assert.match(r.violations[0].reason, /unnamed meshes present/);
});

test('meshVisibleAt: throws on missing inventory.meshes', () => {
  const m = new Map([['X', { /* no meshes */ }]]);
  assert.throws(() => meshVisibleAt(m, { phaseKey: 'X', meshName: 'foo' }), MissingInventoryFieldError);
});

test('meshVisibleAt: throws InventoryEntityNotFoundError on missing phase', () => {
  assert.throws(() => meshVisibleAt(invs, { phaseKey: 'NOPE', meshName: 'x' }), InventoryEntityNotFoundError);
});

// ─── overlayVisibleAt / overlayHiddenAt ──────────────────────────────────

test('overlayVisibleAt: PASS for visible overlay', () => {
  const r = overlayVisibleAt(invs, { phaseKey: 'HYPER', overlayId: 'speedometer' });
  assert.equal(r.passed, true);
});

test('overlayVisibleAt: FAIL for hidden overlay', () => {
  const r = overlayVisibleAt(invs, { phaseKey: 'HYPER', overlayId: 'reticle' });
  assert.equal(r.passed, false);
  assert.match(r.violations[0].reason, /not visible/);
});

test('overlayHiddenAt: PASS for hidden overlay (the regression-reproducer pattern)', () => {
  const r = overlayHiddenAt(invs, { phaseKey: 'HYPER', overlayId: 'reticle' });
  assert.equal(r.passed, true);
});

test('overlayHiddenAt: FAIL for visible overlay', () => {
  const r = overlayHiddenAt(invs, { phaseKey: 'EXIT', overlayId: 'reticle' });
  assert.equal(r.passed, false);
});

// ─── passEnabledAt ───────────────────────────────────────────────────────

test('passEnabledAt: PASS for enabled pass', () => {
  const r = passEnabledAt(invs, { phaseKey: 'HYPER', passName: 'RenderPass' });
  assert.equal(r.passed, true);
});

test('passEnabledAt: FAIL for disabled pass', () => {
  const r = passEnabledAt(invs, { phaseKey: 'HYPER', passName: 'GlowPass' });
  assert.equal(r.passed, false);
});

// ─── drawCallBudget / triangleBudget ─────────────────────────────────────

test('drawCallBudget: PASS when under bound at named phase', () => {
  const r = drawCallBudget(invs, { phaseKey: 'HYPER', max: 50 });
  assert.equal(r.passed, true);
});

test('drawCallBudget: FAIL when over bound', () => {
  const r = drawCallBudget(invs, { phaseKey: 'EXIT', max: 30 });
  assert.equal(r.passed, false);
  assert.equal(r.violations[0].value, 35);
});

test('drawCallBudget: omitted phaseKey checks ALL phases', () => {
  const r = drawCallBudget(invs, { max: 32 });
  assert.equal(r.passed, false);
  assert.equal(r.violations.length, 1); // EXIT exceeds; HYPER does not
  assert.equal(r.totalSamples, 2);
});

test('triangleBudget: PASS', () => {
  const r = triangleBudget(invs, { max: 7000 });
  assert.equal(r.passed, true);
});

test('triangleBudget: FAIL', () => {
  const r = triangleBudget(invs, { phaseKey: 'EXIT', max: 6000 });
  assert.equal(r.passed, false);
});

// ─── diffInventories ─────────────────────────────────────────────────────

test('diffInventories: meshes appeared/disappeared between phases', () => {
  const d = diffInventories(invHyper, invExit);
  assert.deepEqual(d.appearedMeshes, ['sunMesh']);
  assert.deepEqual(d.disappearedMeshes, ['tunnelMesh']);
});

test('diffInventories: overlays appeared/disappeared', () => {
  const d = diffInventories(invHyper, invExit);
  assert.deepEqual(d.appearedOverlays, ['reticle']); // HYPER had it hidden; EXIT visible
  assert.deepEqual(d.disappearedOverlays, ['speedometer']); // HYPER visible; EXIT absent
});

test('diffInventories: passes enabled/disabled', () => {
  const d = diffInventories(invHyper, invExit);
  assert.deepEqual(d.enabledPasses, ['GlowPass']);
  assert.deepEqual(d.disabledPasses, []);
});

test('diffInventories: numerical aggregate deltas', () => {
  const d = diffInventories(invHyper, invExit);
  assert.equal(d.drawCallDelta, 5);
  assert.equal(d.triangleDelta, 1500);
});

test('diffInventories: pure function — same inputs yield same output', () => {
  const a = diffInventories(invHyper, invExit);
  const b = diffInventories(invHyper, invExit);
  assert.deepEqual(a, b);
});

test('diffInventories: handles empty inventories', () => {
  const d = diffInventories({ meshes: [] }, { meshes: [] });
  assert.deepEqual(d.appearedMeshes, []);
  assert.deepEqual(d.disappearedMeshes, []);
  assert.equal(d.drawCallDelta, 0);
});

// ─── snapshotAtPhaseBoundaries ───────────────────────────────────────────

test('snapshotAtPhaseBoundaries: returns Map keyed by phase, finds first sample per phase', () => {
  const samples = [
    { state: { phase: 'idle' }, inventory: { meshes: [{ name: 'a', visible: true, inFrustum: true }] } },
    { state: { phase: 'fold' }, inventory: { meshes: [{ name: 'b', visible: true, inFrustum: true }] } },
    { state: { phase: 'fold' }, inventory: { meshes: [{ name: 'c', visible: true, inFrustum: true }] } },
    { state: { phase: 'hyper' }, inventory: { meshes: [{ name: 'tunnel', visible: true, inFrustum: true }] } },
  ];
  const m = snapshotAtPhaseBoundaries(samples, ['fold', 'hyper'], 'phase');
  assert.equal(m.size, 2);
  assert.equal(m.get('fold').meshes[0].name, 'b'); // first sample in fold phase
  assert.equal(m.get('hyper').meshes[0].name, 'tunnel');
});

test('snapshotAtPhaseBoundaries: skips samples without inventory', () => {
  const samples = [
    { state: { phase: 'fold' } /* no inventory */ },
    { state: { phase: 'fold' }, inventory: { meshes: [] } },
  ];
  const m = snapshotAtPhaseBoundaries(samples, ['fold'], 'phase');
  assert.equal(m.size, 1);
  assert.deepEqual(m.get('fold').meshes, []);
});

test('snapshotAtPhaseBoundaries: dotted path resolves nested state', () => {
  const samples = [
    { state: { auto: { phase: 'cruise' } }, inventory: { meshes: [{ name: 'x', visible: true, inFrustum: true }] } },
  ];
  const m = snapshotAtPhaseBoundaries(samples, ['cruise'], 'auto.phase');
  assert.equal(m.get('cruise').meshes[0].name, 'x');
});

test('snapshotAtPhaseBoundaries: throws on bad inputs', () => {
  assert.throws(() => snapshotAtPhaseBoundaries(null, [], 'p'), /samples/);
  assert.throws(() => snapshotAtPhaseBoundaries([], null, 'p'), /phaseKeys/);
  assert.throws(() => snapshotAtPhaseBoundaries([], [], ''), /stateFieldPath/);
});

test('predicate composition: snapshotAtPhaseBoundaries → meshVisibleAt', () => {
  const samples = [
    { state: { phase: 'HYPER' }, inventory: invHyper },
    { state: { phase: 'EXIT' }, inventory: invExit },
  ];
  const m = snapshotAtPhaseBoundaries(samples, ['HYPER', 'EXIT'], 'phase');
  assert.equal(meshVisibleAt(m, { phaseKey: 'HYPER', meshName: 'tunnelMesh' }).passed, true);
  assert.equal(meshHiddenAt(m, { phaseKey: 'EXIT', meshName: 'tunnelMesh' }).passed, true);
});

// ─── Pure-data invariant ─────────────────────────────────────────────────

test('predicate results JSON-roundtrip without loss', () => {
  const r = drawCallBudget(invs, { max: 32 });
  const round = JSON.parse(JSON.stringify(r));
  assert.deepEqual(round, r);
});

test('diff result JSON-roundtrip without loss', () => {
  const d = diffInventories(invHyper, invExit);
  const round = JSON.parse(JSON.stringify(d));
  assert.deepEqual(round, d);
});
