import type { LockBackend } from './backend.js';

interface MemoryLease {
  token: string;
  expiresAt: number;
}

/**
 * In-process lock backend. Suitable for single-process deployments and tests;
 * swap in a real distributed backend (e.g. the Redis adapter) once locks must
 * coordinate across processes or machines.
 *
 * Expired leases are pruned lazily on access, so no timers are held for idle
 * keys.
 */
export class MemoryLockBackend implements LockBackend {
  private readonly leases = new Map<string, MemoryLease>();

  async acquire(key: string, token: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.leases.get(key);
    if (existing !== undefined && existing.expiresAt > now) {
      return false;
    }
    this.leases.set(key, { token, expiresAt: now + ttlMs });
    return true;
  }

  async extend(key: string, token: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.leases.get(key);
    if (existing === undefined || existing.token !== token || existing.expiresAt <= now) {
      return false;
    }
    existing.expiresAt = now + ttlMs;
    return true;
  }

  async release(key: string, token: string): Promise<boolean> {
    const existing = this.leases.get(key);
    if (existing === undefined || existing.token !== token) {
      return false;
    }
    this.leases.delete(key);
    return true;
  }

  async get(key: string): Promise<string | undefined> {
    const existing = this.leases.get(key);
    if (existing === undefined) {
      return undefined;
    }
    if (existing.expiresAt <= Date.now()) {
      this.leases.delete(key);
      return undefined;
    }
    return existing.token;
  }

  /** Number of currently-held (unexpired) leases. Test/observability helper. */
  size(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, lease] of this.leases) {
      if (lease.expiresAt <= now) {
        this.leases.delete(key);
      } else {
        count += 1;
      }
    }
    return count;
  }
}
