// Inventory predicates — structural-visibility-class assertions.
//
// Pure-data: zero engine/DOM imports. Each predicate matches the kit's
// established predicate shape: (inventoriesByPhase, options) ->
// { passed, violations, totalSamples }. Inventoriesbyphase is a
// Map<phaseKey, SceneInventory> produced by snapshotAtPhaseBoundaries
// (or constructed directly by hosts that take their own snapshots).
//
// Predicates that target a named entity distinguish two failure modes
// in their violations array — "entity not found" vs "entity found but
// unnamed/empty-id" — so working-Claude's diagnostic loop converges on
// the right cause (host-side naming policy vs scene-graph state).

import { MissingInventoryFieldError, InventoryEntityNotFoundError } from './errors.js';

function getInventory(inventoriesByPhase, phaseKey, predicateName) {
  if (!inventoriesByPhase || typeof inventoriesByPhase.get !== 'function') {
    throw new Error(`${predicateName}: inventoriesByPhase must be a Map<phaseKey, SceneInventory>`);
  }
  const inv = inventoriesByPhase.get(phaseKey);
  if (!inv) {
    throw new InventoryEntityNotFoundError(predicateName, -1, 'phase', phaseKey);
  }
  return inv;
}

function findMesh(meshes, name, source) {
  if (!Array.isArray(meshes)) return { entry: null, hasUnnamed: false };
  let entry = null;
  let hasUnnamed = false;
  for (const m of meshes) {
    // Multi-scene scoping: when source is provided, restrict to that source.
    if (source != null && m.source !== source) continue;
    if (m.name === name) { entry = m; break; }
    if (m.name === '') hasUnnamed = true;
  }
  return { entry, hasUnnamed };
}

function findOverlay(overlays, id) {
  if (!Array.isArray(overlays)) return null;
  for (const o of overlays) if (o.id === id) return o;
  return null;
}

function findPass(passes, name) {
  if (!Array.isArray(passes)) return null;
  for (const p of passes) if (p.name === name) return p;
  return null;
}

function findByName(list, name) {
  if (!Array.isArray(list)) return null;
  for (const e of list) if (e.name === name) return e;
  return null;
}

// ─── Mesh predicates ─────────────────────────────────────────────────────

/**
 * Assert a named mesh is visible (visible AND inFrustum) at the given phase.
 *
 * @param {Map<string, object>} inventoriesByPhase
 * @param {{ phaseKey: string, meshName: string, source?: string }} options
 *   `source` (optional): scope the mesh lookup to that scene's source tag
 *   (e.g. 'main', 'sky'). Default: search across all sources.
 * @returns {{ passed: boolean, violations: object[], totalSamples: number }}
 */
export function meshVisibleAt(inventoriesByPhase, options) {
  if (!options?.phaseKey || !options?.meshName) {
    throw new Error('meshVisibleAt: options.phaseKey and options.meshName required');
  }
  const inv = getInventory(inventoriesByPhase, options.phaseKey, 'meshVisibleAt');
  if (!Array.isArray(inv.meshes)) {
    throw new MissingInventoryFieldError('meshVisibleAt', -1, 'inventory.meshes');
  }
  const { entry, hasUnnamed } = findMesh(inv.meshes, options.meshName, options.source);
  const violations = [];
  if (!entry) {
    violations.push({
      phase: options.phaseKey,
      reason: hasUnnamed ? 'mesh not found at phase (note: unnamed meshes present in scene — likely host-naming-policy issue)' : 'mesh not found at phase',
      meshName: options.meshName,
      source: options.source,
    });
  } else if (!entry.visible || !entry.inFrustum) {
    violations.push({
      phase: options.phaseKey,
      reason: !entry.visible ? 'mesh present but visible=false' : 'mesh visible but not inFrustum',
      meshName: options.meshName,
      source: options.source,
      entry,
    });
  }
  return { passed: violations.length === 0, violations, totalSamples: 1 };
}

/**
 * Assert a named mesh is hidden (visible=false OR inFrustum=false OR absent).
 *
 * @param {Map<string, object>} inventoriesByPhase
 * @param {{ phaseKey: string, meshName: string, source?: string }} options
 */
export function meshHiddenAt(inventoriesByPhase, options) {
  if (!options?.phaseKey || !options?.meshName) {
    throw new Error('meshHiddenAt: options.phaseKey and options.meshName required');
  }
  const inv = getInventory(inventoriesByPhase, options.phaseKey, 'meshHiddenAt');
  const { entry } = findMesh(inv.meshes ?? [], options.meshName, options.source);
  const violations = [];
  if (entry && entry.visible && entry.inFrustum) {
    violations.push({
      phase: options.phaseKey,
      reason: 'mesh visible AND inFrustum — expected hidden',
      meshName: options.meshName,
      source: options.source,
      entry,
    });
  }
  return { passed: violations.length === 0, violations, totalSamples: 1 };
}

// ─── Overlay predicates ──────────────────────────────────────────────────

export function overlayVisibleAt(inventoriesByPhase, options) {
  if (!options?.phaseKey || !options?.overlayId) {
    throw new Error('overlayVisibleAt: options.phaseKey and options.overlayId required');
  }
  const inv = getInventory(inventoriesByPhase, options.phaseKey, 'overlayVisibleAt');
  if (!Array.isArray(inv.domOverlays)) {
    throw new MissingInventoryFieldError('overlayVisibleAt', -1, 'inventory.domOverlays');
  }
  const entry = findOverlay(inv.domOverlays, options.overlayId);
  const violations = [];
  if (!entry) {
    violations.push({ phase: options.phaseKey, reason: 'overlay id not found', overlayId: options.overlayId });
  } else if (!entry.visible) {
    violations.push({ phase: options.phaseKey, reason: 'overlay registered but not visible', overlayId: options.overlayId, entry });
  }
  return { passed: violations.length === 0, violations, totalSamples: 1 };
}

export function overlayHiddenAt(inventoriesByPhase, options) {
  if (!options?.phaseKey || !options?.overlayId) {
    throw new Error('overlayHiddenAt: options.phaseKey and options.overlayId required');
  }
  const inv = getInventory(inventoriesByPhase, options.phaseKey, 'overlayHiddenAt');
  const entry = findOverlay(inv.domOverlays ?? [], options.overlayId);
  const violations = [];
  if (entry && entry.visible) {
    violations.push({ phase: options.phaseKey, reason: 'overlay visible — expected hidden', overlayId: options.overlayId, entry });
  }
  return { passed: violations.length === 0, violations, totalSamples: 1 };
}

// ─── Composer-pass predicate ─────────────────────────────────────────────

export function passEnabledAt(inventoriesByPhase, options) {
  if (!options?.phaseKey || !options?.passName) {
    throw new Error('passEnabledAt: options.phaseKey and options.passName required');
  }
  const inv = getInventory(inventoriesByPhase, options.phaseKey, 'passEnabledAt');
  if (!Array.isArray(inv.composerPasses)) {
    throw new MissingInventoryFieldError('passEnabledAt', -1, 'inventory.composerPasses');
  }
  const entry = findPass(inv.composerPasses, options.passName);
  const violations = [];
  if (!entry) {
    violations.push({ phase: options.phaseKey, reason: 'composer pass not found', passName: options.passName });
  } else if (!entry.enabled) {
    violations.push({ phase: options.phaseKey, reason: 'pass present but enabled=false', passName: options.passName, entry });
  }
  return { passed: violations.length === 0, violations, totalSamples: 1 };
}

// ─── Renderer-info budget predicates ─────────────────────────────────────

/**
 * Assert drawCalls under the given max at the named phase (or all phases
 * if phaseKey omitted).
 *
 * @param {Map<string, object>} inventoriesByPhase
 * @param {{ phaseKey?: string, max: number }} options
 */
export function drawCallBudget(inventoriesByPhase, options) {
  if (typeof options?.max !== 'number') {
    throw new Error('drawCallBudget: options.max (number) required');
  }
  const violations = [];
  const phases = options.phaseKey ? [options.phaseKey] : [...inventoriesByPhase.keys()];
  for (const phase of phases) {
    const inv = inventoriesByPhase.get(phase);
    if (!inv) {
      throw new InventoryEntityNotFoundError('drawCallBudget', -1, 'phase', phase);
    }
    if (!inv.rendererInfo) {
      throw new MissingInventoryFieldError('drawCallBudget', -1, `inventoriesByPhase.${phase}.rendererInfo`);
    }
    if (inv.rendererInfo.drawCalls > options.max) {
      violations.push({ phase, value: inv.rendererInfo.drawCalls, bound: options.max });
    }
  }
  return { passed: violations.length === 0, violations, totalSamples: phases.length };
}

export function triangleBudget(inventoriesByPhase, options) {
  if (typeof options?.max !== 'number') {
    throw new Error('triangleBudget: options.max (number) required');
  }
  const violations = [];
  const phases = options.phaseKey ? [options.phaseKey] : [...inventoriesByPhase.keys()];
  for (const phase of phases) {
    const inv = inventoriesByPhase.get(phase);
    if (!inv) {
      throw new InventoryEntityNotFoundError('triangleBudget', -1, 'phase', phase);
    }
    if (!inv.rendererInfo) {
      throw new MissingInventoryFieldError('triangleBudget', -1, `inventoriesByPhase.${phase}.rendererInfo`);
    }
    if (inv.rendererInfo.triangles > options.max) {
      violations.push({ phase, value: inv.rendererInfo.triangles, bound: options.max });
    }
  }
  return { passed: violations.length === 0, violations, totalSamples: phases.length };
}

// ─── Phase-keyed inventory collection helper ─────────────────────────────

/**
 * Walk a samples array; for each requested phaseKey, find the FIRST sample
 * where samples[i].state.<stateFieldPath> === phaseKey, and return that
 * sample's inventory keyed by phaseKey.
 *
 * Tester invocation pattern:
 *   const invs = snapshotAtPhaseBoundaries(samples, ['HYPER', 'EXIT'], 'warpState');
 *   assert.equal(meshVisibleAt(invs, { phaseKey: 'HYPER', meshName: 'tunnelMesh' }).passed, true);
 *
 * @param {Array<{state?: object, inventory?: object}>} samples
 * @param {string[]} phaseKeys
 * @param {string} stateFieldPath  Dotted path into samples[i].state
 * @returns {Map<string, object>} Map of phaseKey to SceneInventory
 */
export function snapshotAtPhaseBoundaries(samples, phaseKeys, stateFieldPath) {
  if (!Array.isArray(samples)) throw new Error('snapshotAtPhaseBoundaries: samples must be an array');
  if (!Array.isArray(phaseKeys)) throw new Error('snapshotAtPhaseBoundaries: phaseKeys must be an array');
  if (typeof stateFieldPath !== 'string' || !stateFieldPath) {
    throw new Error('snapshotAtPhaseBoundaries: stateFieldPath (string) required');
  }
  const parts = stateFieldPath.split('.');
  function readPath(state) {
    let cur = state;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }
  const out = new Map();
  for (const phaseKey of phaseKeys) {
    for (let i = 0; i < samples.length; i++) {
      const value = readPath(samples[i].state);
      if (value === phaseKey && samples[i].inventory) {
        out.set(phaseKey, samples[i].inventory);
        break;
      }
    }
  }
  return out;
}

// ─── Camera predicate ───────────────────────────────────────────────────

/**
 * Assert a named camera's projection config matches the given expectations
 * within a tolerance. `expected` may include any subset of fov / aspect /
 * near / far. Each provided field is compared.
 *
 * Distinguishes "camera not found" from "camera present but mismatch" — the
 * former points at host-naming-policy or scene-graph state; the latter at a
 * camera-config regression.
 *
 * @param {Map<string, object>} inventoriesByPhase
 * @param {{ phaseKey: string, cameraRole: string, expected: object, tolerance?: number }} options
 */
export function cameraConfigAt(inventoriesByPhase, options) {
  if (!options?.phaseKey || !options?.cameraRole || !options?.expected) {
    throw new Error('cameraConfigAt: options.phaseKey, options.cameraRole, options.expected required');
  }
  const inv = getInventory(inventoriesByPhase, options.phaseKey, 'cameraConfigAt');
  if (!Array.isArray(inv.cameras)) {
    throw new MissingInventoryFieldError('cameraConfigAt', -1, 'inventory.cameras');
  }
  const entry = findByName(inv.cameras, options.cameraRole);
  const violations = [];
  if (!entry) {
    violations.push({ phase: options.phaseKey, reason: 'camera role not found', cameraRole: options.cameraRole });
    return { passed: false, violations, totalSamples: 1 };
  }
  const tol = typeof options.tolerance === 'number' ? options.tolerance : 1e-4;
  for (const field of ['fov', 'aspect', 'near', 'far']) {
    if (!Object.prototype.hasOwnProperty.call(options.expected, field)) continue;
    const want = options.expected[field];
    const got = entry[field];
    if (typeof got !== 'number') {
      violations.push({ phase: options.phaseKey, reason: `camera.${field} not a number`, cameraRole: options.cameraRole, field, got });
      continue;
    }
    if (Math.abs(got - want) > tol) {
      violations.push({ phase: options.phaseKey, reason: `camera.${field} mismatch`, cameraRole: options.cameraRole, field, expected: want, got, tolerance: tol });
    }
  }
  return { passed: violations.length === 0, violations, totalSamples: 1 };
}

// ─── Light predicate ────────────────────────────────────────────────────

/**
 * Assert a named light is active (visible=true AND intensity >= intensityMin).
 *
 * @param {Map<string, object>} inventoriesByPhase
 * @param {{ phaseKey: string, lightId: string, intensityMin?: number }} options
 */
export function lightActiveAt(inventoriesByPhase, options) {
  if (!options?.phaseKey || !options?.lightId) {
    throw new Error('lightActiveAt: options.phaseKey and options.lightId required');
  }
  const inv = getInventory(inventoriesByPhase, options.phaseKey, 'lightActiveAt');
  if (!Array.isArray(inv.lights)) {
    throw new MissingInventoryFieldError('lightActiveAt', -1, 'inventory.lights');
  }
  const min = typeof options.intensityMin === 'number' ? options.intensityMin : 0;
  const entry = findByName(inv.lights, options.lightId);
  const violations = [];
  if (!entry) {
    violations.push({ phase: options.phaseKey, reason: 'light not found', lightId: options.lightId });
  } else if (!entry.visible) {
    violations.push({ phase: options.phaseKey, reason: 'light present but visible=false', lightId: options.lightId, entry });
  } else if (typeof entry.intensity === 'number' && entry.intensity < min) {
    violations.push({ phase: options.phaseKey, reason: 'light intensity below threshold', lightId: options.lightId, intensity: entry.intensity, intensityMin: min });
  }
  return { passed: violations.length === 0, violations, totalSamples: 1 };
}

// ─── Material uniform predicate ─────────────────────────────────────────

/**
 * Assert a named material's uniform value matches `expected` within
 * `tolerance` (numbers) or strict-equal (other types).
 *
 * @param {Map<string, object>} inventoriesByPhase
 * @param {{ phaseKey: string, materialRole: string, uniformName: string, expected: any, tolerance?: number }} options
 */
export function uniformValueAt(inventoriesByPhase, options) {
  if (!options?.phaseKey || !options?.materialRole || !options?.uniformName) {
    throw new Error('uniformValueAt: options.phaseKey, options.materialRole, options.uniformName required');
  }
  if (!Object.prototype.hasOwnProperty.call(options, 'expected')) {
    throw new Error('uniformValueAt: options.expected required');
  }
  const inv = getInventory(inventoriesByPhase, options.phaseKey, 'uniformValueAt');
  if (!Array.isArray(inv.materials)) {
    throw new MissingInventoryFieldError('uniformValueAt', -1, 'inventory.materials');
  }
  const mat = inv.materials.find((m) => m.role === options.materialRole);
  const violations = [];
  if (!mat) {
    violations.push({ phase: options.phaseKey, reason: 'material role not found', materialRole: options.materialRole });
    return { passed: false, violations, totalSamples: 1 };
  }
  if (!mat.uniforms || !Object.prototype.hasOwnProperty.call(mat.uniforms, options.uniformName)) {
    violations.push({ phase: options.phaseKey, reason: 'uniform not in material watchlist', materialRole: options.materialRole, uniformName: options.uniformName });
    return { passed: false, violations, totalSamples: 1 };
  }
  const got = mat.uniforms[options.uniformName];
  if (got === null) {
    violations.push({ phase: options.phaseKey, reason: 'uniform declared in watch but absent on material at capture time', materialRole: options.materialRole, uniformName: options.uniformName });
    return { passed: false, violations, totalSamples: 1 };
  }
  const tol = typeof options.tolerance === 'number' ? options.tolerance : 1e-6;
  if (typeof got === 'number' && typeof options.expected === 'number') {
    if (Math.abs(got - options.expected) > tol) {
      violations.push({ phase: options.phaseKey, reason: 'uniform numeric mismatch', materialRole: options.materialRole, uniformName: options.uniformName, expected: options.expected, got, tolerance: tol });
    }
  } else if (got !== options.expected) {
    // Strict equal for non-number primitives. Object/array equality would
    // need deepEqual; keep strict-equal here to avoid hiding shape changes.
    violations.push({ phase: options.phaseKey, reason: 'uniform value mismatch (strict-equal)', materialRole: options.materialRole, uniformName: options.uniformName, expected: options.expected, got });
  }
  return { passed: violations.length === 0, violations, totalSamples: 1 };
}

// ─── Clock predicate ────────────────────────────────────────────────────

/**
 * Assert a named clock's value at `phaseKey` is greater than its value at
 * `sincePhase` by at least `byMinSeconds`.
 *
 * Useful for "warp clock advanced during HYPER" or "audio-beat clock moved
 * between two captured frames" assertions.
 *
 * @param {Map<string, object>} inventoriesByPhase
 * @param {{ phaseKey: string, sincePhase: string, clockSystem: string, byMinSeconds: number }} options
 */
export function clockProgressedSince(inventoriesByPhase, options) {
  if (!options?.phaseKey || !options?.sincePhase || !options?.clockSystem) {
    throw new Error('clockProgressedSince: options.phaseKey, options.sincePhase, options.clockSystem required');
  }
  if (typeof options.byMinSeconds !== 'number') {
    throw new Error('clockProgressedSince: options.byMinSeconds (number) required');
  }
  const invNow = getInventory(inventoriesByPhase, options.phaseKey, 'clockProgressedSince');
  const invThen = getInventory(inventoriesByPhase, options.sincePhase, 'clockProgressedSince');
  if (!invNow.clocks) {
    throw new MissingInventoryFieldError('clockProgressedSince', -1, `inventoriesByPhase.${options.phaseKey}.clocks`);
  }
  if (!invThen.clocks) {
    throw new MissingInventoryFieldError('clockProgressedSince', -1, `inventoriesByPhase.${options.sincePhase}.clocks`);
  }
  const tNow = invNow.clocks[options.clockSystem];
  const tThen = invThen.clocks[options.clockSystem];
  const violations = [];
  if (typeof tNow !== 'number') {
    violations.push({ phase: options.phaseKey, reason: 'clock system not found at phase', clockSystem: options.clockSystem });
  }
  if (typeof tThen !== 'number') {
    violations.push({ phase: options.sincePhase, reason: 'clock system not found at sincePhase', clockSystem: options.clockSystem });
  }
  if (violations.length === 0) {
    const delta = tNow - tThen;
    if (delta < options.byMinSeconds) {
      violations.push({ phase: options.phaseKey, reason: 'clock did not progress by minimum', clockSystem: options.clockSystem, delta, byMinSeconds: options.byMinSeconds });
    }
  }
  return { passed: violations.length === 0, violations, totalSamples: 2 };
}

// ─── Mode predicate ─────────────────────────────────────────────────────

/**
 * Assert a named mode slot equals the expected value at `phaseKey`.
 *
 * @param {Map<string, object>} inventoriesByPhase
 * @param {{ phaseKey: string, slot: string, expected: string }} options
 */
export function modeIs(inventoriesByPhase, options) {
  if (!options?.phaseKey || !options?.slot || typeof options?.expected !== 'string') {
    throw new Error('modeIs: options.phaseKey, options.slot, options.expected (string) required');
  }
  const inv = getInventory(inventoriesByPhase, options.phaseKey, 'modeIs');
  if (!inv.modes) {
    throw new MissingInventoryFieldError('modeIs', -1, `inventoriesByPhase.${options.phaseKey}.modes`);
  }
  const got = inv.modes[options.slot];
  const violations = [];
  if (got === undefined) {
    violations.push({ phase: options.phaseKey, reason: 'mode slot not found', slot: options.slot });
  } else if (got !== options.expected) {
    violations.push({ phase: options.phaseKey, reason: 'mode mismatch', slot: options.slot, expected: options.expected, got });
  }
  return { passed: violations.length === 0, violations, totalSamples: 1 };
}

// ─── Render-target predicate ────────────────────────────────────────────

/**
 * Assert a named render target's dimensions match `expected: [w, h]`.
 *
 * @param {Map<string, object>} inventoriesByPhase
 * @param {{ phaseKey: string, rtName: string, expected: [number, number] }} options
 */
export function renderTargetSize(inventoriesByPhase, options) {
  if (!options?.phaseKey || !options?.rtName) {
    throw new Error('renderTargetSize: options.phaseKey and options.rtName required');
  }
  if (!Array.isArray(options.expected) || options.expected.length !== 2) {
    throw new Error('renderTargetSize: options.expected must be [width, height]');
  }
  const inv = getInventory(inventoriesByPhase, options.phaseKey, 'renderTargetSize');
  if (!Array.isArray(inv.renderTargets)) {
    throw new MissingInventoryFieldError('renderTargetSize', -1, 'inventory.renderTargets');
  }
  const entry = findByName(inv.renderTargets, options.rtName);
  const violations = [];
  if (!entry) {
    violations.push({ phase: options.phaseKey, reason: 'render target name not found', rtName: options.rtName });
  } else if (entry.width !== options.expected[0] || entry.height !== options.expected[1]) {
    violations.push({ phase: options.phaseKey, reason: 'render target size mismatch', rtName: options.rtName, expected: options.expected, got: [entry.width, entry.height] });
  }
  return { passed: violations.length === 0, violations, totalSamples: 1 };
}

// ─── Phase predicate (cross-system) ─────────────────────────────────────

/**
 * Assert a named state-machine system's phase equals `expected` at `phaseKey`.
 *
 * Distinct from the existing `inventoriesByPhase` Map keying: that's the
 * snapshot-key. This predicate reads `inv.phases[system]` to assert
 * cross-system phase coherence at one captured moment (e.g. "at autopilot=
 * CRUISE, warp must equal 'idle'").
 *
 * @param {Map<string, object>} inventoriesByPhase
 * @param {{ phaseKey: string, system: string, expected: string }} options
 */
export function phaseEquals(inventoriesByPhase, options) {
  if (!options?.phaseKey || !options?.system || typeof options?.expected !== 'string') {
    throw new Error('phaseEquals: options.phaseKey, options.system, options.expected (string) required');
  }
  const inv = getInventory(inventoriesByPhase, options.phaseKey, 'phaseEquals');
  if (!inv.phases) {
    throw new MissingInventoryFieldError('phaseEquals', -1, `inventoriesByPhase.${options.phaseKey}.phases`);
  }
  const got = inv.phases[options.system];
  const violations = [];
  if (got === undefined) {
    violations.push({ phase: options.phaseKey, reason: 'phase system not found', system: options.system });
  } else if (got !== options.expected) {
    violations.push({ phase: options.phaseKey, reason: 'phase mismatch', system: options.system, expected: options.expected, got });
  }
  return { passed: violations.length === 0, violations, totalSamples: 1 };
}

// ─── Audio predicate ────────────────────────────────────────────────────

/**
 * Assert a named audio track is currently playing at `phaseKey`.
 *
 * @param {Map<string, object>} inventoriesByPhase
 * @param {{ phaseKey: string, track: string }} options
 */
export function audioPlayingAt(inventoriesByPhase, options) {
  if (!options?.phaseKey || !options?.track) {
    throw new Error('audioPlayingAt: options.phaseKey and options.track required');
  }
  const inv = getInventory(inventoriesByPhase, options.phaseKey, 'audioPlayingAt');
  if (!Array.isArray(inv.audio)) {
    throw new MissingInventoryFieldError('audioPlayingAt', -1, 'inventory.audio');
  }
  const entry = inv.audio.find((a) => a.track === options.track);
  const violations = [];
  if (!entry) {
    violations.push({ phase: options.phaseKey, reason: 'audio track not found', track: options.track });
  } else if (!entry.isPlaying) {
    violations.push({ phase: options.phaseKey, reason: 'audio track present but isPlaying=false', track: options.track, entry });
  }
  return { passed: violations.length === 0, violations, totalSamples: 1 };
}

// ─── Input predicate ────────────────────────────────────────────────────

/**
 * Assert that `inv.input[kind]` contains `expected`.
 *
 * Semantics:
 *   - If `inv.input[kind]` is an array: contains via Array.includes (deep
 *     primitives only).
 *   - If string: substring match.
 *   - Otherwise: strict-equal.
 *
 * @param {Map<string, object>} inventoriesByPhase
 * @param {{ phaseKey: string, kind: string, expected: any }} options
 */
export function inputContains(inventoriesByPhase, options) {
  if (!options?.phaseKey || !options?.kind) {
    throw new Error('inputContains: options.phaseKey and options.kind required');
  }
  if (!Object.prototype.hasOwnProperty.call(options, 'expected')) {
    throw new Error('inputContains: options.expected required');
  }
  const inv = getInventory(inventoriesByPhase, options.phaseKey, 'inputContains');
  if (!inv.input) {
    throw new MissingInventoryFieldError('inputContains', -1, `inventoriesByPhase.${options.phaseKey}.input`);
  }
  const got = inv.input[options.kind];
  const violations = [];
  let matched = false;
  if (got === undefined) {
    violations.push({ phase: options.phaseKey, reason: 'input kind not found', kind: options.kind });
  } else if (Array.isArray(got)) {
    matched = got.includes(options.expected);
    if (!matched) {
      violations.push({ phase: options.phaseKey, reason: 'expected not present in input array', kind: options.kind, expected: options.expected, got });
    }
  } else if (typeof got === 'string' && typeof options.expected === 'string') {
    matched = got.indexOf(options.expected) >= 0;
    if (!matched) {
      violations.push({ phase: options.phaseKey, reason: 'expected substring not found in input string', kind: options.kind, expected: options.expected, got });
    }
  } else {
    matched = got === options.expected;
    if (!matched) {
      violations.push({ phase: options.phaseKey, reason: 'input value strict-equal mismatch', kind: options.kind, expected: options.expected, got });
    }
  }
  return { passed: violations.length === 0, violations, totalSamples: 1 };
}
