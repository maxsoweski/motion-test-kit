// On-failure dump pipeline. Wraps a ring buffer + a set of predicate
// checks; when any check fires `passed: false`, captures the buffer state
// plus a configurable trailing span and writes it via the host-supplied
// writer. The writer is required — the kit's core does not embed a
// default I/O path, because that would couple core to either DOM or
// node:fs. Consumers pass either:
//
//   - the node writer from `adapters/node/fs-writer.js` (writes to disk)
//   - the browser writer from `adapters/dom/blob-download-writer.js`
//     (download-triggers a Blob via an anchor click)
//   - a custom writer (e.g., POST to a telemetry endpoint)
//
// Pattern:
//   const buffer = createRingBuffer({ capacity: 600 });   // last 10s @ 60 Hz
//   const detach = attachOnFailureDump({
//     buffer,
//     predicateChecks: [{ name: 'monotonicity', fn: monotonicityScore, options: {...} }],
//     trailingFrames: 60,
//     dumpPath: '/path/to/dump.json',
//     writer: nodeFsWriter,  // or blobDownloadWriter, or your own
//   });
//   // Host calls dumper.tick(sample) per frame; on first failed predicate,
//   // dumper continues capturing for `trailingFrames` more frames, then
//   // invokes writer with the buffer snapshot and dumpPath.

/**
 * @typedef {object} PredicateCheck
 * @property {string} name
 * @property {(samples: Array, options: any) => { passed: boolean, violations: Array }} fn
 * @property {any} options
 */

/**
 * @typedef {(snapshot: Array, path: string) => void | Promise<void>} DumpWriter
 */

/**
 * @typedef {object} OnFailureDumpOptions
 * @property {ReturnType<typeof import('./ring-buffer.js').createRingBuffer>} buffer
 * @property {PredicateCheck[]} predicateChecks
 * @property {DumpWriter} writer                  REQUIRED — host supplies the I/O path
 * @property {number} [trailingFrames]            frames to capture after first failure (default 60)
 * @property {string} [dumpPath]                  forwarded to writer (default './on-failure-dump.json')
 * @property {number} [checkEveryFrames]          run predicates every N frames (default 30)
 */

/**
 * @param {OnFailureDumpOptions} options
 * @returns {{ tick: (sample: any) => void, detach: () => void, isTracking: () => boolean, hasFired: () => boolean }}
 */
export function attachOnFailureDump(options) {
  if (!options || !options.buffer) throw new Error('attachOnFailureDump: options.buffer required');
  if (!Array.isArray(options.predicateChecks)) throw new Error('attachOnFailureDump: options.predicateChecks (array) required');
  if (typeof options.writer !== 'function') throw new Error('attachOnFailureDump: options.writer (function) required — pass nodeFsWriter or blobDownloadWriter');

  const buffer = options.buffer;
  const checks = options.predicateChecks;
  const trailingFrames = options.trailingFrames ?? 60;
  const dumpPath = options.dumpPath ?? './on-failure-dump.json';
  const checkEvery = options.checkEveryFrames ?? 30;
  const writer = options.writer;

  let frameCounter = 0;
  let trailingRemaining = -1;  // -1 = not in trailing-capture mode
  let hasFired = false;
  let attached = true;

  return {
    tick(sample) {
      if (!attached) return;
      buffer.push(sample);
      frameCounter++;

      if (trailingRemaining > 0) {
        trailingRemaining--;
        if (trailingRemaining === 0) {
          // Trailing span done — dump
          const snapshot = buffer.snapshot();
          Promise.resolve(writer(snapshot, dumpPath)).catch(e => {
            if (typeof console !== 'undefined') console.error('[on-failure-dump] writer failed:', e);
          });
          trailingRemaining = -1;
        }
        return;
      }

      // Not in trailing mode — run checks periodically
      if (hasFired) return;
      if (frameCounter % checkEvery !== 0) return;

      const samples = buffer.snapshot();
      if (samples.length < 2) return;
      for (const c of checks) {
        const r = c.fn(samples, c.options);
        if (!r.passed) {
          hasFired = true;
          trailingRemaining = trailingFrames;
          if (typeof console !== 'undefined') {
            console.warn(`[on-failure-dump] ${c.name} failed (${r.violations.length} violations); capturing ${trailingFrames} trailing frames before dump`);
          }
          break;
        }
      }
    },
    detach() {
      attached = false;
    },
    isTracking() {
      return attached;
    },
    hasFired() {
      return hasFired;
    },
  };
}
