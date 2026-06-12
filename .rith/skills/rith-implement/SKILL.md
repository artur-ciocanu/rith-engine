---
name: rith-implement
description: |
  Executes an implementation plan end-to-end with rigorous validation loops,
  including task-level execution with type-checking after each change.
  Use when a plan file or GitHub issue URL needs to be implemented with
  full environment setup, git preparation, and comprehensive validation.
metadata:
  author: rith-engine
  version: '1.0'
---

# Implement Plan

**Plan**: $ARGUMENTS

---

## Your Mission

Execute the plan end-to-end with rigorous self-validation. You are autonomous.

**Core Philosophy**: Validation loops catch mistakes early. Run checks after every change. Fix issues immediately. The goal is a working implementation, not just code that exists.

**Golden Rule**: If a validation fails, fix it before moving on. Never accumulate broken state.

> **If executing tasks only without full environment setup, skip to [Phase 3: EXECUTE](#phase-3-execute---implement-tasks).** This applies when branch exists, PR is created, and plan is confirmed — i.e., setup is already complete and you only need to run the inner task execution loop.

---

## Phase 0: DETECT - Project Environment

### 0.1 Identify Package Manager

Check for these files to determine the project's toolchain:

| File Found          | Package Manager | Runner              |
| ------------------- | --------------- | ------------------- |
| `bun.lockb`         | bun             | `bun` / `bun run`   |
| `pnpm-lock.yaml`    | pnpm            | `pnpm` / `pnpm run` |
| `yarn.lock`         | yarn            | `yarn` / `yarn run` |
| `package-lock.json` | npm             | `npm run`           |
| `pyproject.toml`    | uv/pip          | `uv run` / `python` |
| `Cargo.toml`        | cargo           | `cargo`             |
| `go.mod`            | go              | `go`                |

**Store the detected runner** - use it for all subsequent commands.

### 0.2 Identify Validation Scripts

Check `package.json` (or equivalent) for available scripts:

- Type checking: `type-check`, `typecheck`, `tsc`
- Linting: `lint`, `lint:fix`
- Testing: `test`, `test:unit`, `test:integration`
- Building: `build`, `compile`

**Use the plan's "Validation Commands" section** - it should specify exact commands for this project.

---

## Phase 1: LOAD - Read the Plan

### 1.1 Load Plan File

```bash
cat $ARGUMENTS
```

If `$ARGUMENTS` is a GitHub issue URL or number (e.g., `#123`), fetch the issue body which contains the plan.

### 1.2 Extract Key Sections

Locate and understand:

- **Summary** - What we're building
- **Patterns to Mirror** - Code to copy from
- **Files to Change** - CREATE/UPDATE list
- **Step-by-Step Tasks** - Implementation order
- **Validation Commands** - How to verify (USE THESE, not hardcoded commands)
- **Acceptance Criteria** - Definition of done

### 1.3 Validate Plan Exists

**If plan not found:**

```
Error: Plan not found at $ARGUMENTS

Provide a valid plan path or GitHub issue containing the plan.
```

**PHASE_1_CHECKPOINT:**

- [ ] Plan file loaded
- [ ] Key sections identified
- [ ] Tasks list extracted

---

## Phase 2: PREPARE - Git State

### 2.1 Check Current State

```bash
# What branch are we on?
git branch --show-current

# Are we in a worktree?
git rev-parse --show-toplevel
git worktree list

# Is working directory clean?
git status --porcelain
```

### 2.2 Branch Decision

```text
┌─ IN WORKTREE?
│  └─ YES → Use current branch AS-IS. Do NOT switch branches. Do NOT create
│           new branches. The isolation system has already set up the correct
│           branch; any deviation operates on the wrong code.
│           Log: "Using worktree at {path} on branch {branch}"
│
├─ ON $BASE_BRANCH? (main, master, or configured base branch)
│  └─ Q: Working directory clean?
│     ├─ YES → Create branch: git checkout -b feature/{plan-slug}
│     │        (only applies outside a worktree — e.g., manual CLI usage)
│     └─ NO  → STOP: "Stash or commit changes first"
│
├─ ON OTHER BRANCH?
│  └─ Use it AS-IS. Do NOT switch to another branch (e.g., one shown by
│     `git branch` but not currently checked out).
│     Log: "Using existing branch {name}"
│
└─ DIRTY STATE?
   └─ STOP: "Stash or commit changes first"
```

### 2.3 Sync with Remote

```bash
git fetch origin
git pull --rebase origin $BASE_BRANCH 2>/dev/null || true
```

**PHASE_2_CHECKPOINT:**

- [ ] On correct branch (not $BASE_BRANCH with uncommitted work)
- [ ] Working directory ready
- [ ] Up to date with remote

---

## Phase 3: EXECUTE - Implement Tasks

**For each task in the plan's Step-by-Step Tasks section:**

> **Task-only context**: If entering at this phase (skipping Phases 0–2), first load context from workflow artifacts:
>
> ```bash
> cat $ARTIFACTS_DIR/plan-context.md
> cat $ARTIFACTS_DIR/plan-confirmation.md
> ```
>
> Extract: files to change, validation commands, patterns to mirror, confirmation status. Also load the original plan from the source path in `plan-context.md`. Verify confirmation status is CONFIRMED or PROCEED WITH CAUTION, and note any warnings.

### 3.1 Read Task Context

1. Read the **MIRROR** file reference from the task
2. Understand the pattern to follow
3. Read any **IMPORTS** specified
4. **Note any GOTCHA warnings**

### 3.2 Implement

1. Make the change exactly as specified
2. Follow the pattern from MIRROR reference
3. Handle any **GOTCHA** warnings

**For CREATE files:**

- Use patterns from plan/artifact
- Follow existing file structure conventions
- Include all specified content

**For UPDATE files:**

- Read current content
- Find the exact lines mentioned
- Make the specified change
- Preserve surrounding code

### 3.3 Validate Immediately

**After EVERY file change, run the type-check command from the plan's Validation Commands section.**

Common patterns:

- `{runner} run type-check` (JS/TS projects)
- `mypy .` (Python)
- `cargo check` (Rust)
- `go build ./...` (Go)

**If types fail:**

1. Read the error message carefully
2. Fix the type issue
3. Re-run type-check
4. Only proceed when passing

**Do NOT accumulate errors** - fix each one before moving to the next task.

### 3.4 Track Progress

Log each task as you complete it:

```
Task 1: CREATE src/features/x/models.ts ✅
Task 2: CREATE src/features/x/service.ts ✅
Task 3: UPDATE src/routes/index.ts ✅
```

### 3.5 Handle Deviations

If you must deviate from the plan:

- **Document WHAT** changed
- **Document WHY** it changed
- **Continue** with the deviation noted

Common reasons for deviation:

- Pattern file has changed since plan was created
- Missing import discovered
- Type incompatibility requires different approach
- Better solution discovered during implementation

**Deviation Handling:**
If you must deviate from the plan:

- Note WHAT changed
- Note WHY it changed
- Continue with the deviation documented

**PHASE_3_CHECKPOINT (per task):**

- [ ] Task implemented
- [ ] Type-check passes
- [ ] Progress logged
- [ ] Deviations documented (if any)

**PHASE_3_CHECKPOINT (overall):**

- [ ] All tasks executed in order
- [ ] Each task passed type-check
- [ ] Deviations documented

---

## Phase 4: TESTS - Write Required Tests

### 4.1 Test Requirements

**You MUST write or update tests for new code.** This is not optional.

Every new function/feature needs at least one test:

- **New file created** → Create corresponding test file
- **New function added** → Add test for that function
- **Behavior changed** → Update existing tests
- Edge cases identified in the plan need tests

### 4.2 Follow Test Patterns

Find existing test files to mirror:

```bash
find . -name "*.test.ts" -type f | head -5
```

Read a relevant test file to understand the project's test patterns.

### 4.3 Write Tests

For each new/changed file, write tests that cover:

1. **Happy path** - Normal expected behavior
2. **Edge cases** - Boundary conditions from the plan
3. **Error cases** - What happens with bad input

### 4.4 Run Tests

**Run the test command from the plan.**

Common patterns:

- JS/TS: `{runner} test` or `{runner} run test`
- Python: `pytest` or `uv run pytest`
- Rust: `cargo test`
- Go: `go test ./...`

**If tests fail:**

1. Identify which test failed
2. Determine: implementation bug or test bug?
3. Fix the root cause (usually implementation)
4. Re-run tests
5. Repeat until green

**PHASE_4_CHECKPOINT:**

- [ ] Tests written for new code
- [ ] All tests pass

---

## Phase 5: VALIDATE - Full Verification

### 5.1 Static Analysis

**Run the type-check and lint commands from the plan's Validation Commands section.**

Common patterns:

- JS/TS: `{runner} run type-check && {runner} run lint`
- Python: `ruff check . && mypy .`
- Rust: `cargo check && cargo clippy`
- Go: `go vet ./...`

**Must pass with zero errors.**

If lint errors:

1. Run the lint fix command (e.g., `{runner} run lint:fix`, `ruff check --fix .`)
2. Re-check
3. Manual fix remaining issues

### 5.2 Build Check

**Run the build command from the plan's Validation Commands section.**

Common patterns:

- JS/TS: `{runner} run build`
- Python: N/A (interpreted) or `uv build`
- Rust: `cargo build --release`
- Go: `go build ./...`

**Must complete without errors.**

### 5.3 Integration Testing (if applicable)

**If the plan involves API/server changes, use the integration test commands from the plan.**

Example pattern:

```bash
# Start server in background (command varies by project)
{runner} run dev &
SERVER_PID=$!
sleep 3

# Test endpoints (adjust URL/port per project config)
curl -s http://localhost:{port}/health | jq

# Stop server
kill $SERVER_PID
```

### 5.4 Edge Case Testing

Run any edge case tests specified in the plan.

**PHASE_5_CHECKPOINT:**

- [ ] Type-check passes (command from plan)
- [ ] Lint passes (0 errors)
- [ ] Tests pass (all green)
- [ ] Build succeeds
- [ ] Integration tests pass (if applicable)

---

## Phase 6: REPORT - Create Implementation Report

### 6.1 Create Report Directory

```bash
mkdir -p $ARTIFACTS_DIR/../reports
```

### 6.2 Write Progress Artifact

Write to `$ARTIFACTS_DIR/implementation.md`:

```markdown
# Implementation Progress

**Generated**: {YYYY-MM-DD HH:MM}
**Workflow ID**: $WORKFLOW_ID
**Status**: {COMPLETE | IN_PROGRESS | BLOCKED}

---

## Tasks Completed

| #   | Task          | File       | Status | Notes                       |
| --- | ------------- | ---------- | ------ | --------------------------- |
| 1   | {description} | `src/x.ts` | ✅     |                             |
| 2   | {description} | `src/y.ts` | ✅     |                             |
| 3   | {description} | `src/z.ts` | ✅     | Minor deviation - see below |

**Progress**: {X} of {Y} tasks completed

---

## Files Changed

| File              | Action | Lines     |
| ----------------- | ------ | --------- |
| `src/new-file.ts` | CREATE | +{N}      |
| `src/existing.ts` | UPDATE | +{N}/-{M} |

---

## Tests Written

| Test File       | Test Cases                             |
| --------------- | -------------------------------------- |
| `src/x.test.ts` | `should do X`, `should handle Y`       |
| `src/y.test.ts` | `creates correctly`, `validates input` |

---

## Deviations from Plan

{If none:}
No deviations. Implementation matched the plan exactly.

{If any:}

### Deviation 1: {brief title}

**Task**: {which task}
**Expected**: {what plan said}
**Actual**: {what was done}
**Reason**: {why the change was necessary}

---

## Type-Check Status

- [x] Passes after all changes

---

## Test Status

- [x] All tests pass
- Tests added: {N}
- Tests modified: {M}

---

## Issues Encountered

{If none:}
No issues encountered.

{If any:}

### Issue 1: {title}

**Problem**: {description}
**Resolution**: {how it was fixed}

---

## Next Step

Continue to `rith-validate` for full validation suite.
```

### 6.3 Generate Full Report

**Path**: `$ARTIFACTS_DIR/../reports/{plan-name}-report.md`

```markdown
# Implementation Report

**Plan**: `$ARGUMENTS`
**Source Issue**: #{number} (if applicable)
**Branch**: `{branch-name}`
**Date**: {YYYY-MM-DD}
**Status**: {COMPLETE | PARTIAL}

---

## Summary

{Brief description of what was implemented}

---

## Assessment vs Reality

Compare the original plan's assessment with what actually happened:

| Metric     | Predicted   | Actual   | Reasoning                                                                      |
| ---------- | ----------- | -------- | ------------------------------------------------------------------------------ |
| Complexity | {from plan} | {actual} | {Why it matched or differed - e.g., "discovered additional integration point"} |
| Confidence | {from plan} | {actual} | {e.g., "root cause was correct" or "had to pivot because X"}                   |

**If implementation deviated from the plan, explain why:**

- {What changed and why - based on what you discovered during implementation}

---

## Tasks Completed

| #   | Task               | File       | Status |
| --- | ------------------ | ---------- | ------ |
| 1   | {task description} | `src/x.ts` | ✅     |
| 2   | {task description} | `src/y.ts` | ✅     |

---

## Validation Results

| Check       | Result | Details               |
| ----------- | ------ | --------------------- |
| Type check  | ✅     | No errors             |
| Lint        | ✅     | 0 errors, N warnings  |
| Unit tests  | ✅     | X passed, 0 failed    |
| Build       | ✅     | Compiled successfully |
| Integration | ✅/⏭️  | {result or "N/A"}     |

---

## Files Changed

| File       | Action | Lines     |
| ---------- | ------ | --------- |
| `src/x.ts` | CREATE | +{N}      |
| `src/y.ts` | UPDATE | +{N}/-{M} |

---

## Deviations from Plan

{List any deviations with rationale, or "None"}

---

## Issues Encountered

{List any issues and how they were resolved, or "None"}

---

## Tests Written

| Test File       | Test Cases               |
| --------------- | ------------------------ |
| `src/x.test.ts` | {list of test functions} |

---

## Next Steps

- [ ] Review implementation
- [ ] Create PR (next step in workflow)
- [ ] Merge when approved
```

### 6.4 Archive Plan

```bash
mkdir -p $ARTIFACTS_DIR/../plans/completed
cp $ARGUMENTS $ARTIFACTS_DIR/../plans/completed/ 2>/dev/null || true
```

**PHASE_6_CHECKPOINT:**

- [ ] Progress artifact written to `$ARTIFACTS_DIR/implementation.md`
- [ ] Full report created at `$ARTIFACTS_DIR/../reports/`
- [ ] Plan copied to completed folder (if local file)
- [ ] All tasks documented
- [ ] Deviations noted
- [ ] Test status recorded

---

## Phase 7: OUTPUT - Report to User

```markdown
## Implementation Complete

**Plan**: `$ARGUMENTS`
**Source Issue**: #{number} (if applicable)
**Branch**: `{branch-name}`
**Status**: ✅ Complete

### Validation Summary

| Check      | Result          |
| ---------- | --------------- |
| Type check | ✅              |
| Lint       | ✅              |
| Tests      | ✅ ({N} passed) |
| Build      | ✅              |

### Progress Summary

| Metric          | Count   |
| --------------- | ------- |
| Tasks completed | {X}/{Y} |
| Files created   | {N}     |
| Files updated   | {M}     |
| Tests written   | {K}     |

### Deviations

{If none: "Implementation matched the plan."}
{If any: Brief summary of what changed and why}
{If deviations: {count} deviation(s) from plan documented in artifact.}

### Artifacts

- Report: `$ARTIFACTS_DIR/../reports/{name}-report.md`
- Progress: `$ARTIFACTS_DIR/implementation.md`

### Next Steps

1. Review the report (especially if deviations noted)
2. Proceed to `rith-validate` for full validation (lint, build, integration tests)
3. Create PR (next workflow step)
4. Merge when approved
```

---

## Handling Failures

### Type-Check Fails

Do NOT proceed to next task. Fix the issue:

1. Read error message carefully
2. Identify the file and line
3. Fix the type issue
4. Re-run the type-check command
5. Don't proceed until passing

### Tests Fail

1. Read the failure output
2. Identify which test failed
3. Determine: implementation bug or test bug?
4. Fix the root cause (usually implementation)
5. Re-run tests
6. Repeat until green

### Lint Fails

1. Run the lint fix command for auto-fixable issues
2. Manually fix remaining issues
3. Re-run lint
4. Proceed when clean

### Build Fails

1. Usually a type or import issue
2. Check the error output
3. Fix and re-run

### Integration Test Fails

1. Check if server started correctly
2. Verify endpoint exists
3. Check request format
4. Fix implementation and retry

### Pattern File Changed

If a pattern file has changed since the plan was created:

1. Read the current version
2. Adapt the implementation to match current patterns
3. Document as a deviation
4. Continue

### Task Unclear

If a task description is ambiguous:

1. Check the plan's context sections for clarity
2. Look at the MIRROR file for guidance
3. Make a reasonable decision
4. Document the interpretation as a deviation

---

## Success Criteria

- **TASKS_COMPLETE**: All plan tasks executed
- **TYPES_PASS**: Type-check passes after all changes
- **LINT_PASS**: Lint command exits 0 (warnings OK)
- **TESTS_WRITTEN**: New code has tests
- **TESTS_PASS**: All tests green
- **BUILD_PASS**: Build command succeeds
- **DEVIATIONS_DOCUMENTED**: Any plan deviations noted
- **REPORT_CREATED**: Implementation report exists
- **ARTIFACT_WRITTEN**: Implementation progress artifact created
