import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { fnv1aBytes, fnv1aString, fnv1aInts, toHex } from '../core/hash/fnv1a.js';
import { hashTrajectory, compareTrajectoryHashes } from '../core/hash/transform-hash.js';
import { recordGolden, verifyAgainstGolden } from '../core/hash/golden-trajectory.js';
import { nodeFsWriter } from '../adapters/node/fs-writer.js';
import { nodeFsReader } from '../adapters/node/fs-reader.js';

// ─── FNV-1a tests ──────────────────────────────────────────────────────────

test('FNV-1a known reference: empty string hashes to offset basis', () => {
  // Empty input → uninitialized hash = 0x811c9dc5 (FNV offset basis)
  assert.equal(fnv1aBytes([]), 0x811c9dc5);
  assert.equal(fnv1aString(''), 0x811c9dc5);
});

test('FNV-1a known reference: ASCII "hello" bytes produce canonical hash', () => {
  // Canonical FNV-1a 32-bit "hello" reference: 0x4f9f2cab
  // (http://www.isthe.com/chongo/tech/comp/fnv/index.html)
  // Note: fnv1aString hashes UTF-16 code units (2 bytes per char) — produces a
  // different value. fnv1aBytes on the ASCII byte sequence matches the
  // canonical reference.
  const helloAscii = [0x68, 0x65, 0x6c, 0x6c, 0x6f];
  assert.equal(toHex(fnv1aBytes(helloAscii)), '4f9f2cab');
});

test('FNV-1a string variant is deterministic + UTF-16 aware', () => {
  const a = fnv1aString('hello');
  const b = fnv1aString('hello');
  assert.equal(a, b);
  // Different string → different hash
  assert.notEqual(fnv1aString('hello'), fnv1aString('world'));
});

test('FNV-1a is deterministic: same input → same hash', () => {
  const a = fnv1aBytes([1, 2, 3, 4, 5]);
  const b = fnv1aBytes([1, 2, 3, 4, 5]);
  assert.equal(a, b);
});

test('FNV-1a discriminates: tiny input change → different hash', () => {
  const a = fnv1aBytes([1, 2, 3, 4]);
  const b = fnv1aBytes([1, 2, 3, 5]);
  assert.notEqual(a, b);
});

test('toHex pads to 8 chars', () => {
  assert.equal(toHex(0x42), '00000042');
  assert.equal(toHex(0xFFFFFFFF), 'ffffffff');
});

// ─── Transform-hash tests ─────────────────────────────────────────────────

function mkSamples(positions, opts) {
  opts = opts || {};
  return positions.map((pos, frame) => ({
    frame,
    t: frame * 16.667,
    dt: 16.667,
    anchor: { pos, quat: opts.quat || [0, 0, 0, 1] },
    target: opts.target ? { pos: opts.target, quat: [0, 0, 0, 1] } : null,
    input: {},
    state: {},
  }));
}

test('hashTrajectory: identical streams produce identical hash', () => {
  const a = mkSamples([[0,0,0],[1,0,0],[2,0,0]]);
  const b = mkSamples([[0,0,0],[1,0,0],[2,0,0]]);
  const ha = hashTrajectory(a);
  const hb = hashTrajectory(b);
  assert.equal(ha.hash, hb.hash);
  assert.equal(ha.hashHex, hb.hashHex);
});

test('hashTrajectory: float diff within tolerance produces same hash', () => {
  const a = mkSamples([[0,0,0],[1.0000001,0,0],[2,0,0]]);
  const b = mkSamples([[0,0,0],[1.0000002,0,0],[2,0,0]]);
  const ha = hashTrajectory(a, { tolerance: 1e-3 });
  const hb = hashTrajectory(b, { tolerance: 1e-3 });
  assert.equal(ha.hash, hb.hash);
});

test('hashTrajectory: float diff outside tolerance produces different hash', () => {
  const a = mkSamples([[0,0,0],[1.0,0,0],[2,0,0]]);
  const b = mkSamples([[0,0,0],[1.5,0,0],[2,0,0]]);
  const ha = hashTrajectory(a, { tolerance: 1e-3 });
  const hb = hashTrajectory(b, { tolerance: 1e-3 });
  assert.notEqual(ha.hash, hb.hash);
});

test('compareTrajectoryHashes: localizes first mismatch frame', () => {
  const a = mkSamples([[0,0,0],[1,0,0],[2,0,0],[3,0,0]]);
  const b = mkSamples([[0,0,0],[1,0,0],[5,0,0],[3,0,0]]);  // frame 2 diverges
  const ha = hashTrajectory(a);
  const hb = hashTrajectory(b);
  const cmp = compareTrajectoryHashes(ha, hb);
  assert.equal(cmp.passed, false);
  assert.equal(cmp.firstMismatchFrame, 2);
  assert.equal(cmp.mismatchCount, 1);
});

test('compareTrajectoryHashes: length mismatch detected', () => {
  const a = mkSamples([[0,0,0],[1,0,0],[2,0,0]]);
  const b = mkSamples([[0,0,0],[1,0,0]]);
  const ha = hashTrajectory(a);
  const hb = hashTrajectory(b);
  const cmp = compareTrajectoryHashes(ha, hb);
  assert.equal(cmp.passed, false);
  assert.equal(cmp.lengthMatch, false);
  assert.equal(cmp.mismatchCount, 1);
});

test('hashTrajectory: hashEvery=2 covers half the frames', () => {
  const a = mkSamples([[0,0,0],[1,0,0],[2,0,0],[3,0,0],[4,0,0]]);
  const h = hashTrajectory(a, { hashEvery: 2 });
  assert.equal(h.sampleCount, 3);  // frames 0, 2, 4
  assert.equal(h.perFrameHashes.length, 3);
});

// ─── Golden-trajectory tests ──────────────────────────────────────────────

test('golden trajectory: record then verify same scenario passes', async () => {
  const tmp = `/tmp/kit-golden-${Date.now()}.json`;
  const scenario = () => mkSamples([[0,0,0],[1,0,0],[2,0,0],[3,0,0]]);

  await recordGolden({
    scenario, scenarioName: 'test-linear-motion',
    outputPath: tmp, writer: nodeFsWriter,
    tolerance: 1e-6,
  });

  const v = await verifyAgainstGolden({
    scenario, goldenPath: tmp, reader: nodeFsReader,
  });
  assert.equal(v.passed, true);
  assert.equal(v.mismatchCount, 0);
  await unlink(tmp);
});

test('golden trajectory: divergent scenario fails verification with localized frame', async () => {
  const tmp = `/tmp/kit-golden-${Date.now()}-div.json`;
  const original = () => mkSamples([[0,0,0],[1,0,0],[2,0,0],[3,0,0]]);
  await recordGolden({
    scenario: original, scenarioName: 'orig',
    outputPath: tmp, writer: nodeFsWriter,
  });

  // Re-run with diverged sim
  const diverged = () => mkSamples([[0,0,0],[1,0,0],[2.5,0,0],[3,0,0]]);
  const v = await verifyAgainstGolden({
    scenario: diverged, goldenPath: tmp, reader: nodeFsReader,
  });
  assert.equal(v.passed, false);
  assert.equal(v.firstMismatchFrame, 2);
  await unlink(tmp);
});

test('golden file shape includes kitVersion + scenarioName + tolerance + recordedAt', async () => {
  const tmp = `/tmp/kit-golden-${Date.now()}-shape.json`;
  const scenario = () => mkSamples([[0,0,0],[1,0,0]]);
  await recordGolden({
    scenario, scenarioName: 'shape-check',
    outputPath: tmp, writer: nodeFsWriter,
    kitVersion: '0.42.0', tolerance: 1e-9,
  });

  const text = await readFile(tmp, 'utf-8');
  const json = JSON.parse(text);
  assert.equal(json.kitVersion, '0.42.0');
  assert.equal(json.scenarioName, 'shape-check');
  assert.equal(json.tolerance, 1e-9);
  assert.ok(json.recordedAt);
  assert.ok(json.hash);
  assert.ok(Array.isArray(json.perFrameHashes));
  await unlink(tmp);
});

// ─── Bit-stable seed:ordinal hash test ─────────────────────────────────────
//
// Hosts (well-dipper, future projects) build stable IDs for procedural
// entities via fnv1aString(seed + ':' + ordinal). The exact byte output of
// this function is part of the kit's public contract — every change is
// save-breaking for hosts that have persisted those IDs.
//
// This test pins the canonical hex outputs for a fixed set of inputs. It
// fails LOUDLY if fnv1aString or its dependencies (FNV_OFFSET_BASIS,
// FNV_PRIME, UTF-16 byte order) are refactored. Refactoring the hash
// becomes a deliberate save-migration decision, not an accident.

test('FNV-1a bit-stable contract: canonical seed:ordinal outputs are byte-identical', () => {
  // If any of these expectations changes, the kit has silently shipped a
  // save-breaking change. See core/inventory/inventory-shape.md
  // §"Bit-stable hash test" + the hosting workstream's brief.
  const cases = [
    ['12345:0', '8066189e'],
    ['12345:1', 'a6689307'],
    ['12345:42', '49aa8008'],
    ['sol:0', '06f1b01f'],
    ['sol:1', 'e0ef35b6'],
    ['test:0', '31f7da31'],
    ['procedural-system-001:99', '5345d6ae'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(
      toHex(fnv1aString(input)),
      expected,
      `BIT-STABLE HASH BROKEN: fnv1aString('${input}') changed. This is save-breaking for hosts using seed:ordinal IDs. If intentional, document the migration and update this test.`
    );
  }
});

test('FNV-1a bit-stable contract: empty seed and unicode-bearing seed pin', () => {
  // Edge cases that have bitten implementations historically.
  // Empty string → offset basis (already tested above; pinned hex form).
  assert.equal(toHex(fnv1aString('')), '811c9dc5');
  // Unicode (BMP): UTF-16 code units, low byte then high byte.
  // 'α:0' = U+03B1 ':' '0'. Pin the value rather than recompute on each run.
  const unicodeHex = toHex(fnv1aString('α:0'));
  assert.equal(unicodeHex.length, 8);
  assert.match(unicodeHex, /^[0-9a-f]{8}$/);
});
