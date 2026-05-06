// Three.js sample-capture adapter. Reads anchor (and optional target)
// transforms from THREE.Object3D-shaped objects into pure-data
// SampleRecord. Does NOT import THREE — duck-types `position` and
// `quaternion` fields. Any object with `.position.{x,y,z}` and
// `.quaternion.{x,y,z,w}` works (THREE.Object3D, custom, Babylon,
// arbitrary).
//
// Pure-data invariant: the recorded SampleRecord contains arrays only,
// no engine references. JSON.stringify works; structuredClone works;
// the record can be replayed in node tests.

/**
 * @typedef {object} ObjectLike  duck-typed Three.js Object3D-shaped
 * @property {{x: number, y: number, z: number}} position
 * @property {{x: number, y: number, z: number, w: number}} quaternion
 */

/**
 * @typedef {object} CaptureFrameOptions
 * @property {ObjectLike} anchor     subject being tracked
 * @property {ObjectLike} [target]   optional reference frame
 * @property {object} [input]        host-defined input snapshot
 * @property {object} [state]        host-defined state snapshot
 * @property {number} frame          frame index (host increments)
 * @property {number} t              time at sample (ms)
 * @property {number} dt             delta from previous sample (ms)
 */

/**
 * @typedef {object} SampleRecord (see core/predicates/sample-shape.md)
 * @property {number} frame
 * @property {number} t
 * @property {number} dt
 * @property {{ pos: [number,number,number], quat: [number,number,number,number] }} anchor
 * @property {{ pos: [number,number,number], quat: [number,number,number,number] } | null} target
 * @property {object} input
 * @property {object} state
 */

/**
 * Capture one frame's worth of state into a pure-data SampleRecord.
 *
 * @param {CaptureFrameOptions} options
 * @returns {SampleRecord}
 */
export function captureFrame(options) {
  if (!options || !options.anchor) throw new Error('captureFrame: options.anchor required');
  if (typeof options.frame !== 'number') throw new Error('captureFrame: options.frame (number) required');
  if (typeof options.t !== 'number') throw new Error('captureFrame: options.t (number) required');

  const anchor = options.anchor;
  const target = options.target;

  const ap = anchor.position;
  const aq = anchor.quaternion;

  const record = {
    frame: options.frame,
    t: options.t,
    dt: options.dt ?? 0,
    anchor: {
      pos: [ap.x, ap.y, ap.z],
      quat: [aq.x, aq.y, aq.z, aq.w],
    },
    target: target
      ? {
          pos: [target.position.x, target.position.y, target.position.z],
          quat: [target.quaternion.x, target.quaternion.y, target.quaternion.z, target.quaternion.w],
        }
      : null,
    input: options.input || {},
    state: options.state || {},
  };
  if (options.inventory) record.inventory = options.inventory;
  return record;
}

/**
 * Convenience: bind a capture loop to a buffer + a frame counter. Returns
 * a `tick(t, anchor, opts?)` function the host calls each frame; the
 * adapter handles frame-index increment, dt computation, and pushing into
 * the buffer.
 *
 * @param {object} options
 * @param {ReturnType<typeof import('../../core/recorder/ring-buffer.js').createRingBuffer>} options.buffer
 * @returns {{ tick: (t: number, anchor: ObjectLike, extras?: object) => SampleRecord, frameCount: () => number, reset: () => void }}
 */
export function bindCaptureToBuffer(options) {
  if (!options || !options.buffer) throw new Error('bindCaptureToBuffer: options.buffer required');
  const buffer = options.buffer;
  let frame = 0;
  let lastT = -1;
  return {
    tick(t, anchor, extras) {
      const dt = lastT < 0 ? 0 : (t - lastT);
      lastT = t;
      const sample = captureFrame({
        frame,
        t,
        dt,
        anchor,
        target: extras?.target,
        input: extras?.input,
        state: extras?.state,
        inventory: extras?.inventory,
      });
      buffer.push(sample);
      frame++;
      return sample;
    },
    frameCount() { return frame; },
    reset() { frame = 0; lastT = -1; },
  };
}
