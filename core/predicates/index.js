// Named motion invariants — Dana's vocabulary table made callable.
// Each predicate is a pure function: (samples, options) → { passed, violations, totalSamples }.
//
// `samples` is an array of SampleRecord (see ./sample-shape.md).
// `options` is predicate-specific.
// The return shape is uniform so the Tester (or any consumer) can compose
// predicates in a single pass: `predicates.runAll(samples, configs)`.
//
// Implementation notes:
//   - All predicates skip frames where required fields are absent rather
//     than throwing, except via `assertSampleField` for hard contract
//     violations (e.g., anchor itself missing — that's a host bug).
//   - Floating-point comparisons use ε = 1e-9 unless options override.
//   - "Violations" carry frame index + observed value + the bound that
//     was violated, so the consumer can localize the failure.

import * as vec3 from '../math/vec3.js';
import { MissingFieldError, InvalidOptionsError } from './errors.js';

const AXES = { x: 0, y: 0, z: 0 };  // sentinel for axis name validation

function assertSampleField(predicate, sample, frameIdx, path) {
  const parts = path.split('.');
  let cur = sample;
  for (const p of parts) {
    if (cur == null || !(p in cur)) {
      throw new MissingFieldError(predicate, frameIdx, path);
    }
    cur = cur[p];
  }
  return cur;
}

function axisIndex(predicate, axis) {
  if (axis === 'x') return 0;
  if (axis === 'y') return 1;
  if (axis === 'z') return 2;
  throw new InvalidOptionsError(predicate, `axis must be 'x' | 'y' | 'z', got ${JSON.stringify(axis)}`);
}

// ─── Predicate 1: deltaMagnitudeBound ──────────────────────────────────────
// "No per-frame Δposition exceeds `bound` along `axis`." Catches teleport
// jumps where the camera/anchor moves more in one frame than thrust × dt
// could plausibly produce.
//
// Use case: the bug Max saw in the toggle-fix recording — autopilot
// CRUISE produced 88-unit single-frame jumps when median Δ was ~1 unit.
// `deltaMagnitudeBound({ axis: 'z', bound: 5 })` flags every spike.
//
// Options:
//   axis: 'x' | 'y' | 'z'
//   bound: maximum allowed |Δ| per frame
//
// Returns { passed, violations: [{ frame, value, bound }], totalSamples }
export function deltaMagnitudeBound(samples, options) {
  if (!options || typeof options.bound !== 'number') {
    throw new InvalidOptionsError('deltaMagnitudeBound', 'options.bound (number) required');
  }
  const ax = axisIndex('deltaMagnitudeBound', options.axis);
  const bound = options.bound;
  const violations = [];
  for (let i = 1; i < samples.length; i++) {
    const cur = assertSampleField('deltaMagnitudeBound', samples[i], i, 'anchor.pos');
    const prev = assertSampleField('deltaMagnitudeBound', samples[i - 1], i - 1, 'anchor.pos');
    const delta = cur[ax] - prev[ax];
    const mag = Math.abs(delta);
    if (mag > bound) {
      violations.push({ frame: samples[i].frame, value: mag, bound });
    }
  }
  return { passed: violations.length === 0, violations, totalSamples: samples.length };
}

// ─── Predicate 2: signStability ────────────────────────────────────────────
// "Approach velocity toward target maintains its sign during a phase."
// During an APPROACH phase (anchor moving toward target), the dot product
// of (anchor velocity) and (target − anchor) should stay positive. Sign
// flips mid-phase indicate oscillation — the bug class teleport-cycle.
//
// Options:
//   phaseStart: frame index where the phase begins (inclusive)
//   phaseEnd:   frame index where the phase ends (exclusive)
export function signStability(samples, options) {
  if (!options || typeof options.phaseStart !== 'number' || typeof options.phaseEnd !== 'number') {
    throw new InvalidOptionsError('signStability', 'options.phaseStart and options.phaseEnd required');
  }
  const violations = [];
  let lastSign = 0;
  for (let i = Math.max(1, options.phaseStart); i < Math.min(samples.length, options.phaseEnd); i++) {
    const cur = assertSampleField('signStability', samples[i], i, 'anchor.pos');
    const prev = assertSampleField('signStability', samples[i - 1], i - 1, 'anchor.pos');
    const tgt = assertSampleField('signStability', samples[i], i, 'target.pos');
    const v = vec3.sub(cur, prev);
    const toTarget = vec3.sub(tgt, prev);
    const d = vec3.dot(v, toTarget);
    const s = vec3.sign(d);
    if (lastSign !== 0 && s !== 0 && s !== lastSign) {
      violations.push({ frame: samples[i].frame, value: d, bound: 'sign-stable approach' });
    }
    if (s !== 0) lastSign = s;
  }
  return { passed: violations.length === 0, violations, totalSamples: samples.length };
}

// ─── Predicate 3: monotonicityScore ────────────────────────────────────────
// "Within rolling spans of size `windowFrames`, count direction reversals
// on `axis`. Flag spans where reversals exceed `maxFlipsPerWindow`."
// Reports per-span flip counts and pass/fail per span.
//
// Use case: detect oscillation — Max's teleport-cycle averaged ~16 sign
// changes per second on Z while the camera was supposedly tracking.
//
// Options:
//   axis: 'x' | 'y' | 'z'
//   windowFrames: rolling window size (default 30 = ~0.5s @ 60Hz)
//   maxFlipsPerWindow: threshold (default Math.ceil(windowFrames / 10))
export function monotonicityScore(samples, options) {
  options = options || {};
  const ax = axisIndex('monotonicityScore', options.axis);
  const windowFrames = options.windowFrames || 30;
  const maxFlips = options.maxFlipsPerWindow ?? Math.ceil(windowFrames / 10);
  const violations = [];

  // Compute per-frame deltas first
  const deltas = new Array(samples.length).fill(0);
  for (let i = 1; i < samples.length; i++) {
    const cur = assertSampleField('monotonicityScore', samples[i], i, 'anchor.pos');
    const prev = assertSampleField('monotonicityScore', samples[i - 1], i - 1, 'anchor.pos');
    deltas[i] = cur[ax] - prev[ax];
  }

  // Slide window, count sign changes
  for (let start = 1; start + windowFrames <= samples.length; start++) {
    let flips = 0;
    let lastSign = 0;
    for (let i = start; i < start + windowFrames; i++) {
      const s = vec3.sign(deltas[i]);
      if (lastSign !== 0 && s !== 0 && s !== lastSign) flips++;
      if (s !== 0) lastSign = s;
    }
    if (flips > maxFlips) {
      violations.push({ frame: samples[start].frame, value: flips, bound: maxFlips });
    }
  }
  return { passed: violations.length === 0, violations, totalSamples: samples.length };
}

// ─── Predicate 4: approachPhaseInvariant ───────────────────────────────────
// "During an APPROACH phase, distance to target is non-increasing
// (modulo eps for float drift)." Catches APPROACH overshoot — anchor
// crosses target then comes back.
//
// Options:
//   phaseStart, phaseEnd: frame range of the approach
//   eps: float tolerance (default 1e-3)
export function approachPhaseInvariant(samples, options) {
  if (!options || typeof options.phaseStart !== 'number' || typeof options.phaseEnd !== 'number') {
    throw new InvalidOptionsError('approachPhaseInvariant', 'options.phaseStart and options.phaseEnd required');
  }
  const eps = options.eps ?? 1e-3;
  const violations = [];
  let prevDist = Infinity;
  for (let i = options.phaseStart; i < Math.min(samples.length, options.phaseEnd); i++) {
    const a = assertSampleField('approachPhaseInvariant', samples[i], i, 'anchor.pos');
    const t = assertSampleField('approachPhaseInvariant', samples[i], i, 'target.pos');
    const d = vec3.distance(a, t);
    if (d > prevDist + eps) {
      violations.push({ frame: samples[i].frame, value: d, bound: prevDist });
    }
    prevDist = d;
  }
  return { passed: violations.length === 0, violations, totalSamples: samples.length };
}

// ─── Predicate 5: zeroInputNullAction ──────────────────────────────────────
// "When all input axes report 0, the anchor's velocity along delta axes
// is zero." Catches drift — body-tracking, residual autopilot, anything
// that moves the camera when the player isn't pressing anything.
//
// Options:
//   inputAxes: array of input field names whose 0 implies stillness
//              (e.g., ['fwd', 'right'] reads samples[i].input.fwd, .right)
//   deltaAxes: array of vec3 axes ('x'|'y'|'z') to check for stillness
//   tolerance: maximum |Δ| per frame considered "still" (default 1e-6)
export function zeroInputNullAction(samples, options) {
  if (!options || !Array.isArray(options.inputAxes) || !Array.isArray(options.deltaAxes)) {
    throw new InvalidOptionsError('zeroInputNullAction', 'options.inputAxes and options.deltaAxes (arrays) required');
  }
  const tol = options.tolerance ?? 1e-6;
  const deltaAxIndices = options.deltaAxes.map(a => axisIndex('zeroInputNullAction', a));
  const violations = [];
  for (let i = 1; i < samples.length; i++) {
    const input = assertSampleField('zeroInputNullAction', samples[i], i, 'input');
    let allZero = true;
    for (const ax of options.inputAxes) {
      if (input[ax] !== 0 && input[ax] !== false && input[ax] != null) { allZero = false; break; }
    }
    if (!allZero) continue;
    const cur = assertSampleField('zeroInputNullAction', samples[i], i, 'anchor.pos');
    const prev = assertSampleField('zeroInputNullAction', samples[i - 1], i - 1, 'anchor.pos');
    for (const ax of deltaAxIndices) {
      const d = Math.abs(cur[ax] - prev[ax]);
      if (d > tol) {
        violations.push({ frame: samples[i].frame, value: d, bound: tol });
        break;
      }
    }
  }
  return { passed: violations.length === 0, violations, totalSamples: samples.length };
}

// ─── Predicate 6: velocityBound ────────────────────────────────────────────
// "|v| < cMax along axis." Catches NaN explosions and physically
// implausible velocities (warp drives included; this predicate is for
// scenarios that should NOT exceed a named cap).
//
// Options:
//   axis: 'x' | 'y' | 'z' (or 'mag' for 3D magnitude)
//   cMax: bound on velocity in scene-units / millisecond
export function velocityBound(samples, options) {
  if (!options || typeof options.cMax !== 'number') {
    throw new InvalidOptionsError('velocityBound', 'options.cMax (number) required');
  }
  const cMax = options.cMax;
  const isMag = options.axis === 'mag';
  const ax = isMag ? -1 : axisIndex('velocityBound', options.axis);
  const violations = [];
  for (let i = 1; i < samples.length; i++) {
    const cur = assertSampleField('velocityBound', samples[i], i, 'anchor.pos');
    const prev = assertSampleField('velocityBound', samples[i - 1], i - 1, 'anchor.pos');
    const dt = samples[i].dt || 1;  // 1ms fallback if dt missing
    let v;
    if (isMag) {
      v = vec3.distance(cur, prev) / dt;
    } else {
      v = Math.abs(cur[ax] - prev[ax]) / dt;
    }
    if (v > cMax) {
      violations.push({ frame: samples[i].frame, value: v, bound: cMax });
    }
  }
  return { passed: violations.length === 0, violations, totalSamples: samples.length };
}

// ─── Predicate 7: stateTransitionWellFormed ────────────────────────────────
// "Every state transition observed in the sample stream is in the
// declared state machine." Catches phase-machine bugs where state jumps
// from CRUISE → IDLE without going through APPROACH → STATION.
//
// Options:
//   stateMachine: { [from: string]: string[] }  — adjacency list of allowed transitions
//   stateField: the name of the state field on samples[i].state (e.g., 'shipPhase')
export function stateTransitionWellFormed(samples, options) {
  if (!options || !options.stateMachine || typeof options.stateField !== 'string') {
    throw new InvalidOptionsError('stateTransitionWellFormed', 'options.stateMachine and options.stateField required');
  }
  const sm = options.stateMachine;
  const field = options.stateField;
  const violations = [];
  for (let i = 1; i < samples.length; i++) {
    const prevState = assertSampleField('stateTransitionWellFormed', samples[i - 1], i - 1, 'state.' + field);
    const curState = assertSampleField('stateTransitionWellFormed', samples[i], i, 'state.' + field);
    if (prevState === curState) continue;  // no transition this frame
    const allowed = sm[prevState] || [];
    if (!allowed.includes(curState)) {
      violations.push({ frame: samples[i].frame, value: `${prevState} → ${curState}`, bound: `allowed from ${prevState}: ${allowed.join('|')}` });
    }
  }
  return { passed: violations.length === 0, violations, totalSamples: samples.length };
}

// ─── Predicate 8: transformHashEquivalence ─────────────────────────────────
// "Two sample streams produce equivalent trajectories at every Nth frame,
// modulo `tolerance`." Used for refactor-regression: capture a golden
// trajectory, then re-run after a refactor, assert equivalence.
//
// Phase 2 implementation: deep equality with tolerance band (per-axis
// quantization). Phase 4 will ship a faster FNV-1a hash variant for
// large-trajectory comparison; this version is correct for any size,
// just O(N) instead of O(N) with smaller constants.
//
// Options:
//   hashEvery: compare every Nth frame (default 1 = every frame)
//   tolerance: float quantization grid (default 1e-6)
export function transformHashEquivalence(samplesA, samplesB, options) {
  options = options || {};
  const hashEvery = options.hashEvery || 1;
  const tol = options.tolerance ?? 1e-6;
  const violations = [];
  const n = Math.min(samplesA.length, samplesB.length);
  if (samplesA.length !== samplesB.length) {
    violations.push({ frame: -1, value: `lengths ${samplesA.length} vs ${samplesB.length}`, bound: 'equal' });
  }
  for (let i = 0; i < n; i += hashEvery) {
    const a = assertSampleField('transformHashEquivalence', samplesA[i], i, 'anchor.pos');
    const b = assertSampleField('transformHashEquivalence', samplesB[i], i, 'anchor.pos');
    const aq = assertSampleField('transformHashEquivalence', samplesA[i], i, 'anchor.quat');
    const bq = assertSampleField('transformHashEquivalence', samplesB[i], i, 'anchor.quat');
    for (let k = 0; k < 3; k++) {
      if (vec3.quantize(a[k], tol) !== vec3.quantize(b[k], tol)) {
        violations.push({ frame: samplesA[i].frame, value: { axis: 'xyz'[k], a: a[k], b: b[k] }, bound: tol });
        break;
      }
    }
    for (let k = 0; k < 4; k++) {
      if (vec3.quantize(aq[k], tol) !== vec3.quantize(bq[k], tol)) {
        violations.push({ frame: samplesA[i].frame, value: { axis: 'xyzw'[k], a: aq[k], b: bq[k] }, bound: tol });
        break;
      }
    }
  }
  return { passed: violations.length === 0, violations, totalSamples: n };
}

// ─── Predicate 9: frameTimeVariance ────────────────────────────────────────
// "Variance of frame_dt is below vMax." Catches uneven frame pacing —
// not a sim correctness predicate but a separate concern about render
// smoothness. The kit ships it for completeness because Dana's
// vocabulary table named it.
//
// Options:
//   vMax: variance ceiling (ms²)
export function frameTimeVariance(samples, options) {
  if (!options || typeof options.vMax !== 'number') {
    throw new InvalidOptionsError('frameTimeVariance', 'options.vMax (number) required');
  }
  if (samples.length < 2) {
    return { passed: true, violations: [], totalSamples: samples.length, variance: 0 };
  }
  const dts = samples.slice(1).map(s => s.dt);
  const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
  const variance = dts.reduce((a, b) => a + (b - mean) ** 2, 0) / dts.length;
  const violations = variance > options.vMax
    ? [{ frame: -1, value: variance, bound: options.vMax }]
    : [];
  return { passed: violations.length === 0, violations, totalSamples: samples.length, variance };
}

// ─── Convenience: run-all ───────────────────────────────────────────────────
// Run a list of named predicate-config tuples against samples, return
// a combined report. Lets the Tester compose checks declaratively.
export function runAll(samples, configs) {
  const out = { passed: true, byPredicate: {} };
  for (const { name, fn, options } of configs) {
    const r = fn(samples, options);
    out.byPredicate[name] = r;
    if (!r.passed) out.passed = false;
  }
  return out;
}
