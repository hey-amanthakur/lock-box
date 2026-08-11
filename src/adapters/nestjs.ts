import 'reflect-metadata';
import type { DistributedLock, WaitOptions } from '../lock/lock.js';

export const LOCK_METADATA = 'lock-box:config';

export type LockKeyFactory = (request: unknown) => string | Promise<string>;

export interface LockDecoratorMetadata {
  keyOrFactory: string | LockKeyFactory;
  options?: WaitOptions;
}

export interface ExecutionContextLike {
  getType(): string;
  getHandler(): unknown;
  getClass(): unknown;
  switchToHttp?(): {
    getRequest<Req = unknown>(): Req;
    getResponse<Res = unknown>(): Res;
  };
}

export interface LockGuardDeps {
  lock: DistributedLock;
}

export interface LockGuard {
  canActivate(context: ExecutionContextLike): Promise<boolean>;
}

/**
 * Decorator that marks a handler (or controller) to be protected by a
 * distributed lock. Combine with `createLockGuard`.
 *
 * ```ts
 * @Lock('payments:account-123')
 * @Get()
 * pay() { ... }
 * ```
 */
export function Lock(
  keyOrFactory: string | LockKeyFactory,
  options: WaitOptions = {},
): MethodDecorator & ClassDecorator {
  const decorator = (
    target: object,
    _propertyKey?: string | symbol,
    descriptor?: TypedPropertyDescriptor<unknown>,
  ): void => {
    const metadata: LockDecoratorMetadata = { keyOrFactory, options };
    if (descriptor?.value !== undefined && descriptor.value !== null) {
      Reflect.defineMetadata(LOCK_METADATA, metadata, descriptor.value);
      return;
    }
    Reflect.defineMetadata(LOCK_METADATA, metadata, target);
  };
  return decorator as MethodDecorator & ClassDecorator;
}

function isHttpContext(context: ExecutionContextLike): boolean {
  const type = context.getType();
  return type === 'http' || (type !== 'rpc' && type !== 'ws' && !!context.switchToHttp);
}

function readMetadata(context: ExecutionContextLike): LockDecoratorMetadata | undefined {
  const handler = context.getHandler();
  const cls = context.getClass();
  return (
    (Reflect.getMetadata(LOCK_METADATA, handler as object) as
      | LockDecoratorMetadata
      | undefined) ??
    (Reflect.getMetadata(LOCK_METADATA, cls as object) as
      | LockDecoratorMetadata
      | undefined)
  );
}

/**
 * Acquire the lock declared by `@Lock(...)`, expose it as
 * `request.lockBoxLock`, and release it when the response finishes.
 */
export async function runLockGuard(
  context: ExecutionContextLike,
  deps: LockGuardDeps,
): Promise<boolean> {
  if (!isHttpContext(context)) {
    return true;
  }
  const metadata = readMetadata(context);
  if (metadata === undefined) {
    return true;
  }
  const http = context.switchToHttp!();
  const request = http.getRequest();
  const key =
    typeof metadata.keyOrFactory === 'function'
      ? await metadata.keyOrFactory(request)
      : metadata.keyOrFactory;

  const acquired = await deps.lock.acquire(key, metadata.options);
  (request as Record<string, unknown>).lockBoxLock = acquired;

  const response = http.getResponse() as { once?(event: string, fn: () => void): void };
  const release = (): void => {
    acquired.release().catch(() => {});
  };
  response.once?.('finish', release);
  response.once?.('close', release);

  return true;
}

export function createLockGuard(deps: LockGuardDeps): LockGuard {
  return {
    async canActivate(context: ExecutionContextLike): Promise<boolean> {
      return runLockGuard(context, deps);
    },
  };
}

export { DistributedLock } from '../lock/lock.js';
export { MemoryLockBackend } from '../lock/memory-backend.js';
export type { LockOptions, WaitOptions } from '../lock/lock.js';
export type { LockBackend } from '../lock/backend.js';
