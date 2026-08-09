/**
 * Backend contract for a distributed mutex/lease store.
 *
 * Implementations MUST be atomic: concurrent callers on the same key must
 * never both observe `acquire` returning true. The in-memory and Redis
 * implementations ship with the package; bring-your-own backends are
 * supported as long as they satisfy this interface.
 */
export interface LockBackend {
  /**
   * Atomically acquire the lock if it is not already held by an unexpired
   * lease. `token` must be unique to the caller.
   *
   * @returns true if acquired, false if held by someone else.
   */
  acquire(key: string, token: string, ttlMs: number): Promise<boolean>;
  /**
   * Atomically refresh the lease if it is still held by `token`.
   *
   * @returns false when the token no longer owns the key (lost lease).
   */
  extend(key: string, token: string, ttlMs: number): Promise<boolean>;
  /**
   * Atomically release the lease if it is still held by `token`.
   *
   * @returns false when the token no longer owns the key.
   */
  release(key: string, token: string): Promise<boolean>;
  /**
   * Return the token currently holding the key, or `undefined` when free
   * (including expired leases, which must not count as held).
   */
  get(key: string): Promise<string | undefined>;
}
