import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DistributedLock,
  MemoryLockBackend,
  LockWaitTimeoutError,
  LockEndedError,
  LockAbortError,
} from '../src/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('DistributedLock', () => {
  it('tryAcquire returns null while the lock is held', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    const first = await lock.tryAcquire('a');
    assert.ok(first !== null);
    const second = await lock.tryAcquire('a');
    assert.equal(second, null);
    await first!.release();
  });

  it('acquire waits and succeeds once the holder releases', async () => {
    const lock = new DistributedLock(new MemoryLockBackend(), { wait: { intervalMs: 10 } });
    const first = await lock.tryAcquire('a', { ttlMs: 1000 });
    const promise = lock.acquire('a', { maxWaitMs: 5000 });
    await sleep(30);
    assert.equal(await lock.tryAcquire('a'), null);
    await first!.release();
    const second = await promise;
    assert.equal(second.key, 'a');
    assert.notEqual(second.token, first!.token);
    await second.release();
  });

  it('acquire throws LockWaitTimeoutError when the wait elapses', async () => {
    const lock = new DistributedLock(new MemoryLockBackend(), { wait: { intervalMs: 10 } });
    await lock.acquire('a', { ttlMs: 10_000 });
    await assert.rejects(lock.acquire('a', { maxWaitMs: 50 }), (err) => {
      assert.ok(err instanceof LockWaitTimeoutError);
      assert.equal(err.key, 'a');
      return true;
    });
  });

  it('withLock runs the fn and releases in finally', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    const seen: string[] = [];
    await lock.withLock('a', async (acquired) => {
      seen.push('inside');
      assert.equal(await acquired.isHeld(), true);
    });
    seen.push('after');
    assert.deepEqual(seen, ['inside', 'after']);
    const reacquired = await lock.tryAcquire('a', { ttlMs: 1000 });
    assert.ok(reacquired !== null);
    await reacquired!.release();
  });

  it('withLock releases the lock even when fn throws', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    await assert.rejects(
      lock.withLock('a', async () => {
        throw new Error('boom');
      }),
      /boom/,
    );
    const reacquired = await lock.tryAcquire('a', { ttlMs: 1000 });
    assert.ok(reacquired !== null);
    await reacquired!.release();
  });

  it('withLock passes through the return value', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    const value = await lock.withLock('a', async () => 42);
    assert.equal(value, 42);
  });

  it('auto-renew extends the lease in the background', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    const acquired = await lock.tryAcquire('a', { ttlMs: 200, renew: { intervalMs: 50 } });
    assert.ok(acquired !== null);
    const initial = acquired!.expiresAt;
    await sleep(130);
    assert.ok(acquired!.expiresAt > initial, 'lease should be extended');
    assert.equal(await acquired!.isHeld(), true);
    await acquired!.release();
  });

  it('a failed renewal detects a lost lease, fires onLost and ends as expired', async () => {
    const events: string[] = [];
    const backend = new MemoryLockBackend();
    const lock = new DistributedLock(backend, {
      hooks: {
        onLost: (info) => events.push(`lost:${info.reason}`),
      },
    });
    const acquired = await lock.tryAcquire('a', {
      ttlMs: 10_000,
      renew: { intervalMs: 10 },
    });
    assert.ok(acquired !== null);
    await backend.release('a', acquired.token);
    const end = await acquired!.ended;
    assert.equal(end.reason, 'expired');
    assert.equal(await acquired!.isHeld(), false);
    assert.deepEqual(events, ['lost:expired']);
  });

  it('extend refreshes the lease and throws LockEndedError after release', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    const acquired = await lock.tryAcquire('a', { ttlMs: 100 });
    assert.ok(acquired !== null);
    const expiry = await acquired!.extend(500);
    assert.ok(expiry.getTime() > Date.now() + 400);
    await acquired!.release();
    await assert.rejects(acquired!.extend(), LockEndedError);
  });

  it('extend fails with LockEndedError when the token lost the lease', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    const acquired = await lock.tryAcquire('a', { ttlMs: 100 });
    assert.ok(acquired !== null);
    // someone else force-releases the underlying lease
    await lock.release('a', acquired!.token);
    await assert.rejects(acquired!.extend(), LockEndedError);
  });

  it('release is idempotent and reports whether it released', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    const acquired = await lock.tryAcquire('a', { ttlMs: 1000 });
    assert.ok(acquired !== null);
    assert.equal(await acquired!.release(), true);
    assert.equal(await acquired!.release(), false);
    assert.equal(await acquired!.isHeld(), false);
  });

  it('abort during a wait rejects with LockAbortError', async () => {
    const lock = new DistributedLock(new MemoryLockBackend(), { wait: { intervalMs: 10 } });
    await lock.acquire('a', { ttlMs: 10_000 });
    const controller = new AbortController();
    const promise = lock.acquire('a', {
      maxWaitMs: 5000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(promise, LockAbortError);
  });

  it('abort while holding releases the lease and fires onLost', async () => {
    const events: string[] = [];
    const lock = new DistributedLock(new MemoryLockBackend(), {
      hooks: { onLost: (info) => events.push(`lost:${info.reason}`) },
    });
    const controller = new AbortController();
    const acquired = await lock.tryAcquire('a', { ttlMs: 10_000, signal: controller.signal });
    assert.ok(acquired !== null);
    controller.abort();
    await acquired!.ended;
    assert.equal(await acquired!.isHeld(), false);
    assert.deepEqual(events, ['lost:aborted']);
    assert.ok(await lock.tryAcquire('a', { ttlMs: 1000 }) !== null);
  });

  it('an already-aborted signal rejects immediately', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(lock.tryAcquire('a', { signal: controller.signal }), LockAbortError);
  });

  it('respects the default ttl configured on the lock', async () => {
    const backend = new MemoryLockBackend();
    const lock = new DistributedLock(backend, { defaultTtlMs: 40 });
    await lock.acquire('a');
    await sleep(60);
    assert.equal(await backend.get('a'), undefined);
  });

  it('fires lifecycle hooks', async () => {
    const events: string[] = [];
    const lock = new DistributedLock(new MemoryLockBackend(), {
      hooks: {
        onAcquire: () => events.push('acquire'),
        onRelease: () => events.push('release'),
      },
    });
    const acquired = await lock.tryAcquire('a', { ttlMs: 1000 });
    await acquired!.release();
    assert.deepEqual(events, ['acquire', 'release']);
  });

  it('a throwing hook does not break acquisition or release', async () => {
    const lock = new DistributedLock(new MemoryLockBackend(), {
      hooks: {
        onAcquire: () => {
          throw new Error('hook boom');
        },
        onRelease: () => {
          throw new Error('hook boom');
        },
      },
    });
    const acquired = await lock.tryAcquire('a', { ttlMs: 1000 });
    assert.ok(acquired !== null);
    await acquired!.release();
    assert.equal(await acquired!.isHeld(), false);
  });

  it('release convenience releases by key + token', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    const acquired = await lock.tryAcquire('a', { ttlMs: 1000 });
    assert.ok(acquired !== null);
    assert.equal(await lock.release('a', acquired!.token), true);
    assert.equal(await lock.release('a', acquired!.token), false);
  });

  it('an abort during acquisition never hands out a dead lock', async () => {
    const backend = new MemoryLockBackend();
    const lock = new DistributedLock(backend);
    const controller = new AbortController();
    const original = backend.acquire.bind(backend);
    backend.acquire = async (key: string, token: string, ttlMs: number): Promise<boolean> => {
      const ok = await original(key, token, ttlMs);
      if (ok) {
        controller.abort();
      }
      return ok;
    };
    await assert.rejects(lock.tryAcquire('k', { signal: controller.signal }), LockAbortError);
    assert.equal(await backend.get('k'), undefined);
  });

  it('ended resolves with expired when the lease lapses without renewal', async () => {
    const events: string[] = [];
    const lock = new DistributedLock(new MemoryLockBackend(), {
      hooks: { onLost: (info) => events.push(`lost:${info.reason}`) },
    });
    const acquired = await lock.tryAcquire('a', { ttlMs: 40 });
    assert.ok(acquired !== null);
    const end = await acquired!.ended;
    assert.equal(end.reason, 'expired');
    assert.equal(await acquired!.isHeld(), false);
    assert.deepEqual(events, ['lost:expired']);
  });

  it('abort does not leak an unhandled rejection when release fails', async () => {
    const failing = new MemoryLockBackend();
    failing.release = async (): Promise<boolean> => {
      throw new Error('release boom');
    };
    let unhandled: unknown = null;
    const onUnhandled = (err: unknown): void => {
      unhandled = err;
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const lock = new DistributedLock(failing);
      const controller = new AbortController();
      const acquired = await lock.tryAcquire('a', { ttlMs: 1000, signal: controller.signal });
      assert.ok(acquired !== null);
      controller.abort();
      const end = await acquired!.ended;
      assert.equal(end.reason, 'aborted');
      await sleep(30);
      assert.equal(unhandled, null);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  it('withLock surfaces the fn error even when release fails', async () => {
    const failing = new MemoryLockBackend();
    failing.release = async (): Promise<boolean> => {
      throw new Error('release boom');
    };
    const lock = new DistributedLock(failing);
    await assert.rejects(
      lock.withLock('a', async () => {
        throw new Error('fn boom');
      }),
      /fn boom/,
    );
  });

  it('withLock surfaces a release failure when fn succeeds', async () => {
    const failing = new MemoryLockBackend();
    failing.release = async (): Promise<boolean> => {
      throw new Error('release boom');
    };
    const lock = new DistributedLock(failing);
    await assert.rejects(lock.withLock('a', async () => 1), /release boom/);
  });

  it('auto-renew honours the ttl set by extend()', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    const acquired = await lock.tryAcquire('a', { ttlMs: 1000, renew: { intervalMs: 20 } });
    assert.ok(acquired !== null);
    await acquired!.extend(100);
    await sleep(50);
    const remaining = acquired!.expiresAt - Date.now();
    assert.ok(remaining < 300, `expected renewal to use the 100ms ttl, got ~${remaining}ms remaining`);
    await acquired!.release();
  });
});

describe('DistributedLock polling', () => {
  // Wrap a real EventTarget so we can count add/removeEventListener calls; it
  // doubles as a duck-typed AbortSignal.
  const makeSignal = (): { signal: EventTarget; count: () => number } => {
    const target = new EventTarget();
    (target as unknown as { aborted: boolean }).aborted = false;
    const originalAdd = target.addEventListener.bind(target);
    const originalRemove = target.removeEventListener.bind(target);
    let count = 0;
    target.addEventListener = ((type: any, listener: any, options?: any) => {
      if (type === 'abort') {
        count += 1;
      }
      return originalAdd(type, listener, options);
    }) as any;
    target.removeEventListener = ((type: any, listener: any, options?: any) => {
      if (type === 'abort') {
        count -= 1;
      }
      return originalRemove(type, listener, options);
    }) as any;
    return { signal: target, count: () => count };
  };

  it('does not leak abort listeners across poll iterations', async () => {
    const lock = new DistributedLock(new MemoryLockBackend(), { wait: { intervalMs: 10 } });
    await lock.acquire('a', { ttlMs: 10_000 });
    const { signal, count } = makeSignal();
    await assert.rejects(
      lock.acquire('a', {
        maxWaitMs: 60,
        signal: signal as unknown as AbortSignal,
      }),
      LockWaitTimeoutError,
    );
    assert.equal(count(), 0);
  });

  it('removes the abort listener when an aborted wait settles', async () => {
    const lock = new DistributedLock(new MemoryLockBackend(), { wait: { intervalMs: 10 } });
    await lock.acquire('a', { ttlMs: 10_000 });
    const { signal, count } = makeSignal();
    const promise = lock.acquire('a', {
      maxWaitMs: 5000,
      signal: signal as unknown as AbortSignal,
    });
    setTimeout(() => {
      (signal as unknown as { aborted: boolean }).aborted = true;
      signal.dispatchEvent(new Event('abort'));
    }, 10);
    await assert.rejects(promise, LockAbortError);
    assert.equal(count(), 0);
  });
});
