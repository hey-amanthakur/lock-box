# Contributing to Lock-Box

Thank you for your interest in contributing! This document outlines the process and standards for contributing to **@hey-amanthakur/lock-box**.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Writing Tests](#writing-tests)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)
- [Adding a Framework Adapter](#adding-a-framework-adapter)
- [License](#license)

---

## Code of Conduct

Be respectful and constructive. Harassment or personal attacks will not be tolerated. By participating, you agree to uphold these standards in every issue, PR, and discussion.

---

## Getting Started

### Prerequisites

- **Node.js** `>= 20.19.0` (run `node --version` to check)
- **npm** `>= 10` (bundled with Node 20+)

### Setup

```bash
git clone https://github.com/hey-amanthakur/lock-box.git
cd lock-box
npm install
```

Verify everything works:

```bash
npm run typecheck   # tsc --noEmit
npm test            # node:test via tsx
npm run build       # tsup dual ESM/CJS build
```

---

## Development Workflow

1. **Fork & clone** the repository.
2. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
3. **Make changes** following the [coding standards](#coding-standards).
4. **Add or update tests** for any new or changed behavior.
5. **Run all checks** before committing:
   ```bash
   npm run verify    # lint + typecheck + test + build
   ```
   Individual commands:
   ```bash
   npm run lint          # ESLint check
   npm run typecheck     # tsc --noEmit
   npm run test:coverage # tests with coverage thresholds
   npm run build         # tsup dual ESM/CJS build
   ```
6. **Commit** using [Conventional Commits](#commit-message-guidelines).
7. **Open a pull request** targeting `main`.

---

## Project Structure

```
lock-box/
├── src/
│   ├── lock/                       # Core (zero dependencies, framework-agnostic)
│   │   ├── backend.ts              # LockBackend interface
│   │   ├── memory-backend.ts       # In-process backend
│   │   ├── lock.ts                 # DistributedLock + AcquiredLock + hooks
│   │   └── errors.ts               # LockWaitTimeoutError, LockEndedError, ...
│   ├── redis/backend.ts            # Redis adapter (atomic Lua scripts)
│   ├── adapters/                   # Express / Fastify / Koa / NestJS
│   │   ├── shared.ts               # runLockMiddleware + shared types
│   │   ├── express.ts              # expressLock
│   │   ├── fastify.ts              # fastifyLockPlugin + fastifyLockRoute
│   │   ├── koa.ts                  # koaLock
│   │   └── nestjs.ts               # @Lock decorator + createLockGuard
│   └── index.ts                    # Public barrel export (main entry)
├── test/                           # Unit + integration tests (node:test)
├── examples/                       # Runnable examples (one per feature)
├── dist/                           # Build output (gitignored)
├── coverage/                       # Coverage output (gitignored)
├── eslint.config.js                # ESLint flat config
├── tsup.config.ts                  # Build configuration
├── tsconfig.json                   # TypeScript configuration
└── package.json
```

---

## Coding Standards

### General Principles

- **Zero runtime dependencies.** Do not add any runtime dependencies. Dev dependencies for tooling, types, and testing are fine.
- **Framework-agnostic core.** Everything under `src/` except `src/adapters/` and `src/redis/` must remain free of framework and client imports. The core owns lock semantics only.
- **Backend + framework packages are optional peers.** Never import `ioredis`, `express`, `fastify`, `koa`, or `@nestjs/*` at the core level. These imports belong only in adapter files exposed as optional subpath exports.
- **Atomicity is the contract.** `LockBackend.acquire/extend/release` must be atomic — reviewers should scrutinize any backend for race conditions (see the Redis Lua scripts as the reference implementation).
- **Strict TypeScript.** The project uses `"strict": true`, `noUnusedLocals`, `noUnusedParameters`, and `noImplicitReturns`. Your code must pass `tsc --noEmit` with zero errors.
- **No comments unless necessary.** Only add comments to explain *why* non-obvious code exists, not *what* it does.
- **Consistent style.** 2-space indentation, semicolons, single quotes, trailing commas in multi-line structures.

### Imports

- Use **`.js` extensions** in relative imports (ESM-compatible): `import { X } from '../lock/lock.js';`
- Use `import type` for type-only imports (enforced by `@typescript-eslint/consistent-type-imports`).

### Linting

The project uses **ESLint 9** with the flat config (`eslint.config.js`) and **typescript-eslint**. All source and test files must pass `eslint .` with zero errors. Examples are excluded from linting and typechecking by design.

---

## Writing Tests

Tests use the built-in [`node:test`](https://nodejs.org/api/test.html) runner with `node:assert/strict`. No external test framework is needed.

### Test File Conventions

- Test files live in `test/` and match the source filename: `src/lock/lock.ts` → `test/lock.test.ts`.
- Use `import` with `.js` extensions (resolved to `.ts` by tsx):
  ```ts
  import { DistributedLock } from '../src/index.js';
  ```

### What to Test

- **Unit tests** for pure logic (memory backend, lock state machine, errors).
- **Integration tests** for `DistributedLock` behavior (wait/timeout, renewal, abort, hooks, ended).
- **Backend tests** for the Redis adapter (run against `ioredis-mock` — no live Redis needed).
- **Adapter tests** for each framework adapter — mock the framework's req/res/next/ctx.
- **Concurrency tests** proving mutual exclusion under `Promise.all`.
- **Bug fixes** must include a regression test.

### Timers in tests

Prefer small `ttlMs` and short `sleep()` calls, and keep every test bounded (never wait on `Infinity`). Tests must never hang.

### Code Coverage

Coverage is measured with **c8** and enforced via `npm run test:coverage`. The thresholds are:

| Metric | Minimum |
| --- | --- |
| Lines | 90% |
| Functions | 90% |
| Branches | 85% |
| Statements | 90% |

```bash
npm run test:coverage         # run tests with threshold enforcement
npm run test:coverage:report  # generate HTML + text report in coverage/
```

Only `src/` files are measured. Barrel `index.ts` files are excluded since they contain only re-exports. New code must maintain or improve the coverage thresholds.

---

## Commit Message Guidelines

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

### Types

| Type | Use for |
| --- | --- |
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `docs` | Documentation changes (README, CONTRIBUTING, examples) |
| `refactor` | Code restructuring without behavior change |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `chore` | Tooling, configs, CI, dependency bumps |
| `breaking` | Breaking change (use with `!` after type, e.g. `feat!:`) |

### Examples

```
feat(lock): add auto-renewal for long-running critical sections
fix(redis): token-verify release before deleting the key
docs(readme): add NestJS guard example
test(lock): add regression test for abort during wait
```

---

## Pull Request Process

1. **One change per PR.** Keep PRs focused — a single feature, fix, or refactor.
2. **Update tests.** Every PR that changes behavior must include or update tests.
3. **Update documentation.** If you add a public API, update the README. If you add a new adapter, add an example.
4. **Pass all checks.** Your PR must pass `lint`, `typecheck`, `test:coverage`, and `build`.
5. **Keep the diff clean.** Rebase onto `main` before submitting.
6. **Describe the change.** In the PR description, explain what changed and why, how it was tested, and any breaking changes.

### PR Checklist

- [ ] Branch is up to date with `main`
- [ ] `npm run lint` passes with no errors
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run test:coverage` passes (all tests + coverage thresholds met)
- [ ] `npm run build` succeeds
- [ ] No new runtime dependencies added
- [ ] Commit messages follow Conventional Commits
- [ ] Documentation updated (README, examples) if API changed
- [ ] Tests added or updated for any new/changed behavior

---

## Reporting Issues

### Bug Reports

Open a [bug report](https://github.com/hey-amanthakur/lock-box/issues/new?labels=bug&template=bug.yml) and include:

- **Node.js version** (`node --version`)
- **Lock-Box version** (`npm ls @hey-amanthakur/lock-box`)
- **Backend** (in-memory, Redis, custom)
- **Minimal reproduction** (a code snippet or a repo link)
- **Expected behavior** vs. **actual behavior**
- **Error output** (stack trace if applicable)

### Feature Requests

Open a [feature request](https://github.com/hey-amanthakur/lock-box/issues/new?labels=enhancement&template=feature.yml) and describe:

- **The problem** you're trying to solve
- **The proposed solution** (API sketch if possible)
- **Alternatives considered**

---

## Adding a Framework Adapter

To add support for a new framework (e.g. Hapi, Polka, h3):

1. **Create the adapter file** at `src/adapters/<framework>.ts`.
2. **Use the shared flow** from `./shared.js` (`runLockMiddleware`) so key derivation, acquisition, and release-on-response-finish stay consistent.
3. **Expose the acquired lock** on the framework-native location (`res.locals`, `request.lock`, `ctx.state`, ...).
4. **Export re-exports** of core `DistributedLock`, `MemoryLockBackend`, errors, and types for convenience.
5. **Add the subpath export** in `package.json` under `exports`.
6. **Add the entry** in `tsup.config.ts`.
7. **Write an example** in `examples/adapters.ts`.
8. **Write tests** for the adapter (mock the framework's req/res/next/ctx).
9. **Update the README** with a usage snippet.

---

## License

By contributing to Lock-Box, you agree that your contributions will be licensed under the [MIT License](./LICENSE).

---

Thank you for contributing!
