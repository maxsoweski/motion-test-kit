// Pure-data vector helpers — array form `[x, y, z]`, no engine deps.
//
// Why array-form: the SampleRecord shape uses arrays, not THREE.Vector3 or
// any other engine-specific class. Arrays JSON-serialize predictably,
// survive structuredClone, and are zero-allocation when you reuse them.
// The kit's predicates need vector math but `core/` cannot import THREE,
// so this module supplies just enough math to read / compare / hash
// transforms.

/**
 * @typedef {[number, number, number]} Vec3
 * @typedef {[number, number, number, number]} Quat
 */

/**
 * Subtract two vectors, return a new array. Pure.
 * @param {Vec3} a
 * @param {Vec3} b
 * @returns {Vec3}
 */
export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * Dot product. Pure.
 * @param {Vec3} a
 * @param {Vec3} b
 * @returns {number}
 */
export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Length of a vector. Pure.
 * @param {Vec3} a
 * @returns {number}
 */
export function length(a) {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

/**
 * Squared length (avoids sqrt for comparison-only uses). Pure.
 * @param {Vec3} a
 * @returns {number}
 */
export function lengthSq(a) {
  return a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
}

/**
 * Distance between two points. Pure.
 * @param {Vec3} a
 * @param {Vec3} b
 * @returns {number}
 */
export function distance(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Sign of a number — returns -1, 0, or +1. Pure.
 * @param {number} n
 * @returns {number}
 */
export function sign(n) {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

/**
 * Quantize a number to a grid of size `tolerance`. Used by transform-hash
 * (Phase 4) for tolerance-band comparison à la Box2D. Pure.
 *
 * Quantizing 0.1234567 with tolerance=1e-3 yields 123 (an integer). The
 * predicate compares quantized values, not raw floats — so 0.1234567 and
 * 0.1234568 hash to the same bucket.
 *
 * @param {number} value
 * @param {number} tolerance  grid size; 1e-6 is a sensible default for sim
 * @returns {number}          quantized integer
 */
export function quantize(value, tolerance) {
  return Math.round(value / tolerance);
}
