import type { AcquiredLock, DistributedLock } from '../lock/lock.js';

export interface LockAdapterOptions<Req = unknown> {
  lock: DistributedLock;
  /** Derive the lock key from the request. */
  key: (req: Req) => string;
  /** Lease duration in ms. Default: the `DistributedLock` default. */
  ttlMs?: number;
  /** Auto-renew the lease while the request is in flight. Default false. */
  renew?: boolean | { intervalMs?: number };
  /** Blocking-acquire wait settings. */
  wait?: { maxWaitMs?: number; intervalMs?: number };
  /** Called with the acquired lock so adapters can expose it to handlers. */
  onAcquired?: (lock: AcquiredLock, req: Req) => void;
  /** Called when acquisition fails (e.g. wait timeout). Default: rethrow. */
  onError?: (error: unknown, req: Req) => void;
}

/**
 * Shared adapter flow: acquire the lock keyed by the request, register the
 * lease release for when the response finishes, then continue.
 */
export async function runLockMiddleware<Req>(
  req: Req,
  options: LockAdapterOptions<Req>,
  onFinish: (fn: () => void) => void,
): Promise<AcquiredLock> {
  const key = options.key(req);
  const lock = await options.lock.acquire(key, {
    ttlMs: options.ttlMs,
    renew: options.renew,
    maxWaitMs: options.wait?.maxWaitMs,
    intervalMs: options.wait?.intervalMs,
  });
  const release = (): void => {
    // Runs after the response has finished, so a release failure cannot be
    // surfaced to the client; the TTL expires the lease anyway.
    lock.release().catch(() => {});
  };
  onFinish(release);
  options.onAcquired?.(lock, req);
  return lock;
}
