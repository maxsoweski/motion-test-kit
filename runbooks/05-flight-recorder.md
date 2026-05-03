# RUNBOOK 05 — Flight Recorder Ring Buffer (technique #5)

## When to use

Use the flight recorder when:

- The bug is **rare or hard to reproduce on demand**. You can't run a
  deliberate scenario; the bug happens in the wild during normal play.
- The bug **escapes the predicate suite** (technique #1) running at
  test time but you want to catch it post-hoc when it does occur.
- You need **continuous observation** — last N seconds of state always
  available — without paying capture-everything-to-disk costs.

The pattern: ring-buffer the last N seconds of SampleRecord at all
times. When a predicate fires `passed: false` (or a manual trigger
fires from the host), continue capturing for a configurable trailing
span, then dump the entire buffer to disk for offline analysis.

Don't use the flight recorder for:

- **Deliberate test runs.** When you can repro on demand, just capture
  the full run with `bindCaptureToBuffer` directly. The flight recorder
  is for catching escapes, not for routine verification.
- **Long-session replay.** A bounded ring buffer drops history. If you
  need the full session, configure capacity = expected frames and don't
  let it overflow — but at that point you're using a normal recorder,
  not the flight recorder.

## How to invoke from a brief AC

ACs that benefit from the flight recorder are typically **escape-class**:
the AC asserts an invariant SHOULD hold, and the recorder ensures that
if it ever doesn't hold (during normal play, a stress test, or a
soak run), the evidence is captured.

### AC vocabulary

| AC vocabulary | Configuration |
|---|---|
| "any predicate violation in production captures the surrounding 10s of state" | capacity ≥ 600 frames @ 60 Hz, trailingFrames = 60 (1s) |
| "soak-run flight recorder dumps on first violation; subsequent violations don't replace the first dump" | hasFired() check; ring resets only on detach + re-attach |
| "manual-trigger dump (debug HUD button)" | host-side button that calls `buffer.dumpToBlob()` directly, bypassing the predicate-fire path |

### Example AC

> AC #X: A 10-minute soak run of the autopilot tour produces zero
> predicate violations. If any violation fires, the surrounding state
> is captured and committed to `screenshots/escapes/<sha>/dump.json`
> for analysis.

That AC translates to:

```js
import { createRingBuffer } from 'motion-test-kit/core/recorder/ring-buffer';
import { attachOnFailureDump } from 'motion-test-kit/core/recorder/on-failure-dump';
import { nodeFsWriter } from 'motion-test-kit/adapters/node/fs-writer';
// or: import { blobDownloadWriter } from 'motion-test-kit/adapters/dom/blob-download-writer';
import { monotonicityScore, deltaMagnitudeBound } from 'motion-test-kit/core/predicates';

const buffer = createRingBuffer({ capacity: 36000 });  // 10 min @ 60 Hz
const dumper = attachOnFailureDump({
  buffer,
  predicateChecks: [
    { name: 'mono-z',  fn: monotonicityScore,   options: { axis: 'z', windowFrames: 30 } },
    { name: 'delta-z', fn: deltaMagnitudeBound, options: { axis: 'z', bound: 5 } },
  ],
  trailingFrames: 60,
  dumpPath: `./screenshots/escapes/${currentSha}/dump.json`,
  writer: nodeFsWriter,
});

// Host loop:
animate(() => {
  const sample = captureFrame({ frame, t, dt, anchor: cam, target: focusBody, input, state });
  dumper.tick(sample);  // pushes to buffer + runs predicates every checkEveryFrames
});
```

## What the Tester does with it

The Tester is typically NOT running the flight recorder during routine
verification — the recorder is for escape capture during runtime, not
for the deliberate-scenario verification the Tester does.

But: the Tester DOES use the flight recorder's outputs as evidence:

1. When working-Claude reports "the kit caught a violation during a
   soak run; here's the dump", the Tester reads the dump (a snapshot
   of SampleRecords), runs the same predicate suite over it, and
   confirms the failure reproduces.
2. The Tester's own scenario-driven runs can use the flight recorder
   as a fallback — start with predicate assertion at end-of-run; if
   the assertion fails, the buffer's snapshot is the diagnostic.

The Tester's verdict shape doesn't change — the flight recorder is
a capture mechanism, not a different predicate.

## Pass / fail evidence shape

**Recorder behavior PASS:**
- Buffer correctly retains last N entries (verified by self-test).
- On predicate fire, trailing-window capture continues for
  `trailingFrames` frames before invoking writer.
- Writer is called exactly once per fire; subsequent fires within
  the same attach session are ignored (hasFired flag).
- Dump JSON deserializes to an array of SampleRecord; pure-data
  invariant holds.

**Recorder behavior FAIL:**
- Buffer drops or duplicates entries → ring buffer bug, file as kit
  defect.
- Writer not invoked after trailing window → frame counter or
  writer-check logic bug.
- Multiple fires per session producing multiple dumps → hasFired
  flag broken.
- Dump JSON missing fields → host's capture path isn't producing
  kit-shape SampleRecords.

**Soak-run usage outcome:**
- **Soak run completes without firing:** PASS at predicate level.
  The flight recorder reports `hasFired() === false`; the buffer's
  last N seconds represent the end-of-soak state, not a captured
  fire.
- **Soak run fires once + dumps:** evidence captured. Working-Claude
  + PM decide whether the bug surfaced is in scope for the current
  workstream or a follow-up.

## Common pitfalls

1. **Ring buffer capacity sized wrong.** Too small (e.g., 60 frames
   = 1s), the dump misses the leading context that would explain how
   the violation arose. Too large (e.g., 86,400 = 24 min), the
   per-frame array operations get slower (O(N) snapshot), and the
   memory per session bloats. Right-size: capture window = how far
   back you'd want to look at the moment of failure. 5-10 seconds
   of leading context is typical (300-600 frames @ 60 Hz).

2. **Writer not provided.** The kit's `attachOnFailureDump` requires
   the writer at attach time — no default. If you forget, the attach
   throws. Don't paper over by passing a no-op writer; the dump is
   the diagnostic, suppressing it defeats the technique.

3. **Predicate `checkEveryFrames` set too aggressive.** Default is
   30 (every half-second @ 60 Hz). Setting it to 1 (every frame)
   adds significant per-frame overhead, especially with long buffers
   — each check re-snapshots and runs the predicate over the full
   buffer. Half-second checks catch sustained violations within
   their first half-second; transient single-frame violations don't
   need a 1-frame check granularity to be detected post-hoc by
   reading the dump.

4. **`hasFired` not reset across sessions.** If you re-attach the
   dumper without resetting state, only the FIRST fire across the
   entire program lifetime captures. For per-session capture
   (e.g., per scene reload), `detach()` and re-`attach`. The kit
   doesn't track "session" — that's a host-level concept.

5. **Pure-data invariant violated by a host-shaped sample.** If the
   host puts a THREE.Object3D reference into `state` (instead of
   serializing its position/quaternion into pure arrays), the
   `JSON.stringify` in the writer fails or produces `[object
   Object]` strings, and the dump is unreadable. Always run a sample
   through `JSON.parse(JSON.stringify(s))` and verify it round-trips
   before relying on the recorder. The Three.js adapter
   (`adapters/three/sample-capture.js`) handles this for known
   fields; custom state fields are the host's responsibility.

6. **Soak-run dump path collides with prior runs.** Dump path
   includes the SHA; if the SHA hasn't changed (you re-ran the same
   commit), the new dump overwrites the old. Prefer
   `${sha}-${timestamp}.json` for soak runs that may fire multiple
   times across sessions.

7. **Treating the dump as the only evidence.** The dump is
   diagnostic input — Tester or working-Claude reads it, runs the
   predicate suite over it, and reports findings. The dump alone
   isn't the verdict; the predicate-over-dump result is.

## Cross-references

- `core/recorder/ring-buffer.js` — implementation
- `core/recorder/on-failure-dump.js` — predicate-driven trigger
- `adapters/dom/blob-download-writer.js` — browser-side writer
- `adapters/node/fs-writer.js` — node-side writer
- `adapters/three/sample-capture.js` — `bindCaptureToBuffer`
  convenience helper
- `tests/ring-buffer.test.js` — self-tests including the on-failure
  trailing-window verification
- Source: `~/projects/well-dipper/research/motion-testing-methodology-2026-05-02.md`
  §"Flight recorder pattern"
