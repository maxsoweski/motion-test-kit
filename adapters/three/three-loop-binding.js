// Three.js / browser adapter — wraps requestAnimationFrame around the core
// accumulator. Hands the kit's accumulator pattern to a host that uses rAF.
//
// IMPORTANT: this adapter does NOT import THREE. The "three" segment in the
// path is conventional categorization — the adapter is a generic browser-rAF
// binding usable by any JS rendering library (THREE, Babylon, raw WebGL).
// Naming it "three-loop-binding" prevents a future engine adapter (Pixi,
// Babylon, the BabylonAdapter folks) from accidentally importing this and
// thinking it's their loop.
//
// Caller passes:
//   - `accumulator` from `core/loop/accumulator.js`
//   - `simUpdate(stepMs)` — fixed-step simulation tick. Called `stepsRun` times per RAF.
//   - `render(alpha)` — render call. Called once per RAF with the interpolation alpha.
//   - `now?` — optional timestamp source for tests; defaults to `performance.now()`.
//   - `rafProvider?` — optional rAF replacement for tests; defaults to `requestAnimationFrame`.
//
// Returns a controller `{ start, stop, isRunning }`. Idempotent: start while
// running is a no-op; stop while stopped is a no-op.

/**
 * @typedef {object} ThreeLoopBindingOptions
 * @property {ReturnType<typeof import('../../core/loop/accumulator.js').createAccumulator>} accumulator
 * @property {(stepMs: number) => void} simUpdate
 * @property {(alpha: number) => void} render
 * @property {() => number} [now]                   override timestamp source (default: performance.now)
 * @property {(cb: (t: number) => void) => number} [rafProvider]  override rAF (default: requestAnimationFrame)
 * @property {(handle: number) => void} [cancelProvider]          override cAF (default: cancelAnimationFrame)
 */

/**
 * @typedef {object} ThreeLoopBindingController
 * @property {() => void} start
 * @property {() => void} stop
 * @property {() => boolean} isRunning
 */

/**
 * @param {ThreeLoopBindingOptions} options
 * @returns {ThreeLoopBindingController}
 */
export function bindToRAF(options) {
  if (!options || !options.accumulator) {
    throw new Error('bindToRAF: options.accumulator required');
  }
  if (typeof options.simUpdate !== 'function') {
    throw new Error('bindToRAF: options.simUpdate must be a function');
  }
  if (typeof options.render !== 'function') {
    throw new Error('bindToRAF: options.render must be a function');
  }

  const accumulator = options.accumulator;
  const simUpdate = options.simUpdate;
  const render = options.render;
  const now = options.now || (() => performance.now());
  const raf = options.rafProvider || ((cb) => requestAnimationFrame(cb));
  const caf = options.cancelProvider || ((h) => cancelAnimationFrame(h));

  let running = false;
  let lastT = 0;
  let rafHandle = 0;

  function frame(t) {
    if (!running) return;
    const dt = t - lastT;
    lastT = t;
    const { alpha } = accumulator.tick(dt, simUpdate);
    render(alpha);
    rafHandle = raf(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastT = now();
      rafHandle = raf(frame);
    },
    stop() {
      if (!running) return;
      running = false;
      caf(rafHandle);
      rafHandle = 0;
    },
    isRunning() {
      return running;
    },
  };
}
