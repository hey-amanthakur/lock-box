import { randomUUID } from 'node:crypto';
import type { LockBackend } from './backend.js';
import { LockAbortError, LockEndedError, LockWaitTimeoutError } from './errors.js';

export type LockEndReason = 'released' | 'expired' | 'aborted';

export interface LockEnd {
  reason: LockEndReason;
  at: number;
}

export interface LockInfo {
  key: string;
  token: string;
}

export interface LockHooks {
  onAcquire?: (info: LockInfo & { ttlMs: number }) => void;
  onRelease?: (info: LockInfo) => void;
  onRenew?: (info: LockInfo & { expiresAt: number }) => void;
  /** Fired when the lease is lost (expired or cancelled) while still held. */
  onLost?: (info: LockInfo & { reason: 'expired' | 'aborted' }) => void;
}

export interface LockOptions {
  /** Lease duration in ms. Default: the `DistributedLock` default (30s). */
  ttlMs?: number;
  /** Keep extending the lease in the background until release. Default false. */
  renew?: boolean | { intervalMs?: number };
  /** Cancel acquisition or abort the held lease. Optional. */
  signal?: AbortSignal;
  /** Arbitrary metadata attached to the lock. Optional. */
  metadata?: unknown;
}

export interface WaitOptions extends LockOptions {
  /** Stop waiting for the lock after this many ms. Default 30_000. `Infinity` waits forever. */
  maxWaitMs?: number;
  /** Poll interval between acquisition attempts. Default 200. */
  intervalMs?: number;
}

export interface DistributedLockOptions {
  /** Default lease duration in ms. Default 30_000. */
  defaultTtlMs?: number;
  /** Wait defaults applied when `acquire`/`withLock` are called without them. */
  wait?: { maxWaitMs?: number; intervalMs?: number };
  hooks?: LockHooks;
}

export interface AcquiredLock {
  readonly key: string;
  readonly token: string;
  /** Current lease expiry as an epoch ms timestamp. */
  readonly expiresAt: number;
  readonly autoRenew: boolean;
  /** Resolves when the lease ends: clean release, expiry, or abort. */
  readonly ended: Promise<LockEnd>;
  /** True while this instance believes it holds a live lease. */
  isHeld(): Promise<boolean>;
  /**
   * Refresh the lease. Throws `LockEndedError` if the lease is no longer held.
   * @returns the new expiry time.
   */
  extend(ttlMs?: number): Promise<Date>;
  /**
   * Release the lease. Idempotent.
   * @returns true if an active lease was released, false if already ended.
   */
  release(): Promise<boolean>;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_WAIT_MS = 30_000;
const DEFAULT_INTERVAL_MS = 200;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new LockAbortError();
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    if (signal === undefined) {
      return;
    }
    if (signal.aborted) {
      clearTimeout(timer);
      reject(new LockAbortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new LockAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    timer.unref?.();
  });
}

export class DistributedLock {
  private readonly backend: LockBackend;
  private readonly defaultTtlMs: number;
  private readonly waitDefaults: { maxWaitMs: number; intervalMs: number };
  private readonly hooks?: LockHooks;

  constructor(backend: LockBackend, options: DistributedLockOptions = {}) {
    this.backend = backend;
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.waitDefaults = {
      maxWaitMs: options.wait?.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
      intervalMs: options.wait?.intervalMs ?? DEFAULT_INTERVAL_MS,
    };
    this.hooks = options.hooks;
  }

  /** Attempt to acquire once; resolves `null` immediately when the lock is held. */
  async tryAcquire(key: string, options: LockOptions = {}): Promise<AcquiredLock | null> {
    throwIfAborted(options.signal);
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;
    const token = randomUUID();
    const acquired = await this.backend.acquire(key, token, ttlMs);
    if (!acquired) {
      return null;
    }
    return this.createLock(key, token, ttlMs, options);
  }

  /** Wait (poll) until the lock is acquired or `maxWaitMs` elapses. */
  async acquire(key: string, options: WaitOptions = {}): Promise<AcquiredLock> {
    const maxWaitMs = options.maxWaitMs ?? this.waitDefaults.maxWaitMs;
    const intervalMs = options.intervalMs ?? this.waitDefaults.intervalMs;
    const deadline = Date.now() + maxWaitMs;

    for (;;) {
      const lock = await this.tryAcquire(key, options);
      if (lock !== null) {
        return lock;
      }
      throwIfAborted(options.signal);
      if (Date.now() >= deadline) {
        throw new LockWaitTimeoutError(key, maxWaitMs);
      }
      await sleep(intervalMs, options.signal);
    }
  }

  /** Acquire the lock, run `fn`, and release it in `finally`. */
  async withLock<T>(
    key: string,
    fn: (lock: AcquiredLock) => T | Promise<T>,
    options: WaitOptions = {},
  ): Promise<T> {
    const lock = await this.acquire(key, options);
    try {
      return await fn(lock);
    } finally {
      await lock.release();
    }
  }

  /** Convenience: release a specific lease by key + token. */
  async release(key: string, token: string): Promise<boolean> {
    return this.backend.release(key, token);
  }

  private createLock(
    key: string,
    token: string,
    ttlMs: number,
    options: LockOptions,
  ): AcquiredLock {
    let endReason: LockEnd['reason'] | null = null;
    let resolveEnd: (end: LockEnd) => void = () => {};
    const ended = new Promise<LockEnd>((resolve) => {
      resolveEnd = resolve;
    });

    const hooks = this.hooks;
    const backend = this.backend;
    const emit = (fn: (() => void) | undefined): void => {
      if (fn === undefined) {
        return;
      }
      try {
        fn();
      } catch {
        // Hooks are isolated by design: a throwing hook never breaks the lock.
      }
    };

    let renewalTimer: ReturnType<typeof setInterval> | null = null;
    let expiresAt = Date.now() + ttlMs;

    const clearRenewal = (): void => {
      if (renewalTimer !== null) {
        clearInterval(renewalTimer);
        renewalTimer = null;
      }
    };

    const finish = (reason: LockEnd['reason']): void => {
      if (endReason !== null) {
        return;
      }
      endReason = reason;
      clearRenewal();
      removeAbort();
      resolveEnd({ reason, at: Date.now() });
    };

    const onAbort = (): void => {
      const held = endReason === null;
      if (held) {
        void backend.release(key, token);
      }
      finish('aborted');
      emit(() => hooks?.onLost?.({ key, token, reason: 'aborted' }));
    };

    const removeAbort = (): void => {
      options.signal?.removeEventListener('abort', onAbort);
    };

    if (options.signal !== undefined) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    if (options.renew) {
      const renewInterval =
        (typeof options.renew === 'object' && options.renew.intervalMs) ||
        Math.max(1, Math.floor(ttlMs / 3));
      renewalTimer = setInterval(() => {
        this.backend
          .extend(key, token, ttlMs)
          .then((ok) => {
            if (!ok) {
              finish('expired');
              emit(() => hooks?.onLost?.({ key, token, reason: 'expired' }));
              return;
            }
            expiresAt = Date.now() + ttlMs;
            emit(() => hooks?.onRenew?.({ key, token, expiresAt }));
          })
          .catch(() => {
            finish('expired');
            emit(() => hooks?.onLost?.({ key, token, reason: 'expired' }));
          });
      }, renewInterval);
      renewalTimer.unref?.();
    }

    const lock: AcquiredLock = {
      key,
      token,
      get expiresAt() {
        return expiresAt;
      },
      autoRenew: options.renew !== undefined && options.renew !== false,
      ended,
      async isHeld(): Promise<boolean> {
        if (endReason !== null) {
          return false;
        }
        const current = await backend.get(key);
        return current === token;
      },
      async extend(newTtlMs?: number): Promise<Date> {
        if (endReason !== null) {
          throw new LockEndedError(key);
        }
        const ttl = newTtlMs ?? ttlMs;
        const ok = await backend.extend(key, token, ttl);
        if (!ok) {
          finish('expired');
          emit(() => hooks?.onLost?.({ key, token, reason: 'expired' }));
          throw new LockEndedError(key);
        }
        expiresAt = Date.now() + ttl;
        emit(() => hooks?.onRenew?.({ key, token, expiresAt }));
        return new Date(expiresAt);
      },
      async release(): Promise<boolean> {
        if (endReason !== null) {
          return false;
        }
        const released = await backend.release(key, token);
        finish(released ? 'released' : 'expired');
        emit(() => {
          if (released) {
            hooks?.onRelease?.({ key, token });
          } else {
            hooks?.onLost?.({ key, token, reason: 'expired' });
          }
        });
        return released;
      },
    };

    emit(() => hooks?.onAcquire?.({ key, token, ttlMs }));

    return lock;
  }
}
