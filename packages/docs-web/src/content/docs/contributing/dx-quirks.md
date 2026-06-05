---
title: DX Quirks
description: Known development experience quirks and workarounds when working on the Rith Engine codebase.
category: contributing
audience: [developer]
status: current
sidebar:
  order: 6
---

Development experience notes and workarounds.

## Bun Log Elision

When running `bun dev` from the repo root, Bun's `--filter` truncates logs:

```
@rith/core dev $ bun --watch src/index.ts
│ [129 lines elided]
└─ Running...
```

**To see full logs**, run directly from the package:

```bash
cd packages/core && bun --watch src/index.ts
```

Or:

```bash
bun --cwd packages/core run dev
```

Note: The root `bun dev` uses `--filter` to fix hot reload path issues, but this comes with log condensing.

## `mock.module()` Pollution

Bun's `mock.module()` is process-global and irreversible — `mock.restore()` does NOT undo it.

- Never add `afterAll(() => mock.restore())` for `mock.module()` cleanup — it has no effect
- Use `spyOn()` for internal modules that other test files import directly (e.g., `spyOn(git, 'checkout')`) — `spy.mockRestore()` DOES work for spies
- Never `mock.module()` a module path that another test file also `mock.module()`s with a different implementation
- When adding a new test file with `mock.module()`, ensure its package.json test script runs it in a separate `bun test` invocation from any conflicting files

## `bun run test` vs `bun test`

**NEVER run `bun test` from the repo root** — it discovers all test files across all packages and runs them in one process, causing ~135 mock pollution failures.

Always use `bun run test` (which uses `bun --filter '*' test` for per-package isolation).
