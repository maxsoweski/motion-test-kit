import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createAccumulator } from '../core/loop/accumulator.js';

// Tests use clean integer-arithmetic step sizes (stepMs ∈ {10, 20}) to avoid
// float-precision issues that plague stepMs = 16.667 in spec-text. The
// accumulator's invariants are math-valid for any step; integer steps make
// the assertion math obvious.

test('100 ms real-dt with 10 ms step produces exactly 10 fixed-step ticks', () => {
  const acc = createAccumulator({ stepMs: 10, maxStepMs: 200 });
  let calls = 0;
  const result = acc.tick(100, () => calls++);
  assert.equal(result.stepsRun, 10);
  assert.equal(calls, 10);
  assert.equal(result.alpha, 0);  // no residual
});

test('residual accumulates across ticks', () => {
  const acc = createAccumulator({ stepMs: 10 });
  // Feed 7 ms — no step, residual = 7
  const r1 = acc.tick(7, () => {});
  assert.equal(r1.stepsRun, 0);
  assert.equal(r1.alpha, 0.7);
  // Feed 5 ms — 7 + 5 = 12; one step (12 → 2 residual)
  let calls = 0;
  const r2 = acc.tick(5, () => calls++);
  assert.equal(r2.stepsRun, 1);
  assert.equal(calls, 1);
  assert.equal(r2.alpha, 0.2);
});

test('60 Hz integer-equivalent: feed 100 ms in 6 ticks of ~16.667 ms each → 5 or 6 steps depending on float ordering', () => {
  // Precision-sensitive case: 100 / 16.667 = 5.99988... → floor 5. With
  // multi-tick feed, floats can deliver either 5 or 6 depending on
  // accumulation order. Both are mathematically correct; what matters is
  // simUpdate received exactly stepMs every call.
  const acc = createAccumulator({ stepMs: 16.667 });
  const observed = [];
  // 6 ticks of 16.667 → total 100.002 → expected 6 steps (residual 0.002)
  for (let i = 0; i < 6; i++) acc.tick(16.667, () => observed.push(true));
  assert.equal(observed.length, 6, `6 equal-sized ticks each ≥ stepMs should produce exactly 6 steps; got ${observed.length}`);
});

test('maxStepMs caps spiral-of-death input', () => {
  const acc = createAccumulator({ stepMs: 10, maxStepMs: 33 });
  // Hitch: 5 seconds of "lost" time
  let calls = 0;
  const r = acc.tick(5000, () => calls++);
  // Real-dt clamped to 33; 33 / 10 = 3 steps + 3 residual
  assert.equal(r.stepsRun, 3);
  assert.equal(calls, 3);
  assert.equal(r.alpha, 0.3);
});

test('updateFn receives exactly stepMs every call', () => {
  const acc = createAccumulator({ stepMs: 16.667 });
  const observedSteps = [];
  acc.tick(50, (dt) => observedSteps.push(dt));
  assert.ok(observedSteps.length > 0);
  for (const dt of observedSteps) {
    assert.equal(dt, 16.667, `simUpdate received non-fixed dt: ${dt}`);
  }
});

test('reset zeroes residual', () => {
  const acc = createAccumulator({ stepMs: 10 });
  acc.tick(7, () => {});
  assert.equal(acc.accumulated(), 7);
  acc.reset();
  assert.equal(acc.accumulated(), 0);
});

test('zero realDt produces zero steps and unchanged alpha', () => {
  const acc = createAccumulator({ stepMs: 10 });
  acc.tick(7, () => {});  // residual = 7
  const r = acc.tick(0, () => {});
  assert.equal(r.stepsRun, 0);
  assert.equal(r.alpha, 0.7);
});

test('terminal alpha is in [0, 1]', () => {
  const acc = createAccumulator({ stepMs: 10 });
  // Run a sequence of irregular ticks; alpha must always be in range
  const ticks = [3.7, 8.2, 1.1, 14.6, 9.9, 2.3, 7.7];
  for (const dt of ticks) {
    const r = acc.tick(dt, () => {});
    assert.ok(r.alpha >= 0 && r.alpha <= 1, `alpha out of [0,1]: ${r.alpha} after dt=${dt}`);
  }
});

test('options validation: missing stepMs throws', () => {
  assert.throws(() => createAccumulator({}), /stepMs must be a positive number/);
  assert.throws(() => createAccumulator({ stepMs: 0 }), /stepMs must be a positive number/);
  assert.throws(() => createAccumulator({ stepMs: -1 }), /stepMs must be a positive number/);
});

test('tick validation: invalid realDt throws', () => {
  const acc = createAccumulator({ stepMs: 10 });
  assert.throws(() => acc.tick(-1, () => {}), /non-negative finite/);
  assert.throws(() => acc.tick(NaN, () => {}), /non-negative finite/);
  assert.throws(() => acc.tick(Infinity, () => {}), /non-negative finite/);
});
