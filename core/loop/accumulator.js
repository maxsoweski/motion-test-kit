// Fixed-timestep accumulator — Glenn Fiedler's "Fix Your Timestep!" pattern.
//
//   https://gafferongames.com/post/fix_your_timestep/
//
// The accumulator decouples simulation rate from render rate. The simulation
// runs at a fixed step (e.g. 16.667 ms = 60 Hz). Real frame time is
// accumulated; whenever it crosses a step boundary, the simulation advances
// by exactly one step. Whatever fraction of a step remains is exposed as
// `alpha ∈ [0, 1]` for render-time interpolation between sim states.
//
// This module is engine-agnostic. It does not call `performance.now()`; the
// caller measures real-dt and passes it in. It does not import THREE, DOM,
// or any other binding. The host wires it into rAF (browser) or _process
// (Godot) via an adapter.
//
// Maximum-step cap: real-dt is clamped to `maxStepMs` before accumulation.
// Without the cap, a paused tab or a hitch produces a huge accumulated dt
// that the sim must catch up with, freezing the page (the "spiral of death"
// Fiedler names). The cap forfeits sim accuracy during a hitch in exchange
// for liveness.

/**
 * @typedef {object} AccumulatorOptions
 * @property {number} stepMs       fixed simulation step in milliseconds (e.g. 16.667 for 60 Hz)
 * @property {number} [maxStepMs]  upper bound on accepted real-dt (default 250 ms — 4 sim steps catch-up max at 60 Hz)
 */

/**
 * @typedef {object} AccumulatorTickResult
 * @property {number} stepsRun   number of fixed-step sim updates invoked this tick
 * @property {number} alpha      [0, 1] interpolation factor for render between previous and current sim state
 */

/**
 * @typedef {object} Accumulator
 * @property {(realDtMs: number, updateFn: (stepMs: number) => void) => AccumulatorTickResult} tick
 *   Advance the accumulator by `realDtMs` of real wall-clock time. Calls
 *   `updateFn(stepMs)` zero or more times — each call advances the sim by
 *   exactly `stepMs` of fixed-step simulated time.
 * @property {() => number} accumulated   current accumulated remainder in ms (for inspection / serialization)
 * @property {() => void}   reset         zero the accumulator (e.g. on scene reload)
 */

/**
 * Construct a fixed-timestep accumulator.
 * Pure factory; no closures over time, RNG, or external state.
 *
 * @param {AccumulatorOptions} options
 * @returns {Accumulator}
 */
export function createAccumulator(options) {
  if (!options || typeof options.stepMs !== 'number' || !(options.stepMs > 0)) {
    throw new Error('createAccumulator: options.stepMs must be a positive number');
  }
  const stepMs = options.stepMs;
  const maxStepMs = typeof options.maxStepMs === 'number' && options.maxStepMs > 0
    ? options.maxStepMs
    : 250;

  let accumulated = 0;

  return {
    tick(realDtMs, updateFn) {
      if (typeof realDtMs !== 'number' || !Number.isFinite(realDtMs) || realDtMs < 0) {
        throw new Error('accumulator.tick: realDtMs must be a non-negative finite number');
      }
      if (typeof updateFn !== 'function') {
        throw new Error('accumulator.tick: updateFn must be a function');
      }
      // Cap real-dt to bound spiral-of-death. Sim trades accuracy for
      // liveness during pauses / hitches; this is the standard Fiedler trade.
      const cappedDt = realDtMs > maxStepMs ? maxStepMs : realDtMs;
      accumulated += cappedDt;
      let stepsRun = 0;
      while (accumulated >= stepMs) {
        updateFn(stepMs);
        accumulated -= stepMs;
        stepsRun++;
      }
      const alpha = accumulated / stepMs;
      return { stepsRun, alpha };
    },
    accumulated() {
      return accumulated;
    },
    reset() {
      accumulated = 0;
    },
  };
}
