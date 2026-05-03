// FNV-1a 32-bit hash. Pure. Used by transform-hash for fast trajectory
// comparison.
//
// Reference: http://www.isthe.com/chongo/tech/comp/fnv/index.html
// Period 2^32; collision rate is fine for trajectory regression
// detection (we're matching golden hashes, not securing crypto).
//
// Operates on byte sequences (Uint8Array | Array<int>) or strings (UTF-16
// code unit pairs treated as bytes). The transform-hash module uses the
// integer-array form; the string form is provided for convenience.

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * Hash a Uint8Array / number[]. Each element is masked to 8 bits.
 * @param {Uint8Array | number[]} bytes
 * @returns {number}  uint32 hash
 */
export function fnv1aBytes(bytes) {
  let h = FNV_OFFSET_BASIS;
  for (let i = 0; i < bytes.length; i++) {
    h ^= (bytes[i] & 0xFF);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/**
 * Hash a string (UTF-16 code unit ↦ 2 bytes each).
 * @param {string} s
 * @returns {number}  uint32 hash
 */
export function fnv1aString(s) {
  let h = FNV_OFFSET_BASIS;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h ^= (c & 0xFF);
    h = Math.imul(h, FNV_PRIME);
    h ^= ((c >>> 8) & 0xFF);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/**
 * Hash a stream of int32 values (treated little-endian as 4 bytes each).
 * Used by transform-hash to combine quantized x/y/z/qx/qy/qz/qw.
 * @param {number[]} ints
 * @returns {number}  uint32 hash
 */
export function fnv1aInts(ints) {
  let h = FNV_OFFSET_BASIS;
  for (let i = 0; i < ints.length; i++) {
    let v = ints[i] | 0;  // force int32
    for (let b = 0; b < 4; b++) {
      h ^= (v & 0xFF);
      h = Math.imul(h, FNV_PRIME);
      v = v >>> 8;
    }
  }
  return h >>> 0;
}

/**
 * Format a uint32 hash as an 8-char lowercase hex string.
 * @param {number} h
 * @returns {string}
 */
export function toHex(h) {
  return (h >>> 0).toString(16).padStart(8, '0');
}
