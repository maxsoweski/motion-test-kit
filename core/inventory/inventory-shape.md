# SceneInventory shape

Pure-data records that capture *which renderable things exist and are
active* at a given simulation tick. Structural sibling to
`SampleRecord` (see `../predicates/sample-shape.md`).

Consumed by Tester via inventory predicates that read these records the
way motion predicates read SampleRecord. Inventory snapshots are JSON-
serializable, contain no engine references, and survive
`structuredClone` + `JSON.stringify` like SampleRecord does.

## Shape

```js
/**
 * @typedef {object} MeshInventoryEntry
 * @property {string} name           Mesh name. Load-bearing assertion key.
 *                                   Empty string is a silent-failure trap;
 *                                   takeSceneInventory's verbose mode warns
 *                                   on empty names.
 * @property {string} type           'Mesh' | 'Points' | 'Sprite' | 'Line' | ...
 * @property {string} uuid           Stable identity across frames. Useful
 *                                   for diff API.
 * @property {string} source         Source scene name (e.g. 'main', 'sky')
 *                                   from the multi-scene `scenes:[]` input.
 *                                   Predicates can scope by source via
 *                                   `options.source`. Legacy `{scene,camera}`
 *                                   shape produces `source: 'main'`.
 * @property {boolean} visible       Object3D.visible (own; chain visibility
 *                                   is resolved by traverseVisible filtering
 *                                   before this entry is emitted).
 * @property {boolean} frustumCulled Object3D.frustumCulled flag (the policy,
 *                                   not the result).
 * @property {boolean} inFrustum     Computed: true if frustumCulled === false
 *                                   OR the mesh's bounding sphere intersects
 *                                   the camera frustum this snapshot.
 * @property {[number, number, number]} worldPos
 *                                   matrixWorld translation. Pure array, not
 *                                   THREE.Vector3.
 * @property {number} layer          Object3D.layers.mask (uint32).
 * @property {string} materialUuid   For material identity tracking (detects
 *                                   accidental material swaps).
 * @property {string} geometryUuid   Same for geometry.
 * @property {number} [boundingSphereRadius]
 *                                   Optional. Set when includeBoundingSphere=true
 *                                   was requested. computeBoundingSphere can
 *                                   throw on Points; opt-in protects against
 *                                   that failure mode.
 *
 * @typedef {object} OverlayInventoryEntry
 * @property {string} id             Overlay registry id.
 * @property {boolean} visible       Resolved per visibility check sequence
 *                                   in adapters/dom/overlay-registry.js.
 * @property {number} opacity        Computed style opacity (0..1).
 * @property {string} display        Computed style display value.
 *
 * @typedef {object} ComposerPassEntry
 * @property {string} name           pass.constructor.name OR pass.name
 *                                   OR 'unknown'.
 * @property {boolean} enabled       pass.enabled !== false.
 * @property {boolean} renderToScreen
 * @property {boolean} needsSwap
 *
 * @typedef {object} RendererInfoSnapshot
 * @property {number} drawCalls
 * @property {number} triangles
 * @property {number} points
 * @property {number} lines
 * @property {number} programs
 * @property {number} geometries
 * @property {number} textures
 *
 * @typedef {object} CameraInventoryEntry
 * @property {string} name           e.g. 'camera.player'.
 * @property {string} type           'PerspectiveCamera' | 'OrthographicCamera' | …
 * @property {string} uuid
 * @property {string} source         Source scene tag (see MeshInventoryEntry).
 * @property {number|null} fov       PerspectiveCamera fov (degrees).
 * @property {number|null} aspect
 * @property {number|null} near
 * @property {number|null} far
 * @property {boolean} isOrthographic
 * @property {[number, number, number]} worldPos
 *
 * @typedef {object} LightInventoryEntry
 * @property {string} name           e.g. 'light.star.sol'.
 * @property {string} type           'AmbientLight' | 'DirectionalLight' | …
 * @property {string} uuid
 * @property {string} source
 * @property {boolean} visible
 * @property {number} intensity
 * @property {string} color          6-char hex (e.g. 'ffaa33'). '' when
 *                                   light has no color (rare).
 * @property {[number, number, number]} worldPos
 *
 * @typedef {object} MaterialInventoryEntry
 * @property {string} role           Stable identifier; lookup key for
 *                                   uniformValueAt (e.g. 'warp.tunnel').
 * @property {Record<string, any>} uniforms
 *                                   Captured uniform values per host's
 *                                   declared watchlist. A uniform declared
 *                                   in `watch` but absent from the material
 *                                   at capture time is recorded as `null`
 *                                   (distinct from a uniform with literal
 *                                   value 0). `uniformValueAt` distinguishes
 *                                   these failure modes.
 * @property {boolean} transparent
 * @property {boolean} depthTest
 * @property {boolean} depthWrite
 * @property {number|null} blending
 * @property {boolean} visible
 *
 * @typedef {object} RenderTargetInventoryEntry
 * @property {string} name
 * @property {number} width
 * @property {number} height
 * @property {boolean} depthBuffer
 * @property {number} samples       MSAA sample count (0 = single-sample).
 * @property {string} textureUuid
 *
 * @typedef {object} AudioInventoryEntry
 * @property {string} track
 * @property {boolean} isPlaying
 * @property {number} currentTime   Seconds.
 * @property {number} volume         0..1.
 *
 * @typedef {object} SceneInventory
 * @property {MeshInventoryEntry[]} meshes
 * @property {CameraInventoryEntry[]} cameras
 *                                   All cameras traversed across all input
 *                                   scenes plus the explicit per-scene camera.
 *                                   Always present (may be empty).
 * @property {LightInventoryEntry[]} lights
 *                                   All `.isLight === true` objects traversed
 *                                   across all input scenes. Always present.
 * @property {MaterialInventoryEntry[]} [materials]
 *                                   Omitted when no `materials:` watchlist
 *                                   was passed.
 * @property {Record<string, number>} [clocks]
 *                                   Host-supplied named numerical clocks.
 *                                   Omitted when not provided.
 * @property {Record<string, string>} [modes]
 *                                   Host-supplied named mode flags. Omitted
 *                                   when not provided.
 * @property {RenderTargetInventoryEntry[]} [renderTargets]
 *                                   Host-supplied named render targets.
 * @property {Record<string, string>} [phases]
 *                                   Host-supplied state-machine phases per
 *                                   system. Used by phaseEquals for cross-
 *                                   system coherence assertions.
 * @property {AudioInventoryEntry[]} [audio]
 *                                   Per-track audio playback state.
 * @property {object} [input]        Plain JSON-serializable input-layer state.
 * @property {OverlayInventoryEntry[]} [domOverlays]
 *                                   Omitted (not [] empty) when no overlay
 *                                   registry was passed. Distinguishes "host
 *                                   opted out" from "host opted in but
 *                                   registered zero overlays."
 * @property {ComposerPassEntry[]} [composerPasses]
 *                                   Omitted when no composer was passed.
 * @property {RendererInfoSnapshot} [rendererInfo]
 *                                   Omitted when no renderer was passed.
 *                                   Set renderer.info.autoReset = false on
 *                                   the host for stable per-tick aggregates.
 * @property {string} [cameraFrustumKey]
 *                                   Optional invariant key for "same frustum?"
 *                                   diffing across snapshots. Currently
 *                                   unused; reserved for v2.
 */
```

## SampleRecord extension

`SampleRecord` (see `../predicates/sample-shape.md`) gets one optional new field:

```js
/**
 * @typedef {SampleRecord_v1 & { inventory?: SceneInventory }} SampleRecord_v2
 */
```

Existing predicates IGNORE the field. Inventory predicates require it.
When the host hasn't requested inventory capture for a frame, the field
is absent (not `null` — same opt-in convention as `domOverlays` above).

## Required vs optional fields per inventory predicate

| Predicate | Required fields |
|-----------|------------------|
| `meshVisibleAt` | `inventory.meshes[i].name`, `.visible`, `.inFrustum`, `.source` (when `options.source` is set) |
| `meshHiddenAt` | same |
| `overlayVisibleAt` | `inventory.domOverlays[i].id`, `.visible` |
| `overlayHiddenAt` | same |
| `passEnabledAt` | `inventory.composerPasses[i].name`, `.enabled` |
| `drawCallBudget` | `inventory.rendererInfo.drawCalls` |
| `triangleBudget` | `inventory.rendererInfo.triangles` |
| `cameraConfigAt` | `inventory.cameras[i].name` + the field(s) listed in `options.expected` |
| `lightActiveAt` | `inventory.lights[i].name`, `.visible`, `.intensity` |
| `uniformValueAt` | `inventory.materials[i].role`, `.uniforms[options.uniformName]` |
| `clockProgressedSince` | `inventoriesByPhase.{phaseKey,sincePhase}.clocks[clockSystem]` (number) |
| `modeIs` | `inventory.modes[options.slot]` (string) |
| `renderTargetSize` | `inventory.renderTargets[i].name`, `.width`, `.height` |
| `phaseEquals` | `inventory.phases[options.system]` (string) |
| `audioPlayingAt` | `inventory.audio[i].track`, `.isPlaying` |
| `inputContains` | `inventory.input[options.kind]` (any JSON value) |
| `diffInventories` (pure) | full `inventory.*` shape on both inputs |

## Validation

Inventory predicates throw `MissingInventoryFieldError` (defined in
`./errors.js`) with a named message when a sample's inventory is missing
a field they require. Same loud-failure-at-test-time semantics as
`MissingFieldError` from `core/predicates/errors.js`.

Predicates that target a named entity (mesh by `name`, overlay by `id`,
pass by `name`) distinguish two failure modes when reporting violations:

1. **"entity not found at phase X"** — no entry with the requested name
   exists in the inventory.
2. **"entity found but unnamed"** — an entry exists at the expected
   structural position but its name is empty string.

This separation lets working-Claude's diagnostic loop converge: an
unnamed-mesh failure points at host naming policy, an entity-not-found
failure points at scene-graph state.

## Multi-scene API

`takeSceneInventory` accepts two input shapes:

```js
// Multi-scene (preferred for hosts with separate sky / main / HUD scenes):
takeSceneInventory({
  scenes: [
    { name: 'main', scene: mainScene, camera: mainCamera },
    { name: 'sky',  scene: skyScene,  camera: skyCamera  },
  ],
  // ... shared options ...
});

// Legacy single-scene:
takeSceneInventory({ scene, camera, ... });   // equivalent to scenes: [{ name: 'main', scene, camera }]
```

Each mesh / camera / light entry carries its origin scene's name in
`source`. Predicates default to "search across all sources"; opt in with
`{ source: 'sky' }` to scope. `composer`, `renderer`, `overlayRegistry`,
and the host-supplied categories (materials / clocks / modes / renderTargets
/ phases / audio / input) are scene-graph-orthogonal — they aren't tagged.

## Bit-stable hash test

The seed:ordinal pattern `fnv1aString(systemSeed + ':' + ordinal)` is
the recommended host-side ID-construction scheme for procedural entities
(planets, moons, npcs). Its byte output is part of the kit's public
contract — every change is save-breaking for hosts that have persisted
those IDs.

`tests/hash.test.js` pins canonical hex outputs for a fixed set of
seed:ordinal inputs. The test fails LOUDLY if FNV_OFFSET_BASIS,
FNV_PRIME, the UTF-16 byte order, or the implementation changes.
Refactoring the hash becomes a deliberate save-migration decision, not
an accidental drift.

## Construction

Hosts construct `SceneInventory` via:

1. **The Three.js adapter** — `adapters/three/scene-inventory.js` exports
   `takeSceneInventory({ scenes: [...] /* or scene, camera */, composer?, overlayRegistry?, renderer?, materials?, clocks?, modes?, renderTargets?, phases?, audio?, input?, ... })`.
   See its JSDoc for full options.

2. **Custom construction** — any host can populate a `SceneInventory`
   directly. The shape is the contract, not the construction path. (A
   future Godot adapter would emit the same shape from Godot scene-graph
   traversal.)

The kit's existing `bindCaptureToBuffer` accepts inventory via the
`extras.inventory` field per `adapters/three/sample-capture.js`. Sugar
wrapper `withPhaseBoundaryInventory` (Phase 2 of this technique)
attaches inventory only at host-named state-field transitions — sub-ms
cost per phase boundary, zero cost between transitions.

## What's intentionally NOT in the shape

- **No engine references.** No `THREE.Mesh`, no `THREE.Object3D`, no DOM
  `Element`, no `composer.passes[i]` references. Same purity rule as
  `SampleRecord`. The kit promises structuredClone + JSON.stringify
  survive; that promise requires arrays, primitives, plain objects only.

- **No nested cycles.** Same as SampleRecord.

- **No "convenience" derived fields.** No precomputed visibility-by-name
  index. Predicates derive these from raw entries. Indexing is a
  predicate-side concern.

- **No per-instance entries for InstancedMesh.** v1 captures the parent
  `InstancedMesh` once. Per-instance visibility is out of scope; a host
  that needs it can capture instance counts separately as `extras.foo`.

- **No frustum geometry.** The `cameraFrustumKey` field is reserved
  but unused in v1. Predicates that need to compare "same frustum?"
  rely on host-side framing comparisons.

## Known limitations (v1)

- **Skinned meshes.** `THREE.SkinnedMesh` instances are traversed
  normally, but manual-frustum's `inFrustum` calculation uses the
  mesh's static bounding sphere, which does NOT track skinned bounds
  after pose updates. Expect false-positives ("inFrustum: true" when
  the skinned mesh is actually outside the frustum due to pose).
  v2 path: opt-in `mode: 'onAfterRender'` capture per research §3(b).

- **Instanced meshes.** `THREE.InstancedMesh` reports the parent mesh
  once; individual instance positions are not enumerated. Predicates
  cannot assert per-instance visibility in v1.

- **Batched meshes.** `THREE.BatchedMesh` (r152+) is treated like an
  ordinary Mesh; the batched primitives within are not enumerated.

## Composer compatibility

`takeSceneInventory({ composer })` duck-types on `composer.passes`.
Compatible with:

- Three.js examples-jsm `EffectComposer` (legacy).
- pmndrs `postprocessing` library's `EffectComposer`.

Not yet compatible with:

- Three.js r183+ `RenderPipeline` (node-based) — `composer.passes` does
  not exist on that API. Forward work; v2 will add a dedicated adapter
  branch.

When `composer.passes` is undefined, `takeSceneInventory` omits the
`composerPasses` field rather than failing. Predicates that require it
(`passEnabledAt`) FAIL on missing field rather than PASSing on empty
array — see `./predicates.js` Phase 3.

## Performance characterization (well-dipper-scale: ~hundreds of meshes)

| Cadence | Cost per snapshot | Per-second cost @ 60 Hz |
|---------|---------------------|---------------------|
| `everyFrame` | ~0.5–1.0 ms | ~30–60 ms/sec (3–6% frame budget) |
| `everyN=6` | ~0.5–1.0 ms (10× less per-second) | ~5–10 ms/sec (~0.5% frame budget) |
| `phaseBoundary` | ~0.5–1.0 ms | sub-ms (handful of snapshots per scenario) |

Estimates only — host-machine variance applies. Phase 3 ships a
benchmark self-test (`tests/inventory-benchmark.test.js`) that captures
1000 snapshots at the kit's own ~300-mesh synthetic scene and reports
p50/p95/p99 to stdout. Use that as the documented baseline; regressions
to the kit are visible against it.
