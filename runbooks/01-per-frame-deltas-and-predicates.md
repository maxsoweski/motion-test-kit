# RUNBOOK 01 — Per-Frame Δ and Predicates (technique #1)

## When to use

Use predicates whenever an AC names an **invariant-class** motion
property — something that should hold every frame, every phase, or every
sub-step of the simulation. The bug class this technique catches:
oscillation, teleport-cycles, drift under zero input, overshoot,
illegal phase transitions. The toggle-fix bug Max saw in the recording
(camera teleporting back-and-forth relative to planets while autopilot
was active) is the load-bearing example — coarse-sampling state-machine
telemetry called PASS while a per-frame Δ predicate would have flagged
it immediately.

Don't use predicates for:
- **Felt-experience gates** (game-feel, juice). Recording is the right
  tool there. Predicates measure properties; they don't measure how
  motion *feels*.
- **Cross-machine regression detection.** Use the transform-hash with
  tolerance band (technique #4) for that. Predicates run per-machine
  and catch the same bug class twice if the bug is hardware-dependent.
- **Behaviors that can't be stated as invariants.** "Camera should
  feel cinematic during APPROACH" can't be a predicate. Reword it as
  "approach-phase invariant: distance to target is non-increasing"
  and now it is.

## How to invoke from a brief AC

PM authors AC text that names the invariant explicitly using the
vocabulary table below. Tester reads the AC, picks the matching
predicate, runs it against a kit-shape sample stream, asserts the
return value's `.passed` field.

### AC vocabulary → predicate mapping

| AC vocabulary (in brief) | Predicate function | Required options |
|---|---|---|
| "no per-frame teleport > N units along axis A" | `deltaMagnitudeBound` | `axis`, `bound` |
| "approach-phase invariant: d_target non-increasing" | `approachPhaseInvariant` | `phaseStart`, `phaseEnd`, `eps` |
| "no oscillation during phase X" | `monotonicityScore` and/or `signStability` | `axis`, `windowFrames`, `maxFlipsPerWindow` |
| "zero input → no drift in body frame" | `zeroInputNullAction` | `inputAxes`, `deltaAxes`, `tolerance` |
| "no NaN/explosion" / "velocity bounded by c" | `velocityBound` | `axis` (or `'mag'`), `cMax` |
| "state machine well-formed" | `stateTransitionWellFormed` | `stateMachine` (adjacency), `stateField` |
| "refactor preserves trajectory within tol" | `transformHashEquivalence` | `tolerance`, `hashEvery` |
| "frame pacing smooth" | `frameTimeVariance` | `vMax` |

### Example AC

> AC #4 (motion-class): During an active autopilot CRUISE phase
> (`shipPhase === 'CRUISE'`), the camera position must not exhibit
> oscillation. **Continuity invariant**: monotonicity score on the Z
> axis over a 30-frame rolling span has < 5 sign flips. **Spike
> bound**: per-frame |Δz| < 2× max thrust × dt.

That AC translates to:

```js
import { monotonicityScore, deltaMagnitudeBound, runAll } from 'motion-test-kit/core/predicates';

const samples = await captureCRUISEPhase({ durationMs: 5000 });
const out = runAll(samples, [
  { name: 'monotonicity-z',  fn: monotonicityScore,    options: { axis: 'z', windowFrames: 30, maxFlipsPerWindow: 5 } },
  { name: 'delta-bound-z',   fn: deltaMagnitudeBound,  options: { axis: 'z', bound: 2 * MAX_THRUST * STEP_MS } },
]);
assert.equal(out.passed, true);
```

## What the Tester does with it

The Tester subagent's pattern for a motion-class AC:

1. **Read the AC.** Identify the invariant vocabulary.
2. **Match to predicate.** Use the table above.
3. **Configure predicate options** from AC parameters (phase boundaries,
   bounds, tolerances).
4. **Capture a sample stream** at the to-be-shipped commit. Either:
   - In-browser via the well-dipper telemetry helper (returns
     SampleRecord shape directly post-AC #22 of the kit workstream)
   - In-node via a kit-internal lab harness using a stubbed simUpdate
5. **Run the predicate.** Assert `.passed === true`.
6. **On fail:** report the violations array (frame index + observed
   value + bound) so working-Claude can localize the regression.
7. **Render verdict.** PASS / FAIL / INSUFFICIENT per Tester audit
   shape.

## Pass / fail evidence shape

**PASS:** the predicate returns `{ passed: true, violations: [],
totalSamples: N }` where N is the captured sample count and is at least
the duration × 60 Hz. Optional secondary check: `runAll` over the
predicate suite the AC names returns `{ passed: true, byPredicate:
{...all true} }`.

**FAIL signatures:**

- **Empty `violations`, `passed: false`** — bug in the predicate or in
  the sample shape (predicate threw before counting). Report as kit
  defect.
- **Single-frame violation cluster** — a transient. Investigate the
  specific frame; could be a one-off rebase event or a predicate
  threshold set too tight. Re-run with looser tolerance to confirm.
- **Sustained violations across many frames** — real bug. The frame
  range narrows the surface to investigate.
- **`MissingFieldError` thrown** — sample shape is wrong, host bug.
  The host's capture path isn't populating `anchor.pos` or whatever
  the predicate requires. Fix at the capture site, not the predicate.

## Common pitfalls

1. **Predicate threshold set with no theoretical justification.**
   "delta-bound = 5" is a magic number. Where does 5 come from? The
   right answer is "2× max thrust × stepMs" or "10× the median Δ
   observed in known-good motion." If the threshold doesn't have a
   reason behind it, the test catches the wrong things and misses
   the real ones.

2. **Predicate runs against samples that aren't at sim-tick fidelity.**
   Pre-fixed-timestep host: samples come from variable-dt rAF, so
   `deltaMagnitudeBound` will naturally see large variations as a
   function of dt. Use `velocityBound` (which divides by dt) instead,
   OR run after the sim migrates to fixed-step (per the well-dipper
   migration workstream).

3. **Sample shape mismatch.** Predicates throw `MissingFieldError`
   when an expected field is absent. Read `core/predicates/sample-shape.md`
   before assuming "the host's existing telemetry is good enough" —
   it usually isn't. The kit-shape capture path lands in Phase 5 of
   the kit workstream (AC #22).

4. **Phase boundaries inferred wrong.** `signStability` and
   `approachPhaseInvariant` take `phaseStart` / `phaseEnd` frame
   indices. If you compute these from sample state ("first frame
   where `state.shipPhase === 'APPROACH'`"), you may include a
   transition frame where the host is mid-update. Off-by-one is
   common. Verify by inspecting the violations array — if the first
   violation is at the phase boundary, your boundary is off.

5. **Treating `monotonicityScore` as "is motion monotonic?"** It's
   not — it's "are there fewer than `maxFlipsPerWindow` reversals
   per `windowFrames` span?" A genuinely monotonic motion has 0
   flips; legitimate but smooth motion (e.g., a pursuit curve that
   decelerates) can have 0 too. Real oscillation has many flips.
   The threshold separates "smooth-but-curvy" from "oscillating."

6. **`zeroInputNullAction` against body-tracking.** If the host's
   manual mode tracks the focused body (camera follows planet's
   orbit), the player can have zero input but the camera moves
   because the BODY is moving. The predicate flags this as drift,
   but the right fix is to either (a) sample the camera in the
   body's frame (subtract the body's position), or (b) pass the
   body's position as `target.pos` and let the predicate compute
   relative motion. The kit's track-A-relative-to-B abstraction
   exists exactly for this case.

7. **`transformHashEquivalence` without fixed timestep.** Will
   produce non-equivalence noise from float drift accumulating at
   variable dt. The tolerance band has to be larger than the noise,
   which means it can't catch the regressions you want. Migrate to
   fixed timestep (kit technique #2) before relying on this
   predicate.

## Cross-references

- Source: `~/projects/well-dipper/research/motion-testing-methodology-2026-05-02.md` §"Predicates"
- The 9-row vocabulary table — Dana imported partly from signal
  processing and industrial-process control because game dev has no
  consensus vocabulary
- Bug-class taxonomy: invariant / regression / reproducibility — in
  Tester persona §"Motion-class verification — kit usage" (lands in
  Phase 5)
- `core/predicates/index.js` — implementation
- `core/predicates/sample-shape.md` — required sample shape
- `tests/predicates.test.js` — self-tests (positive + negative case
  per predicate)
