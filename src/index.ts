export { DistributedLock } from './lock/lock.js';
export type {
  AcquiredLock,
  DistributedLockOptions,
  LockEnd,
  LockEndReason,
  LockHooks,
  LockInfo,
  LockOptions,
  WaitOptions,
} from './lock/lock.js';
export { MemoryLockBackend } from './lock/memory-backend.js';
export type { LockBackend } from './lock/backend.js';
export {
  LockAbortError,
  LockEndedError,
  LockError,
  LockWaitTimeoutError,
} from './lock/errors.js';

export const VERSION = '1.0.0';
