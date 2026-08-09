# AGENTS.md

## Project: @hey-amanthakur/lock-box

Production-grade, framework-agnostic distributed lock and lease library for
Node.js. Zero runtime dependencies, pluggable backends (in-memory, Redis).

## Commands

- **Lint:** `npm run lint`
- **Typecheck:** `npm run typecheck`
- **Test:** `npm test`
- **Test with coverage:** `npm run test:coverage`
- **Build:** `npm run build`
- **All checks:** `npm run verify` (lint + typecheck + test + build)

## Architecture

- Core (`src/lock/backend.ts`, `src/lock/memory-backend.ts`,
  `src/lock/lock.ts`, `src/lock/errors.ts`) is fully framework-agnostic and
  has zero runtime dependencies.
- `DistributedLock` owns lock semantics only: acquire, wait, TTL leases,
  auto-renewal, cancellation. It never touches HTTP frameworks or Redis
  directly — it talks to a `LockBackend` interface.
- Backend adapters live in `src/redis/` and are exposed as an optional
  subpath export (`lock-box/redis`). `ioredis` is an optional peer dependency.
- Framework adapters live in `src/adapters/` (Express, Fastify, Koa, NestJS)
  and are exposed as optional subpath exports (`lock-box/express`, etc.).
- All framework and backend packages are optional peer dependencies — never
  import them at the core level.

## Style

- 2-space indent, semicolons, single quotes, trailing commas in multi-line.
- Use `import type` for type-only imports.
- Relative imports use `.js` extensions (ESM).
- No comments unless explaining non-obvious *why*.
