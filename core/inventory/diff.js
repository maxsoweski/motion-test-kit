// Inventory diff API — pure structural-delta function.
//
// Used by Tester for "what changed between phase A and phase B" assertions.
// The canonical warp-style verification ("what disappeared between HYPER
// and EXIT?") is a load-bearing v1 capability per research §10.
//
// Pure-data: zero engine/DOM imports. Inputs are SceneInventory records
// (per core/inventory/inventory-shape.md), outputs are arrays of named
// entities (mesh names, overlay ids, pass names) plus numerical aggregate
// deltas.

/**
 * @typedef {object} InventoryDiff
 * @property {string[]} appearedMeshes
 * @property {string[]} disappearedMeshes
 * @property {string[]} appearedOverlays
 * @property {string[]} disappearedOverlays
 * @property {string[]} enabledPasses
 * @property {string[]} disabledPasses
 * @property {number} drawCallDelta
 * @property {number} triangleDelta
 */

function meshNames(inv) {
  if (!inv || !Array.isArray(inv.meshes)) return new Set();
  // Visible+inFrustum is the "renderable now" set; that's what diffing
  // against. Hidden meshes don't count as "present" structurally.
  const out = new Set();
  for (const m of inv.meshes) {
    if (m.visible && m.inFrustum && m.name) out.add(m.name);
  }
  return out;
}

function overlayIds(inv) {
  if (!inv || !Array.isArray(inv.domOverlays)) return new Set();
  const out = new Set();
  for (const o of inv.domOverlays) {
    if (o.visible && o.id) out.add(o.id);
  }
  return out;
}

function enabledPassNames(inv) {
  if (!inv || !Array.isArray(inv.composerPasses)) return new Set();
  const out = new Set();
  for (const p of inv.composerPasses) {
    if (p.enabled && p.name) out.add(p.name);
  }
  return out;
}

function setMinus(a, b) {
  const out = [];
  for (const v of a) if (!b.has(v)) out.push(v);
  return out.sort();
}

/**
 * Diff two SceneInventory snapshots. Computes which meshes / overlays /
 * passes appeared or disappeared between A and B, plus numerical deltas
 * for renderer.info aggregates.
 *
 * @param {object} invA
 * @param {object} invB
 * @returns {InventoryDiff}
 */
export function diffInventories(invA, invB) {
  const meshA = meshNames(invA);
  const meshB = meshNames(invB);
  const ovA = overlayIds(invA);
  const ovB = overlayIds(invB);
  const passA = enabledPassNames(invA);
  const passB = enabledPassNames(invB);

  const drawA = invA?.rendererInfo?.drawCalls ?? 0;
  const drawB = invB?.rendererInfo?.drawCalls ?? 0;
  const triA = invA?.rendererInfo?.triangles ?? 0;
  const triB = invB?.rendererInfo?.triangles ?? 0;

  return {
    appearedMeshes: setMinus(meshB, meshA),
    disappearedMeshes: setMinus(meshA, meshB),
    appearedOverlays: setMinus(ovB, ovA),
    disappearedOverlays: setMinus(ovA, ovB),
    enabledPasses: setMinus(passB, passA),
    disabledPasses: setMinus(passA, passB),
    drawCallDelta: drawB - drawA,
    triangleDelta: triB - triA,
  };
}
