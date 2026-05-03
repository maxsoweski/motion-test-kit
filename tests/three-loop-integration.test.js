import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createAccumulator } from '../core/loop/accumulator.js';
import { bindToRAF } from '../adapters/three/three-loop-binding.js';

// Stubbed RAF — synthesizes a sequence of frame timestamps. Each scheduled
// callback is invoked synchronously with the next timestamp from `frameTimes`
// and removed from the queue. After the queue empties, further raf() calls
// queue against an exhausted timestamp list and never fire (loop implicitly
// stops via timestamp exhaustion, simulating window blur).

function makeStubRAF(frameTimes) {
  let nextHandle = 1;
  const pending = [];
  let queueIdx = 0;
  const raf = (cb) => {
    pending.push({ handle: nextHandle, cb });
    return nextHandle++;
  };
  const caf = (handle) => {
    const i = pending.findIndex(p => p.handle === handle);
    if (i >= 0) pending.splice(i, 1);
  };
  function pump() {
    while (pending.length > 0 && queueIdx < frameTimes.length) {
      const { cb } = pending.shift();
      const t = frameTimes[queueIdx++];
      cb(t);
    }
  }
  return { raf, caf, pump };
}

test('bindToRAF runs simUpdate at fixed-dt and render every RAF', () => {
  // Use clean integer steps (10 ms) and timestamps (0, 10, 20, 30, 40 = 5
  // frames at 100 fps for arithmetic clarity). Real apps use 16.667; the
  // contract is the same and integer math makes the assertion obvious.
  const frameTimes = [0, 10, 20, 30, 40];
  const { raf, caf, pump } = makeStubRAF(frameTimes);

  const acc = createAccumulator({ stepMs: 10 });
  const simDts = [];
  const renderAlphas = [];
  const ctrl = bindToRAF({
    accumulator: acc,
    simUpdate: (dt) => simDts.push(dt),
    render: (alpha) => renderAlphas.push(alpha),
    now: () => 0,            // initial lastT = 0 → first frame's dt = 0
    rafProvider: raf,
    cancelProvider: caf,
  });

  ctrl.start();
  pump();
  ctrl.stop();

  // Frame 1 (t=0):  dt=0  → 0 sim steps, render(0)
  // Frame 2 (t=10): dt=10 → 1 sim step (residual 0), render(0)
  // Frame 3 (t=20): dt=10 → 1 sim step, render(0)
  // Frame 4 (t=30): dt=10 → 1 sim step, render(0)
  // Frame 5 (t=40): dt=10 → 1 sim step, render(0)
  // Total: 4 sim steps, 5 renders
  assert.equal(simDts.length, 4, `expected 4 sim steps, got ${simDts.length}`);
  for (const dt of simDts) {
    assert.equal(dt, 10, `simUpdate received non-fixed dt: ${dt}`);
  }
  assert.equal(renderAlphas.length, 5, `expected 5 renders, got ${renderAlphas.length}`);
  for (const a of renderAlphas) {
    assert.ok(a >= 0 && a <= 1, `alpha out of [0,1]: ${a}`);
  }
});

test('bindToRAF start is idempotent', () => {
  const { raf, caf } = makeStubRAF([]);
  const acc = createAccumulator({ stepMs: 10 });
  const ctrl = bindToRAF({
    accumulator: acc,
    simUpdate: () => {},
    render: () => {},
    now: () => 0,
    rafProvider: raf,
    cancelProvider: caf,
  });
  ctrl.start();
  ctrl.start();  // no-op
  assert.equal(ctrl.isRunning(), true);
  ctrl.stop();
  ctrl.stop();   // no-op
  assert.equal(ctrl.isRunning(), false);
});

test('bindToRAF: simUpdate runs stepsRun times per RAF (catch-up after hitch)', () => {
  // Hitch: jump from t=0 to t=100 → 10 sim steps need to catch up
  // (under maxStepMs cap of 200 — well above the hitch span).
  const frameTimes = [0, 100];
  const { raf, caf, pump } = makeStubRAF(frameTimes);
  const acc = createAccumulator({ stepMs: 10, maxStepMs: 200 });
  let simCount = 0;
  const ctrl = bindToRAF({
    accumulator: acc,
    simUpdate: () => simCount++,
    render: () => {},
    now: () => 0,
    rafProvider: raf,
    cancelProvider: caf,
  });
  ctrl.start();
  pump();
  ctrl.stop();
  // Frame 1 (t=0):   dt=0,  0 sims
  // Frame 2 (t=100): dt=100, 10 sims (catch-up)
  assert.equal(simCount, 10);
});

test('bindToRAF: maxStepMs cap suppresses spiral-of-death after long hitch', () => {
  // Hitch: jump from 0 to 5000 ms (5 seconds). With maxStepMs=33, real-dt
  // is clamped to 33; 33/10 = 3 steps. Without the cap, this would be 500
  // steps — page freeze.
  const frameTimes = [0, 5000];
  const { raf, caf, pump } = makeStubRAF(frameTimes);
  const acc = createAccumulator({ stepMs: 10, maxStepMs: 33 });
  let simCount = 0;
  const ctrl = bindToRAF({
    accumulator: acc,
    simUpdate: () => simCount++,
    render: () => {},
    now: () => 0,
    rafProvider: raf,
    cancelProvider: caf,
  });
  ctrl.start();
  pump();
  ctrl.stop();
  // Frame 1: dt=0, 0 sims. Frame 2: clamped dt=33, 3 sims.
  assert.equal(simCount, 3);
});

test('bindToRAF: missing options throw', () => {
  assert.throws(() => bindToRAF(), /accumulator required/);
  assert.throws(() => bindToRAF({}), /accumulator required/);
  const acc = createAccumulator({ stepMs: 10 });
  assert.throws(() => bindToRAF({ accumulator: acc }), /simUpdate must be a function/);
  assert.throws(() => bindToRAF({ accumulator: acc, simUpdate: () => {} }), /render must be a function/);
});
