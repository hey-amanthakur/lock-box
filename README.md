<div align="center">

# Lock-Box

### A production-grade, framework-agnostic distributed lock & lease library for Node.js

[![npm version](https://img.shields.io/npm/v/@hey-amanthakur/lock-box.svg?style=flat-square)](https://www.npmjs.com/package/@hey-amanthakur/lock-box)
[![npm downloads](https://img.shields.io/npm/dm/@hey-amanthakur/lock-box.svg?style=flat-square)](https://www.npmjs.com/package/@hey-amanthakur/lock-box)
[![license](https://img.shields.io/npm/l/@hey-amanthakur/lock-box.svg?style=flat-square)](./LICENSE)
[![types](https://img.shields.io/npm/types/@hey-amanthakur/lock-box?style=flat-square)](https://www.npmjs.com/package/@hey-amanthakur/lock-box)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](./package.json)
[![node](https://img.shields.io/node/v/@hey-amanthakur/lock-box?style=flat-square)](https://www.npmjs.com/package/@hey-amanthakur/lock-box)

**Zero runtime dependencies · Pluggable backends · TTL leases · Auto-renewal · Blocking acquire · AbortSignal cancellation · Express · Fastify · Koa · NestJS**

</div>

---

## Overview

**Lock-Box** is a lightweight, framework-agnostic **distributed mutex** for Node.js. It serializes access to shared resources — databases, queues, rate-limited external APIs, payment accounts — across processes and machines, with a clean `LockBackend` interface so you can run it in-process or on real distributed storage (Redis ships out of the box).

### Highlights

| | |
| --- | --- |
| **Zero dependencies** | No transitive supply-chain risk; nothing to audit beyond Node itself. |
| **Pluggable backends** | [In-memory](#backends) for single-process apps and tests, or the [Redis adapter](#redis) for real distributed coordination. Bring your own via the `LockBackend` interface. |
| **TTL leases** | Every lock is a lease: if a holder crashes, the lock frees itself after `ttlMs`. No stuck locks. |
| **Auto-renewal** | Background lease extension so long jobs never lose their lock mid-flight. |
| **Blocking acquire** | `withLock`/`acquire` wait (poll) until the lock is free or a timeout elapses. `tryAcquire` never blocks. |
| **Cancellation** | One `AbortSignal` aborts the wait *and* releases a held lease. |
| **Observability hooks** | `onAcquire`, `onRelease`, `onRenew`, `onLost` — throwing hooks never break the flow. |
| **Framework adapters** | Drop-in middleware for [Express](#express), [Fastify](#fastify), [Koa](#koa), and a decorator + guard for [NestJS](#nestjs). |
| **Dual ESM + CommonJS** | Ships both module formats with full TypeScript type definitions. |

---

## When to use it

Lock-Box is for any resource that must be mutated by **exactly one** actor at a time:

- **Payment / billing operations** — never double-charge an account for a concurrent request.
- **Job deduplication** — ensure a scheduled job (deployment, report, reindex) isn't already running on another node.
- **Inventory / seat allocation** — a final authoritative check before decrementing a shared counter.
- **Idempotent side-effect guards** — protect the "once" boundary your idempotency key protects *before* the side effect.
- **Queue consumption** — a leader lease so only one consumer polls a sharded source.

It is **not** a fit for:

- **Counting concurrency limits** — for a "at most N concurrent workers" limit, see [Coord-Box](https://github.com/hey-amanthakur/coord-box) (`semaphore`).
- **HTTP response deduplication** — if you want to replay a stored response for duplicate requests, see [Coord-Box](https://github.com/hey-amanthakur/coord-box) (`idempotency`).

> **Tip:** pair a lock with [Retry-Box](https://github.com/hey-amanthakur/retry-box) for a fully resilient write path: acquire the lock, then run the operation under retries inside the critical section.

---

## Table of Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
- [Core API](#core-api)
  - [`DistributedLock`](#distributedlock)
  - [`tryAcquire` / `acquire` / `withLock`](#tryacquire--acquire--withlock)
  - [Leases & auto-renewal](#leases--auto-renewal)
  - [Cancellation](#cancellation)
  - [Hooks](#hooks)
  - [Errors](#errors)
  - [Custom backends](#custom-backends)
- [Backends](#backends)
  - [In-memory](#in-memory)
  - [Redis](#redis)
- [Framework adapters](#framework-adapters)
  - [Express](#express)
  - [Fastify](#fastify)
  - [Koa](#koa)
  - [NestJS](#nestjs)
- [Configuration reference](#configuration-reference)
- [Examples](#examples)
- [Node.js support](#nodejs-support)
- [Testing](#testing)
- [Contributing](#contributing)
- [License](#license)

---

## Installation

```bash
npm install @hey-amanthakur/lock-box
pnpm add    @hey-amanthakur/lock-box
yarn add    @hey-amanthakur/lock-box
```

Framework and backend packages are **optional peer dependencies** — install only the ones you use:

```bash
npm install ioredis                 # Redis backend only
npm install express                 # Express adapter only
npm install fastify                 # Fastify adapter only
npm install koa                     # Koa adapter only
npm install @nestjs/common @nestjs/core reflect-metadata   # NestJS only
```

---

## Quick start

```ts
import { DistributedLock, MemoryLockBackend } from '@hey-amanthakur/lock-box';

const lock = new DistributedLock(new MemoryLockBackend());

await lock.withLock('payments:account-123', async (acquired) => {
  // exactly one process runs this at a time
  await charge();
});
```

The default lease is **30 seconds**. A holder that crashes simply releases the lock when the lease expires — no stuck locks.

---

## Core concepts

- **Backend** decides *where* the lock lives and makes acquisition atomic.
- **Lease (TTL)** bounds how long a lock is held — the safety net for crashed holders.
- **Token** uniquely identifies each acquisition; only the owning token can release or extend.
- **Renewal** keeps the lease alive while a long operation runs, and *detects* a lost lock.

---

## Core API

### `DistributedLock`

```ts
import {
  DistributedLock,
  MemoryLockBackend,
} from '@hey-amanthakur/lock-box';

const lock = new DistributedLock(new MemoryLockBackend(), {
  defaultTtlMs: 10_000,                         // lease duration (default 30s)
  wait: { maxWaitMs: 5_000, intervalMs: 100 },  // blocking-acquire defaults
  hooks: {
    onAcquire: ({ key }) => console.log('locked', key),
    onRelease: ({ key }) => console.log('released', key),
    onLost: ({ key, reason }) => console.warn('lock lost', key, reason),
  },
});
```

### `tryAcquire` / `acquire` / `withLock`

| Method | Behavior |
| --- | --- |
| `tryAcquire(key, opts?)` | One attempt. Returns an `AcquiredLock` or `null` if held. |
| `acquire(key, opts?)` | Waits (polls) until free or `maxWaitMs` elapses; throws `LockWaitTimeoutError`. |
| `withLock(key, fn, opts?)` | `acquire` → run `fn(lock)` → release in `finally` (even if `fn` throws). |
| `release(key, token)` | Convenience: release by key + token. |

```ts
const lock = await lock.tryAcquire('queue:leader');
if (lock === null) {
  // someone else is leader — skip
}

const guard = await lock.acquire('inventory:SKU-1', { maxWaitMs: 2_000 });

const result = await lock.withLock('account:42', async (held) => {
  return deduct();
});
```

### `AcquiredLock`

```ts
export interface AcquiredLock {
  readonly key: string;
  readonly token: string;      // unique per acquisition
  readonly expiresAt: number;  // epoch ms
  readonly autoRenew: boolean;
  readonly ended: Promise<{ reason: 'released' | 'expired' | 'aborted'; at: number }>;
  isHeld(): Promise<boolean>;  // live check against the backend
  extend(ttlMs?: number): Promise<Date>;
  release(): Promise<boolean>; // idempotent; true if it released an active lease
}
```

### Leases & auto-renewal

Every lock is a **lease**: the backend frees it after `ttlMs` even if nobody releases it. If your operation may run longer than the lease, enable auto-renewal:

```ts
await lock.withLock('long-job', async () => {
  // lease is refreshed every ttlMs/3 in the background
}, { ttlMs: 10_000, renew: true });
```

If a renewal fails (the lease was lost — e.g. backend hiccup or another actor), `onLost` fires and `lock.ended` resolves with `{ reason: 'expired' }`. **A lost lock is never silently assumed to be held**: check `await lock.isHeld()` before committing side effects, or use renewal to detect loss.

### Cancellation

```ts
const controller = new AbortController();

const job = lock.withLock('x', async () => { /* ... */ }, { signal: controller.signal });
setTimeout(() => controller.abort(), 1_000);

// aborts the wait AND releases an already-held lease
```

- Waiting on a lock: aborts with `LockAbortError`.
- Already holding: the lease is released and `ended` resolves with `{ reason: 'aborted' }`.

### Hooks

```ts
const lock = new DistributedLock(backend, {
  hooks: {
    onAcquire: ({ key, token }) => {},
    onRelease: ({ key, token }) => {},
    onRenew: ({ key, token, expiresAt }) => {},
    onLost: ({ key, token, reason }) => {}, // 'expired' | 'aborted'
  },
});
```

Hook exceptions are isolated by design — a throwing hook never breaks acquisition or release.

### Errors

| Error | When |
| --- | --- |
| `LockWaitTimeoutError` | Couldn't acquire within `maxWaitMs`. Carries `key` and `waitedMs`. |
| `LockEndedError` | `extend()`/`release()` on a lease that already ended. |
| `LockAbortError` | Acquisition cancelled via signal. `name === 'AbortError'`. |
| `LockError` | Base class for all lock errors. |

### Custom backends

Any object satisfying `LockBackend` works:

```ts
import type { LockBackend } from '@hey-amanthakur/lock-box';

const backend: LockBackend = {
  async acquire(key, token, ttlMs) { /* atomic set-if-not-exists */ },
  async extend(key, token, ttlMs) { /* atomic compare-and-refresh */ },
  async release(key, token) { /* atomic delete-if-matches */ },
  async get(key) { /* current token or undefined */ },
};
```

The four operations must each be **atomic** — that is the entire contract of a distributed lock. (For reference, see `src/redis/backend.ts`.)

---

## Backends

### In-memory

```ts
import { DistributedLock, MemoryLockBackend } from '@hey-amanthakur/lock-box';

const lock = new DistributedLock(new MemoryLockBackend());
```

Correct within a single Node process. Swap in Redis (or your own backend) the moment locks must coordinate across processes or machines.

### Redis

```ts
import Redis from 'ioredis';
import { createRedisLock } from '@hey-amanthakur/lock-box/redis';

const redis = new Redis({ host: '127.0.0.1' });
const lock = createRedisLock(redis, { defaultTtlMs: 10_000 });
```

Every operation is an **atomic Lua script** (`SET NX PX` for acquire, token-verified `PEXPIRE`/`DEL` for extend/release), so the ownership check and the write happen in one step — safe across any number of processes.

```ts
const backend = createRedisLockBackend(redis); // just the backend, if you prefer
```

---

## Framework adapters

Adapters acquire the lock, expose it to your handler, and release it when the response finishes (or the connection closes).

### Express

```ts
import express from 'express';
import { DistributedLock, MemoryLockBackend } from '@hey-amanthakur/lock-box';
import { expressLock } from '@hey-amanthakur/lock-box/express';

const lock = new DistributedLock(new MemoryLockBackend());
const app = express();

app.post(
  '/payments',
  expressLock({ lock, key: (req) => `payments:${req.body.accountId}` }),
  (req, res) => {
    res.locals.lock; // the AcquiredLock, if you need it
    res.json({ ok: true });
  },
);
```

### Fastify

```ts
import Fastify from 'fastify';
import { DistributedLock, MemoryLockBackend } from '@hey-amanthakur/lock-box';
import { fastifyLockPlugin } from '@hey-amanthakur/lock-box/fastify';

const app = Fastify();
const lock = new DistributedLock(new MemoryLockBackend());

app.register((instance, _opts, done) => {
  fastifyLockPlugin({ lock, key: (req) => `payments:${req.body.accountId}` })(instance);
  done();
});
```

The acquired lock is exposed as `request.lock`.

### Koa

```ts
import Koa from 'koa';
import { DistributedLock, MemoryLockBackend } from '@hey-amanthakur/lock-box';
import { koaLock } from '@hey-amanthakur/lock-box/koa';

const app = new Koa();
const lock = new DistributedLock(new MemoryLockBackend());

app.use(koaLock({ lock, key: (ctx) => `payments:${ctx.request.body.accountId}` }));
```

The acquired lock is exposed as `ctx.state.lock`.

### NestJS

```ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { DistributedLock, MemoryLockBackend } from '@hey-amanthakur/lock-box';
import { Lock, createLockGuard } from '@hey-amanthakur/lock-box/nestjs';

const lock = new DistributedLock(new MemoryLockBackend());

@Controller('payments')
class PaymentsController {
  @Get()
  @UseGuards(createLockGuard({ lock }))
  @Lock((req) => `payments:${req.query.accountId}`)  // or @Lock('payments:fixed-key')
  pay() {
    return 'ok';
  }
}
```

The guard acquires the lock (using the `@Lock` metadata), exposes it as `request.lockBoxLock`, and releases it when the response finishes.

---

## Configuration reference

```ts
interface DistributedLockOptions {
  /** Default lease duration in ms. Default 30_000. */
  defaultTtlMs?: number;
  /** Wait defaults for acquire/withLock. Default { maxWaitMs: 30_000, intervalMs: 200 }. */
  wait?: { maxWaitMs?: number; intervalMs?: number };
  hooks?: LockHooks;
}

interface LockOptions {
  ttlMs?: number;                             // lease duration
  renew?: boolean | { intervalMs?: number };  // background lease renewal
  signal?: AbortSignal;                       // cancel wait / release held lock
  metadata?: unknown;                         // arbitrary, available to hooks
}

interface WaitOptions extends LockOptions {
  maxWaitMs?: number;   // stop waiting after this; Infinity waits forever
  intervalMs?: number;  // poll interval
}
```

---

## Examples

Runnable examples live in [`examples/`](./examples) — run any of them with `npx tsx`:

```bash
npx tsx examples/basic.ts     # withLock, mutual exclusion
npx tsx examples/redis.ts     # Redis backend (requires a local Redis)
npx tsx examples/adapters.ts  # Express / Fastify / Koa
```

---

## Node.js support

| Node line | Status | Supported |
| --- | --- | :---: |
| 20.x | EOL ~Apr 2026, still widely deployed | ✅ |
| 22.x | Active LTS | ✅ |
| 24.x | Active LTS (newest LTS) | ✅ |
| 26.x | Current | ✅ |

`engines.node: ">=20.19.0"`.

---

## Testing

```bash
npm test          # run unit + integration tests with tsx + node:test
npm run test:coverage  # coverage with gates (lines/functions/statements >= 90, branches >= 85)
npm run typecheck # tsc --noEmit
npm run build     # tsup dual ESM/CJS + .d.ts
npm run verify    # lint + typecheck + test + build
```

Redis adapter tests run against `ioredis-mock` — no live Redis needed.

---

## Contributing

Contributions are welcome and appreciated. Please read the [Contributing Guidelines](./CONTRIBUTING.md) before opening a pull request.

- **Bug reports & feature requests** → [open an issue](https://github.com/hey-amanthakur/lock-box/issues/new/choose)
- **Pull requests** → target the `main` branch; include tests for any new behavior
- **Discussions & questions** → [start a discussion](https://github.com/hey-amanthakur/lock-box/discussions)

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).

---

## License

[MIT](./LICENSE) © 2026 [Aman Thakur](https://github.com/hey-amanthakur)
