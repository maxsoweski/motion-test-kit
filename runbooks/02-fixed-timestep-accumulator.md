# RUNBOOK 02 — Fixed-Timestep Accumulator (technique #2)

## When to use

Use the accumulator whenever **simulation correctness** depends on dt
behavior — and that's nearly every motion-class system. Concrete triggers:

- Anything you intend to verify with predicates (#1) that depend on
  per-frame Δ — variable dt makes "per-frame Δ" meaningless because the
  same simulated motion produces different Δ values at different frame
  rates.
- Anything you intend to replay (#3) — replays at the same wall-clock
  cadence produce different sim trajectories under variable dt.
- Anything you intend to regression-test against a golden trajectory (#4)
  — the trajectory is non-deterministic without a fixed step.
- Physics integrators that aren't inherently dt-stable (semi-implicit
  Euler, Verlet) accumulate drift at variable dt.

Don't use the accumulator for purely cosmetic, render-tick concerns:
particle puffs, sky-shader time uniforms, FPS counters, audio BPM clocks
(those have their own clock domain). Cosmetic systems use real-dt; sim
systems use the fixed-step. The divide IS the point of the accumulator.

## How to invoke from a brief AC

ACs in motion-class workstream briefs cite the accumulator implicitly via
the predicates that depend on it. Direct AC text typically reads:

> "Sim runs at fixed step (stepMs = 16.667, 60 Hz). Render runs every RAF
> with `alpha` interpolation between sim states. Verifiable: telemetry
> capture shows `dt` in every recorded sample equals 16.667 ± 1e-9."

The "Verifiable" sentence translates to: the kit's `samples[i].dt` field
equals the fixed step on every record. If a sample's dt varies, the loop
isn't using the accumulator (or the recorder is on the render tick, not
the sim tick — see Common Pitfalls).

In the well-dipper migration workstream specifically, the brief AC will
be shaped:

> "Sim tick runs at fixed step; verified by capturing 60 frames of
> autopilot CRUISE motion and asserting `dt` constant + `stepsRun ≥ 1`
> on every RAF."

## What the Tester does with it

The Tester's invocation pattern for accumulator-related verification:

```js
import { createAccumulator } from 'motion-test-kit/core/loop/accumulator';
// or for full-loop verification:
import { bindToRAF } from 'motion-test-kit/adapters/three/three-loop-binding';

// Verify the accumulator math directly:
const acc = createAccumulator({ stepMs: 16.667 });
// ... drive with a known dt sequence, assert stepsRun + alpha
```

For verifying a host (well-dipper post-migration), the Tester captures a
window of telemetry samples and asserts:

```js
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

const samples = await captureFromHost({ scenario: 'autopilotCRUISE', durationMs: 1000 });
assert.equal(new Set(samples.map(s => s.dt)).size, 1, 'sim dt is fixed');
assert.equal(samples[0].dt, 16.667, 'sim dt matches expected stepMs');
```

The `node:test` runner is the kit's own test layer; for in-browser
verification, the same predicates run in `tests/three-loop-integration.test.js`
or in a kit-driven verifier under `chrome-devtools.evaluate_script`.

## Pass / fail evidence shape

**PASS:** every recorded `samples[i].dt` equals the configured `stepMs`
(within 1e-9 floating-point tolerance). `samples[i].alpha` ∈ [0, 1] on
every render-side sample. The Glenn Fiedler invariant holds: total
simulated time = `stepMs × sum(stepsRun)` ≈ wall-clock elapsed (modulo
spiral-of-death cap and initial alpha residual).

**FAIL signatures and what they mean:**
- `dt` varies → sample is on render tick, not sim tick. Move the
  capture point.
- `dt` is constant but doesn't equal `stepMs` → wrong accumulator
  config; check the host's `createAccumulator({ stepMs })` argument.
- `alpha` ever falls outside [0, 1] → accumulator math bug; report
  immediately, this is a kit-level defect.
- `stepsRun` is consistently 0 across many RAFs → real-dt feeding is
  broken; the host's `now()` source isn't advancing or `realDtMs` is
  zero.
- `stepsRun` spikes catastrophically (e.g., 100+ steps in one RAF) →
  `maxStepMs` cap not configured; spiral of death is in progress.

## Common pitfalls

1. **Sampling on the render tick when you mean the sim tick.** If the
   telemetry hook fires inside `render(alpha)`, `dt` will look like real
   frame time (variable). Move the capture into `simUpdate(stepMs)` for
   sim-state samples, or accept that render-tick samples carry the
   render's variable dt and document that in the AC.

2. **Mixing sim and render concerns in one update function.** Don't call
   `cube.rotation.y = cubeAngle` (a render concern) from inside
   `simUpdate(stepMs)`. The render reads sim state at frame time;
   simUpdate WRITES sim state. Mixing produces a system that looks like
   it works at one refresh rate and breaks at another.

3. **The spiral of death.** A paused tab + uncapped `realDtMs` produces
   a sim that catches up with thousands of steps in one RAF — the page
   freezes. Always configure `maxStepMs`. The kit's default of 250 ms
   sacrifices sim accuracy for liveness during pauses; that's the
   standard trade.

4. **Interpolation alpha not being used.** `bindToRAF`'s `render(alpha)`
   gets the [0, 1] residual every frame. If render ignores alpha and
   reads the latest sim state directly, motion will judder at
   refresh rates that don't divide evenly into the sim step. To render
   smoothly at 144 Hz with 60 Hz sim, the host must interpolate between
   the previous and current sim state using alpha. The kit doesn't ship
   interpolation primitives — that's host code (lerp positions, slerp
   quaternions). Document this in the host's render path.

5. **`now()` source mismatch in tests.** If the test stubs `rafProvider`
   but not `now`, the binding's first frame computes `dt = t - now()` —
   if `now()` returns the host's wall-clock and `t` is the stub's
   timestamp, dt will be negative or huge. Always stub both in tests.

6. **Floating-point drift in `cubeAngle += rate * dt`.** Over thousands
   of steps, the angle accumulates float rounding. For most game uses
   this is fine; for hash-equivalence regression testing (technique #4),
   apply tolerance bands or quantize before hashing.

7. **Audio clocks DON'T migrate to sim tick.** Audio runs in its own
   clock domain (the AudioContext's sample clock). A BPM beat that fires
   on the sim tick will be quantized to 60 Hz buckets and sound robotic.
   Audio is a render-tick (or independent-tick) concern; document the
   carve-out in the host.

8. **Hot-reload preserves accumulator state.** If your dev workflow
   hot-replaces the simUpdate function, the accumulator's residual
   carries the old delta. After a hot-reload, call `accumulator.reset()`
   to zero the residual. Otherwise the first post-reload tick can fire
   a burst of catch-up sim steps under the new function.

## Cross-references

- Glenn Fiedler, *Fix Your Timestep!* — https://gafferongames.com/post/fix_your_timestep/
- Erin Catto, *Determinism* (Box2D, Aug 2024) — https://box2d.org/posts/2024/08/determinism/
- `core/loop/accumulator.js` — implementation
- `adapters/three/three-loop-binding.js` — RAF wrapper
- `tests/accumulator.test.js`, `tests/three-loop-integration.test.js` — self-tests
- `labs/accumulator-lab.html` — end-to-end demo
