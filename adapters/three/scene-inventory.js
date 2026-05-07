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
 * @typedef {object} SceneEntry
 * @property {string} name             Source-tag value applied to every mesh /
 *                                     camera / light entry collected from this
 *                                     scene (e.g. 'main', 'sky'). Predicates
 *                                     can scope by source.
 * @property {object} scene            Three.js Scene-shaped (duck-typed).
 *                                     Must expose .traverseVisible(cb) and
 *                                     .traverse(cb).
 * @property {object} camera           Three.js Camera-shaped. Must expose
 *                                     .projectionMatrix.elements (16 floats)
 *                                     and .matrixWorldInverse.elements OR
 *                                     .matrixWorld.elements (we invert).
 *
 * @typedef {object} MaterialWatchEntry
 * @property {string} role             Stable identifier for predicate lookups
 *                                     (e.g. 'warp.tunnel').
 * @property {object} material         Three.js Material-shaped. Duck-types on
 *                                     .uniforms[name].value.
 * @property {string[]} watch          Uniform names to capture. Uniforms not
 *                                     present in material.uniforms are recorded
 *                                     as null — surfaces silent typos.
 *
 * @typedef {object} RenderTargetEntry
 * @property {string} name
 * @property {object} target           Three.js WebGLRenderTarget-shaped.
 *
 * @typedef {object} AudioTrackEntry
 * @property {string} track
 * @property {boolean} isPlaying
 * @property {number} [currentTime]
 * @property {number} [volume]
 *
 * @typedef {object} TakeSceneInventoryOptions
 * @property {SceneEntry[]} [scenes]   Multi-scene shape. Preferred for hosts
 *                                     with separate sky / main / HUD scenes.
 *                                     Each entry contributes meshes / cameras /
 *                                     lights tagged with source = scene name.
 * @property {object} [scene]          Legacy single-scene shape. Equivalent to
 *                                     `scenes: [{ name: 'main', scene, camera }]`.
 *                                     Provide either { scenes } OR { scene, camera }.
 * @property {object} [camera]         Companion to `scene` for legacy shape.
 * @property {object} [composer]       Optional. Duck-types on .passes array.
 * @property {object} [overlayRegistry]
 *                                     Optional createOverlayRegistry() instance.
 * @property {object} [renderer]       Optional. Duck-types on .info.render.
 * @property {MaterialWatchEntry[]} [materials]
 *                                     Host-declared material watchlist. Each
 *                                     entry's uniforms[w] for each w in watch
 *                                     are sampled into inventory.materials[i].uniforms.
 * @property {Record<string, number>} [clocks]
 *                                     Named numerical clocks (warp elapsed,
 *                                     audio beat, autopilot tour timer …).
 *                                     Non-number values dropped.
 * @property {Record<string, string>} [modes]
 *                                     Named string-valued mode flags
 *                                     ('viewport' → 'system' | 'galaxy' | …).
 * @property {RenderTargetEntry[]} [renderTargets]
 *                                     Named render targets (composer ping-pong,
 *                                     dedicated effect targets …).
 * @property {Record<string, string>} [phases]
 *                                     Named state-machine phases (autopilot,
 *                                     warp, …). Cross-system assertions go
 *                                     through phaseEquals.
 * @property {AudioTrackEntry[]} [audio]
 *                                     Per-track playback state.
 * @property {object} [input]          Plain JSON-serializable record of
 *                                     input-layer state ({ 'held-keys': [...],
 *                                     'last-action': '…' }).
 * @property {string} [meshNamePrefix=''] Filter meshes whose name starts
 *                                     with this prefix. Default: include all.
 * @property {boolean} [includeBoundingSphere=false]
 *                                     Include boundingSphereRadius per mesh
 *                                     entry. Opt-in because computeBoundingSphere
 *                                     can throw on Points geometry.
 * @property {boolean} [verbose=false] Emit warnings to stderr/console.warn
 *                                     on empty mesh names. Opt-in for
 *                                     kit-development + first-time host
 *                                     integration; production capture is silent.
 */

/**
 * Capture a SceneInventory snapshot at this instant.
 *
 * Synchronous, no rAF dependency — runs at sim tick before render.
 *
 * Multi-scene contract: `scenes` is preferred. Each mesh / camera / light entry
 * carries its origin scene's name in `source`. `composer`, `renderer`,
 * `overlayRegistry`, and the 7 host-supplied category fields (materials,
 * clocks, modes, renderTargets, phases, audio, input) are scene-graph-orthogonal
 * and not source-tagged. Categories that aren't passed are OMITTED from the
 * returned inventory (not [] / not null) — same opt-in convention as
 * domOverlays.
 *
 * @param {TakeSceneInventoryOptions} options
 * @returns {SceneInventory}
 */
export function takeSceneInventory(options) {
  if (!options) throw new Error('takeSceneInventory: options required');

  const scenes = normalizeScenes(options);
  const verbose = !!options.verbose;
  const meshPrefix = options.meshNamePrefix || '';
  const includeBoundingSphere = !!options.includeBoundingSphere;

  /** @type {object[]} */
  const meshes = [];
  /** @type {object[]} */
  const cameras = [];
  /** @type {object[]} */
  const lights = [];
  const seenCameraUuids = new Set();
  const seenLightUuids = new Set();

  for (const entry of scenes) {
    const { name: source, scene, camera } = entry;
    if (typeof scene.traverseVisible !== 'function') {
      throw new Error(`takeSceneInventory: scenes['${source}'].traverseVisible() missing — pass a Three.js Scene-shaped object`);
    }
    if (!camera.projectionMatrix || !camera.projectionMatrix.elements) {
      throw new Error(`takeSceneInventory: scenes['${source}'].camera.projectionMatrix.elements missing — pass a Three.js Camera-shaped object`);
    }

    // Build clip-space matrix: M = projection * matrixWorldInverse
    // matrixWorldInverse should be current; if missing, derive from matrixWorld.
    let invE = camera.matrixWorldInverse?.elements;
    if (!invE) {
      if (!camera.matrixWorld?.elements) {
        throw new Error(`takeSceneInventory: scenes['${source}'].camera.matrixWorldInverse OR matrixWorld required`);
      }
      invE = invertMatrix4(camera.matrixWorld.elements);
    }
    const projE = camera.projectionMatrix.elements;
    const clipE = multiplyMatrix4(projE, invE);
    const planes = extractFrustumPlanes(clipE);

    // Capture meshes via traverseVisible (renderable visibility chain).
    scene.traverseVisible((obj) => {
      if (!obj.geometry) return;
      if (meshPrefix && (obj.name || '').indexOf(meshPrefix) !== 0) return;

      if (verbose && (obj.name === '' || obj.name == null)) {
        // eslint-disable-next-line no-console
        console.warn(`[takeSceneInventory] unnamed mesh in scene-graph (source='${source}', uuid=${obj.uuid}, type=${obj.type}). Predicates assert by mesh name; unnamed meshes silently skip.`);
      }

      const mwE = obj.matrixWorld?.elements;
      const worldPos = mwE
        ? [mwE[12], mwE[13], mwE[14]]
        : [obj.position?.x ?? 0, obj.position?.y ?? 0, obj.position?.z ?? 0];

      let inFrustum = true;
      if (obj.frustumCulled !== false) {
        const sphere = obj.geometry?.boundingSphere;
        if (sphere && sphere.center && typeof sphere.radius === 'number') {
          const cwx = mwE
            ? mwE[0] * sphere.center.x + mwE[4] * sphere.center.y + mwE[8] * sphere.center.z + mwE[12]
            : sphere.center.x;
          const cwy = mwE
            ? mwE[1] * sphere.center.x + mwE[5] * sphere.center.y + mwE[9] * sphere.center.z + mwE[13]
            : sphere.center.y;
          const cwz = mwE
            ? mwE[2] * sphere.center.x + mwE[6] * sphere.center.y + mwE[10] * sphere.center.z + mwE[14]
            : sphere.center.z;
          const sx = mwE ? Math.hypot(mwE[0], mwE[1], mwE[2]) : 1;
          const sy = mwE ? Math.hypot(mwE[4], mwE[5], mwE[6]) : 1;
          const sz = mwE ? Math.hypot(mwE[8], mwE[9], mwE[10]) : 1;
          const worldRadius = sphere.radius * Math.max(sx, sy, sz);
          inFrustum = sphereIntersectsFrustum(cwx, cwy, cwz, worldRadius, planes);
        }
      }

      const meshEntry = {
        name: obj.name || '',
        type: obj.type || 'Object3D',
        uuid: obj.uuid || '',
        source,
        visible: !!obj.visible,
        frustumCulled: obj.frustumCulled !== false,
        inFrustum,
        worldPos,
        layer: (obj.layers?.mask) ?? 1,
        materialUuid: obj.material?.uuid ?? '',
        geometryUuid: obj.geometry?.uuid ?? '',
      };
      if (includeBoundingSphere && obj.geometry?.boundingSphere?.radius != null) {
        meshEntry.boundingSphereRadius = obj.geometry.boundingSphere.radius;
      }
      meshes.push(meshEntry);
    });

    // Cameras + lights via traverse (visible-or-not — they don't render
    // themselves so the visibility chain doesn't apply to *whether to inventory*).
    if (typeof scene.traverse === 'function') {
      scene.traverse((obj) => {
        if (obj.isCamera === true && !seenCameraUuids.has(obj.uuid)) {
          seenCameraUuids.add(obj.uuid);
          cameras.push(buildCameraEntry(obj, source));
        } else if (obj.isLight === true && !seenLightUuids.has(obj.uuid)) {
          seenLightUuids.add(obj.uuid);
          lights.push(buildLightEntry(obj, source));
        }
      });
    }

    // Always include the explicitly-passed camera for this scene if not
    // already collected (cameras typically aren't on the scene-graph).
    if (camera.uuid && !seenCameraUuids.has(camera.uuid)) {
      seenCameraUuids.add(camera.uuid);
      cameras.push(buildCameraEntry(camera, source));
    }
  }

  /** @type {SceneInventory} */
  const inv = { meshes, cameras, lights };

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

  // Host-supplied categories — opt-in (omit when not provided).
  if (options.materials != null) inv.materials = captureMaterials(options.materials);
  if (options.clocks != null) inv.clocks = captureRecord(options.clocks, 'clocks', 'number');
  if (options.modes != null) inv.modes = captureRecord(options.modes, 'modes', 'string');
  if (options.renderTargets != null) inv.renderTargets = captureRenderTargets(options.renderTargets);
  if (options.phases != null) inv.phases = captureRecord(options.phases, 'phases', 'string');
  if (options.audio != null) inv.audio = captureAudio(options.audio);
  if (options.input != null) inv.input = captureInput(options.input);

  return inv;
}

// ── Multi-scene normalization ───────────────────────────────────────────

function normalizeScenes(options) {
  if (Array.isArray(options.scenes)) {
    if (options.scenes.length === 0) {
      throw new Error('takeSceneInventory: scenes array must contain at least one entry');
    }
    const seen = new Set();
    for (const s of options.scenes) {
      if (!s || typeof s.name !== 'string' || s.name.length === 0) {
        throw new Error('takeSceneInventory: each scenes[] entry must have a string `name`');
      }
      if (seen.has(s.name)) {
        throw new Error(`takeSceneInventory: duplicate scene name '${s.name}' in scenes[]`);
      }
      seen.add(s.name);
      if (!s.scene) throw new Error(`takeSceneInventory: scenes['${s.name}'].scene required`);
      if (!s.camera) throw new Error(`takeSceneInventory: scenes['${s.name}'].camera required`);
    }
    return options.scenes;
  }
  if (options.scene && options.camera) {
    return [{ name: 'main', scene: options.scene, camera: options.camera }];
  }
  throw new Error('takeSceneInventory: provide either { scenes: [...] } or { scene, camera }');
}

// ── Camera + light entry builders ───────────────────────────────────────

function buildCameraEntry(cam, source) {
  const mwE = cam.matrixWorld?.elements;
  const worldPos = mwE
    ? [mwE[12], mwE[13], mwE[14]]
    : [cam.position?.x ?? 0, cam.position?.y ?? 0, cam.position?.z ?? 0];
  const isOrtho = cam.isOrthographicCamera === true;
  return {
    name: cam.name || '',
    type: cam.type || (cam.isPerspectiveCamera ? 'PerspectiveCamera' : isOrtho ? 'OrthographicCamera' : 'Camera'),
    uuid: cam.uuid || '',
    source,
    fov: typeof cam.fov === 'number' ? cam.fov : null,
    aspect: typeof cam.aspect === 'number' ? cam.aspect : null,
    near: typeof cam.near === 'number' ? cam.near : null,
    far: typeof cam.far === 'number' ? cam.far : null,
    isOrthographic: isOrtho,
    worldPos,
  };
}

function buildLightEntry(light, source) {
  const mwE = light.matrixWorld?.elements;
  const worldPos = mwE
    ? [mwE[12], mwE[13], mwE[14]]
    : [light.position?.x ?? 0, light.position?.y ?? 0, light.position?.z ?? 0];
  let color = '';
  if (light.color) {
    if (typeof light.color.getHexString === 'function') {
      color = light.color.getHexString();
    } else if (typeof light.color === 'number') {
      color = (light.color >>> 0).toString(16).padStart(6, '0');
    } else if (typeof light.color.r === 'number') {
      const r = Math.round((light.color.r ?? 0) * 255);
      const g = Math.round((light.color.g ?? 0) * 255);
      const b = Math.round((light.color.b ?? 0) * 255);
      color = ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
    }
  }
  return {
    name: light.name || '',
    type: light.type || 'Light',
    uuid: light.uuid || '',
    source,
    visible: light.visible !== false,
    intensity: typeof light.intensity === 'number' ? light.intensity : 1,
    color,
    worldPos,
  };
}

// ── Host-supplied capture helpers ───────────────────────────────────────

function captureMaterials(materialsList) {
  if (!Array.isArray(materialsList)) {
    throw new Error('takeSceneInventory: materials must be an array of { role, material, watch }');
  }
  return materialsList.map(({ role, material, watch }) => {
    if (typeof role !== 'string' || role.length === 0) {
      throw new Error('takeSceneInventory: materials[i].role must be a non-empty string');
    }
    const uniforms = {};
    if (Array.isArray(watch) && material?.uniforms) {
      for (const uName of watch) {
        if (typeof uName !== 'string') continue;
        if (Object.prototype.hasOwnProperty.call(material.uniforms, uName)) {
          const u = material.uniforms[uName];
          uniforms[uName] = serializeUniformValue(u && Object.prototype.hasOwnProperty.call(u, 'value') ? u.value : u);
        } else {
          // Declared in watch but not present on material. Surface as null
          // so uniformValueAt distinguishes missing-from-material vs
          // present-but-mismatch.
          uniforms[uName] = null;
        }
      }
    }
    return {
      role,
      uniforms,
      transparent: !!material?.transparent,
      depthTest: material?.depthTest !== false,
      depthWrite: material?.depthWrite !== false,
      blending: typeof material?.blending === 'number' ? material.blending : null,
      visible: material?.visible !== false,
    };
  });
}

function serializeUniformValue(v) {
  if (v == null) return null;
  const t = typeof v;
  if (t === 'number' || t === 'boolean' || t === 'string') return v;
  if (Array.isArray(v)) {
    const out = [];
    const n = Math.min(v.length, 16);
    for (let i = 0; i < n; i++) out.push(serializeUniformValue(v[i]));
    return out;
  }
  if (typeof v.x === 'number') {
    const out = { x: v.x };
    if (typeof v.y === 'number') out.y = v.y;
    if (typeof v.z === 'number') out.z = v.z;
    if (typeof v.w === 'number') out.w = v.w;
    return out;
  }
  if (typeof v.r === 'number' && typeof v.g === 'number' && typeof v.b === 'number') {
    return { r: v.r, g: v.g, b: v.b };
  }
  if (typeof v.uuid === 'string') {
    return { uuid: v.uuid, name: v.name || '', type: v.type || 'Texture' };
  }
  if (typeof v.length === 'number' && (v instanceof Float32Array || v instanceof Float64Array || v instanceof Int32Array)) {
    return { length: v.length, _kind: 'TypedArray' };
  }
  return { _kind: 'unserialized' };
}

function captureRecord(record, label, valueType) {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    throw new Error(`takeSceneInventory: ${label} must be a plain object Record<key, ${valueType}>`);
  }
  const out = {};
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === valueType) out[k] = v;
  }
  return out;
}

function captureRenderTargets(rtList) {
  if (!Array.isArray(rtList)) {
    throw new Error('takeSceneInventory: renderTargets must be an array of { name, target }');
  }
  return rtList.map(({ name, target }) => {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('takeSceneInventory: renderTargets[i].name must be a non-empty string');
    }
    return {
      name,
      width: typeof target?.width === 'number' ? target.width : 0,
      height: typeof target?.height === 'number' ? target.height : 0,
      depthBuffer: target?.depthBuffer !== false,
      samples: typeof target?.samples === 'number' ? target.samples : 0,
      textureUuid: typeof target?.texture?.uuid === 'string' ? target.texture.uuid : '',
    };
  });
}

function captureAudio(audioList) {
  if (!Array.isArray(audioList)) {
    throw new Error('takeSceneInventory: audio must be an array of { track, isPlaying, ... }');
  }
  return audioList.map((a) => {
    if (typeof a?.track !== 'string' || a.track.length === 0) {
      throw new Error('takeSceneInventory: audio[i].track must be a non-empty string');
    }
    return {
      track: a.track,
      isPlaying: !!a.isPlaying,
      currentTime: typeof a.currentTime === 'number' ? a.currentTime : 0,
      volume: typeof a.volume === 'number' ? a.volume : 0,
    };
  });
}

function captureInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('takeSceneInventory: input must be a plain object Record<kind, JSON-value>');
  }
  // Roundtrip through JSON to enforce purity. Host may pass cyclic / non-
  // JSON values; fail loudly rather than silently corrupting the snapshot.
  try {
    return JSON.parse(JSON.stringify(input));
  } catch (e) {
    throw new Error(`takeSceneInventory: input is not JSON-serializable: ${e.message}`);
  }
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
