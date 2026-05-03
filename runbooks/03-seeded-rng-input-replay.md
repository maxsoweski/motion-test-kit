# RUNBOOK 03 — Seeded RNG + Input Replay (technique #3)

## When to use

Use input replay when you need:

- **Reproducibility-class** verification — "the Tester re-running this
  scenario must produce byte-equivalent results to working-Claude's
  original capture." Without seeded RNG + recorded input, each rerun
  is a different scenario.
- **Regression isolation** — combined with technique #4 (transform-hash
  golden trajectory), replay catches the smallest behavioral change in
  motion code. Same input + same seed → same trajectory hash. Any
  change is a regression candidate.
- **Bug repro from a flight-recorder dump** — when technique #5 captures
  an escape, the captured InputRecord is replayable; you can step
  through the failure offline.

Don't use replay for:

- **Cross-machine determinism.** JS floating-point isn't bit-equivalent
  across hardware / browser / OS combinations. The contract is
  same-machine only. For cross-machine regression detection, use
  transform-hash with tolerance bands (technique #4).
- **Felt-experience evaluation.** Replay reproduces the simulation, not
  the rendering, audio, or display. A replay can confirm "same sim
  state" but says nothing about how it looks. Pair with a recording.
- **Adversarial input fuzzing.** The replay system records what
  happened; it doesn't synthesize new inputs. For property-based or
  fuzz-style testing, build on top (the kit doesn't ship fuzzing).

## How to invoke from a brief AC

ACs that benefit from replay are typically **regression-class** or
**reproducibility-class**:

### AC vocabulary

| AC vocabulary | Configuration |
|---|---|
| "scenario X reproduces byte-equivalent across replays" | createInputRecorder + createInputPlayer; transformHashEquivalence with tolerance 1e-12 |
| "Tester reruns produce identical trajectories" | record once, replay in Tester, compare with predicate |
| "soak-run input is committed and replayable" | InputRecord serialized to JSON, committed to test fixtures |
| "RNG-driven motion is deterministic given seed" | createRNG, restore from saved state, assert identical sequence |

### Example AC

> AC #X: The autopilot tour sequence "warp to Sol → autopilot to Earth"
> is reproducible. The recorded InputRecord at
> `tests/fixtures/sol-earth-tour.json` replayed against a fixed-step sim
> with seed 12345 produces a trajectory whose transform-hash equivalence
> against the golden trajectory at `tests/fixtures/sol-earth-tour.golden.json`
> passes within tolerance 1e-9.

That AC translates to:

```js
import { createInputPlayer } from 'motion-test-kit/core/replay/input-player';
import { createRNG } from 'motion-test-kit/core/rng/mulberry32';
import { transformHashEquivalence } from 'motion-test-kit/core/predicates';

const record = JSON.parse(fs.readFileSync('tests/fixtures/sol-earth-tour.json'));
const golden = JSON.parse(fs.readFileSync('tests/fixtures/sol-earth-tour.golden.json'));

let rng = null;
const trajectory = [];
const player = createInputPlayer({
  record,
  simUpdate: (stepMs) => {
    runOneSimStep(stepMs, rng);
    trajectory.push(captureFrame({ ... }));
  },
  applyEvent: (e) => {
    if (e.kind === 'rngSeed') rng = createRNG(e.payload.seed);
    else applyInputToHost(e);
  },
});
while (player.tick()) {}
const result = transformHashEquivalence(trajectory, golden, { tolerance: 1e-9 });
assert.equal(result.passed, true);
```

## What the Tester does with it

The Tester's pattern for a replay-class AC:

1. **Read the record path** from the AC.
2. **Reconstruct the host sim** in a test harness — the same simUpdate
   used in production, called via the player. The sim is the host's
   responsibility; the kit just drives ticks.
3. **Wire applyEvent** to the host's input layer. For browser hosts:
   apply keydown/keyup to the equivalent of `_heldKeys`, mousemove to
   the targeting reticle's input, etc. For node sims: just store
   into a host state object.
4. **Run the player to completion** — `while (player.tick()) {}`.
5. **Capture the trajectory** during the run (use the kit's ring
   buffer or just push to an array).
6. **Compare against the golden** via `transformHashEquivalence`.
7. **Render verdict** PASS/FAIL/INSUFFICIENT.

## Pass / fail evidence shape

**PASS:**
- `transformHashEquivalence(replay, golden, { tolerance })` returns
  `{ passed: true, violations: [], totalSamples: N }`.
- Two consecutive replays of the same record produce identical
  trajectories (cross-replay determinism check at tolerance 1e-12).

**FAIL signatures:**

- **Replay vs replay diverges:** the simUpdate is non-deterministic.
  Common cause: `Math.random()` slipped in somewhere; replace with
  the seeded RNG. Or: `performance.now()` drives a timer; replace
  with sim-time.
- **Replay matches replay but diverges from golden:** real regression.
  The first divergence frame localizes the change.
- **Player.tick() doesn't advance:** record's totalFrames is 0 or the
  player's internal state is stuck. Inspect record snapshot.
- **applyEvent receives no rngSeed event:** the recorder didn't add
  it (host bug — likely passed seed: 0 by default and the kit's
  recorder skipped recording). Verify recorder construction.

## Common pitfalls

1. **`Math.random()` snuck in.** This is the #1 way replays diverge.
   Audit every `Math.random()` site in the sim path; replace with
   the seeded RNG. The host wires `applyEvent({ kind: 'rngSeed' })`
   to construct the RNG; sim code that needs randomness reads from
   that RNG, never from Math.random.

2. **`performance.now()` in sim path.** Same issue. Sim code uses
   the accumulator's stepMs, not real wall-clock. If sim code
   needs a "current time" (e.g., for animation phase), it should
   use the simulated time (frame × stepMs), not `performance.now()`.

3. **Cross-machine replay assumed.** JS float arithmetic varies
   slightly across CPU architectures, browser versions, even JIT
   tier transitions. The replay contract is same-machine. For
   cross-machine: use technique #4 with tolerance bands large
   enough to absorb hardware drift.

4. **isTrusted-equivalent semantics not maintained.** When replayed
   events are dispatched (synthetic), some browsers or framework
   code gates on `isTrusted: true`. Replay events are
   `isTrusted: false`. Document which fields the host's input layer
   reads (`code`, `key`, etc.) — those work fine on synthetic
   events. Don't depend on `isTrusted` for input filtering.

5. **Frame-vs-time confusion.** Events are keyed by frame INDEX, not
   wall-clock time. If your sim ticks at 60 Hz and you record an
   event at "0.5 seconds in", the event lives at frame 30. Replays
   apply at frame 30 regardless of how fast the replay runs. This
   is the correct behavior — sim time is decoupled from real time.

6. **Recording without ticking.** `recorder.record(event)` without
   `recorder.tick()` between frames piles all events at frame 0.
   The recorder's `tick()` advances the frame counter; the host
   must call it once per sim step.

7. **Replay applies events in order BUT sim runs first per frame.**
   The player advances sim FIRST, then applies frame-N events.
   This matches the live recording: live host's sim ran first, then
   events for the next frame's input arrived. Don't expect events
   at frame N to affect frame N's sim — they affect frame N+1.

   (If your AC requires events to apply BEFORE sim, restructure the
   recording so events are at frame N-1 with the same intent.)

8. **Mutable host state leaks across replay runs.** If the host's
   input state (e.g., `_heldKeys`) isn't reset before each replay,
   the second replay starts with the first's residual state.
   Always reset host state explicitly before constructing a new
   InputPlayer.

## Determinism limits (READ THIS BEFORE RELYING ON REPLAY)

JS floating-point arithmetic is **not** bit-deterministic across:

- Different browsers (Chrome / Firefox / Safari / Node).
- Different versions of the same browser.
- Different hardware (Intel / AMD / ARM; SIMD instructions vary).
- Different JIT optimization tiers (interpreter / baseline /
  optimizing — same browser, same code, different output).

What IS bit-deterministic:

- Same browser version, same OS, same CPU, same code path → same
  output. The replay contract.

For cross-machine regression detection, use **technique #4
transform-hash equivalence with tolerance bands**. The tolerance
should be larger than the float drift the cross-machine inconsistency
produces (typically 1e-6 to 1e-9, depending on accumulation depth).

If you need cross-machine bit-determinism (multiplayer leaderboards,
server-side validation), this kit doesn't deliver it. The
engineering required is substantial: integer fixed-point math,
controlled FMA usage, banned `Math.sin/cos/tan`, careful summation
order. Box2D's "Determinism" article (cited in README) describes
the rabbit hole. Out of scope.

## Cross-references

- `core/rng/mulberry32.js` — RNG implementation
- `core/replay/input-recorder.js` — recorder
- `core/replay/input-player.js` — player
- `adapters/dom/keyboard-mouse-bridge.js` — DOM event capture
- `tests/rng.test.js` — RNG self-tests including reference sequence
- `tests/replay-determinism.test.js` — replay round-trip determinism
- Source: `~/projects/well-dipper/research/motion-testing-methodology-2026-05-02.md`
  §"Seeded RNG + replay"
- Box2D, *Determinism*: https://box2d.org/posts/2024/08/determinism/
