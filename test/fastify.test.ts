import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DistributedLock, MemoryLockBackend } from '../src/index.js';
import { fastifyLockPlugin } from '../src/adapters/fastify.js';
import type { AcquiredLock } from '../src/lock/lock.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FakeReq extends Record<string, unknown> {
  url?: string;
  lock?: AcquiredLock;
}

function createReply(): { raw: EventEmitter } {
  return { raw: new EventEmitter() };
}

function createInstance() {
  const hooks: Record<string, unknown> = {};
  return {
    hooks,
    addHook(event: string, hook: unknown) {
      hooks[event] = hook;
    },
  };
}

describe('fastifyLockPlugin', () => {
  it('acquires the lock, exposes it on req, and releases on reply finish', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    const instance = createInstance();
    fastifyLockPlugin({ lock, key: (req) => (req as FakeReq).url ?? '' })(
      instance as never,
    );

    const req: FakeReq = { url: '/payments' };
    const reply = createReply();
    let doneCalled = false;

    const handler = instance.hooks['onRequest'] as (
      r: unknown,
      rp: unknown,
      done: () => void,
    ) => void;

    await new Promise<void>((resolve) => {
      handler(req, reply, () => {
        doneCalled = true;
        resolve();
      });
    });

    assert.equal(doneCalled, true);
    assert.ok(req.lock !== undefined);
    assert.equal(await req.lock!.isHeld(), true);

    reply.raw.emit('finish');
    await sleep(10);
    assert.equal(await req.lock!.isHeld(), false);
  });

  it('calls done(err) when the lock cannot be acquired in time', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    await lock.acquire('a', { ttlMs: 10_000 });
    const instance = createInstance();
    fastifyLockPlugin({
      lock,
      key: () => 'a',
      wait: { maxWaitMs: 20, intervalMs: 5 },
    })(instance as never);

    const reply = createReply();
    let error: unknown;
    const handler = instance.hooks['onRequest'] as (
      r: unknown,
      rp: unknown,
      done: (err?: unknown) => void,
    ) => void;

    await new Promise<void>((resolve) => {
      handler({}, reply, (err?: unknown) => {
        error = err;
        resolve();
      });
    });
    assert.ok(error instanceof Error);
  });
});
