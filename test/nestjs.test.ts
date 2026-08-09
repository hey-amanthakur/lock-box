import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DistributedLock, MemoryLockBackend } from '../src/index.js';
import { Lock, createLockGuard, runLockGuard } from '../src/adapters/nestjs.js';
import type { ExecutionContextLike } from '../src/adapters/nestjs.js';
import type { AcquiredLock } from '../src/lock/lock.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Req {
  resourceId?: string;
  lockBoxLock?: AcquiredLock;
}

function makeContext(
  req: Req,
  handler: unknown,
  cls: unknown,
  res: EventEmitter,
): ExecutionContextLike {
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContextLike;
}

describe('nest lock guard', () => {
  it('acquires the lock declared by @Lock and releases on response finish', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());

    class PaymentsController {
      @Lock('payments:account')
      pay(): string {
        return 'ok';
      }
    }

    const req: Req = {};
    const res = new EventEmitter();
    const context = makeContext(req, new PaymentsController().pay, PaymentsController, res);

    const allowed = await runLockGuard(context, { lock });
    assert.equal(allowed, true);
    assert.ok(req.lockBoxLock !== undefined);
    assert.equal(await req.lockBoxLock!.isHeld(), true);
    assert.equal(await lock.tryAcquire('payments:account'), null);

    res.emit('finish');
    await sleep(10);
    assert.equal(await req.lockBoxLock!.isHeld(), false);
    assert.ok(await lock.tryAcquire('payments:account') !== null);
  });

  it('supports a dynamic key factory', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());

    class Controller {
      @Lock((request: unknown) => {
        const id = (request as Req).resourceId;
        return `resource:${id}`;
      })
      run(): string {
        return 'ok';
      }
    }

    const context = (id: string): ExecutionContextLike =>
      makeContext(
        { resourceId: id },
        new Controller().run,
        Controller,
        new EventEmitter(),
      );

    const guard = createLockGuard({ lock });
    await guard.canActivate(context('a'));
    await guard.canActivate(context('b'));

    assert.equal(await lock.tryAcquire('resource:a'), null);
    assert.equal(await lock.tryAcquire('resource:b'), null);
  });

  it('passes through when no @Lock metadata is present', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    class PlainController {
      run(): string {
        return 'ok';
      }
    }
    const req: Req = {};
    const context = makeContext(req, new PlainController().run, PlainController, new EventEmitter());
    const allowed = await runLockGuard(context, { lock });
    assert.equal(allowed, true);
    assert.equal(req.lockBoxLock, undefined);
  });

  it('createLockGuard wraps runLockGuard', async () => {
    const lock = new DistributedLock(new MemoryLockBackend());
    const guard = createLockGuard({ lock });

    class Controller {
      @Lock('fixed')
      run(): string {
        return 'ok';
      }
    }

    const req: Req = {};
    const context = makeContext(req, new Controller().run, Controller, new EventEmitter());
    assert.equal(await guard.canActivate(context), true);
    assert.equal(await lock.tryAcquire('fixed'), null);
  });
});
