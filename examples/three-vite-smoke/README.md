# three-vite-smoke — motion-test-kit example

A minimal cross-project demonstration: a synthetic three.js scene (NPC
ship cube + station cube) where the ship approaches the station, and
the kit's predicates run live over the captured sample stream.

**No well-dipper-specific assumptions.** This example exercises the
kit's `track-A-relative-to-B` abstraction (anchor = NPC ship, target =
station) with no autopilot machinery, no warp, no celestial mechanics.
The pattern translates to any three.js project that needs motion
verification.

## Running

The example loads through the kit's own static-file server:

```sh
cd ~/projects/motion-test-kit
npm run lab
# then visit http://localhost:5174/examples/three-vite-smoke/
```

The kit's `labs/serve.js` serves the kit's whole tree, so
`../../core/loop/accumulator.js` and friends resolve as relative paths
from this example's `index.html`.

For real consuming projects (e.g., well-dipper), the import pattern is:

```js
// In a Vite project with `motion-test-kit` aliased to vendor/motion-test-kit:
import { createAccumulator } from 'motion-test-kit/core/loop/accumulator';
import { deltaMagnitudeBound } from 'motion-test-kit/core/predicates';
```

The kit's `package.json` `exports` map handles sub-path routing.

## What it demonstrates

- `createAccumulator` + `bindToRAF` — fixed-timestep sim with rAF render
- `createRingBuffer` + `bindCaptureToBuffer` — flight-recorder capture
- `captureFrame` — pure-data SampleRecord production from
  duck-typed Object3D
- `deltaMagnitudeBound` / `monotonicityScore` /
  `approachPhaseInvariant` — three predicates run live every 30 frames

## Inspecting via chrome-devtools

The page exposes `window._motionTestKit.example` for poll-based
verification:

```js
window._motionTestKit.example.frameCount
window._motionTestKit.example.simSteps
window._motionTestKit.example.bufferSize
window._motionTestKit.example.snapshot()         // returns sample stream
window._motionTestKit.example.runPredicates()    // returns { passed, violations } per predicate
```
