# Plan: Maintainer Workflow Cleanup

## Overview

Delete all maintainer commands (13 files) and the `rith-validate-pr` workflow.
60% of `rith-validate-pr` is dead infrastructure for a web app that no longer
exists (`@rith/server`, `@rith/web`, `agent-browser`). The surviving 40% (fetch
PR → code review main vs feature → verdict) is a minor variant of the existing
`rith-smart-pr-review` workflow. Promote `rith-issue-review-full` to production
defaults — it's the only well-structured maintainer workflow.

## Problem Being Solved

1. **`rith-validate-pr` is 60% dead code** — 6 of 10 nodes reference
   `@rith/server`, `@rith/web`, `agent-browser`, port allocation, and process
   management for infrastructure that was removed from Rith Engine. The workflow
   cannot run.
2. **5 validate-pr commands are broken** — moved to `.rith/maintainer/commands/`
   which is not in the command resolver's search path.
3. **8 orphaned commands** — not referenced by any workflow.
4. **The surviving value is redundant** — "fetch PR → code review main → code
   review feature → verdict" is `rith-smart-pr-review` with a before/after
   comparison twist. Not worth a separate broken workflow.
5. **`rith-issue-review-full` is misclassified** — already fully migrated to
   skills, generic enough for any project, but buried in `maintainer/`.

## Success Criteria

- [ ] All 13 maintainer command files deleted
- [ ] `rith-validate-pr.yaml` deleted
- [ ] `rith-issue-review-full.yaml` promoted to `.rith/workflows/defaults/`
- [ ] `.rith/maintainer/` directory removed entirely
- [ ] `bun run validate` passes

## Affected Packages

None — purely `.rith/` content changes. No TypeScript modifications.

## Architecture Notes

### Why delete `rith-validate-pr` instead of fixing it

The workflow's design premise was: start the app on main, reproduce the bug
in a browser, then start the app on feature, verify it's fixed. That premise
requires `@rith/server`, `@rith/web`, and `agent-browser` — all removed.

What survives (4 nodes) is:
1. `fetch-pr` — `gh pr view` (one bash command)
2. `code-review-main` — "confirm bug exists on main" (code review)
3. `code-review-feature` — "verify fix is correct" (code review)
4. `final-report` — synthesize verdict

This is `rith-smart-pr-review` minus the 5 parallel review dimensions plus
a before/after comparison. The before/after pattern can be added to
`rith-smart-pr-review` as a prompt variation if ever needed — it does not
justify maintaining a separate broken workflow with 13 command files.

### `rith-issue-review-full` promotion

Already uses `skills:` for all 12 nodes. Pipeline: investigate → fix →
review scope → parallel review (5 dimensions) → synthesize → implement
fixes → summary. Generic enough for any project. Move to production defaults.

## Implementation Tasks

### Task 1: Delete all 13 maintainer command files and the directory
**Files:** `.rith/maintainer/commands/`
**Type:** Delete
**Description:** Remove all command files and the directory. 8 are orphaned
(not referenced). 5 are broken (not in resolver search path) and reference
dead infrastructure.
**Depends on:** none

### Task 2: Delete `rith-validate-pr.yaml`
**File:** `.rith/maintainer/workflows/rith-validate-pr.yaml`
**Type:** Delete
**Description:** 60% dead nodes (server/browser/port infrastructure). 40%
surviving value is redundant with `rith-smart-pr-review`. Not fixable without
rebuilding from scratch, and the rebuild would just be a worse version of an
existing workflow.
**Depends on:** none

### Task 3: Promote `rith-issue-review-full.yaml` to production defaults
**File:** `.rith/maintainer/workflows/rith-issue-review-full.yaml`
**Type:** Move → `.rith/workflows/defaults/rith-issue-review-full.yaml`
**Description:** Already fully migrated to skills. Generic issue→fix→review
pipeline applicable to any project. Should be a production default, not
hidden in maintainer/.
**Depends on:** none

### Task 4: Remove `.rith/maintainer/` directory
**Type:** Delete
**Description:** After Tasks 1-3, the directory is empty. Remove it.
**Depends on:** Tasks 1, 2, 3

### Task 5: Verify clean state
**Type:** Verify
**Description:** Confirm:
- Zero `command:` references in any workflow YAML under `.rith/workflows/`
- No references to deleted command names
- `rith-issue-review-full.yaml` discoverable in defaults
- No `.rith/maintainer/` directory
**Depends on:** Task 4

## Validation Steps

1. `grep -rn "command:" .rith/workflows/ 2>/dev/null` — zero matches
2. `test -d .rith/maintainer && echo FAIL || echo PASS` — PASS
3. `test -f .rith/workflows/defaults/rith-issue-review-full.yaml && echo PASS` — PASS
4. `ls .rith/workflows/defaults/*.yaml | wc -l` — 16 (was 15, +1 promoted)
5. `bun run validate` — passes

## Rollback Notes

Content-only changes. `git revert` restores everything. No runtime, schema,
or interface modifications.

## Out of Scope

- Adding before/after comparison mode to `rith-smart-pr-review` (future if needed)
- Claude-specific content cleanup in skill bodies (Appendix A — separate PR)
- Workflow composition primitive
- Deprecating `command:` from schema/runtime
