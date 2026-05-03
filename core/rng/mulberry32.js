// Mulberry32 — a fast, small, byte-deterministic seeded RNG.
//
// Reference: https://gist.github.com/tommyettinger/46a3a48b1cae3897fdf8c2929f5b6db8
// Period 2^32. Good for game-test reproducibility; not cryptographic.
//
// Why Mulberry32 vs alternatives:
//   - PCG32: better statistical quality, larger state, marginal cost in JS.
//   - xoshiro128**: similar quality, larger state.
//   - Math.random(): no seed control, browser-implementation-dependent.
// Mulberry32 is the smallest seedable option that's good enough for sim
// reproducibility. The kit's job is byte-equivalent reruns on the same
// machine; we don't need cryptographic strength.
//
// Pure factory; no engine deps; no globals.

/**
 * @typedef {object} SeededRNG
 * @property {() => number} next     [0, 1) float, like Math.random()
 * @property {() => number} state    current internal state (uint32, for save/restore)
 * @property {(s: number) => void} restore   restore from a previous state value
 */

/**
 * @param {number} seed   any uint32 value
 * @returns {SeededRNG}
 */
export function createRNG(seed) {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new Error('createRNG: seed must be a finite number');
  }
  // Force to uint32 range
  let s = seed >>> 0;
  return {
    next() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    state() {
      return s;
    },
    restore(newState) {
      if (typeof newState !== 'number' || !Number.isFinite(newState)) {
        throw new Error('rng.restore: state must be a finite number');
      }
      s = newState >>> 0;
    },
  };
}
