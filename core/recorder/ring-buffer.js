// Fixed-capacity ring buffer for SampleRecord (or anything else). O(1)
// append; the buffer overwrites the oldest entry when full. On-demand
// snapshot returns the most-recent N entries in chronological order.
//
// The flight-recorder pattern: keep the last few seconds of state in
// memory at all times, dump to disk only when something interesting
// happens (a predicate fails, a manual trigger fires). Catches
// rare-condition bugs that don't fire during deliberate test runs.
//
// No engine imports. The optional `sampleFactory` lets the host
// pre-allocate sample objects to avoid per-frame GC pressure (relevant
// at 60+ Hz capture for long sessions).

/**
 * @typedef {object} RingBufferOptions
 * @property {number} capacity                    max entries retained; oldest overwritten when full
 * @property {() => any} [sampleFactory]          optional factory for pre-allocated entries
 *                                                 (record.copyFrom(source) replaces a write-by-value)
 */

/**
 * @typedef {object} RingBuffer
 * @property {(entry: any) => void} push          append; overwrites oldest if full
 * @property {() => Array<any>} snapshot          chronological copy of current contents
 * @property {() => Blob | string} dumpToBlob     JSON-serialize snapshot to a Blob (browser) or string (node)
 * @property {() => number} size                  current count (≤ capacity)
 * @property {() => void} clear                   reset
 * @property {number} capacity
 */

/**
 * @param {RingBufferOptions} options
 * @returns {RingBuffer}
 */
export function createRingBuffer(options) {
  if (!options || typeof options.capacity !== 'number' || !(options.capacity > 0)) {
    throw new Error('createRingBuffer: options.capacity must be a positive number');
  }
  const capacity = options.capacity | 0;
  // Use a fixed-size array with head/length indices. Avoids splice() costs.
  const data = new Array(capacity);
  let head = 0;        // next write index
  let length = 0;      // current count

  return {
    capacity,
    push(entry) {
      data[head] = entry;
      head = (head + 1) % capacity;
      if (length < capacity) length++;
    },
    size() {
      return length;
    },
    snapshot() {
      // Return entries in chronological (oldest-first) order.
      const out = new Array(length);
      const start = length < capacity ? 0 : head;
      for (let i = 0; i < length; i++) {
        out[i] = data[(start + i) % capacity];
      }
      return out;
    },
    dumpToBlob() {
      const snap = this.snapshot();
      const json = JSON.stringify(snap);
      // Browser path: return a Blob (consumer can download-trigger).
      // Node path: return the JSON string (consumer writes to disk).
      if (typeof Blob !== 'undefined') {
        return new Blob([json], { type: 'application/json' });
      }
      return json;
    },
    clear() {
      head = 0;
      length = 0;
      for (let i = 0; i < capacity; i++) data[i] = undefined;
    },
  };
}
