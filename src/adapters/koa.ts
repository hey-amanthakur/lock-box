import type { AcquiredLock } from '../lock/lock.js';
import { runLockMiddleware } from './shared.js';
import type { LockAdapterOptions } from './shared.js';

export interface KoaLockOptions extends LockAdapterOptions<KoaContextLike> {
  key: (ctx: KoaContextLike) => string;
}

export interface KoaContextLike {
  state: Record<string, unknown>;
  res: { once?(event: string, fn: () => void): void };
}

/**
 * Koa middleware that holds a distributed lock for the duration of the
 * downstream call. The acquired lock is exposed as `ctx.state.lock`.
 */
export function koaLock(
  options: KoaLockOptions,
): (ctx: KoaContextLike, next: () => Promise<unknown>) => Promise<void> {
  return async (ctx, next) => {
    const releaseOnResponse = (fn: () => void): void => {
      ctx.res.once?.('finish', fn);
      ctx.res.once?.('close', fn);
    };
    try {
      const lock: AcquiredLock = await runLockMiddleware(ctx, options, releaseOnResponse);
      ctx.state.lock = lock;
    } catch (error) {
      if (options.onError !== undefined) {
        options.onError(error, ctx);
      }
      throw error;
    }
    await next();
  };
}

export { DistributedLock } from '../lock/lock.js';
export { MemoryLockBackend } from '../lock/memory-backend.js';
export type { AcquiredLock, LockOptions, WaitOptions } from '../lock/lock.js';
export type { LockBackend } from '../lock/backend.js';
