import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DistributedLock, MemoryLockBackend } from '../src/index.js';
import { koaLock } from '../src/adapters/koa.js';
import type { AcquiredLock } from '../src/lock/lock.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FakeCtx {
  state: Record<string, unknown>;
  res: EventEmitter;
}

const asLock = (value: unknown): AcquiredLock => value as AcquiredLock;

function createCtx(): FakeCtx {
  return { state: {}, res: new EventEmitter() };
}

describe('koaLock', () => {
  it('acquires the lock, exposes it on ctx.state, and releases on finish', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    const ctx = createCtx();
    ctx.state['resourceId'] = 'a';
    let downstreamRan = false;

    const middleware = koaLock({
      lock,
      key: (c) => (c as unknown as FakeCtx).state['resourceId'] as string,
    });
    await middleware(ctx as never, async () => {
      downstreamRan = true;
      assert.equal(await asLock(ctx.state.lock).isHeld(), true);
    });

    assert.equal(downstreamRan, true);
    assert.equal(await asLock(ctx.state.lock).isHeld(), true);
    ctx.res.emit('finish');
    await sleep(10);
    assert.equal(await asLock(ctx.state.lock).isHeld(), false);
  });

  it('throws when the lock cannot be acquired in time', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    const held = await lock.acquire('a', { ttlMs: 10_000 });
    const ctx = createCtx();
    const middleware = koaLock({
      lock,
      key: () => 'a',
      wait: { maxWaitMs: 20, intervalMs: 5 },
    });    await assert.rejects(middleware(ctx as never, async () => {}));
    await held.release();
  });
});
