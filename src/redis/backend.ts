import type { LockBackend } from '../lock/backend.js';
import { DistributedLock } from '../lock/lock.js';
import type { DistributedLockOptions } from '../lock/lock.js';

/**
 * Minimal subset of the `ioredis` client used by the backend. Any Redis client
 * exposing `eval` + `get` can be passed (ioredis, node-redis's `eval` shim,
 * ioredis-mock for tests, ...).
 */
export interface RedisLike {
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

const ACQUIRE = `
if redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX') then
  return 1
end
return 0
`;

const EXTEND = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * Distributed lock backend backed by Redis. All operations are atomic Lua
 * scripts, so the token ownership check and the write happen in one step —
 * this is what makes the lock safe across processes.
 *
 * Leases are keyed by PX/EXPIRE: if a holder crashes, the lease expires on
 * its own and the lock becomes available again.
 */
export function createRedisLockBackend(redis: RedisLike): LockBackend {
  return {
    acquire(key, token, ttlMs) {
      return redis.eval(ACQUIRE, 1, key, token, ttlMs).then((r) => r === 1);
    },
    extend(key, token, ttlMs) {
      return redis.eval(EXTEND, 1, key, token, ttlMs).then((r) => r === 1);
    },
    release(key, token) {
      return redis.eval(RELEASE, 1, key, token).then((r) => r === 1);
    },
    get(key) {
      return redis.get(key).then((v) => v ?? undefined);
    },
  };
}

/** Convenience: a `DistributedLock` bound to a Redis backend. */
export function createRedisLock(
  redis: RedisLike,
  options: DistributedLockOptions = {},
): DistributedLock {
  return new DistributedLock(createRedisLockBackend(redis), options);
}

export { DistributedLock } from '../lock/lock.js';
export type { DistributedLockOptions, LockOptions, WaitOptions } from '../lock/lock.js';
export type { LockBackend } from '../lock/backend.js';
