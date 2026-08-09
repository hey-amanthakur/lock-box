export class LockError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * Thrown by `acquire`/`withLock` when the lock could not be obtained within
 * `maxWaitMs`. Carries the key and how long the caller waited.
 */
export class LockWaitTimeoutError extends LockError {
  readonly key: string;
  readonly waitedMs: number;

  constructor(key: string, waitedMs: number) {
    super(`Timed out waiting to acquire lock "${key}" after ${waitedMs}ms.`);
    this.key = key;
    this.waitedMs = waitedMs;
  }
}

/**
 * Thrown when an operation targets a lease that has already ended (released,
 * expired, or aborted) — e.g. extending a released lock.
 */
export class LockEndedError extends LockError {
  readonly key: string;

  constructor(key: string) {
    super(`Lock "${key}" has already been released or lost.`);
    this.key = key;
  }
}

/**
 * Thrown when acquiring or waiting for a lock was cancelled via an
 * `AbortSignal`. Standard `name === 'AbortError'`.
 */
export class LockAbortError extends LockError {
  constructor(message = 'The operation was aborted.') {
    super(message);
    this.name = 'AbortError';
  }
}
