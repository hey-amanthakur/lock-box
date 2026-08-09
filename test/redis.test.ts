import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Redis from 'ioredis-mock';
import {
  createRedisLockBackend,
  createRedisLock,
} from '../src/redis/backend.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('createRedisLockBackend', () => {
  let redis: InstanceType<typeof Redis>;
  let backend: ReturnType<typeof createRedisLockBackend>;

  beforeEach(async () => {
    redis = new Redis();
    await redis.flushall();
    backend = createRedisLockBackend(redis);
  });

  it('acquire is exclusive and token-verified', async () => {
    assert.equal(await backend.acquire('a', 't1', 1000), true);
    assert.equal(await backend.acquire('a', 't2', 1000), false);
    assert.equal(await backend.get('a'), 't1');
    assert.equal(await backend.release('a', 't2'), false);
    assert.equal(await backend.release('a', 't1'), true);
    assert.equal(await backend.get('a'), undefined);
  });

  it('lease expires and the lock becomes available', async () => {
    await backend.acquire('a', 't1', 30);
    await sleep(60);
    assert.equal(await backend.get('a'), undefined);
    assert.equal(await backend.acquire('a', 't2', 1000), true);
  });

  it('extend refreshes only for the owner', async () => {
    await backend.acquire('a', 't1', 1000);
    assert.equal(await backend.extend('a', 'other', 5000), false);
    assert.equal(await backend.extend('a', 't1', 5000), true);
    const ttl = await redis.pttl('a');
    assert.ok(ttl > 4000);
  });
});

describe('createRedisLock', () => {
  it('provides a working DistributedLock over Redis', async () => {
    const redis = new Redis();
    await redis.flushall();
    const lock = createRedisLock(redis);

    const first = await lock.tryAcquire('job', { ttlMs: 1000 });
    assert.ok(first !== null);
    assert.equal(await lock.tryAcquire('job', { ttlMs: 1000 }), null);
    assert.equal(await first!.isHeld(), true);
    assert.equal(await first!.release(), true);
    assert.equal(await first!.release(), false);

    const value = await lock.withLock('job', async () => 'done');
    assert.equal(value, 'done');
    const reacquired = await lock.tryAcquire('job', { ttlMs: 1000 });
    assert.ok(reacquired !== null);
    await reacquired!.release();
  });

  it('withLock serializes concurrent access', async () => {
    const redis = new Redis();
    await redis.flushall();
    const lock = createRedisLock(redis);
    let active = 0;
    let maxActive = 0;
    const task = async (): Promise<void> => {
      await lock.withLock('critical', async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await sleep(20);
        active -= 1;
      });
    };
    await Promise.all([task(), task(), task(), task(), task()]);
    assert.equal(maxActive, 1);
  });
});
