import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRNG } from '../core/rng/mulberry32.js';

// Reference sequence — committed as a regression guard. Any change to
// the RNG implementation that produces different values for these seeds
// breaks this test, which is the point: replays + golden trajectories
// depend on bit-equivalent RNG output.

test('Mulberry32 reference sequence — seed 12345', () => {
  const r = createRNG(12345);
  const expected = [
    0.9797282677609473,
    0.3067522644996643,
    0.484205421525985,
    0.817934412509203,
    0.5094283693470061,
  ];
  for (const e of expected) {
    assert.equal(r.next(), e);
  }
});

test('Mulberry32 reference sequence — seed 0', () => {
  const r = createRNG(0);
  const seq = [];
  for (let i = 0; i < 5; i++) seq.push(r.next());
  // Verify the values are stable (run-to-run determinism); the actual
  // values are a stable derivation from the algorithm.
  const r2 = createRNG(0);
  for (let i = 0; i < 5; i++) assert.equal(r2.next(), seq[i]);
});

test('two RNGs with the same seed produce identical sequences', () => {
  const a = createRNG(42);
  const b = createRNG(42);
  for (let i = 0; i < 100; i++) {
    assert.equal(a.next(), b.next());
  }
});

test('different seeds produce different sequences', () => {
  const a = createRNG(1);
  const b = createRNG(2);
  let differences = 0;
  for (let i = 0; i < 100; i++) {
    if (a.next() !== b.next()) differences++;
  }
  assert.ok(differences > 90, `expected near-100/100 differences, got ${differences}`);
});

test('state save/restore yields identical post-restore sequence', () => {
  const r = createRNG(999);
  for (let i = 0; i < 50; i++) r.next();
  const saved = r.state();
  const subsequent = [];
  for (let i = 0; i < 10; i++) subsequent.push(r.next());

  // Restore and re-run
  r.restore(saved);
  for (let i = 0; i < 10; i++) {
    assert.equal(r.next(), subsequent[i]);
  }
});

test('values are in [0, 1)', () => {
  const r = createRNG(12345);
  for (let i = 0; i < 1000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1, `value out of [0, 1): ${v}`);
  }
});

test('createRNG validates seed', () => {
  assert.throws(() => createRNG('not a number'), /seed must be a finite number/);
  assert.throws(() => createRNG(NaN), /seed must be a finite number/);
  assert.throws(() => createRNG(Infinity), /seed must be a finite number/);
});
