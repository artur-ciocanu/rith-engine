---
name: rith-validate
description: |
  Validation sequence: type-check, lint, format, test, build. Detects the
  project's package manager and runs the appropriate commands. Use when
  validating code changes, running CI checks locally, or fixing validation
  failures.
  Triggers: "validate", "run checks", "type-check", "lint", "run tests",
  "fix validation", "CI checks".
metadata:
  author: rith-engine
  version: "1.0"
---

# Validate

Run the full validation suite: type-check → lint → format → test → build.
Fix failures at each step before proceeding to the next.

---

## Package Manager Detection

Detect from lockfile present in the project root:

| Lockfile             | Runner       |
| -------------------- | ------------ |
| `bun.lockb`          | `bun`        |
| `bun.lock`           | `bun`        |
| `pnpm-lock.yaml`     | `pnpm`       |
| `yarn.lock`          | `yarn`       |
| `package-lock.json`  | `npm run`    |
| `pyproject.toml`     | `uv run`     |
| `Cargo.toml`         | `cargo`      |
| `go.mod`             | `go`         |

Check `package.json` `"scripts"` (or equivalent) to confirm which script names exist (`type-check`, `typecheck`, `lint`, `lint:fix`, `format`, `format:check`, `test`, `build`).

---

## Validation Sequence

Run each step in order. **Fix failures before moving to the next step** — never accumulate broken state.

### 1. Type Check

```
{runner} run type-check
```

**On failure:** Read errors, fix type issues in source, re-run. Common fixes: missing return types, generic constraint mismatches, incorrect imports.

### 2. Lint

```
{runner} run lint
```

**On failure:**
1. Try auto-fix first: `{runner} run lint:fix`
2. Re-run lint
3. Manually fix anything auto-fix couldn't resolve

### 3. Format

```
{runner} run format:check
```

**On failure:**
1. Auto-fix: `{runner} run format`
2. Verify: `{runner} run format:check`

### 4. Tests

```
{runner} test
```

**On failure:**
1. Identify which test(s) failed
2. Determine root cause: implementation bug or stale test expectation?
3. Fix the **root cause** — never suppress a test to pass validation
4. Re-run until green

### 5. Build

```
{runner} run build
```

**On failure:** Usually a type or import issue missed by step 1. Fix and re-run.

---

## Language Variants

| Language   | Type Check              | Lint                     | Test               | Build                  |
| ---------- | ----------------------- | ------------------------ | ------------------ | ---------------------- |
| JS/TS      | `{runner} run type-check` | `{runner} run lint`    | `{runner} test`    | `{runner} run build`   |
| Python     | `mypy .`                | `ruff check .`           | `pytest`           | N/A or `uv build`     |
| Rust       | `cargo check`           | `cargo clippy`           | `cargo test`       | `cargo build --release`|
| Go         | `go vet ./...`          | `golangci-lint run`      | `go test ./...`    | `go build ./...`       |

---

## Partial vs Full Validation

**Partial** (during active development):
- Type-check + lint after each file change
- Run only affected test files: `{runner} test {path/to/changed.test.ts}`
- Quick feedback loop — catch issues early

**Full** (before commit, PR, or marking a task done):
- All five steps in sequence
- All tests, not just affected ones
- Must exit 0 across the board

---

## Fixing Common Failures

### Type errors after refactor
Read the full error chain. Fix from the root type outward — don't patch leaf files when the source type is wrong.

### Lint errors in bulk
Always run `lint:fix` first. Only hand-edit what auto-fix can't resolve.

### Test failures after behavior change
If you intentionally changed behavior, update the test assertion to match. If the test exposes a bug in your change, fix the implementation.

### Build failures
These are usually type or import issues that `type-check` didn't surface (e.g., circular dependencies, missing exports). Trace the error to the offending module.

### Format drift
Run the formatter once. If `format:check` still fails after `format`, check for editor config conflicts or files excluded from formatting.

---

## Handling Blocked Validation

If a check cannot be fixed after multiple attempts:

1. Document the failure: what command, what error, what was tried
2. Check if it's a pre-existing issue (run on a clean branch to compare)
3. If pre-existing — not your problem, note it and proceed
4. If introduced by your changes — do not proceed until resolved or explicitly marked blocked with justification
