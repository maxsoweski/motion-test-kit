import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as P from '../core/predicates/index.js';

// Helper: build a synthetic sample stream
function mkSamples(positions, opts) {
  opts = opts || {};
  return positions.map((pos, frame) => ({
    frame,
    t: frame * (opts.dt || 16.667),
    dt: opts.dt || 16.667,
    anchor: { pos, quat: [0, 0, 0, 1] },
    target: opts.target ? { pos: opts.target, quat: [0, 0, 0, 1] } : null,
    input: opts.input || {},
    state: opts.state || {},
  }));
}

test('exports all 9 predicates as functions + runAll', () => {
  const expected = [
    'deltaMagnitudeBound', 'signStability', 'monotonicityScore',
    'approachPhaseInvariant', 'zeroInputNullAction', 'velocityBound',
    'stateTransitionWellFormed', 'transformHashEquivalence', 'frameTimeVariance',
  ];
  for (const name of expected) {
    assert.equal(typeof P[name], 'function', `${name} is not a function`);
  }
  assert.equal(typeof P.runAll, 'function');
});

test('deltaMagnitudeBound: smooth motion passes', () => {
  const samples = mkSamples([[0,0,0], [1,0,0], [2,0,0], [3,0,0]]);
  const r = P.deltaMagnitudeBound(samples, { axis: 'x', bound: 5 });
  assert.equal(r.passed, true);
  assert.equal(r.violations.length, 0);
});

test('deltaMagnitudeBound: catches single-frame teleport', () => {
  // Frame 2 jumps 100 units — mimics the toggle-fix recording's spike
  const samples = mkSamples([[0,0,0], [1,0,0], [101,0,0], [102,0,0]]);
  const r = P.deltaMagnitudeBound(samples, { axis: 'x', bound: 5 });
  assert.equal(r.passed, false);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].frame, 2);
  assert.equal(r.violations[0].value, 100);
});

test('signStability: monotonic approach passes', () => {
  // Anchor moves +x toward target at +10
  const samples = mkSamples([[0,0,0],[1,0,0],[2,0,0],[3,0,0],[4,0,0]], { target: [10, 0, 0] });
  const r = P.signStability(samples, { phaseStart: 0, phaseEnd: 5 });
  assert.equal(r.passed, true);
});

test('signStability: catches direction reversal mid-approach', () => {
  // Anchor approaches then bounces back
  const samples = mkSamples([[0,0,0],[1,0,0],[2,0,0],[1,0,0],[0,0,0]], { target: [10, 0, 0] });
  const r = P.signStability(samples, { phaseStart: 0, phaseEnd: 5 });
  assert.equal(r.passed, false);
  assert.ok(r.violations.length >= 1);
});

test('monotonicityScore: smooth motion passes', () => {
  const positions = [];
  for (let i = 0; i < 100; i++) positions.push([i, 0, 0]);
  const samples = mkSamples(positions);
  const r = P.monotonicityScore(samples, { axis: 'x', windowFrames: 30 });
  assert.equal(r.passed, true);
});

test('monotonicityScore: catches oscillation', () => {
  // Sawtooth: alternating +1/-1 motion → many sign flips
  const positions = [];
  for (let i = 0; i < 100; i++) positions.push([i % 2, 0, 0]);
  const samples = mkSamples(positions);
  const r = P.monotonicityScore(samples, { axis: 'x', windowFrames: 30, maxFlipsPerWindow: 5 });
  assert.equal(r.passed, false);
  assert.ok(r.violations.length > 0);
});

test('approachPhaseInvariant: distance non-increasing', () => {
  const samples = mkSamples([[0,0,0],[1,0,0],[2,0,0],[3,0,0]], { target: [10, 0, 0] });
  const r = P.approachPhaseInvariant(samples, { phaseStart: 0, phaseEnd: 4 });
  assert.equal(r.passed, true);
});

test('approachPhaseInvariant: catches overshoot', () => {
  // Anchor reaches target then continues past — distance increases
  const samples = mkSamples([[0,0,0],[5,0,0],[10,0,0],[15,0,0]], { target: [10, 0, 0] });
  const r = P.approachPhaseInvariant(samples, { phaseStart: 0, phaseEnd: 4 });
  assert.equal(r.passed, false);
});

test('zeroInputNullAction: zero input + still anchor passes', () => {
  const positions = Array(10).fill([5, 0, 5]);
  const samples = mkSamples(positions, { input: { fwd: 0, right: 0 } });
  const r = P.zeroInputNullAction(samples, { inputAxes: ['fwd', 'right'], deltaAxes: ['x', 'z'] });
  assert.equal(r.passed, true);
});

test('zeroInputNullAction: catches drift under zero input', () => {
  // Zero input but anchor drifts → fail
  const positions = [];
  for (let i = 0; i < 10; i++) positions.push([i * 0.5, 0, 0]);
  const samples = mkSamples(positions, { input: { fwd: 0, right: 0 } });
  const r = P.zeroInputNullAction(samples, { inputAxes: ['fwd', 'right'], deltaAxes: ['x'] });
  assert.equal(r.passed, false);
  assert.ok(r.violations.length > 0);
});

test('velocityBound: bounded velocity passes', () => {
  // 1 unit per 16.667 ms = 0.06 unit/ms; bound 0.1 passes
  const positions = [];
  for (let i = 0; i < 10; i++) positions.push([i, 0, 0]);
  const samples = mkSamples(positions);
  const r = P.velocityBound(samples, { axis: 'mag', cMax: 0.1 });
  assert.equal(r.passed, true);
});

test('velocityBound: catches velocity spike', () => {
  const samples = mkSamples([[0,0,0], [1,0,0], [101,0,0]]);  // huge jump
  const r = P.velocityBound(samples, { axis: 'x', cMax: 0.1 });
  assert.equal(r.passed, false);
});

test('stateTransitionWellFormed: legal transitions pass', () => {
  const samples = mkSamples(
    [[0,0,0],[1,0,0],[2,0,0]],
    { state: { phase: 'IDLE' } }
  );
  // Override per-frame state
  samples[0].state = { phase: 'IDLE' };
  samples[1].state = { phase: 'CRUISE' };
  samples[2].state = { phase: 'APPROACH' };
  const r = P.stateTransitionWellFormed(samples, {
    stateField: 'phase',
    stateMachine: { IDLE: ['CRUISE'], CRUISE: ['APPROACH'], APPROACH: ['STATION'], STATION: [] },
  });
  assert.equal(r.passed, true);
});

test('stateTransitionWellFormed: catches illegal jump', () => {
  const samples = mkSamples([[0,0,0],[1,0,0]]);
  samples[0].state = { phase: 'IDLE' };
  samples[1].state = { phase: 'STATION' };  // skipped CRUISE + APPROACH
  const r = P.stateTransitionWellFormed(samples, {
    stateField: 'phase',
    stateMachine: { IDLE: ['CRUISE'], CRUISE: ['APPROACH'], APPROACH: ['STATION'] },
  });
  assert.equal(r.passed, false);
  assert.equal(r.violations.length, 1);
});

test('transformHashEquivalence: identical streams pass', () => {
  const positions = [[0,0,0],[1,0,0],[2,0,0],[3,0,0]];
  const a = mkSamples(positions);
  const b = mkSamples(positions);
  const r = P.transformHashEquivalence(a, b, { tolerance: 1e-6 });
  assert.equal(r.passed, true);
});

test('transformHashEquivalence: small float diff within tolerance passes', () => {
  const a = mkSamples([[0,0,0],[1,0,0]]);
  const b = mkSamples([[0,0,0],[1.0000001,0,0]]);
  const r = P.transformHashEquivalence(a, b, { tolerance: 1e-3 });
  assert.equal(r.passed, true);
});

test('transformHashEquivalence: divergence outside tolerance fails', () => {
  const a = mkSamples([[0,0,0],[1,0,0]]);
  const b = mkSamples([[0,0,0],[1.5,0,0]]);  // 0.5 unit diff
  const r = P.transformHashEquivalence(a, b, { tolerance: 1e-3 });
  assert.equal(r.passed, false);
});

test('frameTimeVariance: consistent dt passes', () => {
  const positions = Array(10).fill([0,0,0]);
  const samples = mkSamples(positions, { dt: 16.667 });
  const r = P.frameTimeVariance(samples, { vMax: 1 });
  assert.equal(r.passed, true);
  assert.equal(r.variance, 0);
});

test('frameTimeVariance: high variance fails', () => {
  const samples = [
    { frame: 0, t: 0,   dt: 0,   anchor: {pos:[0,0,0], quat:[0,0,0,1]}, target: null, input: {}, state: {} },
    { frame: 1, t: 16,  dt: 16,  anchor: {pos:[0,0,0], quat:[0,0,0,1]}, target: null, input: {}, state: {} },
    { frame: 2, t: 100, dt: 84,  anchor: {pos:[0,0,0], quat:[0,0,0,1]}, target: null, input: {}, state: {} },  // hitch
    { frame: 3, t: 116, dt: 16,  anchor: {pos:[0,0,0], quat:[0,0,0,1]}, target: null, input: {}, state: {} },
  ];
  const r = P.frameTimeVariance(samples, { vMax: 100 });
  assert.equal(r.passed, false);
});

test('runAll composes predicates and reports per-name', () => {
  const samples = mkSamples([[0,0,0],[1,0,0],[2,0,0]]);
  const out = P.runAll(samples, [
    { name: 'delta', fn: P.deltaMagnitudeBound, options: { axis: 'x', bound: 5 } },
    { name: 'mono',  fn: P.monotonicityScore,    options: { axis: 'x', windowFrames: 2 } },
  ]);
  assert.equal(out.passed, true);
  assert.ok(out.byPredicate.delta);
  assert.ok(out.byPredicate.mono);
});

test('predicates throw MissingFieldError on shape violation', () => {
  const bad = [{ frame: 0, t: 0, dt: 0 }];  // no anchor
  assert.throws(() => P.deltaMagnitudeBound(bad.concat(bad), { axis: 'x', bound: 1 }),
    /missing required field "anchor.pos"/);
});
