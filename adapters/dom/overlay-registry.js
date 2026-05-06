// DOM overlay registry — pairs with adapters/three/scene-inventory.js.
//
// Hosts register their UI overlay elements (HUD, reticle, nav-computer
// panel, etc.) by id. The registry resolves each to an Element at register
// time (or lazily via resolver function), then snapshots their visibility
// per scene-inventory call.
//
// Pure-data outputs: the OverlayInventoryEntry array contains primitives
// only — no Element references, no live DOM handles. JSON.stringify works,
// structuredClone works.
//
// Visibility check sequence (research §4):
//   1. !el.isConnected           → false (detached from document)
//   2. computedStyle.display === 'none'      → false
//   3. computedStyle.visibility === 'hidden' → false
//   4. parseFloat(opacity) === 0             → false
//   5. otherwise                              → true
//
// This module has zero engine imports — DOM-only.

/**
 * @typedef {object} OverlayInventoryEntry
 * @property {string} id
 * @property {boolean} visible
 * @property {number} opacity
 * @property {string} display
 */

/**
 * @typedef {string | (() => Element | null)} SelectorOrResolver
 */

/**
 * @typedef {object} OverlayRegistry
 * @property {(id: string, sel: SelectorOrResolver) => void} register
 * @property {(id: string) => void} unregister
 * @property {() => OverlayInventoryEntry[]} snapshot
 * @property {() => string[]} ids
 */

/**
 * Create a new overlay registry.
 *
 * Optional injected DOM-host for testing. Defaults to global `document` +
 * `window.getComputedStyle`. Tests can pass their own host with mocked
 * behavior — this is what keeps the registry node-testable.
 *
 * @param {object} [host]
 * @param {(sel: string) => Element | null} [host.querySelector]
 *   Override `document.querySelector`. Defaults to globalThis.document.querySelector.
 * @param {(el: Element) => CSSStyleDeclaration} [host.getComputedStyle]
 *   Override `window.getComputedStyle`. Defaults to globalThis.getComputedStyle.
 * @returns {OverlayRegistry}
 */
export function createOverlayRegistry(host) {
  const _qs = host?.querySelector
    || ((sel) => globalThis.document?.querySelector(sel) ?? null);
  const _gcs = host?.getComputedStyle
    || ((el) => globalThis.getComputedStyle?.(el));

  /**
   * @typedef {object} Entry
   * @property {SelectorOrResolver} sel
   * @property {Element | null} cached
   */
  /** @type {Map<string, Entry>} */
  const entries = new Map();

  function resolve(id) {
    const e = entries.get(id);
    if (!e) return null;
    if (e.cached && e.cached.isConnected !== false) return e.cached;
    let el = null;
    if (typeof e.sel === 'function') {
      el = e.sel();
    } else if (typeof e.sel === 'string') {
      el = _qs(e.sel);
    }
    e.cached = el;
    return el;
  }

  function checkVisible(el) {
    if (!el) return { visible: false, opacity: 0, display: 'none' };
    if (el.isConnected === false) return { visible: false, opacity: 0, display: 'none' };
    const cs = _gcs(el);
    if (!cs) return { visible: true, opacity: 1, display: '' };
    const display = cs.display ?? '';
    if (display === 'none') return { visible: false, opacity: 0, display };
    const visibility = cs.visibility ?? '';
    if (visibility === 'hidden') return { visible: false, opacity: 0, display };
    const opacity = parseFloat(cs.opacity ?? '1');
    if (opacity === 0) return { visible: false, opacity, display };
    return { visible: true, opacity, display };
  }

  return {
    register(id, sel) {
      if (typeof id !== 'string' || !id) throw new Error('overlay-registry: id required (string)');
      if (typeof sel !== 'string' && typeof sel !== 'function') {
        throw new Error('overlay-registry: sel required (string or function)');
      }
      entries.set(id, { sel, cached: null });
    },
    unregister(id) {
      entries.delete(id);
    },
    snapshot() {
      const out = [];
      for (const [id, _entry] of entries) {
        const el = resolve(id);
        const v = checkVisible(el);
        out.push({ id, visible: v.visible, opacity: v.opacity, display: v.display });
      }
      return out;
    },
    ids() {
      return [...entries.keys()];
    },
  };
}
