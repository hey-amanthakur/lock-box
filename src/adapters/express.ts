import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AcquiredLock } from '../lock/lock.js';
import { runLockMiddleware } from './shared.js';
import type { LockAdapterOptions } from './shared.js';

export interface ExpressLockOptions extends LockAdapterOptions<Request> {
  key: (req: Request) => string;
}

/**
 * Express middleware that holds a distributed lock for the duration of the
 * request. The acquired lock is exposed as `res.locals.lock` for downstream
 * handlers. The lock is released when the response finishes or the connection
 * closes.
 */
export function expressLock(options: ExpressLockOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const releaseOnResponse = (fn: () => void): void => {
      res.once('finish', fn);
      res.once('close', fn);
    };
    runLockMiddleware(req, options, releaseOnResponse)
      .then((lock: AcquiredLock) => {
        res.locals.lock = lock;
        next();
      })
      .catch((error: unknown) => {
        if (options.onError !== undefined) {
          options.onError(error, req);
        }
        next(error instanceof Error ? error : new Error(String(error)));
      });
  };
}

export { DistributedLock } from '../lock/lock.js';
export { MemoryLockBackend } from '../lock/memory-backend.js';
export type { AcquiredLock, LockOptions, WaitOptions } from '../lock/lock.js';
export type { LockBackend } from '../lock/backend.js';
