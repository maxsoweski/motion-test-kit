// Phase 2 self-tests for overlay-registry: visibility check sequence,
// register/unregister, snapshot shape. Uses synthetic host (querySelector
// + getComputedStyle injected) so the test runs in node without DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOverlayRegistry } from '../adapters/dom/overlay-registry.js';

// Synthetic DOM host — backs querySelector with a Map, returns synthetic
// Element-shaped objects. getComputedStyle returns an injected style object.

function makeHost(elements) {
  return {
    querySelector(sel) {
      return elements.get(sel) ?? null;
    },
    getComputedStyle(el) {
      return el?._computedStyle ?? { display: '', visibility: '', opacity: '1' };
    },
  };
}

function makeElement({ display = 'block', visibility = 'visible', opacity = '1', connected = true } = {}) {
  return {
    isConnected: connected,
    _computedStyle: { display, visibility, opacity },
  };
}

test('overlay-registry: register + snapshot returns visible entry for visible element', () => {
  const el = makeElement();
  const host = makeHost(new Map([['#hud', el]]));
  const reg = createOverlayRegistry(host);
  reg.register('hud', '#hud');
  const snap = reg.snapshot();
  assert.equal(snap.length, 1);
  assert.equal(snap[0].id, 'hud');
  assert.equal(snap[0].visible, true);
});

test('overlay-registry: display:none → visible:false', () => {
  const el = makeElement({ display: 'none' });
  const reg = createOverlayRegistry(makeHost(new Map([['#x', el]])));
  reg.register('x', '#x');
  assert.equal(reg.snapshot()[0].visible, false);
});

test('overlay-registry: visibility:hidden → visible:false', () => {
  const el = makeElement({ visibility: 'hidden' });
  const reg = createOverlayRegistry(makeHost(new Map([['#x', el]])));
  reg.register('x', '#x');
  assert.equal(reg.snapshot()[0].visible, false);
});

test('overlay-registry: opacity:0 → visible:false', () => {
  const el = makeElement({ opacity: '0' });
  const reg = createOverlayRegistry(makeHost(new Map([['#x', el]])));
  reg.register('x', '#x');
  assert.equal(reg.snapshot()[0].visible, false);
});

test('overlay-registry: detached element (isConnected=false) → visible:false', () => {
  const el = makeElement({ connected: false });
  const reg = createOverlayRegistry(makeHost(new Map([['#x', el]])));
  reg.register('x', '#x');
  assert.equal(reg.snapshot()[0].visible, false);
});

test('overlay-registry: missing element (querySelector returns null) → visible:false', () => {
  const reg = createOverlayRegistry(makeHost(new Map()));
  reg.register('missing', '#nope');
  assert.equal(reg.snapshot()[0].visible, false);
});

test('overlay-registry: lazy resolver re-runs each snapshot when cached element absent', () => {
  let callCount = 0;
  let availableElement = null;
  const reg = createOverlayRegistry({
    querySelector: () => null,
    getComputedStyle: (el) => el?._computedStyle ?? { display: '', visibility: '', opacity: '1' },
  });
  reg.register('lazy', () => {
    callCount++;
    return availableElement;
  });
  // First snapshot — element not yet mounted
  let snap = reg.snapshot();
  assert.equal(callCount, 1);
  assert.equal(snap[0].visible, false);
  // Mount element
  availableElement = makeElement();
  // Second snapshot — re-resolves
  snap = reg.snapshot();
  assert.equal(callCount, 2);
  assert.equal(snap[0].visible, true);
});

test('overlay-registry: register requires id string + selector/resolver', () => {
  const reg = createOverlayRegistry(makeHost(new Map()));
  assert.throws(() => reg.register('', '#x'), /id required/);
  assert.throws(() => reg.register('x'), /sel required/);
  assert.throws(() => reg.register('x', 42), /sel required/);
});

test('overlay-registry: unregister removes entry', () => {
  const reg = createOverlayRegistry(makeHost(new Map([['#x', makeElement()]])));
  reg.register('x', '#x');
  assert.equal(reg.snapshot().length, 1);
  reg.unregister('x');
  assert.equal(reg.snapshot().length, 0);
});

test('overlay-registry: ids() returns registered keys', () => {
  const reg = createOverlayRegistry(makeHost(new Map()));
  reg.register('a', '#a');
  reg.register('b', '#b');
  assert.deepEqual(reg.ids().sort(), ['a', 'b']);
});

test('overlay-registry: snapshot() pure-data — no Element refs in output', () => {
  const el = makeElement();
  const reg = createOverlayRegistry(makeHost(new Map([['#hud', el]])));
  reg.register('hud', '#hud');
  const snap = reg.snapshot();
  // JSON-roundtrip should preserve everything
  const round = JSON.parse(JSON.stringify(snap));
  assert.deepEqual(round, snap);
});

test('overlay-registry: three overlays — visible / hidden / detached — distinguished correctly', () => {
  const visible = makeElement();
  const hidden = makeElement({ display: 'none' });
  const detached = makeElement({ connected: false });
  const reg = createOverlayRegistry(makeHost(new Map([
    ['#visible', visible],
    ['#hidden', hidden],
    ['#detached', detached],
  ])));
  reg.register('visible', '#visible');
  reg.register('hidden', '#hidden');
  reg.register('detached', '#detached');
  const snap = reg.snapshot();
  assert.equal(snap.find((e) => e.id === 'visible').visible, true);
  assert.equal(snap.find((e) => e.id === 'hidden').visible, false);
  assert.equal(snap.find((e) => e.id === 'detached').visible, false);
});
