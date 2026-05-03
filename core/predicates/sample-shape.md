# SampleRecord shape

The kit's predicates and recorders all consume a sequence of `SampleRecord`
objects — pure-data records that the host populates per simulation tick (or
per render tick, with the same shape).

## Shape

```js
/**
 * @typedef {[number, number, number]} Vec3
 *   Position in scene units. Coordinate frame is whatever the host uses
 *   (post-rebase, world-relative, doesn't matter to the kit). Arrays not
 *   THREE.Vector3 — pure data, JSON-serializable.
 *
 * @typedef {[number, number, number, number]} Quat
 *   Quaternion x, y, z, w.
 *
 * @typedef {object} TrackedTransform
 * @property {Vec3} pos
 * @property {Quat} quat
 *
 * @typedef {object} SampleRecord
 * @property {number} frame
 *   Sequential frame index, starts at 0 and monotonically increases.
 * @property {number} t
 *   Time at sample, milliseconds. Convention: sim-tick samples use sim
 *   clock; render-tick samples use real wall-clock. Document which in the
 *   recording.
 * @property {number} dt
 *   Delta from previous sample's t. Equals stepMs for sim-tick capture
 *   under the kit's accumulator. Variable for render-tick capture.
 * @property {TrackedTransform} anchor
 *   The subject being tracked — typically the camera, ship, player, or
 *   whatever entity the test cares about. Required.
 * @property {TrackedTransform | null} target
 *   The reference frame entity, for predicates that compute relative
 *   motion ("anchor's distance to target", "anchor's approach velocity
 *   toward target"). Null when no relative-tracking is being asserted.
 *
 *   The track-A-relative-to-B abstraction. Lets a predicate ask about a
 *   ship's motion relative to a station, a planet's motion relative to a
 *   star, etc. — not just camera-relative-to-world.
 *
 * @property {object} input
 *   Host-defined input snapshot. Suggested shape:
 *     { keys: Set<string> | string[], pointer: { x, y, dx, dy, buttons } }
 *   The kit doesn't enforce; predicates that read input document what
 *   fields they expect.
 * @property {object} state
 *   Host-defined state snapshot. Free-form. Predicates that read it
 *   document what fields they expect.
 *
 *   Example (well-dipper):
 *     { autopilotEnabled, autopilotMotionPhase, navPhase, shipPhase,
 *       autoNavActive, flightEnabled, bypassed }
 */
```

## Required vs optional fields per predicate

Predicates document which fields they read. Quick reference:

| Predicate | Required fields |
|-----------|------------------|
| `deltaMagnitudeBound` | `frame`, `anchor.pos` |
| `signStability` | `frame`, `anchor.pos`, `target.pos`, `state.<phaseField>` |
| `monotonicityScore` | `frame`, `anchor.pos` |
| `approachPhaseInvariant` | `frame`, `anchor.pos`, `target.pos`, `state.<phaseField>` |
| `zeroInputNullAction` | `frame`, `anchor.pos`, `input` |
| `velocityBound` | `frame`, `anchor.pos`, `dt` |
| `stateTransitionWellFormed` | `frame`, `state` |
| `transformHashEquivalence` | `frame`, `anchor.pos`, `anchor.quat` |
| `frameTimeVariance` | `frame`, `dt` |

## Validation

Predicates throw `MissingFieldError` (defined in `predicates/errors.js`)
with a named message when a sample is missing a field they require. This
fails loudly at test time rather than silently returning `passed: true`
because the predicate's data was empty.

## Construction

Hosts construct `SampleRecord` via either:

1. The Three.js adapter — `adapters/three/sample-capture.js` exports
   `captureFrame({ anchor: Object3D, target?: Object3D, input?, state? })`
   which reads `Object3D.position` + `.quaternion` into pure-data arrays.

2. Custom construction — any host can populate a `SampleRecord` directly.
   The shape is the contract, not the construction path.

## What's intentionally NOT in the shape

- **No engine references.** No THREE.Object3D, no Node3D, no DOM Event.
  Those are non-serializable and don't survive `JSON.stringify` or
  `structuredClone`. The kit promises that a recorded sample stream can
  be replayed, hashed, and shipped to a different process — that promise
  requires pure data.

- **No nested objects with cycles.** All values are primitives, arrays of
  primitives, or plain objects with primitive values. No DOM nodes, no
  three meshes, no functions.

- **No "convenience" derived fields.** No precomputed `delta`, no
  precomputed `distance`. Predicates derive these from raw fields. Adding
  derived fields to the shape would make them stale across replays,
  hashes, or transformations.
