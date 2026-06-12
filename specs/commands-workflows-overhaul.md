# Plan: Commands & Workflows Overhaul — Skills Migration + Cleanup

## Overview

Audit and restructure the 36 bundled commands and 20 bundled workflows shipped with Rith
Engine. Kill the `command:` indirection, migrate reusable methodology into skills, inline
trivial prompts, separate test/maintainer artifacts from production, purge all Claude Code /
Archon / dead-package references, and replace the bundled-defaults-as-code pattern with
installer-managed files on disk.

## Problem

1. **Commands are a fake primitive.** `command:` just inlines a markdown file as the prompt.
   Skills do this better — `SKILL.md` + assets, composable, on-demand loading.

2. **Claude Code assumptions baked in.** 13 commands and 15 workflows reference `CLAUDE.md`,
   `Claude Code capabilities`, `TodoWrite`, or `subagent_type="Explore"`. Rith uses Pi
   Coding Agent — these are confusing at best, harmful at worst.

3. **Dead package references.** `rith-create-issue.yaml` references `@rith/web`,
   `@rith/server`, `@rith/adapters`, `bun run dev:server`, PostgreSQL, Slack/Telegram/
   Discord — all removed. `rith-interactive-prd.yaml` references `packages/server/src/routes/`.

4. **Test/maintainer mixed with production.** E2E smoke tests and maintainer workflows live
   alongside production defaults with no separation.

5. **Massive prompt bloat.** 11 commands exceed 400 lines. Same git patterns, package manager
   detection, and commit hygiene copy-pasted across 5+ commands.

6. **136KB generated TypeScript file.** `bundled-defaults.generated.ts` bakes 56 files as
   escaped string literals into the binary. Skills (with multi-file assets) can't work this
   way. The whole approach should be replaced with installer-managed files on disk.

## Core Design Decision: Files on Disk, Not Strings in Binary

**Before:** The binary bakes commands and workflows as string literals into
`bundled-defaults.generated.ts`. Runtime resolves from the compiled map when disk files
aren't found.

**After:** The installer (`install.sh`, `brew`, `curl | sh`) installs skills and workflows
as regular files to `~/.rith/`. The runtime reads from disk. No generated code, no in-memory
maps, no `isBinaryBuild()` branching.

```
~/.rith/
  rith.db                       # runtime data (already exists)
  config.yaml                   # user config (already exists)
  skills/                       # installed by installer, read by Pi
    rith-git/SKILL.md
    rith-implement/SKILL.md
    rith-implement/package-managers.md
    rith-plan/SKILL.md
    rith-plan/plan-template.md
    rith-review/SKILL.md
    rith-review/review-dimensions.md
    rith-ralph/SKILL.md
    rith-ralph/prd-template.md
    rith-ralph/prd-json-schema.md
    rith-validate/SKILL.md
  workflows/                    # installed by installer, discovered by runtime
    rith-assist.yaml
    rith-plan-to-pr.yaml
    ...15 production workflows
```

**Resolution order** (first match wins):

1. `.rith/` (project-local) — user's customizations and overrides
2. `~/.rith/` (user-global) — installed defaults
3. `.claude/skills/`, `~/.claude/skills/` — Claude/Pi convention (keep for compat)
4. `.agents/skills/`, `~/.agents/skills/` — agentskills.io standard (keep for compat)

**What gets killed:**

- `bundled-defaults.generated.ts` (136KB)
- `scripts/generate-bundled-defaults.ts`
- `scripts/check-bundled-skill.ts`
- `isBinaryBuild()` function and all its branching
- `BUNDLED_COMMANDS`, `BUNDLED_WORKFLOWS` maps
- `generate:bundled`, `check:bundled`, `check:bundled-skill` npm scripts
- The `bun run validate` dependency on `check:bundled`

**What replaces it:**

- A `dist/content/` directory in the build output containing the raw files
- The installer copies `dist/content/skills/` → `~/.rith/skills/` and
  `dist/content/workflows/` → `~/.rith/workflows/`
- On upgrade, the installer overwrites installed defaults (user's project-local `.rith/`
  is never touched)

## Success Criteria

- [ ] Zero `command:` node references in any production workflow
- [ ] Zero references to `CLAUDE.md`, `Claude Code`, `TodoWrite`, or `subagent_type`
- [ ] Zero references to removed packages, PostgreSQL, or Slack/Telegram/Discord
- [ ] Test workflows in `.rith/workflows/e2e/`
- [ ] Maintainer artifacts in `.rith/maintainer/` (repo-only, not bundled)
- [ ] 6 skills created in `.rith/skills/`
- [ ] `bundled-defaults.generated.ts` deleted
- [ ] Skill resolution searches `~/.rith/skills/` and `.rith/skills/`
- [ ] `bun run validate` passes (updated to skip deleted bundled checks)
- [ ] `shared/` directory in `@rith/pi` flattened (vestigial from multi-provider era)

## Scope

**In:** Audit, classify, migrate commands → skills, restructure directories, update
installers, kill bundled-defaults codegen, update skill/workflow resolution, purge
Claude-isms and dead refs.

**Out:** Deprecating `command:` node type in schema/runtime (leave functional, just unused
in defaults). Rewriting workflow DAG topology. Adding new workflows.

---

## Inventory & Classification

### Commands (36 defaults) → Disposition

#### DELETE — 3 orphaned

| Command                  | Reason                                                 |
| ------------------------ | ------------------------------------------------------ |
| `rith-auto-fix-review`   | Not referenced by any workflow                         |
| `rith-post-review-to-pr` | Not referenced by any workflow                         |
| `rith-ralph-prd`         | Orphaned — `rith-ralph-dag` uses `rith-ralph-generate` |

#### BECOME SKILLS — 18 commands → 6 skills

**`rith-git`** (from: `rith-create-pr`, `rith-finalize-pr`, `rith-sync-pr-with-main`,
`rith-resolve-merge-conflicts`)

- Worktree detection, branch strategy, selective staging, commit format, PR creation

**`rith-implement`** (from: `rith-implement`, `rith-implement-tasks`, `rith-fix-issue`,
`rith-implement-issue`)

- Validation loops, fix-before-proceed, plan adherence, dependency detection
- Asset: `package-managers.md`

**`rith-plan`** (from: `rith-create-plan`, `rith-plan-setup`, `rith-confirm-plan`)

- Codebase-first research, primitives inventory, phase checkpoints
- Asset: `plan-template.md` (kill the ASCII box art)

**`rith-review`** (from: `rith-code-review-agent`, `rith-error-handling-agent`,
`rith-test-coverage-agent`, `rith-comment-quality-agent`, `rith-docs-impact-agent`,
`rith-pr-review-scope`, `rith-synthesize-review`, `rith-implement-review-fixes`)

- 5 review dimensions as a single reference doc, not 5 command files
- Asset: `review-dimensions.md`

**`rith-ralph`** (from: `rith-ralph-generate`)

- PRD structure, story decomposition, progress tracking
- Assets: `prd-template.md`, `prd-json-schema.md`

**`rith-validate`** (from: `rith-validate`, validation sections of other commands)

- Type-check → lint → format → test sequence, failure handling

#### INLINE INTO WORKFLOWS — 15 commands (too small for a skill)

`rith-assist`, `rith-self-fix-all`, `rith-simplify-changes`, `rith-issue-completion-report`,
`rith-workflow-summary`, `rith-web-research`, `rith-validate-pr-code-review-feature`,
`rith-validate-pr-code-review-main`, `rith-validate-pr-e2e-feature`,
`rith-validate-pr-e2e-main`, `rith-validate-pr-report`, `rith-investigate-issue`,
`rith-implement-review-fixes`, `rith-auto-fix-review`, `rith-post-review-to-pr`

Each becomes a `prompt:` + `skills:` node in its parent workflow.

### Workflows (20 defaults) → Disposition

#### PRODUCTION — 15 (stay in `.rith/workflows/defaults/`)

`rith-assist`, `rith-plan-to-pr`, `rith-idea-to-pr`, `rith-fix-github-issue`,
`rith-feature-development`, `rith-piv-loop`, `rith-adversarial-dev`, `rith-refactor-safely`,
`rith-architect`, `rith-interactive-prd`, `rith-ralph-dag`, `rith-smart-pr-review`,
`rith-workflow-builder`, `rith-create-issue`, `rith-remotion-generate`

#### MOVE TO `.rith/workflows/e2e/` — 5

`e2e-opencode-all-nodes-smoke`, `e2e-opencode-inline-multi-agents`, `e2e-opencode-smoke`,
`rith-test-pi`, `rith-test-loop-dag`

#### MOVE TO `.rith/maintainer/` (repo-only, not installed) — 3

`rith-validate-pr`, `rith-issue-review-full`, `rith-comprehensive-pr-review`

Plus 8 maintainer commands → `.rith/maintainer/commands/`

#### DELETE — 2

`rith-resolve-conflicts` (15 lines, just calls a command — inline instead),
`rith-comprehensive-pr-review` (subset of `rith-smart-pr-review`)

---

## Implementation Tasks

### Phase 1: Housekeeping — move and delete

#### Task 1: Create directory structure

**Type:** Create

```
.rith/skills/
.rith/workflows/e2e/
.rith/workflows/e2e/commands/
.rith/maintainer/commands/
.rith/maintainer/workflows/
```

#### Task 2: Move test workflows to e2e

**Type:** Move
Move 4 e2e yamls from `.rith/workflows/` → `.rith/workflows/e2e/`.
Move `rith-test-loop-dag.yaml` from `.rith/workflows/defaults/` → `.rith/workflows/e2e/`.
Move `e2e-echo-command.md` from `.rith/commands/` → `.rith/workflows/e2e/commands/`.

#### Task 3: Move maintainer artifacts

**Type:** Move
Move `maintainer-*.md` from `.rith/commands/` → `.rith/maintainer/commands/`.
Move `rith-validate-pr.yaml`, `rith-issue-review-full.yaml` from
`.rith/workflows/defaults/` → `.rith/maintainer/workflows/`.

#### Task 4: Delete orphaned and redundant files

**Type:** Delete
Commands: `rith-auto-fix-review.md`, `rith-post-review-to-pr.md`, `rith-ralph-prd.md`.
Workflows: `rith-resolve-conflicts.yaml`, `rith-comprehensive-pr-review.yaml`.

### Phase 2: Create skills

#### Task 5: Create `rith-git` skill

`.rith/skills/rith-git/SKILL.md`
Extract shared git patterns from 4+ commands. Conventions and guardrails, not scripts.

#### Task 6: Create `rith-implement` skill

`.rith/skills/rith-implement/SKILL.md` + `package-managers.md`
Implementation methodology: validation loops, dependency detection.

#### Task 7: Create `rith-plan` skill

`.rith/skills/rith-plan/SKILL.md` + `plan-template.md`
Planning methodology. Kill the ASCII box art.

#### Task 8: Create `rith-review` skill

`.rith/skills/rith-review/SKILL.md` + `review-dimensions.md`
Collapse 8 commands into one skill with 5 review dimensions as an asset.

#### Task 9: Create `rith-ralph` skill

`.rith/skills/rith-ralph/SKILL.md` + `prd-template.md` + `prd-json-schema.md`

#### Task 10: Create `rith-validate` skill

`.rith/skills/rith-validate/SKILL.md`
Validation sequence and failure handling.

### Phase 3: Migrate workflows (command → prompt + skills)

#### Task 11: Migrate simple workflows

`rith-assist`, `rith-feature-development` — trivial inlining.

#### Task 12: Migrate plan-to-pr family

`rith-plan-to-pr`, `rith-idea-to-pr` — replace `command:` refs with `skills:` + `prompt:`.

#### Task 13: Migrate review workflows

`rith-smart-pr-review` — replace 5 review command refs with `skills: [rith-review]`.

#### Task 14: Migrate issue workflows

`rith-fix-github-issue` — replace command refs, purge dead package refs.

#### Task 15: Migrate complex workflows

`rith-piv-loop`, `rith-adversarial-dev`, `rith-refactor-safely` — largest migrations.

#### Task 16: Migrate `rith-ralph-dag`

Replace `command: rith-ralph-generate` with `skills: [rith-ralph]` + prompt.

#### Task 17: Rewrite `rith-create-issue.yaml`

**Major.** Purge all dead refs: `@rith/web`, `@rith/server`, `@rith/adapters`, `web-ui`/
`api-server`/`adapters` areas, server startup, `remote_agent_*` tables, PostgreSQL,
Slack/Telegram/Discord. Simplify areas to: `cli`, `isolation`, `workflows`, `database`,
`core`, `pi`, `other`.

#### Task 18: Fix remaining workflows

`rith-interactive-prd` (purge `packages/server/` refs), `rith-architect` (minimal),
`rith-workflow-builder` (fix bare model name), `rith-remotion-generate` (already clean).

#### Task 19: Purge Claude-isms across all files

Global pass: replace `CLAUDE.md` → project rules/conventions, `Claude Code capabilities` →
agent capabilities, `TodoWrite` → todo tracking, `subagent_type="Explore"` → read-only
subagent. Verify zero matches.

### Phase 4: Kill bundled-defaults codegen, update runtime

#### Task 20: Flatten `packages/pi/src/shared/` → `packages/pi/src/`

Move `skills.ts` → `packages/pi/src/skills.ts`, `structured-output.ts` →
`packages/pi/src/structured-output.ts`. Update all imports. Delete `shared/` directory.
Pure rename, zero behavior change.

#### Task 21: Add `.rith/skills/` and `~/.rith/skills/` to skill resolution

**File:** `packages/pi/src/skills.ts` (after flatten)
Add two new search roots to `skillSearchRoots()`:

```typescript
join(cwd, '.rith', 'skills'),   // project-local rith skills
join(home, '.rith', 'skills'),  // user-global installed defaults
```

These go **first** in the search order (rith-native paths before claude/agents compat).

#### Task 22: Add `~/.rith/workflows/` to workflow discovery

**File:** `packages/workflows/src/workflow-discovery.ts`
Add `~/.rith/workflows/` as a search location alongside the existing project-local
`.rith/workflows/defaults/` path. User-global installed workflows are the fallback when
no project-local override exists.

#### Task 23: Add `.rith/skills/` to validator

**File:** `packages/workflows/src/validator.ts`
Add `.rith/skills/` (project) and `~/.rith/skills/` (user-global) to the skill existence
check, matching the resolution order in Task 21.

#### Task 24: Delete bundled-defaults infrastructure

- Delete `packages/workflows/src/defaults/bundled-defaults.generated.ts` (136KB)
- Delete `scripts/generate-bundled-defaults.ts`
- Delete `scripts/check-bundled-skill.ts`
- Remove `generate:bundled`, `check:bundled`, `check:bundled-skill` from `package.json`
- Remove `check:bundled` from the `validate` script
- Remove `isBinaryBuild()` and all references
- Update `workflow-discovery.ts` to remove `BUNDLED_WORKFLOWS` fallback
- Update `executor-shared.ts` to remove `BUNDLED_COMMANDS` fallback
- Update `validator.ts` to remove `BUNDLED_COMMANDS` check

#### Task 25: Delete emptied commands directory

After all migrations, delete remaining files from `.rith/commands/defaults/` and clean up.

#### Task 26: Update installer scripts

**Files:** `scripts/install.sh`, `scripts/install.ps1`, `scripts/build-binaries.sh`
Add steps to:

- Package `.rith/skills/` and `.rith/workflows/defaults/` into the distribution
- Install them to `~/.rith/skills/` and `~/.rith/workflows/` on install
- Overwrite on upgrade (these are defaults, not user config)

### Phase 5: Validation

#### Task 27: Update validate script

Remove `check:bundled` and `check:bundled-skill` from `bun run validate`.

#### Task 28: Run full validation

`bun run validate` — type-check, lint, format, tests all pass.

#### Task 29: Verify resolution

`bun run cli workflow list` — all 15 production workflows visible.
Smoke test one migrated workflow to confirm skills load.

#### Task 30: Verify zero contamination

```bash
grep -r "CLAUDE.md\|Claude Code\|TodoWrite\|subagent_type" .rith/skills/ .rith/workflows/defaults/
grep -r "@rith/web\|@rith/server\|@rith/adapters\|remote_agent_\|psql\|PostgreSQL" .rith/workflows/defaults/
```

Zero matches.

---

## Risks

| Risk                                                        | Mitigation                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Workflow behavior changes from prompt rewording             | Keep core instruction content, just remove scaffolding                          |
| Pi skill loading doesn't pick up assets                     | Already works — Pi reads the directory, not just SKILL.md                       |
| Installer changes break existing installs                   | Additive only — new dirs, no removal of existing files                          |
| Runtime can't find workflows after bundled-defaults removal | Task 22 adds `~/.rith/workflows/` discovery before Task 24 deletes the old path |

## Rollback

All changes are prompt text, YAML, file locations, and one 136KB generated file deletion.
No schema migrations, no runtime behavior changes, no interface changes. `git revert`
restores previous state. The `command:` node type remains functional.
