import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryLockBackend } from '../src/lock/memory-backend.js';

describe('MemoryLockBackend', () => {
  it('acquires a free key', async () => {
    const backend = new MemoryLockBackend();
    assert.equal(await backend.acquire('a', 't1', 1000), true);
    assert.equal(await backend.get('a'), 't1');
  });

  it('rejects a second acquisition of a held key', async () => {
    const backend = new MemoryLockBackend();
    await backend.acquire('a', 't1', 1000);
    assert.equal(await backend.acquire('a', 't2', 1000), false);
    assert.equal(await backend.get('a'), 't1');
  });

  it('allows acquisition after the lease expires', async () => {
    const backend = new MemoryLockBackend();
    await backend.acquire('a', 't1', 30);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(await backend.acquire('a', 't2', 1000), true);
    assert.equal(await backend.get('a'), 't2');
  });

  it('extend only succeeds for the owning token', async () => {
    const backend = new MemoryLockBackend();
    await backend.acquire('a', 't1', 50);
    assert.equal(await backend.extend('a', 'other', 5000), false);
    assert.equal(await backend.extend('a', 't1', 5000), true);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(await backend.get('a'), 't1');
  });

  it('release only succeeds for the owning token and frees the key', async () => {
    const backend = new MemoryLockBackend();
    await backend.acquire('a', 't1', 1000);
    assert.equal(await backend.release('a', 'other'), false);
    assert.equal(await backend.release('a', 't1'), true);
    assert.equal(await backend.get('a'), undefined);
    assert.equal(await backend.acquire('a', 't2', 1000), true);
  });

  it('get returns undefined for expired leases and prunes them', async () => {
    const backend = new MemoryLockBackend();
    await backend.acquire('a', 't1', 10);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(await backend.get('a'), undefined);
    assert.equal(backend.size(), 0);
  });

  it('size counts only live leases', async () => {
    const backend = new MemoryLockBackend();
    await backend.acquire('a', 't1', 1000);
    await backend.acquire('b', 't2', 1000);
    await backend.acquire('c', 't3', 10);
    assert.equal(backend.size(), 3);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(backend.size(), 2);
  });
});
