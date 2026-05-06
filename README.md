# motion-test-kit

Engine-agnostic motion-testing kit. Six techniques — predicates, fixed-timestep
accumulator, seeded RNG + input replay, transform-hash regression, flight-recorder
ring buffer, scene-inventory snapshots — packaged as a portable library with Three.js + DOM adapters and
a Godot port supported by the architecture.

**Status:** Phase 1 (accumulator) landing. Phases 2-5 in flight per
`docs/WORKSTREAMS/motion-test-kit-2026-05-02.md` in the well-dipper repo
(the consuming project).

## Why this exists

Game-dev verification has historically reduced to "watch the recording for
jank." That works until a class of bug — oscillation, teleport-cycles,
sub-second motion-continuity violations — slips past coarse-sampling
telemetry while still being plainly visible in playback. The recording
catches it; the assertion doesn't, and the assertion is what the agent
loop runs on.

This kit replaces ad-hoc per-bug telemetry with a vocabulary of named
invariants (Δ-magnitude bound, sign stability, monotonicity score,
approach-phase invariant, etc.), expressed as pure functions over a
standardized `samples` shape. The pre-existing recording remains the
right tool for felt-experience evaluation; the kit handles the
invariant-class bugs that recordings shouldn't have to catch.

Source research: `~/projects/well-dipper/research/motion-testing-methodology-2026-05-02.md`.

## Architecture

Hexagonal / ports-and-adapters:

```
core/                       ← engine-agnostic, pure functions, pure data
  loop/accumulator.js       (Glenn Fiedler fixed-timestep)
  predicates/               (named invariants — Phase 2)
  recorder/ring-buffer.js   (flight recorder — Phase 2)
  rng/mulberry32.js         (seeded RNG — Phase 3)
  replay/                   (input recorder + player — Phase 3)
  hash/                     (FNV-1a + transform hash + golden trajectory — Phase 4)
  math/vec3.js              (minimal pure vector helpers; no Three import)

adapters/
  three/                    ← Three.js + browser bindings (does NOT import THREE in adapter code; duck-types Object3D-shaped objects)
  dom/                      ← KeyboardEvent / MouseEvent / TouchEvent capture for input replay

tests/                      ← node --test self-tests; exercise core/ only, no engine, no DOM
runbooks/                   ← per-technique usage methodology (when, how, evidence shape, pitfalls)
labs/                       ← in-browser end-to-end demos for each technique (no build step)
examples/                   ← cross-project integration demos (e.g., three-vite-smoke)
```

**`core/` purity is non-negotiable.** No `from 'three'`. No `window`. No
`document`. The grep assertion is in CI when CI exists; for now the
contract is enforced by review. Violating this commits us to a Three.js
port instead of a Godot port — the original Godot-portability promise
gets paid.

## Six techniques

| # | Module | Purpose |
|---|--------|---------|
| 1 | `core/predicates/` | Named invariants over a sample stream (Δ-magnitude, sign-stability, monotonicity, approach-phase, zero-input null-action, velocity bound, state-machine well-formedness, transform-hash equivalence, frame-time variance) |
| 2 | `core/loop/accumulator.js` | Fixed-timestep simulation — separates sim rate from render rate, decouples deterministic motion from frame timing |
| 3 | `core/rng/mulberry32.js` + `core/replay/` | Seeded RNG + input event recording/playback for byte-equivalent reruns (same machine; cross-machine via #4 tolerance bands) |
| 4 | `core/hash/` | Transform-hash regression — FNV-1a over quantized trajectory states, tolerance-band comparison (Box2D pattern) |
| 5 | `core/recorder/ring-buffer.js` | Flight-recorder — last-N-frames ring buffer that dumps to JSON on predicate failure |
| 6 | `core/inventory/` + `adapters/three/scene-inventory.js` + `adapters/dom/overlay-registry.js` | Scene-inventory snapshots — pure-data records of which meshes are visible-and-in-frustum, which DOM overlays are showing, which composer passes are enabled, plus renderer.info aggregates. Predicates: `meshVisibleAt`, `overlayVisibleAt`, `passEnabledAt`, `drawCallBudget`, plus `diffInventories` for "what changed between phase A and phase B." See `runbooks/06-scene-inventory.md`. |

Dependencies: #2 enables #3 enables #4. #1, #5, and #6 are independent of each other.

## Consuming the kit

### From a Three.js + Vite project

Add as a git submodule:

```sh
git submodule add <kit-repo-url> vendor/motion-test-kit
```

Add to `vite.config.js`:

```js
import path from 'node:path';
export default {
  resolve: {
    alias: {
      'motion-test-kit': path.resolve(__dirname, 'vendor/motion-test-kit'),
    },
  },
};
```

Then import:

```js
import { createAccumulator } from 'motion-test-kit/core/loop/accumulator';
import { bindToRAF } from 'motion-test-kit/adapters/three/three-loop-binding';
```

### From a node test runner

The kit's own self-tests (`npm test`) demonstrate the import pattern.
Tests use `node --test` (built-in, no test framework dep) and exercise
`core/` only.

## Determinism limits

JS floating-point is **not bit-deterministic across browsers, hardware, or
even the same browser at different optimization levels**. The kit's seeded
RNG + input replay (#3) produces byte-equivalent reruns *on the same
machine, same browser version, same Node version*. Cross-machine replay
is out of scope; for cross-machine regression detection, use technique #4
(transform-hash with tolerance bands — Box2D pattern, default 1e-6
quantization).

If you need cross-machine determinism (multiplayer leaderboards, server-
side validation), that's a separate engineering effort (full Box2D-style
hardening — fma/SIMD audit, math-mode flags, integer fixed-point, etc.).
This kit doesn't attempt it.

## Porting to Godot

When Max moves engines, the port is:

1. `core/` is unchanged — engine-agnostic.
2. `adapters/godot/` replaces `adapters/three/`. The adapter API surface
   is the same: `bindToRAF` becomes `bindToProcess`; `sampleCapture`
   reads `Node3D.position` + `.basis` instead of `Object3D.position` +
   `.quaternion`; `keyboard-mouse-bridge` uses `InputEvent` instead of
   DOM events.
3. The runbooks stay; only the invocation examples change.
4. Self-tests (`tests/`) require zero changes.

## Self-tests

```sh
npm test
```

Runs node's built-in test runner against `tests/`. No test framework
dep, no build step, no CI required.

## Running the labs

Labs are HTML pages with ES module imports — these need an HTTP origin
(modern browsers block ES modules over `file://` due to CORS). Run:

```sh
npm run lab
```

This starts a tiny static HTTP server (`labs/serve.js`, ~50 lines, no
deps) on port 5174 and prints the URLs. Open the lab URL in any modern
browser:

- `http://localhost:5174/labs/accumulator-lab.html`

To run on a different port: `node labs/serve.js 8080`.

The "no build step" claim still holds — the labs are static files served
verbatim. The HTTP server is just there because browsers don't allow
ES modules over file://.

## Phase status

- ✓ **Phase 1** (Repo + Accumulator) — `dce61b1`
- ✓ **Phase 2** (Predicates + Flight Recorder) — `c6486b0`
- ✓ **Phase 3** (RNG + Input Replay) — `d0a6202`
- ✓ **Phase 4** (Transform-Hash + Golden Trajectory) — `f645d2e`
- ✓ **Phase 5** (Cross-project example + Tester persona update + dogfood)
- ✓ **Technique #6** (Scene-inventory) — `motion-test-kit-scene-inventory-2026-05-05` brief in well-dipper repo

159 self-tests pass under `npm test`.

## Dogfood result (toggle-fix AC #4 re-verification)

The kit was scoped after a working-Claude-and-Tester PASS verdict on a
toggle-fix workstream that Max immediately saw was broken — the
recording showed teleport-cycle motion that coarse 3-point sampling
hadn't measured. AC #23 of this workstream re-runs the toggle-fix
scenarios through kit predicates.

Result: `deltaMagnitudeBound` and `monotonicityScore` flag the
teleport-cycle on every pre-fix capture (3145 violations on Sol A,
including a 255 scene-unit single-frame Z spike; 6924-unit spike in Sol
B). The bug class the original verification missed is structurally
caught by the predicates.

Per-capture results in
`~/projects/well-dipper/tests/motion-test-kit-dogfood-2026-05-02.js`.

## License

MIT.
