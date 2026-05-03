import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRNG } from '../core/rng/mulberry32.js';
import { createAccumulator } from '../core/loop/accumulator.js';
import { createInputRecorder } from '../core/replay/input-recorder.js';
import { createInputPlayer } from '../core/replay/input-player.js';
import { transformHashEquivalence } from '../core/predicates/index.js';

// Build a tiny sim: a particle at position [x, y, z] that moves +x while
// a held key is true, and adds RNG noise to its y position each tick.
// Replaying the same recorded input + same RNG seed must produce
// byte-equivalent state at every frame.

function runScenarioRecord(seed, durationFrames) {
  const recorder = createInputRecorder({ rngSeed: seed, stepMs: 16.667 });
  const rng = createRNG(seed);
  const trajectory = [];
  let pos = [0, 0, 0];
  let keyHeld = false;

  // Synthesize an input pattern: hold W from frame 10 to 50; release; hold A from 70 to 90
  const fakeKeyEvents = [
    { frame: 10, kind: 'keydown', code: 'KeyW' },
    { frame: 50, kind: 'keyup',   code: 'KeyW' },
    { frame: 70, kind: 'keydown', code: 'KeyA' },
    { frame: 90, kind: 'keyup',   code: 'KeyA' },
  ];

  for (let f = 0; f < durationFrames; f++) {
    // Fire any input events at THIS frame — recorded as live events
    for (const e of fakeKeyEvents) {
      if (e.frame === f) {
        if (e.kind === 'keydown') keyHeld = true;
        else if (e.kind === 'keyup') keyHeld = false;
        recorder.record({ kind: e.kind, payload: { code: e.code } });
      }
    }
    // Sim step
    if (keyHeld) pos[0] += 1;
    pos[1] += rng.next() * 0.1;
    trajectory.push({
      frame: f,
      t: f * 16.667,
      dt: 16.667,
      anchor: { pos: [pos[0], pos[1], pos[2]], quat: [0, 0, 0, 1] },
      target: null,
      input: { keyHeld },
      state: {},
    });
    recorder.tick();
  }
  return { record: recorder.snapshot(), trajectory };
}

function runScenarioReplay(record, durationFrames) {
  const trajectory = [];
  let pos = [0, 0, 0];
  let keyHeld = false;
  let rng = null;

  const player = createInputPlayer({
    record,
    simUpdate: (stepMs) => {
      // Sim: RNG noise on y, +x while held
      if (keyHeld) pos[0] += 1;
      pos[1] += rng.next() * 0.1;
      trajectory.push({
        frame: trajectory.length,
        t: trajectory.length * stepMs,
        dt: stepMs,
        anchor: { pos: [pos[0], pos[1], pos[2]], quat: [0, 0, 0, 1] },
        target: null,
        input: { keyHeld },
        state: {},
      });
    },
    applyEvent: (event) => {
      if (event.kind === 'rngSeed') {
        rng = createRNG(event.payload.seed);
      } else if (event.kind === 'keydown' && event.payload.code === 'KeyW') {
        keyHeld = true;
      } else if (event.kind === 'keyup' && event.payload.code === 'KeyW') {
        keyHeld = false;
      } else if (event.kind === 'keydown' && event.payload.code === 'KeyA') {
        keyHeld = true;  // simplified: any tracked key counts
      } else if (event.kind === 'keyup' && event.payload.code === 'KeyA') {
        keyHeld = false;
      }
    },
  });

  while (player.tick()) { /* sim runs inside */ }
  return trajectory;
}

test('replay produces identical trajectory across runs (same machine)', () => {
  const SEED = 42;
  const FRAMES = 100;
  const { record, trajectory: original } = runScenarioRecord(SEED, FRAMES);
  const replay1 = runScenarioReplay(record, FRAMES);
  const replay2 = runScenarioReplay(record, FRAMES);

  // Replay 1 vs Replay 2 — must be byte-equivalent
  const eq12 = transformHashEquivalence(replay1, replay2, { tolerance: 1e-12 });
  assert.equal(eq12.passed, true, `replay-1 vs replay-2 diverged: ${JSON.stringify(eq12.violations.slice(0, 3))}`);

  // Original (live record) vs Replay — also byte-equivalent because same
  // RNG seed + same input timeline + same sim
  const eqOR = transformHashEquivalence(original, replay1, { tolerance: 1e-12 });
  assert.equal(eqOR.passed, true, `original vs replay diverged: ${JSON.stringify(eqOR.violations.slice(0, 3))}`);
});

test('input recorder: rngSeed event is at frame 0', () => {
  const r = createInputRecorder({ rngSeed: 12345 });
  const snap = r.snapshot();
  assert.equal(snap.events[0].frame, 0);
  assert.equal(snap.events[0].kind, 'rngSeed');
  assert.equal(snap.events[0].payload.seed, 12345);
});

test('input recorder: events keyed by frame counter', () => {
  const r = createInputRecorder({ rngSeed: 0 });
  r.tick();  // now at frame 1
  r.record({ kind: 'keydown', payload: { code: 'KeyW' } });
  r.tick();
  r.tick();  // frame 3
  r.record({ kind: 'keyup', payload: { code: 'KeyW' } });

  const snap = r.snapshot();
  // Event 0: rngSeed @ frame 0
  // Event 1: keydown @ frame 1
  // Event 2: keyup @ frame 3
  assert.equal(snap.events.length, 3);
  assert.equal(snap.events[1].frame, 1);
  assert.equal(snap.events[2].frame, 3);
  assert.equal(snap.totalFrames, 3);
});

test('input player: applyEvent receives events at correct frames', () => {
  const record = {
    rngSeed: 0,
    events: [
      { frame: 0, kind: 'rngSeed', payload: { seed: 0 } },
      { frame: 5, kind: 'keydown', payload: { code: 'KeyW' } },
      { frame: 10, kind: 'keyup', payload: { code: 'KeyW' } },
    ],
    totalFrames: 12,
    stepMs: 16.667,
  };
  const applied = [];
  const player = createInputPlayer({
    record,
    simUpdate: () => {},
    applyEvent: (e) => applied.push({ frame: e.frame, kind: e.kind }),
  });
  while (player.tick()) {}
  // rngSeed at frame 0 is applied immediately at construction
  assert.equal(applied[0].kind, 'rngSeed');
  assert.equal(applied[1].kind, 'keydown');
  assert.equal(applied[1].frame, 5);
  assert.equal(applied[2].kind, 'keyup');
  assert.equal(applied[2].frame, 10);
});

test('input player: simUpdate called exactly totalFrames times', () => {
  const record = {
    rngSeed: 0,
    events: [{ frame: 0, kind: 'rngSeed', payload: { seed: 0 } }],
    totalFrames: 30,
    stepMs: 10,
  };
  let count = 0;
  const player = createInputPlayer({
    record,
    simUpdate: () => count++,
    applyEvent: () => {},
  });
  while (player.tick()) {}
  assert.equal(count, 30);
  assert.equal(player.isComplete(), true);
});
