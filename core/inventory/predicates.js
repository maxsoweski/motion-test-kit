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

function findMesh(meshes, name) {
  if (!Array.isArray(meshes)) return { entry: null, hasUnnamed: false };
  let entry = null;
  let hasUnnamed = false;
  for (const m of meshes) {
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

// ─── Mesh predicates ─────────────────────────────────────────────────────

/**
 * Assert a named mesh is visible (visible AND inFrustum) at the given phase.
 *
 * @param {Map<string, object>} inventoriesByPhase
 * @param {{ phaseKey: string, meshName: string }} options
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
  const { entry, hasUnnamed } = findMesh(inv.meshes, options.meshName);
  const violations = [];
  if (!entry) {
    violations.push({
      phase: options.phaseKey,
      reason: hasUnnamed ? 'mesh not found at phase (note: unnamed meshes present in scene — likely host-naming-policy issue)' : 'mesh not found at phase',
      meshName: options.meshName,
    });
  } else if (!entry.visible || !entry.inFrustum) {
    violations.push({
      phase: options.phaseKey,
      reason: !entry.visible ? 'mesh present but visible=false' : 'mesh visible but not inFrustum',
      meshName: options.meshName,
      entry,
    });
  }
  return { passed: violations.length === 0, violations, totalSamples: 1 };
}

/**
 * Assert a named mesh is hidden (visible=false OR inFrustum=false OR absent).
 *
 * @param {Map<string, object>} inventoriesByPhase
 * @param {{ phaseKey: string, meshName: string }} options
 */
export function meshHiddenAt(inventoriesByPhase, options) {
  if (!options?.phaseKey || !options?.meshName) {
    throw new Error('meshHiddenAt: options.phaseKey and options.meshName required');
  }
  const inv = getInventory(inventoriesByPhase, options.phaseKey, 'meshHiddenAt');
  const { entry } = findMesh(inv.meshes ?? [], options.meshName);
  const violations = [];
  if (entry && entry.visible && entry.inFrustum) {
    violations.push({
      phase: options.phaseKey,
      reason: 'mesh visible AND inFrustum — expected hidden',
      meshName: options.meshName,
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
