// Golden-trajectory workflow. Records a known-good trajectory hash to
// disk; future runs verify against it.
//
// A "scenario" is a deterministic function: given a fresh RNG and an
// accumulator, it produces a sample stream. The kit doesn't constrain
// what the scenario does — it could be a tiny synthetic sim or a full
// well-dipper autopilot tour. The contract: the scenario is reproducible
// (uses seeded RNG, fixed-step accumulator, no `Math.random`/`Date.now`).
//
// Workflow:
//   1. Develop the scenario; ship it stable.
//   2. recordGolden({ scenario, outputPath, writer }) — runs once,
//      produces hashTrajectory + raw samples, writer commits to disk.
//   3. Future runs: verifyAgainstGolden({ scenario, goldenPath, reader,
//      tolerance }) — runs same scenario, compares, returns mismatch
//      diagnostics.
//   4. Intentional behavior change → re-bless the golden:
//      recordGolden again, commit the new file with a message naming
//      the change.
//
// I/O is required (writer + reader callbacks). Core stays pure; node
// supplies file I/O via adapters/node/fs-writer.js and a sibling reader.

import { hashTrajectory, compareTrajectoryHashes } from './transform-hash.js';

/**
 * @typedef {object} GoldenFile
 * @property {string} kitVersion          motion-test-kit version that recorded the golden
 * @property {string} scenarioName        human-readable scenario name
 * @property {number} tolerance           quantization grid used
 * @property {number} hash                rollup uint32
 * @property {string} hashHex
 * @property {Array<{frame: number, hash: number}>} perFrameHashes
 * @property {number} sampleCount
 * @property {string} recordedAt          ISO timestamp
 */

/**
 * Record a golden trajectory.
 *
 * @param {object} options
 * @param {() => Array} options.scenario           returns sample stream
 * @param {string} options.scenarioName            stored in golden file
 * @param {string} options.outputPath              forwarded to writer
 * @param {(snapshot: object, path: string) => void | Promise<void>} options.writer
 * @param {number} [options.tolerance]             default 1e-6
 * @param {number} [options.hashEvery]             default 1
 * @param {string} [options.kitVersion]            default '0.1.0'
 * @returns {Promise<GoldenFile>}
 */
export async function recordGolden(options) {
  if (!options) throw new Error('recordGolden: options required');
  if (typeof options.scenario !== 'function') throw new Error('recordGolden: options.scenario (function) required');
  if (typeof options.scenarioName !== 'string') throw new Error('recordGolden: options.scenarioName (string) required');
  if (typeof options.writer !== 'function') throw new Error('recordGolden: options.writer (function) required');
  if (typeof options.outputPath !== 'string') throw new Error('recordGolden: options.outputPath (string) required');

  const samples = options.scenario();
  const tolerance = options.tolerance ?? 1e-6;
  const hashEvery = options.hashEvery || 1;
  const result = hashTrajectory(samples, { tolerance, hashEvery });
  const golden = {
    kitVersion: options.kitVersion ?? '0.1.0',
    scenarioName: options.scenarioName,
    tolerance,
    hashEvery,
    hash: result.hash,
    hashHex: result.hashHex,
    perFrameHashes: result.perFrameHashes,
    sampleCount: result.sampleCount,
    recordedAt: new Date().toISOString(),
  };
  await options.writer(golden, options.outputPath);
  return golden;
}

/**
 * Verify a re-run against an existing golden file.
 *
 * @param {object} options
 * @param {() => Array} options.scenario
 * @param {string} options.goldenPath
 * @param {(path: string) => Promise<GoldenFile> | GoldenFile} options.reader
 * @param {number} [options.tolerance]   override (defaults to golden's recorded tolerance)
 * @returns {Promise<{ passed: boolean, firstMismatchFrame: number|null, mismatchCount: number, lengthMatch: boolean, golden: GoldenFile, current: ReturnType<typeof hashTrajectory> }>}
 */
export async function verifyAgainstGolden(options) {
  if (!options) throw new Error('verifyAgainstGolden: options required');
  if (typeof options.scenario !== 'function') throw new Error('verifyAgainstGolden: options.scenario required');
  if (typeof options.reader !== 'function') throw new Error('verifyAgainstGolden: options.reader required');
  if (typeof options.goldenPath !== 'string') throw new Error('verifyAgainstGolden: options.goldenPath required');

  const golden = await options.reader(options.goldenPath);
  const tolerance = options.tolerance ?? golden.tolerance;
  const hashEvery = golden.hashEvery || 1;
  const samples = options.scenario();
  const current = hashTrajectory(samples, { tolerance, hashEvery });
  const cmp = compareTrajectoryHashes(current, golden);
  return { ...cmp, golden, current };
}
