// Three.js scene-inventory adapter. Captures pure-data SceneInventory
// records from a Three.js scene-graph + camera + (optional) composer +
// (optional) overlay registry + (optional) renderer.
//
// IMPORTANT: this adapter does NOT import THREE. The "three" segment in
// the directory name is a marker for "consumers who use three.js may
// import this." Duck-types every Three.js interface it touches — this
// matches the existing kit convention (see three-loop-binding.js,
// sample-capture.js).
//
// Pure-data invariant: the returned SceneInventory contains arrays only,
// no THREE.Object3D references, no DOM Element references. JSON.stringify
// works; structuredClone works.
//
// Manual-frustum visibility resolution: builds 6 frustum planes from
// camera.projectionMatrix * camera.matrixWorldInverse using the
// Gribb-Hartmann row-extraction method, then per mesh tests bounding-
// sphere intersection. See research §3 for why manual-frustum is the
// default (vs onAfterRender hook or renderer.info aggregate).
//
// Caller responsibility: ensure scene.matrixWorld is current. Host can
// call scene.updateMatrixWorld() before the snapshot if mid-tick mutation
// has happened. Cameras' matrixWorldInverse must also be current.
//
// ── Known limitations (v1) ─────────────────────────────────────────────
//
// - SkinnedMesh: traversed normally, but inFrustum uses the mesh's static
//   bounding sphere — does not track skinned bounds after pose updates.
//   Expect false-positive "inFrustum: true" when skinned mesh poses
//   outside its rest-pose bounds. v2 path: opt-in mode: 'onAfterRender'.
//
// - InstancedMesh: parent reported once; per-instance visibility not
//   enumerated. Predicates can't assert per-instance visibility in v1.
//
// - BatchedMesh: treated like an ordinary Mesh; batched primitives within
//   are not enumerated.
//
// All three carve-outs are documented in core/inventory/inventory-shape.md
// §"Known limitations (v1)".

/**
 * @typedef {import('../../core/inventory/inventory-shape.md').SceneInventory} SceneInventory
 * @typedef {import('../../core/inventory/inventory-shape.md').MeshInventoryEntry} MeshInventoryEntry
 */

/**
 * @typedef {object} TakeSceneInventoryOptions
 * @property {object} scene           Three.js Scene-shaped (duck-typed).
 *                                    Must expose .traverseVisible(cb).
 * @property {object} camera          Three.js Camera-shaped. Must expose
 *                                    .projectionMatrix.elements (16 floats)
 *                                    and .matrixWorldInverse.elements OR
 *                                    .matrixWorld.elements (we invert).
 * @property {object} [composer]      Optional. Duck-types on .passes array.
 * @property {object} [overlayRegistry]
 *                                    Optional createOverlayRegistry() instance.
 * @property {object} [renderer]      Optional. Duck-types on .info.render.
 * @property {string} [meshNamePrefix=''] Filter meshes whose name starts
 *                                    with this prefix. Default: include all.
 * @property {boolean} [includeBoundingSphere=false]
 *                                    Include boundingSphereRadius per mesh
 *                                    entry. Opt-in because computeBoundingSphere
 *                                    can throw on Points geometry.
 * @property {boolean} [verbose=false] Emit warnings to stderr/console.warn
 *                                    on empty mesh names. Opt-in for
 *                                    kit-development + first-time host
 *                                    integration; production capture is silent.
 */

/**
 * Capture a SceneInventory snapshot at this instant.
 *
 * Synchronous, no rAF dependency — runs at sim tick before render.
 *
 * @param {TakeSceneInventoryOptions} options
 * @returns {SceneInventory}
 */
export function takeSceneInventory(options) {
  if (!options || !options.scene) throw new Error('takeSceneInventory: options.scene required');
  if (!options.camera) throw new Error('takeSceneInventory: options.camera required');

  const scene = options.scene;
  const camera = options.camera;
  const verbose = !!options.verbose;
  const meshPrefix = options.meshNamePrefix || '';
  const includeBoundingSphere = !!options.includeBoundingSphere;

  if (typeof scene.traverseVisible !== 'function') {
    throw new Error('takeSceneInventory: scene.traverseVisible() missing — pass a Three.js Scene-shaped object');
  }
  if (!camera.projectionMatrix || !camera.projectionMatrix.elements) {
    throw new Error('takeSceneInventory: camera.projectionMatrix.elements missing — pass a Three.js Camera-shaped object');
  }

  // Build clip-space matrix: M = projection * matrixWorldInverse
  // matrixWorldInverse should be current; if missing, derive from matrixWorld.
  let invE = camera.matrixWorldInverse?.elements;
  if (!invE) {
    if (!camera.matrixWorld?.elements) {
      throw new Error('takeSceneInventory: camera.matrixWorldInverse OR camera.matrixWorld required');
    }
    invE = invertMatrix4(camera.matrixWorld.elements);
  }
  const projE = camera.projectionMatrix.elements;
  const clipE = multiplyMatrix4(projE, invE);

  // Extract 6 frustum planes (left, right, bottom, top, near, far) from
  // clip-space matrix. Gribb-Hartmann row method, normalized.
  const planes = extractFrustumPlanes(clipE);

  // Capture meshes
  const meshes = [];
  scene.traverseVisible((obj) => {
    // A "renderable" has a geometry property; Group/Object3D bare nodes don't.
    if (!obj.geometry) return;
    if (meshPrefix && (obj.name || '').indexOf(meshPrefix) !== 0) return;

    if (verbose && (obj.name === '' || obj.name == null)) {
      // eslint-disable-next-line no-console
      console.warn(`[takeSceneInventory] unnamed mesh in scene-graph (uuid=${obj.uuid}, type=${obj.type}). Predicates assert by mesh name; unnamed meshes silently skip.`);
    }

    const matrixWorld = obj.matrixWorld;
    const mwE = matrixWorld?.elements;
    const worldPos = mwE
      ? [mwE[12], mwE[13], mwE[14]]
      : [
          obj.position?.x ?? 0,
          obj.position?.y ?? 0,
          obj.position?.z ?? 0,
        ];

    let inFrustum = true;
    if (obj.frustumCulled !== false) {
      // Renderer would frustum-cull this; check sphere intersection.
      const sphere = obj.geometry?.boundingSphere;
      if (sphere && sphere.center && typeof sphere.radius === 'number') {
        // Transform sphere center to world space
        const cwx = mwE
          ? mwE[0] * sphere.center.x + mwE[4] * sphere.center.y + mwE[8] * sphere.center.z + mwE[12]
          : sphere.center.x;
        const cwy = mwE
          ? mwE[1] * sphere.center.x + mwE[5] * sphere.center.y + mwE[9] * sphere.center.z + mwE[13]
          : sphere.center.y;
        const cwz = mwE
          ? mwE[2] * sphere.center.x + mwE[6] * sphere.center.y + mwE[10] * sphere.center.z + mwE[14]
          : sphere.center.z;
        // Scale radius by max scale factor of matrixWorld (estimate)
        const sx = mwE ? Math.hypot(mwE[0], mwE[1], mwE[2]) : 1;
        const sy = mwE ? Math.hypot(mwE[4], mwE[5], mwE[6]) : 1;
        const sz = mwE ? Math.hypot(mwE[8], mwE[9], mwE[10]) : 1;
        const worldRadius = sphere.radius * Math.max(sx, sy, sz);
        inFrustum = sphereIntersectsFrustum(cwx, cwy, cwz, worldRadius, planes);
      } else {
        // No bounding sphere (or not computed) — conservative assumption: in frustum.
        // Caller can opt into includeBoundingSphere or precompute on host side.
        inFrustum = true;
      }
    }

    /** @type {MeshInventoryEntry} */
    const entry = {
      name: obj.name || '',
      type: obj.type || 'Object3D',
      uuid: obj.uuid || '',
      visible: !!obj.visible,
      frustumCulled: obj.frustumCulled !== false,
      inFrustum,
      worldPos,
      layer: (obj.layers?.mask) ?? 1,
      materialUuid: obj.material?.uuid ?? '',
      geometryUuid: obj.geometry?.uuid ?? '',
    };
    if (includeBoundingSphere && obj.geometry?.boundingSphere?.radius != null) {
      entry.boundingSphereRadius = obj.geometry.boundingSphere.radius;
    }
    meshes.push(entry);
  });

  /** @type {SceneInventory} */
  const inv = { meshes };

  // Composer passes
  if (options.composer && Array.isArray(options.composer.passes)) {
    inv.composerPasses = options.composer.passes.map((p) => ({
      name: (p?.constructor?.name && p.constructor.name !== 'Object') ? p.constructor.name : (p?.name || 'unknown'),
      enabled: p?.enabled !== false,
      renderToScreen: !!p?.renderToScreen,
      needsSwap: p?.needsSwap !== false,
    }));
  }

  // Renderer info aggregate
  if (options.renderer?.info?.render) {
    const ri = options.renderer.info.render;
    const rm = options.renderer.info.memory || {};
    const rp = options.renderer.info.programs || [];
    inv.rendererInfo = {
      drawCalls: ri.calls ?? 0,
      triangles: ri.triangles ?? 0,
      points: ri.points ?? 0,
      lines: ri.lines ?? 0,
      programs: Array.isArray(rp) ? rp.length : (rp?.length ?? 0),
      geometries: rm.geometries ?? 0,
      textures: rm.textures ?? 0,
    };
  }

  // DOM overlays
  if (options.overlayRegistry && typeof options.overlayRegistry.snapshot === 'function') {
    inv.domOverlays = options.overlayRegistry.snapshot();
  }

  return inv;
}

// ── Frustum math helpers (inlined to keep adapter THREE-import-free) ────

/**
 * Extract 6 normalized frustum planes from a 16-element column-major
 * clip-space matrix. Returns Float64Array(24) with planes laid out as
 * [a0,b0,c0,d0, a1,b1,c1,d1, ..., a5,b5,c5,d5] where each plane is
 * ax + by + cz + d = 0 with (a,b,c) unit normal.
 *
 * @param {ArrayLike<number>} m16  Column-major 4x4 matrix elements
 * @returns {Float64Array}
 */
export function extractFrustumPlanes(m16) {
  // Column-major access: m[col][row] = m16[col*4 + row]
  // For column-major, row r is (m16[r], m16[4+r], m16[8+r], m16[12+r]).
  // Planes: row3 +/- row{0,1,2}, where row3 is (m16[3], m16[7], m16[11], m16[15]).
  const r0x = m16[0], r0y = m16[4], r0z = m16[8], r0w = m16[12];
  const r1x = m16[1], r1y = m16[5], r1z = m16[9], r1w = m16[13];
  const r2x = m16[2], r2y = m16[6], r2z = m16[10], r2w = m16[14];
  const r3x = m16[3], r3y = m16[7], r3z = m16[11], r3w = m16[15];

  const planes = new Float64Array(24);
  // Left = row3 + row0
  planes[0] = r3x + r0x; planes[1] = r3y + r0y; planes[2] = r3z + r0z; planes[3] = r3w + r0w;
  // Right = row3 - row0
  planes[4] = r3x - r0x; planes[5] = r3y - r0y; planes[6] = r3z - r0z; planes[7] = r3w - r0w;
  // Bottom = row3 + row1
  planes[8] = r3x + r1x; planes[9] = r3y + r1y; planes[10] = r3z + r1z; planes[11] = r3w + r1w;
  // Top = row3 - row1
  planes[12] = r3x - r1x; planes[13] = r3y - r1y; planes[14] = r3z - r1z; planes[15] = r3w - r1w;
  // Near = row3 + row2
  planes[16] = r3x + r2x; planes[17] = r3y + r2y; planes[18] = r3z + r2z; planes[19] = r3w + r2w;
  // Far = row3 - row2
  planes[20] = r3x - r2x; planes[21] = r3y - r2y; planes[22] = r3z - r2z; planes[23] = r3w - r2w;

  // Normalize each plane so |normal| = 1
  for (let i = 0; i < 6; i++) {
    const o = i * 4;
    const a = planes[o], b = planes[o + 1], c = planes[o + 2];
    const len = Math.hypot(a, b, c);
    if (len > 0) {
      const inv = 1 / len;
      planes[o] = a * inv;
      planes[o + 1] = b * inv;
      planes[o + 2] = c * inv;
      planes[o + 3] = planes[o + 3] * inv;
    }
  }
  return planes;
}

/**
 * Test whether a sphere intersects the frustum.
 *
 * @param {number} cx Sphere center x (world)
 * @param {number} cy Sphere center y (world)
 * @param {number} cz Sphere center z (world)
 * @param {number} r  Sphere radius (world)
 * @param {Float64Array} planes 6 planes from extractFrustumPlanes
 * @returns {boolean}
 */
export function sphereIntersectsFrustum(cx, cy, cz, r, planes) {
  for (let i = 0; i < 6; i++) {
    const o = i * 4;
    const d = planes[o] * cx + planes[o + 1] * cy + planes[o + 2] * cz + planes[o + 3];
    if (d < -r) return false;
  }
  return true;
}

/**
 * Multiply two 4x4 column-major matrices: out = a * b.
 *
 * @param {ArrayLike<number>} a 16 elements
 * @param {ArrayLike<number>} b 16 elements
 * @returns {Float64Array} 16-element column-major result
 */
export function multiplyMatrix4(a, b) {
  const out = new Float64Array(16);
  const a11 = a[0], a21 = a[1], a31 = a[2], a41 = a[3];
  const a12 = a[4], a22 = a[5], a32 = a[6], a42 = a[7];
  const a13 = a[8], a23 = a[9], a33 = a[10], a43 = a[11];
  const a14 = a[12], a24 = a[13], a34 = a[14], a44 = a[15];
  for (let col = 0; col < 4; col++) {
    const b1 = b[col * 4];
    const b2 = b[col * 4 + 1];
    const b3 = b[col * 4 + 2];
    const b4 = b[col * 4 + 3];
    out[col * 4] = a11 * b1 + a12 * b2 + a13 * b3 + a14 * b4;
    out[col * 4 + 1] = a21 * b1 + a22 * b2 + a23 * b3 + a24 * b4;
    out[col * 4 + 2] = a31 * b1 + a32 * b2 + a33 * b3 + a34 * b4;
    out[col * 4 + 3] = a41 * b1 + a42 * b2 + a43 * b3 + a44 * b4;
  }
  return out;
}

/**
 * Invert a 4x4 column-major matrix. Returns null if singular.
 *
 * Adapted from gl-matrix's mat4.invert. Exported in case host wants to
 * derive matrixWorldInverse from matrixWorld outside the snapshot hot path.
 *
 * @param {ArrayLike<number>} m 16 elements
 * @returns {Float64Array | null}
 */
export function invertMatrix4(m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (det === 0) return null;
  const invDet = 1 / det;

  const out = new Float64Array(16);
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * invDet;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * invDet;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * invDet;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * invDet;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * invDet;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * invDet;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * invDet;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * invDet;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * invDet;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * invDet;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * invDet;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * invDet;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * invDet;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * invDet;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * invDet;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * invDet;
  return out;
}


// ── Cadence helpers (AC #11) ────────────────────────────────────────────
//
// Three sampling cadences for inventory snapshots. Each wraps a recorder
// (returned by bindCaptureToBuffer) and decides per-tick whether to attach
// an inventory snapshot to the just-pushed sample. The recorder's own
// frame counting + buffer-push semantics are unchanged; the wrapper only
// adds inventory.
//
// Cost characterization (research §6, well-dipper-scale ~hundreds of meshes):
//
//   everyFrame:    ~30-60 ms/sec at 60 Hz (3-6% frame budget)
//   everyN(N=6):   ~5-10 ms/sec at 60 Hz (~0.5% frame budget)
//   phaseBoundary: sub-ms per scenario (handful of snapshots total)
//
// Default for production tests: phaseBoundary. Use everyN for soak runs
// where intra-phase regressions matter. Use everyFrame only for short
// regression captures where temporal resolution is load-bearing.

/**
 * Read a dotted path from an object. Returns undefined if any segment is
 * absent. Used by withPhaseBoundaryInventory to monitor state.<phaseField>.
 *
 * @param {object | undefined} obj
 * @param {string | undefined} path
 * @returns {*}
 */
function readPath(obj, path) {
  if (!path || obj == null) return undefined;
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * @typedef {object} CadenceOptions
 * @property {object} recorder       Returned by bindCaptureToBuffer.
 * @property {object} scene          Three.js Scene-shaped (passed to takeSceneInventory).
 * @property {object} camera         Three.js Camera-shaped.
 * @property {object} [composer]
 * @property {object} [overlayRegistry]
 * @property {object} [renderer]
 * @property {string} [meshNamePrefix]
 * @property {boolean} [includeBoundingSphere]
 * @property {boolean} [verbose]
 *
 * @typedef {CadenceOptions & { stateFieldPath: string }} PhaseBoundaryCadenceOptions
 */

/**
 * Attach inventory only when host's named state field transitions.
 *
 * Cheapest cadence: sub-ms per phase boundary; zero cost between transitions.
 * Default for production tests.
 *
 * Caller's tick loop continues to call returned object's tick() like the
 * underlying recorder's tick(). When state.<stateFieldPath> changes from
 * the prior tick, takeSceneInventory is called and the snapshot is attached
 * to that frame's record.
 *
 * @param {PhaseBoundaryCadenceOptions} options
 * @returns {{ tick: typeof options.recorder.tick, frameCount: () => number, reset: () => void }}
 */
export function withPhaseBoundaryInventory(options) {
  if (!options || !options.recorder) throw new Error('withPhaseBoundaryInventory: options.recorder required');
  if (!options.stateFieldPath) throw new Error('withPhaseBoundaryInventory: options.stateFieldPath required');
  const { recorder, stateFieldPath, ...invOpts } = options;
  let lastPhase;
  let firstTick = true;
  return {
    tick(t, anchor, extras) {
      const sample = recorder.tick(t, anchor, extras);
      const phase = readPath(extras?.state, stateFieldPath);
      // Capture on first tick AND on every transition.
      if (firstTick || phase !== lastPhase) {
        sample.inventory = takeSceneInventory(invOpts);
        lastPhase = phase;
        firstTick = false;
      }
      return sample;
    },
    frameCount() { return recorder.frameCount(); },
    reset() { lastPhase = undefined; firstTick = true; recorder.reset(); },
  };
}

/**
 * Attach inventory every N frames.
 *
 * Cost: ~1/N of everyFrame's per-second cost. With N=6 at 60 Hz sim,
 * ~10 inventories/sec — sub-1% frame budget at well-dipper scale.
 *
 * @param {number} n
 * @param {CadenceOptions} options
 */
export function everyN(n, options) {
  if (typeof n !== 'number' || n < 1) throw new Error('everyN: n must be a positive integer');
  if (!options || !options.recorder) throw new Error('everyN: options.recorder required');
  const { recorder, ...invOpts } = options;
  let counter = 0;
  return {
    tick(t, anchor, extras) {
      const sample = recorder.tick(t, anchor, extras);
      if (counter % n === 0) {
        sample.inventory = takeSceneInventory(invOpts);
      }
      counter++;
      return sample;
    },
    frameCount() { return recorder.frameCount(); },
    reset() { counter = 0; recorder.reset(); },
  };
}

/**
 * Attach inventory every frame.
 *
 * Highest temporal resolution; highest per-second cost (~3-6% frame budget
 * at 60 Hz with hundreds of meshes). Use for short regression captures only.
 *
 * @param {CadenceOptions} options
 */
export function everyFrame(options) {
  return everyN(1, options);
}
