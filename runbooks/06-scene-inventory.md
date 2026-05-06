# RUNBOOK 06 — Scene-Inventory Snapshots (technique #6)

## When to use

Use scene-inventory snapshots whenever an AC names a **structural-
visibility-class** property — *which* meshes are visible at a given phase,
*which* DOM overlays are showing, *which* post-effect passes are active,
*how many* draw calls / triangles a phase costs. The bug class this
technique catches: assets rendered when they shouldn't be (the 2026-05-05
reticle-runway-persists-after-warp regression), assets missing when they
should be there (warp-tunnel-second-half-not-rendering), draw-call budget
runaway under load, accidental composer-pass disable mid-scenario.

The toggle-fix incident proved kit predicates catch motion bugs faster
than recordings; the warp-hyper-dimness 2026-04-18 miss showed the
inverse problem — recordings caught a structural-visibility issue
(post-FX dimming pass) that no kit predicate could express. This
technique closes that gap.

Don't use scene-inventory for:
- **Felt-experience gates** — game-feel, juice, "does this transition
  feel cinematic." Use lab-mode + Max's interactive evaluation per
  `feedback_lab-modes-not-recordings.md` (the canonical workflow that
  pairs this technique with).
- **Per-frame motion math** — predicates from technique #1
  (`deltaMagnitudeBound`, `monotonicityScore`, etc.) are the right tool
  for trajectory-class assertions.
- **Cross-machine regression** — transform-hash from technique #4 is
  better-suited; inventory snapshot identity (mesh uuids, geometry uuids)
  drifts across machines because three.js generates them.

## How to invoke from a brief AC

PM authors AC text that names the structural property explicitly using
the vocabulary table below. Tester reads the AC, picks the matching
predicate, runs it against per-phase inventories from the kit, asserts
the return value's `.passed` field.

### AC vocabulary → predicate mapping

| AC vocabulary (in PM brief) | Predicate function | Required options |
|---|---|---|
| "tunnelMesh visible during HYPER phase" | `meshVisibleAt` | `phaseKey`, `meshName` |
| "reticle hidden during warp" | `meshHiddenAt` or `overlayHiddenAt` | `phaseKey`, `meshName`/`overlayId` |
| "speedometer overlay visible during CRUISE" | `overlayVisibleAt` | `phaseKey`, `overlayId` |
| "exit-reveal pass enabled at EXIT phase" | `passEnabledAt` | `phaseKey`, `passName` |
| "draw calls under 50 during STATION" | `drawCallBudget` | `phaseKey`, `max` |
| "triangle count under 10000 across all phases" | `triangleBudget` | `max` (omit phaseKey) |
| "what disappeared between HYPER and EXIT" | `diffInventories` | (no options — pure function over two inventories) |

## What the Tester does with it

```js
import { takeSceneInventory } from 'motion-test-kit/adapters/three/scene-inventory';
import { createOverlayRegistry } from 'motion-test-kit/adapters/dom/overlay-registry';
import {
  meshVisibleAt,
  overlayHiddenAt,
  passEnabledAt,
  drawCallBudget,
  snapshotAtPhaseBoundaries,
} from 'motion-test-kit/core/inventory/predicates';
import { diffInventories } from 'motion-test-kit/core/inventory/diff';

// 1) Host registers overlays at startup.
const overlayRegistry = createOverlayRegistry();
overlayRegistry.register('reticle', '#hud-reticle');
overlayRegistry.register('navComputer', '#nav-panel');

// 2) Per-phase capture during scenario. The recorder.tick() loop
//    automatically attaches inventory at phase boundaries.
import { withPhaseBoundaryInventory } from 'motion-test-kit/adapters/three/scene-inventory';
import { bindCaptureToBuffer } from 'motion-test-kit/adapters/three/sample-capture';
import { createRingBuffer } from 'motion-test-kit/core/recorder/ring-buffer';

const buffer = createRingBuffer({ capacity: 500 });
const recorder = withPhaseBoundaryInventory({
  recorder: bindCaptureToBuffer({ buffer }),
  scene, camera, composer, overlayRegistry, renderer,
  stateFieldPath: 'warpState',
});
// Caller drives recorder.tick(t, anchor, { state, target, input }) per
// sim tick; inventory captured automatically on warpState transitions.

// 3) After scenario, run predicates over the captured stream.
const samples = buffer.snapshot();
const invs = snapshotAtPhaseBoundaries(samples, ['HYPER', 'EXIT'], 'warpState');

assert.equal(meshVisibleAt(invs, { phaseKey: 'HYPER', meshName: 'tunnelMesh' }).passed, true);
assert.equal(overlayHiddenAt(invs, { phaseKey: 'HYPER', overlayId: 'reticle' }).passed, true);
assert.equal(passEnabledAt(invs, { phaseKey: 'EXIT', passName: 'GlowPass' }).passed, true);

// 4) Diff API — what changed structurally between phases.
const delta = diffInventories(invs.get('HYPER'), invs.get('EXIT'));
assert.deepEqual(delta.disappearedMeshes, ['tunnelMesh']);
assert.deepEqual(delta.appearedOverlays, ['reticle']);
```

## Pass / fail evidence shape

When Tester runs an inventory predicate against a captured scenario, the
verdict carries:

- **PASS:** `{ passed: true, violations: [], totalSamples: N }` for the
  named phase. No artifacts beyond the predicate result needed.
- **FAIL:** `{ passed: false, violations: [{phase, reason, ...}], totalSamples }`.
  Tester verdict cites the violations array; working-Claude reads it to
  pinpoint the offending state. Two distinguished failure modes per
  predicate: "entity not found" (host-naming-policy or scene-graph state
  issue) vs "entity present but visible/enabled mismatch" (genuine
  visibility regression).

Captured samples + inventory snapshots optionally persisted to JSON in
`recordings/` (gitignored). Re-running the predicates against persisted
samples is byte-deterministic; bug reports can include both the predicate
violation and the underlying inventory dump.

## Common pitfalls

1. **Unnamed meshes break assertions silently.** Predicates assert by
   `mesh.name`. If three.js auto-generated geometry, debug helpers, or
   instanced child meshes have `name === ''`, an assertion targeting that
   mesh's name will FAIL with "not found" — not because the mesh is
   missing but because the lookup misses. The predicate's violation
   reason names this distinction ("note: unnamed meshes present in scene
   — likely host-naming-policy issue") so the diagnostic loop converges.
   Run `takeSceneInventory({ verbose: true })` once during host
   integration to surface unnamed load-bearing meshes; commit names per
   the host-side naming policy.

2. **Manual-frustum unreliable for skinned/instanced meshes.** v1's
   visibility resolution uses static bounding spheres — does not track
   skinned mesh poses or per-instance positions of `InstancedMesh`.
   Expect false-positives ("inFrustum: true" when a skinned mesh is
   actually outside the frustum due to pose). v2 path: opt-in `mode:
   'onAfterRender'` capture per research §3(b). Documented in
   `core/inventory/inventory-shape.md` §"Known limitations (v1)".

3. **Phase-boundary cadence misses intra-phase regressions.**
   `withPhaseBoundaryInventory` is the cheapest cadence and the natural
   default — but a bug that fires mid-HYPER and clears before EXIT (e.g.,
   a transient mesh-visible glitch at hyper-onset+200ms) won't appear in
   either snapshot. When the AC names a transient property ("tunnelMesh
   never flickers during HYPER"), use `everyN(N=6)` for 10 Hz sampling
   or `everyFrame` for full per-tick capture.

4. **Overlay registry not refreshed when overlays mount/unmount.** The
   registry caches resolved Element references. If a host's UI panel is
   unmounted-then-remounted between snapshots, the cached reference may
   point at a detached node. Mitigations: (a) register elements with
   lazy resolver functions instead of selector strings (the resolver
   re-runs when the cached element is null); (b) call
   `unregister('id')` + `register('id', ...)` after intentional mount
   cycles. Pure CSS-show/hide doesn't trigger this; only DOM
   detach/reattach does.

5. **`composer.passes` undefined silently omits the field.** If the host
   uses three.js r183+ `RenderPipeline` (node-based) instead of legacy
   `EffectComposer`, `composer.passes` doesn't exist. The adapter
   silently omits `composerPasses` from the inventory; `passEnabledAt`
   then throws `MissingInventoryFieldError` (the right behavior — fails
   loudly, not silently). r183+ adapter is forward work documented in
   `core/inventory/inventory-shape.md` §"Composer compatibility".

## Cross-references

- `~/.claude/projects/-home-ax/memory/feedback_lab-modes-not-recordings.md` —
  the rule this technique serves.
- `docs/PERSONAS/tester.md` §"Bug-class taxonomy" — the
  Structural-visibility-class row this technique is the active default
  for.
- `docs/WORKSTREAMS/motion-test-kit-scene-inventory-2026-05-05.md` —
  technique origin + acceptance criteria.
- `docs/WORKSTREAMS/welldipper-lab-mode-2026-05-05.md` — parallel-sibling
  workstream that lays the felt-experience surface using the same per-
  phase inventory.
- `motion-test-kit/runbooks/01-per-frame-deltas-and-predicates.md` —
  motion predicates (technique #1); composes with this technique
  (motion + visibility = full phase verification).
