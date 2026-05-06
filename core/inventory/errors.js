// Named errors for inventory predicate validation. Pure.
//
// Same loud-failure-at-test-time semantics as core/predicates/errors.js.
// Inventory predicates that require a field throw MissingInventoryFieldError
// with a named message rather than silently returning passed:true on empty
// data. The shape mirrors MissingFieldError so consumers handle both
// uniformly.
//
// Pure-data invariant: this module has zero engine/DOM imports — kept
// importable from node tests, browser tests, future Godot adapters.

export class MissingInventoryFieldError extends Error {
  constructor(predicate, frameIdx, fieldPath) {
    super(`${predicate}: inventory at frame ${frameIdx} is missing required field "${fieldPath}"`);
    this.name = 'MissingInventoryFieldError';
    this.predicate = predicate;
    this.frameIdx = frameIdx;
    this.fieldPath = fieldPath;
  }
}

export class InventoryEntityNotFoundError extends Error {
  constructor(predicate, frameIdx, entityKind, entityKey) {
    super(`${predicate}: ${entityKind} "${entityKey}" not found in inventory at frame ${frameIdx}`);
    this.name = 'InventoryEntityNotFoundError';
    this.predicate = predicate;
    this.frameIdx = frameIdx;
    this.entityKind = entityKind;
    this.entityKey = entityKey;
  }
}
