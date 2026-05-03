// Transform-hash — compresses a SampleRecord trajectory into a stream
// of per-frame hashes plus a single roll-up hash. Used for fast
// trajectory regression detection.
//
// Pattern:
//   const a = hashTrajectory(samplesA, { hashEvery: 1, tolerance: 1e-6 });
//   const b = hashTrajectory(samplesB, { hashEvery: 1, tolerance: 1e-6 });
//   if (a.hash === b.hash) { /* trajectories equivalent */ }
//   else { /* find first mismatchedFrame: a.perFrameHashes[i] !== b.perFrameHashes[i] */ }
//
// Tolerance band: each float value is quantized to a grid of size
// `tolerance` before hashing. Quantizing 0.1234567 with tolerance=1e-6
// yields integer 123457 (round, then to int). 0.1234568 also yields
// 123457 — same hash. 0.1234600 yields 123460 — different hash.
//
// This is the Box2D pattern Dana cited (see Phase 4 references). Floats
// don't have to be bit-equivalent; they have to round to the same grid
// cell. Adjustable to match the precision needs of the host's sim.

import { fnv1aInts } from './fnv1a.js';
import * as vec3 from '../math/vec3.js';

/**
 * @typedef {object} HashTrajectoryOptions
 * @property {number} [hashEvery]   include every Nth frame (default 1 = every frame)
 * @property {number} [tolerance]   quantization grid (default 1e-6)
 * @property {boolean} [includeQuat]  hash quat alongside pos (default true)
 * @property {boolean} [includeTarget]  hash target.pos/quat alongside anchor (default true; null target → skipped)
 */

/**
 * @typedef {object} HashTrajectoryResult
 * @property {number} hash               uint32 — the roll-up hash
 * @property {string} hashHex            8-char hex of `hash`
 * @property {Array<{frame: number, hash: number}>} perFrameHashes
 * @property {number} sampleCount        number of frames included
 * @property {number} tolerance          options.tolerance used
 */

/**
 * @param {Array} samples
 * @param {HashTrajectoryOptions} [options]
 * @returns {HashTrajectoryResult}
 */
export function hashTrajectory(samples, options) {
  options = options || {};
  const hashEvery = options.hashEvery || 1;
  const tolerance = options.tolerance ?? 1e-6;
  const includeQuat = options.includeQuat !== false;
  const includeTarget = options.includeTarget !== false;

  const perFrameHashes = [];
  const rollIntoRollup = [];

  let count = 0;
  for (let i = 0; i < samples.length; i += hashEvery) {
    const s = samples[i];
    const ap = s.anchor.pos;
    const aq = s.anchor.quat;
    const ints = [
      vec3.quantize(ap[0], tolerance),
      vec3.quantize(ap[1], tolerance),
      vec3.quantize(ap[2], tolerance),
    ];
    if (includeQuat) {
      ints.push(vec3.quantize(aq[0], tolerance));
      ints.push(vec3.quantize(aq[1], tolerance));
      ints.push(vec3.quantize(aq[2], tolerance));
      ints.push(vec3.quantize(aq[3], tolerance));
    }
    if (includeTarget && s.target) {
      ints.push(vec3.quantize(s.target.pos[0], tolerance));
      ints.push(vec3.quantize(s.target.pos[1], tolerance));
      ints.push(vec3.quantize(s.target.pos[2], tolerance));
      if (includeQuat) {
        ints.push(vec3.quantize(s.target.quat[0], tolerance));
        ints.push(vec3.quantize(s.target.quat[1], tolerance));
        ints.push(vec3.quantize(s.target.quat[2], tolerance));
        ints.push(vec3.quantize(s.target.quat[3], tolerance));
      }
    }
    const h = fnv1aInts(ints);
    perFrameHashes.push({ frame: s.frame, hash: h });
    rollIntoRollup.push(h);
    count++;
  }
  const rollup = fnv1aInts(rollIntoRollup);
  return {
    hash: rollup,
    hashHex: (rollup >>> 0).toString(16).padStart(8, '0'),
    perFrameHashes,
    sampleCount: count,
    tolerance,
  };
}

/**
 * Compare two trajectories' per-frame hashes; report the first mismatched
 * frame plus a count.
 *
 * @param {HashTrajectoryResult} a
 * @param {HashTrajectoryResult} b
 * @returns {{ passed: boolean, firstMismatchFrame: number|null, mismatchCount: number, lengthMatch: boolean }}
 */
export function compareTrajectoryHashes(a, b) {
  const lengthMatch = a.perFrameHashes.length === b.perFrameHashes.length;
  if (a.hash === b.hash && lengthMatch) {
    return { passed: true, firstMismatchFrame: null, mismatchCount: 0, lengthMatch };
  }
  // Localize: first mismatched frame and total mismatch count
  const n = Math.min(a.perFrameHashes.length, b.perFrameHashes.length);
  let first = null;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (a.perFrameHashes[i].hash !== b.perFrameHashes[i].hash) {
      if (first === null) first = a.perFrameHashes[i].frame;
      count++;
    }
  }
  // Length mismatch counts as additional mismatches
  count += Math.abs(a.perFrameHashes.length - b.perFrameHashes.length);
  return { passed: false, firstMismatchFrame: first, mismatchCount: count, lengthMatch };
}
