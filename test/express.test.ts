import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  DistributedLock,
  MemoryLockBackend,
  LockWaitTimeoutError,
} from '../src/index.js';
import { expressLock } from '../src/adapters/express.js';
import type { AcquiredLock } from '../src/lock/lock.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FakeRes extends EventEmitter {
  locals: Record<string, unknown>;
}

interface FakeReq {
  id: string;
}

function createRes(): FakeRes {
  const res = new EventEmitter() as FakeRes;
  res.locals = {};
  return res;
}

const asLock = (value: unknown): AcquiredLock => value as AcquiredLock;

describe('expressLock', () => {
  it('acquires the lock, exposes it, and releases on finish', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    const res = createRes();
    let nextCalled = false;

    const middleware = expressLock({
      lock,
      key: (req) => (req as unknown as FakeReq).id,
    });
    await new Promise<void>((resolve) => {
      middleware(
        { id: 'a' } as never,
        res as never,
        () => {
          nextCalled = true;
          resolve();
        },
      );
    });

    assert.equal(nextCalled, true);
    const acquired = asLock(res.locals.lock);
    assert.ok(acquired !== undefined);
    assert.equal(await acquired.isHeld(), true);

    res.emit('finish');
    await sleep(10);
    assert.equal(await acquired.isHeld(), false);
    const reacquired = await lock.tryAcquire('a', { ttlMs: 1000 });
    assert.ok(reacquired !== null);
    await reacquired!.release();
  });

  it('calls next(err) when the lock cannot be acquired in time', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    await lock.acquire('a', { ttlMs: 10_000 });
    const res = createRes();
    const middleware = expressLock({
      lock,
      key: () => 'a',
      wait: { maxWaitMs: 20, intervalMs: 5 },
    });

    let error: unknown;
    await new Promise<void>((resolve) => {
      middleware(
        {} as never,
        res as never,
        (err?: unknown) => {
          error = err;
          resolve();
        },
      );
    });
    assert.ok(error instanceof LockWaitTimeoutError);
  });

  it('invokes onError as a notification hook', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    await lock.acquire('a', { ttlMs: 10_000 });
    const res = createRes();
    const notified: unknown[] = [];
    const middleware = expressLock({
      lock,
      key: () => 'a',
      wait: { maxWaitMs: 20, intervalMs: 5 },
      onError: (err) => notified.push(err),
    });

    let error: unknown;
    await new Promise<void>((resolve) => {
      middleware(
        {} as never,
        res as never,
        (err?: unknown) => {
          error = err;
          resolve();
        },
      );
    });
    assert.ok(error instanceof LockWaitTimeoutError);
    assert.equal(notified.length, 1);
    assert.ok(notified[0] instanceof LockWaitTimeoutError);
  });
});
