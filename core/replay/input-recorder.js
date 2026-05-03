// Input recorder — captures a sparse stream of input events keyed by
// frame index. The first event in the record is always 'rngSeed' so
// replay restores the seed before any sim step.
//
// Event shape: { frame: number, kind: string, payload: object }
//
// Kind taxonomy:
//   'rngSeed'       — payload: { seed: number }      (always frame 0)
//   'keydown'       — payload: { code, key, repeat, ctrl, shift, alt, meta }
//   'keyup'         — payload: { code, key }
//   'mousemove'     — payload: { x, y, dx, dy, buttons }
//   'mousedown'     — payload: { x, y, button, buttons }
//   'mouseup'       — payload: { x, y, button, buttons }
//   'touchstart'    — payload: { id, x, y }
//   'touchmove'     — payload: { id, x, y }
//   'touchend'      — payload: { id }
//   'wheel'         — payload: { dx, dy, dz }
//
// Hosts can extend the kind taxonomy for application-specific events
// (e.g., 'autopilotToggle'); the kit's player applies any kind it
// receives to the host's applyEvent callback. The kind taxonomy above
// is the conventional set for browser input.

/**
 * @typedef {object} InputEvent
 * @property {number} frame
 * @property {string} kind
 * @property {object} payload
 */

/**
 * @typedef {object} InputRecord
 * @property {number} rngSeed       seed restored before any sim step
 * @property {InputEvent[]} events  chronological by frame; sparse (only frames with events)
 * @property {number} totalFrames   total simulated frames in this record
 * @property {number} stepMs        the sim step the record was captured at (informational)
 */

/**
 * @typedef {object} InputRecorder
 * @property {(event: { kind: string, payload: object }) => void} record
 *   Append an event for the current frame. Frame index is auto-assigned
 *   from the recorder's internal counter (advanced via tick()).
 * @property {() => void} tick                advance the frame counter (call once per sim step)
 * @property {() => InputRecord} snapshot     pure-data InputRecord for replay or persistence
 * @property {() => number} currentFrame
 */

/**
 * @param {object} options
 * @param {number} options.rngSeed                the seed to record at frame 0
 * @param {number} [options.stepMs]               informational; default 16.667
 * @returns {InputRecorder}
 */
export function createInputRecorder(options) {
  if (!options || typeof options.rngSeed !== 'number') {
    throw new Error('createInputRecorder: options.rngSeed (number) required');
  }
  const stepMs = options.stepMs ?? 16.667;
  const events = [];
  let frame = 0;

  // Always record the seed at frame 0
  events.push({ frame: 0, kind: 'rngSeed', payload: { seed: options.rngSeed } });

  return {
    record(event) {
      if (!event || typeof event.kind !== 'string') {
        throw new Error('inputRecorder.record: event.kind (string) required');
      }
      events.push({
        frame,
        kind: event.kind,
        payload: event.payload || {},
      });
    },
    tick() {
      frame++;
    },
    currentFrame() {
      return frame;
    },
    snapshot() {
      return {
        rngSeed: options.rngSeed,
        events: events.slice(),  // copy
        totalFrames: frame,
        stepMs,
      };
    },
  };
}
