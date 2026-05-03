// Named errors for predicate validation. Pure.

export class MissingFieldError extends Error {
  constructor(predicate, frameIdx, fieldPath) {
    super(`${predicate}: sample at frame ${frameIdx} is missing required field "${fieldPath}"`);
    this.name = 'MissingFieldError';
    this.predicate = predicate;
    this.frameIdx = frameIdx;
    this.fieldPath = fieldPath;
  }
}

export class InvalidOptionsError extends Error {
  constructor(predicate, message) {
    super(`${predicate}: ${message}`);
    this.name = 'InvalidOptionsError';
    this.predicate = predicate;
  }
}
