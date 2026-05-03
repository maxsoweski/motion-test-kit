# RUNBOOK 04 — Transform-Hash Golden Trajectory (technique #4)

## When to use

Use the golden-trajectory pattern when you need:

- **Regression-class** verification at scale. "Did this refactor change
  the camera trajectory?" answered in O(1) hash comparison instead of
  O(N) frame-by-frame inspection.
- **Cross-machine regression detection** — within tolerance bands. The
  hash-with-quantization pattern absorbs hardware-level float drift
  while still catching meaningful behavioral changes.
- **Long-soak comparison** — comparing a 10-minute trajectory against
  its golden takes one hash equality check, not 36000 frame
  comparisons.

Don't use the golden-trajectory pattern for:

- **Discovering new bugs.** A golden only tells you the scenario
  changed; it doesn't tell you the change is bad. The first run
  records the golden as "the way it currently behaves" — if the
  current behavior is buggy, the golden bakes the bug in. Pair with
  predicates (technique #1) for active assertion of correctness;
  use the golden only after predicates establish the scenario is
  good.
- **Felt-experience evaluation.** Recording is the right tool for
  game-feel; the hash says nothing about how the trajectory feels.

## How to invoke from a brief AC

ACs that benefit from golden-trajectory:

### AC vocabulary

| AC vocabulary | Configuration |
|---|---|
| "refactor preserves trajectory" | recordGolden once pre-refactor; verifyAgainstGolden post-refactor |
| "scenario X produces hash <hex>" | record committed; verify hash equality |
| "behavioral change to <feature> is intentional and re-blesses golden Y" | re-record golden + commit with message naming the change |
| "cross-machine equivalence within tolerance T" | record golden on one machine; verify on others with tolerance ≥ T |

### Example AC

> AC #X: The scenario "warp to Sol → autopilot tour to Earth" produces
> a transform-hash matching the golden at
> `tests/fixtures/sol-earth-tour.golden.json` (tolerance 1e-6). Any
> mismatch indicates either a regression or an intentional behavior
> change requiring a re-bless commit.

That AC translates to:

```js
import { verifyAgainstGolden } from 'motion-test-kit/core/hash/golden-trajectory';
import { nodeFsReader } from 'motion-test-kit/adapters/node/fs-reader';
import { createInputPlayer } from 'motion-test-kit/core/replay/input-player';
import { createRNG } from 'motion-test-kit/core/rng/mulberry32';

const scenario = () => {
  // Replay the recorded input against the production sim,
  // capture sample stream, return it.
  const record = JSON.parse(fs.readFileSync('tests/fixtures/sol-earth-tour.input.json'));
  const samples = [];
  let rng = null;
  const player = createInputPlayer({
    record,
    simUpdate: (stepMs) => { runSimStep(stepMs, rng); samples.push(captureFrame({...})); },
    applyEvent: (e) => { if (e.kind === 'rngSeed') rng = createRNG(e.payload.seed); else applyToHost(e); },
  });
  while (player.tick()) {}
  return samples;
};

const v = await verifyAgainstGolden({
  scenario,
  goldenPath: 'tests/fixtures/sol-earth-tour.golden.json',
  reader: nodeFsReader,
  tolerance: 1e-6,
});
assert.equal(v.passed, true,
  `golden mismatch at frame ${v.firstMismatchFrame} (${v.mismatchCount} total)`);
```

## What the Tester does with it

The Tester's pattern for a golden-class AC:

1. **Read the golden path** from the AC.
2. **Reconstruct the scenario** — typically a wrapper around an
   InputPlayer + the host's production sim.
3. **Run `verifyAgainstGolden`.** Returns `{ passed, firstMismatchFrame,
   mismatchCount, lengthMatch }`.
4. **On PASS:** scenario is regression-clean. Verdict PASS.
5. **On FAIL:** report the firstMismatchFrame to localize the
   regression. The mismatch may be:
   - **Real regression:** the change under review is unintentional.
     Verdict FAIL with frame index for working-Claude.
   - **Intentional behavior change:** the AC's caller knows the
     scenario should change (e.g., a feature is being added that
     affects the trajectory). The fix is to re-bless the golden in
     a separate commit; verdict PENDING_REBLESS until that lands.
   - **Tolerance too tight:** float drift exceeds the band on the
     current hardware. Verdict INSUFFICIENT — recommend tolerance
     loosening per cross-machine carve-out.

## Pass / fail evidence shape

**PASS:** `{ passed: true, mismatchCount: 0, lengthMatch: true,
golden: {...}, current: {...} }`. Hash strings match (`current.hashHex
=== golden.hashHex`).

**FAIL signatures:**

- **`firstMismatchFrame === 0`**: divergence at the very first frame.
  Likely an RNG seed mismatch, an initial-state difference, or the
  scenario doesn't reset properly between runs.
- **`firstMismatchFrame > 0` but `mismatchCount` is small (1-3)**:
  localized regression. Inspect the few frames around the mismatch
  for the change.
- **`firstMismatchFrame` early but `mismatchCount` large**: the
  regression cascades from an early frame. The fix is upstream of
  the cascade.
- **`lengthMatch: false`**: scenario produced a different number of
  samples than the golden. Either the scenario terminates earlier
  (sim crashed?) or the golden file is from a different run length.
- **`firstMismatchFrame: null` but `passed: false`**: shouldn't
  happen — the comparison logic guarantees mismatchFrame is set
  when passed is false. Report as kit defect.

## Re-bless workflow

When the AC's caller intentionally changes a scenario's behavior:

1. **Run the scenario** once with the new behavior; verify the new
   trajectory looks right (predicates on it, or eyeball the
   recording if it's a felt-experience change).
2. **`recordGolden`** with the same scenario + outputPath; the new
   golden file replaces the old.
3. **Commit the new golden file** with a message naming the
   intentional change. Example:
   ```
   re-bless: sol-earth-tour.golden.json — autopilot APPROACH speed
   reduced from 100 → 50 unit/sec per autopilot.md §A12
   ```
4. **The next verifyAgainstGolden** passes against the new golden.

The golden file's `kitVersion`, `scenarioName`, and `recordedAt`
fields help future-you (or future Tester) understand when and why
the golden was recorded.

## Common pitfalls

1. **Recording a golden over a buggy scenario.** The golden bakes in
   whatever behavior was current. If the scenario was buggy, the
   golden's hash matches "the buggy behavior." Future runs that
   accidentally fix the bug fail the golden. Always run predicates
   (technique #1) over the scenario before recording the golden;
   the predicates assert correctness, the golden then locks in the
   correct behavior.

2. **Tolerance too tight for the host.** Default 1e-6 works for
   well-controlled sims; larger sims with deep math chains
   accumulate float drift past 1e-6 within seconds. Symptom:
   golden passes locally, fails on the same machine after a Node
   version update. Loosen tolerance to absorb the drift; ideally
   match the host sim's actual precision (e.g., 1e-4 if the sim
   only writes positions in scene-units to 4 decimal places).

3. **Tolerance too loose.** A tolerance of 1e-1 absorbs nearly any
   regression except gross teleports. Catch tighter regressions
   need tolerance that's large enough to absorb noise but small
   enough to catch meaningful changes. Empirical rule: run the
   scenario 10 times in a row, observe the cross-run hash
   distribution, set tolerance to ~3× the natural variance.

4. **Re-blessing without naming the change.** "re-bless: golden updated"
   is a useless commit message. Future-you can't tell whether the
   golden change was intentional and what it represents. Always
   name the behavior change in the commit.

5. **Golden file path collisions.** Multiple ACs sharing one golden
   file is fragile — re-blessing for AC X breaks AC Y. Each AC
   gets its own golden file unless they genuinely test the same
   trajectory.

6. **Forgetting that golden depends on RNG seed + input + sim
   determinism.** If the scenario uses `Math.random()` or
   `performance.now()` anywhere in the sim path, the golden is
   non-deterministic and useless. Audit the scenario per technique
   #3's pitfalls (RUNBOOK 03) before recording.

7. **Per-frame hash storage cost.** A 36000-frame run stores 36000
   uint32 hashes (144 KB) in the golden file. For very long runs,
   bump `hashEvery` to 10 (every 10th frame) — golden file shrinks
   to 14.4 KB. Trade-off: localization granularity is 10 frames
   instead of 1.

## Cross-references

- `core/hash/fnv1a.js` — hash implementation
- `core/hash/transform-hash.js` — `hashTrajectory`,
  `compareTrajectoryHashes`
- `core/hash/golden-trajectory.js` — `recordGolden`,
  `verifyAgainstGolden`
- `adapters/node/fs-reader.js`, `adapters/node/fs-writer.js` — node I/O
- `tests/hash.test.js` — self-tests including reference FNV-1a values
- Erin Catto, *Determinism* (Box2D, Aug 2024):
  https://box2d.org/posts/2024/08/determinism/
- Source: `~/projects/well-dipper/research/motion-testing-methodology-2026-05-02.md`
  §"Transform-hash regression"
