---
name: rith-implement
description: |
  Implementation methodology with validation loops, dependency detection, and
  plan adherence. Use when implementing features, fixing issues, executing plan
  tasks, or running fix-before-proceed workflows.
  Triggers: "implement", "fix issue", "execute plan", "build feature",
  "implement tasks", "code the solution".
metadata:
  author: rith-engine
  version: "1.0"
---

# Implementation

Execute plans and investigation artifacts with rigorous validation. Every change is verified before the next begins.

## Core Philosophy

- **Validate after every change.** Run the type-check/compile command after each file edit. Never accumulate broken state.
- **Fix before proceeding.** If validation fails, stop and fix the issue. Do not move to the next task.
- **Follow the plan.** Execute tasks in dependency order. If deviation is necessary, document what changed and why.
- **No scope creep.** Do not refactor unrelated code, add unplanned improvements, or change formatting of untouched lines.

## Environment Detection

Before any implementation work, detect the project toolchain. See [package-managers.md](references/package-managers.md) for the full detection matrix.

Identify available validation scripts from the project config (e.g., `package.json` scripts):
- Type checking: `type-check`, `typecheck`, `tsc`
- Linting: `lint`, `lint:fix`
- Testing: `test`, `test:unit`
- Building: `build`, `compile`

Use the plan's **Validation Commands** section when available — it specifies exact commands for the project.

## Plan Loading

1. Load the plan file or investigation artifact
2. Extract: files to change (CREATE/UPDATE), task list, validation commands, patterns to mirror, acceptance criteria
3. If the plan references specific code, verify those references still match the codebase — detect drift before starting

### Drift Detection

For each file/line reference in the plan:
- Read the actual current code
- Compare to what the plan expects
- If significant drift: warn, suggest re-planning, or proceed with caution and document

## Git State

- **In a worktree**: use current branch as-is — the isolation system already set up the correct branch
- **On base branch with clean state**: create a feature/fix branch
- **On other branch**: use as-is, assume it was set up for this work
- **Dirty state**: stop — require commit or stash first
- Sync with remote before starting

## Dependency Installation

Before any validation or implementation, install project dependencies. See [package-managers.md](references/package-managers.md) for lockfile-based detection.

If install fails, stop and report. Do not proceed with missing dependencies.

## Task Execution

For each task in the plan, in order:

### 1. Read Context
- Read the MIRROR/pattern file referenced by the task
- Understand the pattern to follow
- Note GOTCHA warnings and required IMPORTS

### 2. Implement
- **CREATE**: write new file following the discovered pattern
- **UPDATE**: modify existing file as specified, preserve surrounding code
- Match existing code style exactly — naming, structure, error handling, logging

### 3. Validate Immediately
Run the project's type-check command after every file change:
```
{runner} run type-check    # JS/TS
cargo check                # Rust
mypy .                     # Python
go build ./...             # Go
```

If validation fails:
1. Read the error carefully
2. Fix the issue in the file you just changed
3. Re-run validation
4. Only proceed when passing

### 4. Track Progress
Log each completed task. If you deviate from the plan, document:
- **What** changed from the plan
- **Why** it changed (pattern drift, type incompatibility, better solution found)

## Testing Strategy

Every new function/feature needs at least one test. This is not optional.

### Test Requirements
- New file created → create corresponding test file
- New function added → add test for that function
- Behavior changed → update existing tests

### What to Test
1. **Happy path** — normal expected behavior
2. **Edge cases** — boundary conditions from the plan
3. **Error cases** — bad input, missing data, unauthorized access

### Test Patterns
Find existing test files in the project and mirror their structure. Follow the project's assertion style, describe/it blocks, and file naming conventions.

### When Tests Fail
1. Determine: bug in implementation or bug in test?
2. Fix the root cause (usually the implementation, not the test)
3. Re-run tests
4. Repeat until green

## Full Validation

After all tasks are complete, run the full validation suite:

1. **Static analysis**: type-check + lint (zero errors required)
2. **Unit tests**: all tests pass
3. **Build**: compiles without errors
4. **Integration tests**: if the plan involves API/server changes

If lint has auto-fixable issues, run the fix command first, then re-check.

## Error Handling Strategy

### Type-Check Fails
Do not proceed. Read the error, fix the type issue, re-run. Only continue when green.

### Lint Fails
Run auto-fix first. Manually fix remaining issues. Re-run until clean.

### Build Fails
Usually a type or import issue. Check error output, fix, and re-run.

### Test Fails
Read failure output. Fix the root cause — the implementation, not the test (unless the test itself is wrong). Re-run until green.

### Pattern File Changed
If a pattern file has changed since the plan was created:
1. Read the current version
2. Adapt implementation to match current patterns
3. Document as a deviation

## Committing

- Stage only the files you actually edited — never `git add -A` or `git add .`
- Never stage scratch files, artifacts, or review files
- Use conventional commit messages referencing the issue number
- Push to remote after successful validation

## Implementation Report

After completion, produce a report covering:
- Tasks completed (with status)
- Files changed (action + line counts)
- Deviations from plan (if any, with rationale)
- Validation results (type-check, tests, lint, build)
- Issues encountered and how they were resolved

## Success Criteria

- All plan tasks executed in dependency order
- Type-check passes after every individual change
- All tests pass (existing + new)
- Lint and build succeed
- Deviations documented
- Implementation report written
