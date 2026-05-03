// Browser adapter — captures real KeyboardEvent / MouseEvent / TouchEvent
// / WheelEvent into the kit's InputRecorder.
//
// Captured event metadata aims for **isTrusted-equivalent semantics**:
// when the recorded events are replayed (with isTrusted: false), the
// downstream behavior should match what the host did during the recording.
// The bridge captures `code`, `key`, `repeat`, modifier states for keys;
// `clientX/Y`, `button`, `buttons` for mouse; `identifier`, `clientX/Y`
// for touches; `deltaX/Y/Z` for wheel.
//
// What's NOT captured (by design):
//   - `target` (host re-derives from current scene)
//   - `timeStamp` (kit uses frame index, not wall-clock)
//   - `isTrusted` (record is meaningful even when replayed)
//   - element-specific bubbling state (record-then-replay assumes
//     listeners on `window`)
//
// Hosts that need additional fields can wrap this adapter — the bridge
// returns event handlers, not a closed system.

/**
 * @param {ReturnType<typeof import('../../core/replay/input-recorder.js').createInputRecorder>} recorder
 * @returns {{ attach: (target: any) => () => void }}
 */
export function createKeyboardMouseBridge(recorder) {
  if (!recorder || typeof recorder.record !== 'function') {
    throw new Error('createKeyboardMouseBridge: recorder required');
  }

  const onKeydown = (e) => recorder.record({
    kind: 'keydown',
    payload: {
      code: e.code, key: e.key, repeat: e.repeat,
      ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
    },
  });
  const onKeyup = (e) => recorder.record({
    kind: 'keyup',
    payload: {
      code: e.code, key: e.key,
      ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
    },
  });
  const onMousedown = (e) => recorder.record({
    kind: 'mousedown',
    payload: { x: e.clientX, y: e.clientY, button: e.button, buttons: e.buttons },
  });
  const onMouseup = (e) => recorder.record({
    kind: 'mouseup',
    payload: { x: e.clientX, y: e.clientY, button: e.button, buttons: e.buttons },
  });
  const onMousemove = (e) => recorder.record({
    kind: 'mousemove',
    payload: { x: e.clientX, y: e.clientY, dx: e.movementX, dy: e.movementY, buttons: e.buttons },
  });
  const onWheel = (e) => recorder.record({
    kind: 'wheel',
    payload: { dx: e.deltaX, dy: e.deltaY, dz: e.deltaZ },
  });
  const onTouchstart = (e) => {
    for (const t of e.changedTouches) {
      recorder.record({ kind: 'touchstart', payload: { id: t.identifier, x: t.clientX, y: t.clientY } });
    }
  };
  const onTouchmove = (e) => {
    for (const t of e.changedTouches) {
      recorder.record({ kind: 'touchmove', payload: { id: t.identifier, x: t.clientX, y: t.clientY } });
    }
  };
  const onTouchend = (e) => {
    for (const t of e.changedTouches) {
      recorder.record({ kind: 'touchend', payload: { id: t.identifier } });
    }
  };

  return {
    attach(target) {
      target.addEventListener('keydown', onKeydown);
      target.addEventListener('keyup', onKeyup);
      target.addEventListener('mousedown', onMousedown);
      target.addEventListener('mouseup', onMouseup);
      target.addEventListener('mousemove', onMousemove);
      target.addEventListener('wheel', onWheel, { passive: true });
      target.addEventListener('touchstart', onTouchstart, { passive: true });
      target.addEventListener('touchmove', onTouchmove, { passive: true });
      target.addEventListener('touchend', onTouchend, { passive: true });
      return () => {
        target.removeEventListener('keydown', onKeydown);
        target.removeEventListener('keyup', onKeyup);
        target.removeEventListener('mousedown', onMousedown);
        target.removeEventListener('mouseup', onMouseup);
        target.removeEventListener('mousemove', onMousemove);
        target.removeEventListener('wheel', onWheel);
        target.removeEventListener('touchstart', onTouchstart);
        target.removeEventListener('touchmove', onTouchmove);
        target.removeEventListener('touchend', onTouchend);
      };
    },
  };
}
