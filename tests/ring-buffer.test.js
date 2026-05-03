import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRingBuffer } from '../core/recorder/ring-buffer.js';
import { attachOnFailureDump } from '../core/recorder/on-failure-dump.js';
import { captureFrame, bindCaptureToBuffer } from '../adapters/three/sample-capture.js';
import { deltaMagnitudeBound } from '../core/predicates/index.js';

test('ring buffer: under capacity, snapshot returns chronological insert order', () => {
  const rb = createRingBuffer({ capacity: 10 });
  for (let i = 0; i < 5; i++) rb.push(i);
  const snap = rb.snapshot();
  assert.deepEqual(snap, [0, 1, 2, 3, 4]);
  assert.equal(rb.size(), 5);
});

test('ring buffer: over capacity, oldest entries dropped', () => {
  const rb = createRingBuffer({ capacity: 3 });
  for (let i = 0; i < 10; i++) rb.push(i);
  const snap = rb.snapshot();
  assert.deepEqual(snap, [7, 8, 9]);  // last 3 in order
  assert.equal(rb.size(), 3);
});

test('ring buffer: 600 pushes to 300-capacity yields 300 newest in order', () => {
  const rb = createRingBuffer({ capacity: 300 });
  for (let i = 0; i < 600; i++) rb.push({ frame: i });
  const snap = rb.snapshot();
  assert.equal(snap.length, 300);
  assert.equal(snap[0].frame, 300);
  assert.equal(snap[299].frame, 599);
});

test('ring buffer: clear resets state', () => {
  const rb = createRingBuffer({ capacity: 5 });
  rb.push(1); rb.push(2); rb.push(3);
  rb.clear();
  assert.equal(rb.size(), 0);
  assert.deepEqual(rb.snapshot(), []);
});

test('ring buffer: dumpToBlob produces JSON', () => {
  const rb = createRingBuffer({ capacity: 3 });
  rb.push({ a: 1 });
  rb.push({ b: 2 });
  const dumped = rb.dumpToBlob();
  // Node path returns string
  if (typeof dumped === 'string') {
    assert.deepEqual(JSON.parse(dumped), [{ a: 1 }, { b: 2 }]);
  } else {
    // Blob path — verify type
    assert.equal(dumped.type, 'application/json');
  }
});

test('ring buffer: validation throws', () => {
  assert.throws(() => createRingBuffer({}), /capacity must be a positive number/);
  assert.throws(() => createRingBuffer({ capacity: 0 }), /capacity must be a positive number/);
  assert.throws(() => createRingBuffer({ capacity: -1 }), /capacity must be a positive number/);
});

test('captureFrame produces pure-data SampleRecord from duck-typed anchor', () => {
  const anchor = {
    position: { x: 1, y: 2, z: 3 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  };
  const target = {
    position: { x: 10, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  };
  const sample = captureFrame({
    frame: 5,
    t: 83.335,
    dt: 16.667,
    anchor,
    target,
    input: { keys: ['KeyW'] },
    state: { phase: 'CRUISE' },
  });
  assert.deepEqual(sample.anchor.pos, [1, 2, 3]);
  assert.deepEqual(sample.anchor.quat, [0, 0, 0, 1]);
  assert.deepEqual(sample.target.pos, [10, 0, 0]);
  assert.equal(sample.frame, 5);
  assert.equal(sample.dt, 16.667);
  assert.deepEqual(sample.input, { keys: ['KeyW'] });
  assert.deepEqual(sample.state, { phase: 'CRUISE' });
  // Pure-data invariant: must round-trip through JSON
  const round = JSON.parse(JSON.stringify(sample));
  assert.deepEqual(round, sample);
});

test('bindCaptureToBuffer increments frame + dt automatically', () => {
  const rb = createRingBuffer({ capacity: 100 });
  const cap = bindCaptureToBuffer({ buffer: rb });
  const a1 = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
  const a2 = { position: { x: 1, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
  cap.tick(0, a1);
  cap.tick(16.667, a2);
  cap.tick(33.333, a2);
  const snap = rb.snapshot();
  assert.equal(snap.length, 3);
  assert.equal(snap[0].frame, 0);
  assert.equal(snap[0].dt, 0);
  assert.equal(snap[1].frame, 1);
  assert.equal(snap[1].dt, 16.667);
  assert.equal(snap[2].frame, 2);
  assert.ok(Math.abs(snap[2].dt - 16.666) < 1e-9, `expected dt~16.666, got ${snap[2].dt}`);
});

test('on-failure dump: capture continues for trailingFrames after first failure', async () => {
  const rb = createRingBuffer({ capacity: 100 });
  const tmpFile = `/tmp/kit-test-dump-${Date.now()}.json`;
  let writerCalled = false;
  let writerSnapshot = null;
  const dumper = attachOnFailureDump({
    buffer: rb,
    predicateChecks: [
      { name: 'delta-bound', fn: deltaMagnitudeBound, options: { axis: 'x', bound: 5 } },
    ],
    trailingFrames: 5,
    checkEveryFrames: 1,  // check every frame for the test
    dumpPath: tmpFile,
    writer: (snap, path) => {
      writerCalled = true;
      writerSnapshot = snap;
    },
  });

  // Push smooth motion (passes)
  for (let i = 0; i < 5; i++) {
    dumper.tick({ frame: i, t: i * 16, dt: 16, anchor: { pos: [i, 0, 0], quat: [0,0,0,1] }, target: null, input: {}, state: {} });
  }
  assert.equal(dumper.hasFired(), false);

  // Inject a teleport (fails delta-bound)
  dumper.tick({ frame: 5, t: 80, dt: 16, anchor: { pos: [200, 0, 0], quat: [0,0,0,1] }, target: null, input: {}, state: {} });
  assert.equal(dumper.hasFired(), true);

  // Continue ticking for trailing frames
  for (let i = 6; i < 12; i++) {
    dumper.tick({ frame: i, t: i * 16, dt: 16, anchor: { pos: [200 + i, 0, 0], quat: [0,0,0,1] }, target: null, input: {}, state: {} });
  }

  // Writer should have been called (trailing window of 5 elapsed)
  assert.equal(writerCalled, true);
  assert.ok(writerSnapshot.length > 0);
  // The snapshot must include the failing frame
  const failFrame = writerSnapshot.find(s => s.frame === 5);
  assert.ok(failFrame, 'snapshot must include the frame that triggered failure');

  dumper.detach();
});

test('on-failure dump: detach stops processing', () => {
  const rb = createRingBuffer({ capacity: 50 });
  const dumper = attachOnFailureDump({
    buffer: rb,
    predicateChecks: [],
    writer: () => {},
  });
  dumper.detach();
  assert.equal(dumper.isTracking(), false);
  // tick() after detach is a no-op
  dumper.tick({ frame: 0, t: 0, dt: 0, anchor: { pos: [0,0,0], quat: [0,0,0,1] }, target: null, input: {}, state: {} });
  assert.equal(rb.size(), 0);
});
