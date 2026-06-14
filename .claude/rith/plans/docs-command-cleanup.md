# Plan: Documentation Command Cleanup

## Overview

Remove all references to the deleted `command:` node type, `.rith/commands/`
directories, and `commands.folder` config from documentation, CLAUDE.md, and
README. Also fix stale workflow lists and architecture diagrams that reference
dead infrastructure (Web UI, PostgreSQL, Command Handler, Codex).

## Success Criteria

- [ ] `grep -rn "\.rith/commands" packages/docs-web/ CLAUDE.md README.md` — zero matches
- [ ] `grep -rn "commands:" packages/docs-web/ CLAUDE.md README.md` — zero matches
      (except natural-language "CLI commands" usage)
- [ ] `grep -rn "validate commands" packages/docs-web/ CLAUDE.md` — zero matches
- [ ] Workflow tables match actual `.rith/workflows/defaults/` contents
- [ ] Architecture diagrams reflect current state (no Web UI, PostgreSQL, Codex)
- [ ] `bun run validate` passes

## Affected Packages

- `@rith/docs-web` — 3 docs pages with stale command content
- Root — `CLAUDE.md`, `README.md`
- No TypeScript changes

## Implementation Tasks

### Task 1: Update `new-developer-guide.md`
**File:** `packages/docs-web/src/content/docs/contributing/new-developer-guide.md`
**Type:** Modify
**Description:** 4 stale sections:

1. **Lines 170-202** — "How Workflows Work" diagram uses `command: investigate-issue`
   and `command: implement-issue`. Replace with `skills: [rith-investigate-issue]` and
   `skills: [rith-fix-issue]`. Change "Each command is a markdown file" →
   "Each skill is a reusable SOP loaded from `.rith/skills/`". Update the
   execution flow boxes from `investigate-issue.md` → `rith-investigate-issue skill`.

2. **Lines 452-456** — Config hierarchy diagram shows
   `commands: { folder: .rith/commands/custom }`. Remove the commands line.

3. **Lines 478-483** — Directory structure shows `commands/` with `.md` files.
   Replace with `skills/` referencing skill directories.

4. **Line 568** — Next Steps: `.rith/commands/` → `.rith/skills/`

**Depends on:** none

### Task 2: Update `overview.md`
**File:** `packages/docs-web/src/content/docs/getting-started/overview.md`
**Type:** Modify
**Description:** 4 stale sections:

1. **Line 216** — CLI table: `rith validate commands [name]` → delete row
   (command validation no longer exists).

2. **Lines 240-253** — Workflow table: remove 4 deleted workflows
   (`rith-comprehensive-pr-review`, `rith-validate-pr`,
   `rith-resolve-conflicts`, `rith-test-loop-dag`). Add
   `rith-issue-review-full` and `rith-workflow-builder`. Update descriptions
   to match current reality.

3. **Lines 266-270** — Directory structure: `.rith/commands/` →
   `.rith/skills/`.

4. **Lines 275-279** — Example config: remove `commands:` block.

**Depends on:** none

### Task 3: Update `releasing.md`
**File:** `packages/docs-web/src/content/docs/contributing/releasing.md`
**Type:** Modify
**Description:** Line 18: "new commands" in minor release description →
"new skills".
**Depends on:** none

### Task 4: Update `README.md`
**File:** `README.md`
**Type:** Modify
**Description:** 2 stale sections:

1. **Line 73** — `Per-repo commands: .rith/commands/` → replace with
   `Per-repo skills: .rith/skills/`

2. **Lines 80-97** — Architecture diagram: remove "Web UI", "Command Handler",
   "Codex", "PostgreSQL". Update to reflect current architecture:
   CLI → Orchestrator → Workflow Executor → AI Provider (Pi) → SQLite

**Depends on:** none

### Task 5: Update `CLAUDE.md`
**File:** `CLAUDE.md`
**Type:** Modify
**Description:** 7 stale references:

1. **Line 111** — `bun test packages/core/src/handlers/command-handler.test.ts`
   → use a valid example file path

2. **Lines 218-220** — `Validate command files` section → delete entirely

3. **Line 283** — `validator.ts` description: "command files, MCP configs,
   skill dirs" → "MCP configs, skill dirs"

4. **Line 284** — `defaults/` description: "Bundled default commands and
   workflows" → delete line (directory no longer exists)

5. **Line 342** — codebases table: "Repository metadata and commands (JSONB)"
   → "Repository metadata (JSONB)"

6. **Lines 438-439** — directory structure: `commands/` line → replace with
   `skills/` showing skill directories

7. **Line 348** — codebase_env_vars: "injected into workflow commands" →
   "injected into workflow nodes"

**Depends on:** none

## Validation Steps

1. `grep -rn "\.rith/commands\|validate commands\|commands:.*folder\|loadDefaultCommands" packages/docs-web/ CLAUDE.md README.md` — zero matches
2. `bun run validate` — passes

## Rollback Notes

Documentation-only. `git revert` restores all files.
