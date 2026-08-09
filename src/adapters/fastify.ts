import type { AcquiredLock } from '../lock/lock.js';
import { runLockMiddleware } from './shared.js';
import type { LockAdapterOptions } from './shared.js';

export interface FastifyLockOptions extends LockAdapterOptions<unknown> {
  key: (req: unknown) => string;
}

export interface FastifyReplyLike {
  raw?: { once?(event: string, fn: () => void): void };
}

export type FastifyLockHandler = (
  req: unknown,
  reply: FastifyReplyLike,
  done: (error?: Error) => void,
) => void;

function createHandler(options: FastifyLockOptions): FastifyLockHandler {
  return (req, reply, done) => {
    const releaseOnResponse = (fn: () => void): void => {
      reply.raw?.once?.('finish', fn);
      reply.raw?.once?.('close', fn);
    };
    runLockMiddleware(req, options, releaseOnResponse)
      .then((lock: AcquiredLock) => {
        (req as Record<string, unknown>).lock = lock;
        done();
      })
      .catch((error: unknown) => {
        if (options.onError !== undefined) {
          options.onError(error, req);
          done();
          return;
        }
        done(error instanceof Error ? error : new Error(String(error)));
      });
  };
}

export interface FastifyInstanceLike {
  addHook?(event: string, hook: FastifyLockHandler): void;
}

/** Fastify plugin that acquires the lock on `onRequest` for every route. */
export function fastifyLockPlugin(
  options: FastifyLockOptions,
): (instance: FastifyInstanceLike) => void {
  return (instance) => {
    instance.addHook?.('onRequest', createHandler(options));
  };
}

/** Per-route lock handler — pass as the route handler wrapper. */
export function fastifyLockRoute(
  options: FastifyLockOptions,
): FastifyLockHandler {
  return createHandler(options);
}

export { DistributedLock } from '../lock/lock.js';
export { MemoryLockBackend } from '../lock/memory-backend.js';
export type { AcquiredLock, LockOptions, WaitOptions } from '../lock/lock.js';
export type { LockBackend } from '../lock/backend.js';
