# Plan: Commands & Workflows Overhaul — 1:1 Skill Migration + Cleanup

## Overview

Convert all 36 bundled commands and 8 maintainer commands into individual skills
following the agentskills.io specification. Kill the `command:` indirection in all
workflow YAML files. Separate test/maintainer artifacts from production. Replace
the bundled-defaults-as-code pattern with installer-managed files on disk.

## Lessons From First Attempt (READ THIS FIRST)

The first attempt collapsed 21 commands into 6 "methodology guide" skills. This
was wrong in three ways:

1. **Skills ARE procedures, not abstractions.** A command's `.md` body is
   step-by-step instructions the agent executes (phases, bash snippets, output
   templates, checklists). A skill's `SKILL.md` body serves the identical role.
   The conversion is a file move + front matter addition, NOT a rewrite into a
   high-level reference document. The first attempt produced 100-200 line
   "methodology guides" that replaced 300-700 line step-by-step procedures —
   the agent lost the actual instructions.

2. **Independent procedures must not be collapsed.** "Create a PR" and "resolve
   merge conflicts" are completely different SOPs with different phases, inputs,
   and outputs. They share git conventions but are independently useful. Same
   for each review dimension agent — they run as separate parallel DAG nodes.
   Collapsing them lost procedural specificity and made the skills convoluted.

3. **"Too small for a skill" was wrong for most commands.** The original plan
   classified 15 commands as "inline into workflows." But 12 of those 15 are
   4-15KB multi-phase SOPs. Inlining a 15KB procedure into a YAML `prompt:`
   field is strictly worse — unreadable, unmaintainable, not reusable. Only
   `rith-assist` (811B, "you are a helpful assistant") is genuinely trivial.

### The correct mapping

```
COMMAND FILE                              SKILL DIRECTORY
────────────                              ───────────────
.rith/commands/defaults/rith-foo.md  →    .rith/skills/rith-foo/SKILL.md

Command front matter:                     Skill front matter (agentskills.io):
  ---                                       ---
  description: <what>                       name: rith-foo
  argument-hint: <args>                     description: |
  ---                                         <what>. Use when <context>.
                                              Triggers: "kw1", "kw2".
                                            metadata:
                                              author: rith-engine
                                              version: "1.0"
                                            ---

Command body:                             Skill body:
  # Heading                                 (SAME procedural content)
  ## Phase 1: LOAD                          (phases, bash, templates preserved)
  ## Phase 2: ANALYZE                       (only strip Claude-isms, dead refs)
  ...                                       (extract large templates to assets/)
```

## Problem

1. **Commands are a fake primitive.** `command:` just inlines a markdown file as
   the prompt. Skills do this better — `SKILL.md` + assets, composable,
   on-demand loading, discoverable via agentskills.io standard.

2. **Claude Code assumptions baked in.** 16 commands reference `CLAUDE.md`,
   `Claude Code`, `TodoWrite`, or `subagent_type="Explore"`. Rith uses Pi
   Coding Agent — these are confusing at best, harmful at worst.

3. **Dead package references.** `rith-create-issue.yaml` references `@rith/web`,
   `@rith/server`, `@rith/adapters`, `bun run dev:server`, PostgreSQL, Slack/
   Telegram/Discord — all removed.

4. **Test/maintainer mixed with production.** E2E smoke tests and maintainer
   workflows live alongside production defaults with no separation.

5. **136KB generated TypeScript file.** `bundled-defaults.generated.ts` bakes 56
   files as escaped string literals into the binary. Skills (with multi-file
   assets) can't work this way.

## Scope

**In scope:**

- Convert every command to an individual skill (1:1)
- Add agentskills.io YAML front matter to every SKILL.md
- Move test workflows to `.rith/workflows/e2e/`
- Move maintainer artifacts to `.rith/maintainer/`
- Kill bundled-defaults codegen
- Update skill/workflow resolution to search `.rith/skills/`
- Update all workflow YAML to use `skills:` instead of `command:`
- Purge dead package references from workflows

**Deferred to follow-up PR (separate concern):**

- Claude-specific content cleanup (CLAUDE.md compliance sections, subagent_type,
  TodoWrite). This requires judgment calls per command — output format
  restructuring, not just string substitution. See Appendix A for full inventory.

**Out of scope:**

- Deprecating `command:` node type in schema/runtime (leave functional, just
  unused in defaults)
- Rewriting workflow DAG topology
- Adding new workflows

---

## Complete Command Inventory & Disposition

### DELETE — 3 orphaned commands

| Command                  | Lines | Reason                                                 |
| ------------------------ | ----- | ------------------------------------------------------ |
| `rith-auto-fix-review`   | 390   | Not referenced by any workflow                         |
| `rith-post-review-to-pr` | 199   | Not referenced by any workflow                         |
| `rith-ralph-prd`         | 415   | Orphaned — `rith-ralph-dag` uses `rith-ralph-generate` |

### BECOME INDIVIDUAL SKILLS — 32 commands → 32 skills

Every command below becomes its own skill directory. The SKILL.md body is the
command's procedural content with front matter added. No collapsing.

#### Git Operations (4 skills)

| Command                        | Lines | Phases | Skill Name                     | Description                                               |
| ------------------------------ | ----- | ------ | ------------------------------ | --------------------------------------------------------- |
| `rith-create-pr`               | 238   | 4      | `rith-create-pr`               | Create PR from current branch with implementation context |
| `rith-finalize-pr`             | 419   | 5      | `rith-finalize-pr`             | Selective stage, commit, create/update PR, mark ready     |
| `rith-sync-pr-with-main`       | 416   | 7      | `rith-sync-pr-with-main`       | Sync PR branch with main via rebase                       |
| `rith-resolve-merge-conflicts` | 506   | 7      | `rith-resolve-merge-conflicts` | Analyze and resolve merge conflicts                       |

#### Implementation (4 skills)

| Command                | Lines | Phases | Skill Name             | Description                                         |
| ---------------------- | ----- | ------ | ---------------------- | --------------------------------------------------- |
| `rith-implement`       | 505   | 7      | `rith-implement`       | Execute implementation plan with validation loops   |
| `rith-implement-tasks` | 392   | 5      | `rith-implement-tasks` | Execute plan tasks with per-change type-checking    |
| `rith-fix-issue`       | 513   | 9      | `rith-fix-issue`       | Implement fix from investigation artifact (no PR)   |
| `rith-implement-issue` | 578   | 10     | `rith-implement-issue` | Implement fix from investigation + PR + self-review |

#### Planning (3 skills)

| Command             | Lines | Phases | Skill Name          | Description                                            |
| ------------------- | ----- | ------ | ------------------- | ------------------------------------------------------ |
| `rith-create-plan`  | 704   | 9      | `rith-create-plan`  | Create implementation plan from codebase analysis      |
| `rith-plan-setup`   | 361   | 4      | `rith-plan-setup`   | Prepare for plan execution: read plan, branch, context |
| `rith-confirm-plan` | 343   | 6      | `rith-confirm-plan` | Verify plan research is still valid                    |

#### Code Review (8 skills)

| Command                       | Lines | Phases | Skill Name                    | Description                                                |
| ----------------------------- | ----- | ------ | ----------------------------- | ---------------------------------------------------------- |
| `rith-code-review-agent`      | 299   | 4      | `rith-code-review-agent`      | Code quality, convention compliance, bug detection         |
| `rith-error-handling-agent`   | 272   | 3      | `rith-error-handling-agent`   | Silent failures, error patterns, async correctness         |
| `rith-test-coverage-agent`    | 293   | 3      | `rith-test-coverage-agent`    | Test gaps, coverage quality, mock isolation                |
| `rith-comment-quality-agent`  | 266   | 3      | `rith-comment-quality-agent`  | Comment accuracy, rot risk, value assessment               |
| `rith-docs-impact-agent`      | 277   | 3      | `rith-docs-impact-agent`      | Missing/stale documentation detection                      |
| `rith-pr-review-scope`        | 534   | 6      | `rith-pr-review-scope`        | Gather PR context, verify reviewability, prepare artifacts |
| `rith-synthesize-review`      | 412   | 5      | `rith-synthesize-review`      | Aggregate findings, deduplicate, draft PR comment          |
| `rith-implement-review-fixes` | 473   | 7      | `rith-implement-review-fixes` | Fix CRITICAL/HIGH findings from review                     |

#### PRD & Research (2 skills)

| Command               | Lines | Phases | Skill Name            | Description                                       |
| --------------------- | ----- | ------ | --------------------- | ------------------------------------------------- |
| `rith-ralph-generate` | 423   | 7      | `rith-ralph-generate` | Autonomously generate PRD (prd.md + prd.json)     |
| `rith-web-research`   | 268   | 5      | `rith-web-research`   | Web research methodology with source verification |

#### Validation & Fixing (3 skills)

| Command                 | Lines | Phases | Skill Name              | Description                                       |
| ----------------------- | ----- | ------ | ----------------------- | ------------------------------------------------- |
| `rith-validate`         | 350   | 4      | `rith-validate`         | Full validation: type-check → lint → test → build |
| `rith-self-fix-all`     | 428   | 8      | `rith-self-fix-all`     | Iterative fix-and-validate loop until clean       |
| `rith-simplify-changes` | 121   | 0      | `rith-simplify-changes` | Simplify diff before final commit                 |

#### Investigation & Reporting (3 skills)

| Command                        | Lines | Phases | Skill Name                     | Description                                   |
| ------------------------------ | ----- | ------ | ------------------------------ | --------------------------------------------- |
| `rith-investigate-issue`       | 600   | 6      | `rith-investigate-issue`       | Root cause analysis with codebase exploration |
| `rith-issue-completion-report` | 340   | 5      | `rith-issue-completion-report` | Issue closure report with verification        |
| `rith-workflow-summary`        | 514   | 7      | `rith-workflow-summary`        | Structured workflow execution report          |

#### Maintainer PR Validation (5 skills)

| Command                                | Lines | Phases | Skill Name                             | Description                               |
| -------------------------------------- | ----- | ------ | -------------------------------------- | ----------------------------------------- |
| `rith-validate-pr-code-review-main`    | 163   | 3      | `rith-validate-pr-code-review-main`    | Code review of main branch (bug present)  |
| `rith-validate-pr-code-review-feature` | 202   | 3      | `rith-validate-pr-code-review-feature` | Code review of feature branch (bug fixed) |
| `rith-validate-pr-e2e-main`            | 361   | 4      | `rith-validate-pr-e2e-main`            | E2E test on main branch                   |
| `rith-validate-pr-e2e-feature`         | 357   | 5      | `rith-validate-pr-e2e-feature`         | E2E test on feature branch                |
| `rith-validate-pr-report`              | 232   | 3      | `rith-validate-pr-report`              | Final validation verdict report           |

### INLINE — 1 command (genuinely trivial)

| Command       | Lines | Reason                                                 |
| ------------- | ----- | ------------------------------------------------------ |
| `rith-assist` | 35    | 811 bytes, just "you are a helpful assistant" — no SOP |

### Maintainer Commands — 8 commands → 8 skills

| Command                             | Lines | Skill Name                               |
| ----------------------------------- | ----- | ---------------------------------------- |
| `maintainer-review-code-review`     | 138   | `rith-maintainer-review-code-review`     |
| `maintainer-review-comment-quality` | 108   | `rith-maintainer-review-comment-quality` |
| `maintainer-review-docs-impact`     | 131   | `rith-maintainer-review-docs-impact`     |
| `maintainer-review-error-handling`  | 106   | `rith-maintainer-review-error-handling`  |
| `maintainer-review-report`          | 65    | `rith-maintainer-review-report`          |
| `maintainer-review-synthesize`      | 166   | `rith-maintainer-review-synthesize`      |
| `maintainer-review-test-coverage`   | 115   | `rith-maintainer-review-test-coverage`   |
| `maintainer-standup`                | 254   | `rith-maintainer-standup`                |

---

## Workflow Inventory & Disposition

### Production — 15 workflows (stay in `.rith/workflows/defaults/`)

`rith-assist`, `rith-plan-to-pr`, `rith-idea-to-pr`, `rith-fix-github-issue`,
`rith-feature-development`, `rith-piv-loop`, `rith-adversarial-dev`,
`rith-refactor-safely`, `rith-architect`, `rith-interactive-prd`,
`rith-ralph-dag`, `rith-smart-pr-review`, `rith-workflow-builder`,
`rith-create-issue`, `rith-remotion-generate`

All `command:` references replaced with `skills:` references. Each workflow node
that previously had `command: rith-foo` becomes `skills: [rith-foo]`. The
`prompt:` field, if present, contains only node-specific context (e.g., "this is
PR #$PR_NUMBER"), NOT the procedural instructions (those are in the skill).

### Move to `.rith/workflows/e2e/` — 5 test workflows

`e2e-opencode-all-nodes-smoke`, `e2e-opencode-inline-multi-agents`,
`e2e-opencode-smoke`, `rith-test-pi`, `rith-test-loop-dag`

Also move `e2e-echo-command.md` to `.rith/workflows/e2e/commands/`.

### Move to `.rith/maintainer/workflows/` — 2 maintainer workflows

`rith-validate-pr`, `rith-issue-review-full`

These also need `command:` → `skills:` conversion.

### DELETE — 2 workflows

`rith-resolve-conflicts` (15 lines, just calls a command),
`rith-comprehensive-pr-review` (subset of `rith-smart-pr-review`)

---

## Core Design Decision: Files on Disk, Not Strings in Binary

**Before:** Binary bakes commands and workflows as string literals into
`bundled-defaults.generated.ts`. Runtime resolves from compiled map when disk
files aren't found.

**After:** Installer places skills and workflows as regular files to `~/.rith/`.
Runtime reads from disk. No generated code, no in-memory maps, no
`isBinaryBuild()` branching.

```
~/.rith/
  rith.db                       # runtime data (already exists)
  config.yaml                   # user config (already exists)
  skills/                       # installed by installer, discovered by runtime
    rith-create-pr/SKILL.md
    rith-finalize-pr/SKILL.md
    rith-code-review-agent/SKILL.md
    ... (32 production + 8 maintainer skills)
  workflows/                    # installed by installer, discovered by runtime
    rith-assist.yaml
    rith-plan-to-pr.yaml
    ... (15 production workflows)
```

**Resolution order** (first match wins):

1. `.rith/` (project-local) — user's customizations and overrides
2. `~/.rith/` (user-global) — installed defaults
3. `.claude/skills/`, `~/.claude/skills/` — Claude/Pi convention (compat)
4. `.agents/skills/`, `~/.agents/skills/` — agentskills.io standard (compat)

**What gets killed:**

- `bundled-defaults.generated.ts` (136KB)
- `scripts/generate-bundled-defaults.ts`
- `scripts/check-bundled-skill.ts`
- `isBinaryBuild()` function and all its branching
- `BUNDLED_COMMANDS`, `BUNDLED_WORKFLOWS` maps
- `generate:bundled`, `check:bundled`, `check:bundled-skill` npm scripts
- The `bun run validate` dependency on `check:bundled`

**What replaces it:**

- `dist/content/` directory in build output containing raw files
- Installer copies `dist/content/skills/` → `~/.rith/skills/` and
  `dist/content/workflows/` → `~/.rith/workflows/`
- On upgrade, installer overwrites defaults (user's project-local `.rith/`
  never touched)

---

## Implementation Tasks

### Phase 1: Housekeeping — move and delete

#### Task 1: Create directory structure

```
.rith/skills/                     # (32 + 8 skill directories created here)
.rith/workflows/e2e/
.rith/workflows/e2e/commands/
.rith/maintainer/workflows/
```

#### Task 2: Move test workflows to e2e

Move 4 e2e yamls from `.rith/workflows/` → `.rith/workflows/e2e/`.
Move `rith-test-loop-dag.yaml` from `.rith/workflows/defaults/` → `.rith/workflows/e2e/`.
Move `e2e-echo-command.md` from `.rith/commands/` → `.rith/workflows/e2e/commands/`.

#### Task 3: Move maintainer workflows

Move `rith-validate-pr.yaml`, `rith-issue-review-full.yaml` from
`.rith/workflows/defaults/` → `.rith/maintainer/workflows/`.

#### Task 4: Delete orphaned and redundant files

Commands: `rith-auto-fix-review.md`, `rith-post-review-to-pr.md`,
`rith-ralph-prd.md`.
Workflows: `rith-resolve-conflicts.yaml`, `rith-comprehensive-pr-review.yaml`.

### Phase 2: Convert commands to skills (1:1)

**CRITICAL:** Each command becomes its own skill. The SKILL.md body is the
command's procedural content — phases, bash snippets, output templates,
checklists — with YAML front matter added and Claude-isms deferred (see below).

#### Task 5: Convert git commands (4 skills)

Convert `rith-create-pr`, `rith-finalize-pr`, `rith-sync-pr-with-main`,
`rith-resolve-merge-conflicts` → individual skill directories.

Each gets:

- YAML front matter (name, description with triggers, metadata)
- Body = original command body (preserve all phases and detail)
- Large embedded templates → `assets/` subdirectory if applicable

#### Task 6: Convert implementation commands (4 skills)

Convert `rith-implement`, `rith-implement-tasks`, `rith-fix-issue`,
`rith-implement-issue` → individual skill directories.

#### Task 7: Convert planning commands (3 skills)

Convert `rith-create-plan`, `rith-plan-setup`, `rith-confirm-plan` →
individual skill directories.

`rith-create-plan` is 704 lines — extract the plan template section into
`assets/plan-template.md` and reference it from SKILL.md.

#### Task 8: Convert review commands (8 skills)

Convert all 8 review commands → individual skill directories.

Each review agent keeps its own output format template, phase structure, and
evaluation criteria intact.

#### Task 9: Convert PRD, research, validation, investigation commands (8 skills)

Convert: `rith-ralph-generate`, `rith-web-research`, `rith-validate`,
`rith-self-fix-all`, `rith-simplify-changes`, `rith-investigate-issue`,
`rith-issue-completion-report`, `rith-workflow-summary`.

#### Task 10: Convert maintainer PR validation commands (5 skills)

Convert: `rith-validate-pr-code-review-main`, `rith-validate-pr-code-review-feature`,
`rith-validate-pr-e2e-main`, `rith-validate-pr-e2e-feature`,
`rith-validate-pr-report`.

#### Task 11: Convert maintainer commands (8 skills)

Convert all 8 `maintainer-*.md` commands → individual skill directories under
`.rith/skills/rith-maintainer-*`.

#### Task 12: Delete old commands directory

After all conversions, delete `.rith/commands/defaults/` and all remaining
command files.

### Phase 3: Migrate workflows (command → skills reference)

**Key change from first attempt:** Workflow nodes that reference skills should
use `skills: [rith-specific-skill]` pointing to the exact skill for that node's
procedure. The `prompt:` field should contain ONLY node-specific context (PR
number, branch name, etc.), NOT the procedural instructions. The skill carries
the full procedure.

#### Task 13: Migrate simple workflows

`rith-assist` (inline the 811B prompt), `rith-feature-development`.

#### Task 14: Migrate plan-to-pr family

`rith-plan-to-pr`, `rith-idea-to-pr` — each node gets its specific skill:

- plan node → `skills: [rith-create-plan]`
- setup node → `skills: [rith-plan-setup]`
- confirm node → `skills: [rith-confirm-plan]`
- implement node → `skills: [rith-implement-tasks]`
- validate node → `skills: [rith-validate]`
- finalize node → `skills: [rith-finalize-pr]`
- review nodes → each gets its specific review skill
- etc.

#### Task 15: Migrate review workflows

`rith-smart-pr-review` — each review dimension node gets its own skill:

- code-review → `skills: [rith-code-review-agent]`
- error-handling → `skills: [rith-error-handling-agent]`
- test-coverage → `skills: [rith-test-coverage-agent]`
- comment-quality → `skills: [rith-comment-quality-agent]`
- docs-impact → `skills: [rith-docs-impact-agent]`
- scope → `skills: [rith-pr-review-scope]`
- synthesize → `skills: [rith-synthesize-review]`
- implement-fixes → `skills: [rith-implement-review-fixes]`

#### Task 16: Migrate issue workflows

`rith-fix-github-issue` — replace all command refs with specific skills.

#### Task 17: Migrate complex workflows

`rith-piv-loop`, `rith-adversarial-dev`, `rith-refactor-safely`.

#### Task 18: Migrate remaining workflows

`rith-ralph-dag`, `rith-create-issue` (purge dead refs), `rith-interactive-prd`
(purge `packages/server/` refs), `rith-architect`, `rith-workflow-builder`,
`rith-remotion-generate`.

#### Task 19: Migrate maintainer workflows

`rith-validate-pr`, `rith-issue-review-full` — convert `command:` refs to
`skills:` refs using the maintainer skill names.

### Phase 4: Kill bundled-defaults codegen, update runtime

#### Task 20: Flatten `packages/pi/src/shared/` → `packages/pi/src/`

Move `skills.ts`, `structured-output.ts`. Update all imports. Delete `shared/`.

#### Task 21: Add `.rith/skills/` to skill resolution

Add `cwd/.rith/skills/` and `~/.rith/skills/` as highest-priority search roots
in `skillSearchRoots()`.

#### Task 22: Add `~/.rith/workflows/` to workflow discovery

Add `~/.rith/workflows/` as search location for user-global installed workflows.

#### Task 23: Add `.rith/skills/` to validator

Update skill existence checks to match the resolution order in Task 21.

#### Task 24: Delete bundled-defaults infrastructure

- Delete `bundled-defaults.generated.ts`, `bundled-defaults.ts`, test, type defs
- Delete `scripts/generate-bundled-defaults.ts`, `scripts/check-bundled-skill.ts`
- Delete `packages/cli/src/bundled-skill.ts`
- Remove npm scripts: `generate:bundled`, `check:bundled`, `check:bundled-skill`
- Remove `check:bundled` from `validate` script
- Remove `isBinaryBuild()` and all `BUNDLED_COMMANDS`/`BUNDLED_WORKFLOWS` refs
- Update `workflow-discovery.ts`, `executor-shared.ts`, `validator.ts`
- Update `doctor.ts` checkBundledDefaults to use disk discovery

#### Task 25: Update installer scripts

`scripts/install.sh`, `scripts/install.ps1`, `scripts/build-binaries.sh`:

- Package `.rith/skills/` and `.rith/workflows/defaults/` into distribution
- Install to `~/.rith/skills/` and `~/.rith/workflows/` on install
- Overwrite on upgrade (defaults, not user config)

### Phase 5: Validation

#### Task 26: Run full validation

`bun run validate` — type-check, lint, format, tests all pass.

#### Task 27: Verify zero contamination

```bash
# Zero command: refs in production workflows
grep -r "command:" .rith/workflows/defaults/ | grep -v "^#"
# Zero dead package refs
grep -r "@rith/web\|@rith/server\|@rith/adapters" .rith/workflows/defaults/
```

#### Task 28: Verify skill count

```bash
ls -d .rith/skills/*/  # Should show 40 skill directories
```

---

## Success Criteria

- [ ] Zero `command:` references in any production or maintainer workflow
- [ ] Zero references to removed packages (`@rith/web`, `@rith/server`, etc.)
- [ ] 32 production skills + 8 maintainer skills in `.rith/skills/`
- [ ] Every SKILL.md has valid agentskills.io front matter (name, description)
- [ ] Every SKILL.md body preserves the original command's phases and detail
- [ ] Test workflows in `.rith/workflows/e2e/`
- [ ] Maintainer workflows in `.rith/maintainer/workflows/`
- [ ] `bundled-defaults.generated.ts` deleted
- [ ] Skill resolution searches `.rith/skills/` (project and home)
- [ ] `bun run validate` passes
- [ ] `shared/` directory in `@rith/pi` flattened

---

## Appendix A: Claude-Specific Content Inventory (Deferred to Follow-up PR)

16 of 36 commands contain Claude-specific content. This is deferred to a
separate PR because it requires per-command judgment, not mechanical conversion.

### Category 1: CLAUDE.md as project-rules file (13 commands)

These reference `CLAUDE.md` as a source of project conventions. The fix is:

- `cat CLAUDE.md` → discover whatever rules file exists
  (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`)
- "CLAUDE.md rules" → "project conventions"
- "CLAUDE.md Compliance" output section → "Project Conventions Compliance"

| Command                                | CLAUDE.md refs | Structural impact                                   |
| -------------------------------------- | -------------- | --------------------------------------------------- |
| `rith-code-review-agent`               | 13             | Has "CLAUDE.md Compliance" TABLE in output template |
| `rith-docs-impact-agent`               | 9              | References CLAUDE.md as doc source                  |
| `rith-pr-review-scope`                 | 6              | "Check for CLAUDE.md" phase step                    |
| `rith-validate-pr-code-review-feature` | 4              | CLAUDE.md in review criteria                        |
| `rith-create-plan`                     | 3              | "Read CLAUDE.md" phase step                         |
| `rith-simplify-changes`                | 3              | CLAUDE.md reference in review                       |
| `rith-workflow-summary`                | 3              | CLAUDE.md in summary context                        |
| `rith-error-handling-agent`            | 3              | CLAUDE.md in review criteria                        |
| `rith-ralph-generate`                  | 2              | CLAUDE.md in codebase exploration                   |
| `rith-validate-pr-report`              | 1              | CLAUDE.md in report context                         |
| 6 maintainer-review-\*                 | varies         | CLAUDE.md in review criteria                        |

### Category 2: Claude-specific tool/API references (5 commands)

| Command                       | Reference                      | Fix                             |
| ----------------------------- | ------------------------------ | ------------------------------- |
| `rith-create-plan`            | `subagent_type="Explore"` (2x) | → "use a read-only subagent"    |
| `rith-investigate-issue`      | `subagent_type="Explore"` (1x) | → "use a read-only subagent"    |
| `rith-ralph-generate`         | `subagent_type="Explore"` (1x) | → "use a read-only subagent"    |
| `rith-auto-fix-review`        | `TodoWrite` (1x)               | → "use todo tracking" (DELETED) |
| `rith-implement-review-fixes` | `TodoWrite` (1x)               | → "use todo tracking"           |

### Category 3: "Claude Code" brand references (3 commands)

| Command                        | Reference                       | Fix                    |
| ------------------------------ | ------------------------------- | ---------------------- |
| `rith-assist`                  | `Claude Code capabilities` (2x) | → "agent capabilities" |
| `rith-validate-pr-e2e-feature` | `Claude Code` (1x)              | → "coding agent"       |
| `rith-validate-pr-e2e-main`    | `Claude Code` (1x)              | → "coding agent"       |

### Category 4: Dead package references (3 commands)

| Command                        | Reference      | Fix    |
| ------------------------------ | -------------- | ------ |
| `rith-plan-setup`              | `Discord`      | Remove |
| `rith-validate-pr-e2e-feature` | `@rith/server` | Remove |
| `rith-validate-pr-e2e-main`    | `@rith/server` | Remove |

---

## Appendix B: Workflow → Skill Reference Map

Exact mapping of which skill each workflow node should reference after migration.

### rith-smart-pr-review (12 nodes)

| Node ID         | Old `command:`              | New `skills:`                 |
| --------------- | --------------------------- | ----------------------------- |
| scope           | rith-pr-review-scope        | [rith-pr-review-scope]        |
| sync            | rith-sync-pr-with-main      | [rith-sync-pr-with-main]      |
| code-review     | rith-code-review-agent      | [rith-code-review-agent]      |
| error-handling  | rith-error-handling-agent   | [rith-error-handling-agent]   |
| test-coverage   | rith-test-coverage-agent    | [rith-test-coverage-agent]    |
| comment-quality | rith-comment-quality-agent  | [rith-comment-quality-agent]  |
| docs-impact     | rith-docs-impact-agent      | [rith-docs-impact-agent]      |
| synthesize      | rith-synthesize-review      | [rith-synthesize-review]      |
| implement-fixes | rith-implement-review-fixes | [rith-implement-review-fixes] |

### rith-fix-github-issue (22 nodes with commands)

| Node ID         | Old `command:`               | New `skills:`                  |
| --------------- | ---------------------------- | ------------------------------ |
| research        | rith-web-research            | [rith-web-research]            |
| investigate     | rith-investigate-issue       | [rith-investigate-issue]       |
| plan            | rith-create-plan             | [rith-create-plan]             |
| implement       | rith-fix-issue               | [rith-fix-issue]               |
| validate        | rith-validate                | [rith-validate]                |
| review-scope    | rith-pr-review-scope         | [rith-pr-review-scope]         |
| code-review     | rith-code-review-agent       | [rith-code-review-agent]       |
| error-handling  | rith-error-handling-agent    | [rith-error-handling-agent]    |
| test-coverage   | rith-test-coverage-agent     | [rith-test-coverage-agent]     |
| comment-quality | rith-comment-quality-agent   | [rith-comment-quality-agent]   |
| docs-impact     | rith-docs-impact-agent       | [rith-docs-impact-agent]       |
| synthesize      | rith-synthesize-review       | [rith-synthesize-review]       |
| self-fix        | rith-self-fix-all            | [rith-self-fix-all]            |
| simplify        | rith-simplify-changes        | [rith-simplify-changes]        |
| report          | rith-issue-completion-report | [rith-issue-completion-report] |

### rith-plan-to-pr / rith-idea-to-pr (16-17 nodes)

| Node ID          | Old `command:`              | New `skills:`                 |
| ---------------- | --------------------------- | ----------------------------- |
| create-plan      | rith-create-plan            | [rith-create-plan]            |
| plan-setup       | rith-plan-setup             | [rith-plan-setup]             |
| confirm-plan     | rith-confirm-plan           | [rith-confirm-plan]           |
| implement-tasks  | rith-implement-tasks        | [rith-implement-tasks]        |
| validate         | rith-validate               | [rith-validate]               |
| finalize-pr      | rith-finalize-pr            | [rith-finalize-pr]            |
| review-scope     | rith-pr-review-scope        | [rith-pr-review-scope]        |
| sync             | rith-sync-pr-with-main      | [rith-sync-pr-with-main]      |
| code-review      | rith-code-review-agent      | [rith-code-review-agent]      |
| error-handling   | rith-error-handling-agent   | [rith-error-handling-agent]   |
| test-coverage    | rith-test-coverage-agent    | [rith-test-coverage-agent]    |
| comment-quality  | rith-comment-quality-agent  | [rith-comment-quality-agent]  |
| docs-impact      | rith-docs-impact-agent      | [rith-docs-impact-agent]      |
| synthesize       | rith-synthesize-review      | [rith-synthesize-review]      |
| implement-fixes  | rith-implement-review-fixes | [rith-implement-review-fixes] |
| workflow-summary | rith-workflow-summary       | [rith-workflow-summary]       |

### rith-feature-development (2 command nodes)

| Node ID   | Old `command:` | New `skills:`    |
| --------- | -------------- | ---------------- |
| implement | rith-implement | [rith-implement] |
| create-pr | rith-create-pr | [rith-create-pr] |

### rith-ralph-dag (1 command node)

| Node ID  | Old `command:`      | New `skills:`         |
| -------- | ------------------- | --------------------- |
| generate | rith-ralph-generate | [rith-ralph-generate] |

### Maintainer: rith-issue-review-full (12 command nodes)

| Node ID         | Old `command:`              | New `skills:`                 |
| --------------- | --------------------------- | ----------------------------- |
| investigate     | rith-investigate-issue      | [rith-investigate-issue]      |
| implement       | rith-implement-issue        | [rith-implement-issue]        |
| review-scope    | rith-pr-review-scope        | [rith-pr-review-scope]        |
| sync            | rith-sync-pr-with-main      | [rith-sync-pr-with-main]      |
| code-review     | rith-code-review-agent      | [rith-code-review-agent]      |
| error-handling  | rith-error-handling-agent   | [rith-error-handling-agent]   |
| test-coverage   | rith-test-coverage-agent    | [rith-test-coverage-agent]    |
| comment-quality | rith-comment-quality-agent  | [rith-comment-quality-agent]  |
| docs-impact     | rith-docs-impact-agent      | [rith-docs-impact-agent]      |
| synthesize      | rith-synthesize-review      | [rith-synthesize-review]      |
| implement-fixes | rith-implement-review-fixes | [rith-implement-review-fixes] |
| summary         | rith-workflow-summary       | [rith-workflow-summary]       |

### Maintainer: rith-validate-pr (5 command nodes)

| Node ID             | Old `command:`                       | New `skills:`                          |
| ------------------- | ------------------------------------ | -------------------------------------- |
| code-review-main    | rith-validate-pr-code-review-main    | [rith-validate-pr-code-review-main]    |
| code-review-feature | rith-validate-pr-code-review-feature | [rith-validate-pr-code-review-feature] |
| e2e-test-main       | rith-validate-pr-e2e-main            | [rith-validate-pr-e2e-main]            |
| e2e-test-feature    | rith-validate-pr-e2e-feature         | [rith-validate-pr-e2e-feature]         |
| final-report        | rith-validate-pr-report              | [rith-validate-pr-report]              |

---

## Risks

| Risk                                                | Mitigation                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Skill body too long (>500 lines per agentskills.io) | Extract templates/schemas to `assets/` — `rith-create-plan` is 704 lines, needs splitting |
| Workflow behavior changes from skill loading        | Skills load the full SKILL.md body — same content as command, just different delivery     |
| Pi skill loading doesn't pick up assets             | Already works — Pi reads the directory, not just SKILL.md                                 |
| Installer changes break existing installs           | Additive only — new dirs, no removal of existing files                                    |
| 40 skill directories feels like a lot               | Each is one self-contained procedure. Better than 40 collapsed into 6 vague guides        |

## Rollback

All changes are prompt text, YAML, file locations, and one 136KB generated file
deletion. No schema migrations, no runtime behavior changes, no interface
changes. `git revert` restores previous state. The `command:` node type remains
functional.
