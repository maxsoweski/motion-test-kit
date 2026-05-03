// Input player — replays an InputRecord against a sim under fixed-step
// accumulator. The player advances frame-by-frame, applies events at
// their recorded frame indices, and calls simUpdate(stepMs) once per
// frame.
//
// The host supplies:
//   - simUpdate(stepMs): the sim tick (e.g., wraps the same simUpdate
//     used in production)
//   - applyEvent(event): translates a generic InputEvent into the host's
//     input state. Example for well-dipper: 'keydown'/'keyup' updates
//     `_heldKeys`; 'mousemove' updates targeting reticle; etc.
//
// Determinism contract: given the same InputRecord, the same simUpdate
// implementation, and the same RNG seed (recorded as the first event),
// the resulting trajectory is byte-equivalent across runs ON THE SAME
// MACHINE. Cross-machine determinism is out-of-scope (see
// runbooks/03-seeded-rng-input-replay.md §"Determinism limits").
//
// Pure factory; no engine deps. The seed-restore call is the consumer's
// responsibility — the player passes the rngSeed event to applyEvent
// like any other event; the host wires it to its RNG.

/**
 * @typedef {object} InputPlayerOptions
 * @property {import('./input-recorder.js').InputRecord} record
 * @property {(stepMs: number) => void} simUpdate
 * @property {(event: { frame: number, kind: string, payload: object }) => void} applyEvent
 */

/**
 * @typedef {object} InputPlayer
 * @property {() => boolean} tick           advance one frame; returns true if more frames remain
 * @property {() => boolean} isComplete     true when all recorded frames replayed
 * @property {() => number} currentFrame
 */

/**
 * @param {InputPlayerOptions} options
 * @returns {InputPlayer}
 */
export function createInputPlayer(options) {
  if (!options || !options.record) throw new Error('createInputPlayer: options.record required');
  if (typeof options.simUpdate !== 'function') throw new Error('createInputPlayer: options.simUpdate (function) required');
  if (typeof options.applyEvent !== 'function') throw new Error('createInputPlayer: options.applyEvent (function) required');

  const record = options.record;
  const simUpdate = options.simUpdate;
  const applyEvent = options.applyEvent;
  const events = record.events;
  const stepMs = record.stepMs ?? 16.667;
  const totalFrames = record.totalFrames;

  let frame = 0;
  let eventIdx = 0;

  // Apply pre-frame-0 events synchronously (rngSeed lives here).
  while (eventIdx < events.length && events[eventIdx].frame === 0) {
    applyEvent(events[eventIdx]);
    eventIdx++;
  }

  return {
    tick() {
      if (frame >= totalFrames) return false;
      // Advance one fixed-step sim
      simUpdate(stepMs);
      frame++;
      // Apply any events recorded for THIS new frame
      while (eventIdx < events.length && events[eventIdx].frame === frame) {
        applyEvent(events[eventIdx]);
        eventIdx++;
      }
      return frame < totalFrames;
    },
    isComplete() {
      return frame >= totalFrames;
    },
    currentFrame() {
      return frame;
    },
  };
}
