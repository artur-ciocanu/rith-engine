# Plan: Commands & Workflows Overhaul — Skills Migration + Cleanup

## Overview

Audit every bundled command, decide whether it qualifies as a genuine skill or
should remain a command / be inlined, then migrate the real skills, kill the
bundled-defaults codegen, and update the runtime. This is not a mechanical 1:1
conversion — each command is evaluated against clear criteria drawn from the
agentskills.io specification and Anthropic's skill authoring best practices.

---

## What Is a Skill vs a Command

### Sources

- [agentskills.io specification](https://agentskills.io/specification) — the
  open standard for Agent Skills
- [Anthropic skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Claude Code skills documentation](https://docs.anthropic.com/en/docs/claude-code/skills)

### Definition

A **skill** is reusable, discoverable expertise that an agent loads on demand.
It carries specialized knowledge the agent doesn't already have. A skill has a
clear "use when..." sentence that a human or agent can evaluate without knowing
the workflow DAG it participates in.

A **command** is a workflow-specific procedure — step-by-step instructions for
a particular node in a particular DAG. It may reference workflow-specific
artifacts (`$ARTIFACTS_DIR`), assume a specific execution context, and only make
sense within its parent workflow.

### The Five Criteria

A command qualifies as a skill when ALL of the following are true:

#### 1. Genuine Expertise (Anthropic: "Only add context Claude doesn't already have")

The procedure encodes methodology, conventions, or decision logic that the agent
would not produce on its own. If Claude already knows how to do this (simplify a
diff, write a closure report, summarize work), it's not a skill — it's a prompt.

**Skill:** "Validate-after-every-change, fix-before-proceed implementation loop
with per-change type-checking" — Claude does not do this by default.

**Not a skill:** "Simplify the changes in this diff" — Claude already knows how.

#### 2. Discoverable (agentskills.io: description helps agents identify relevant tasks)

You can write a clear, non-contrived `description` with a "Use when..." clause
that an agent or human can evaluate without context about the calling workflow.
Write in third person (Anthropic requirement).

**Skill:** "Resolves merge conflicts by categorizing conflict types and applying
3-way merge logic. Use when a branch has merge conflicts to resolve."

**Not a skill:** "Runs the E2E test on the main branch during the validate-pr
workflow." — The "use when" requires knowing the workflow.

#### 3. Reusable

The skill is useful in more than one context. It may be referenced by multiple
workflows, or it may be invocable directly by a user via `/skill-name`. A skill
that only makes sense inside one specific workflow DAG at one specific step is
workflow plumbing, not a skill.

**Exception:** A skill used by only one workflow today may still qualify if it
represents genuine expertise that _could_ be reused (e.g., "investigate issue"
is currently in one workflow but is clearly useful standalone).

#### 4. Self-Contained

The skill makes sense without its parent workflow's context. It doesn't depend
on `$ARTIFACTS_DIR`, `$WORKFLOW_ID`, or specific artifact files written by
upstream nodes. It receives its inputs through the workflow node's `prompt:`
field or standard environment, not through implicit DAG-level coupling.

**Note:** Some commands that fail this test have a useful core buried inside
workflow plumbing. The fix is to extract the expertise into a skill and leave
the plumbing in the workflow node's `prompt:` or `bash:` fields.

#### 5. Appropriately Scoped (Anthropic: "The context window is a public good")

The skill is neither too thin (Claude already knows this) nor too fat (multiple
unrelated procedures crammed together). From Anthropic's best practices:

- Keep SKILL.md under 500 lines; use `references/` and `assets/` for overflow
- "Challenge each piece of information: Does Claude really need this?"
- Two commands that are >90% identical should be ONE skill with a conditional
  phase, not two nearly-duplicate skills

### Decision Flowchart

```
Does the command encode expertise Claude doesn't already have?
├── No → INLINE into workflow prompt: field
└── Yes ↓
    Can you write a clear "Use when..." without referencing a specific workflow?
    ├── No → KEEP AS COMMAND (workflow-specific procedure)
    └── Yes ↓
        Is it self-contained (no $ARTIFACTS_DIR / implicit DAG coupling)?
        ├── No, but has useful core → EXTRACT expertise into skill, leave plumbing in workflow
        ├── No, pure plumbing → KEEP AS COMMAND
        └── Yes ↓
            Is it >90% identical to another command?
            ├── Yes → MERGE into one skill with conditional phases
            └── No → CONVERT TO SKILL
```

### Two Types of Skill Content (Anthropic)

**Reference content** — conventions, patterns, decision frameworks. Loaded
inline so the agent can apply it to current work. Example: API design
conventions, commit message format, review criteria.

**Task content** — step-by-step instructions for a specific action. Often
invoked directly with `/skill-name`. Example: create a PR, run validation,
generate a PRD.

Both are valid skills. The distinction affects `disable-model-invocation`
(task skills may want manual-only invocation).

### agentskills.io SKILL.md Format

```yaml
---
name: skill-name # Required. Must match directory name. Lowercase + hyphens.
description: | # Required. What + when + trigger keywords. Third person.
  Resolves merge conflicts by categorizing conflict types and applying
  3-way merge logic. Use when a branch has merge conflicts that need
  resolution after a rebase or merge attempt.
metadata: # Optional. Key-value pairs.
  author: rith-engine
  version: '1.0'
compatibility: Requires git # Optional. Environment requirements.
---
# Skill body — the actual instructions

## Phase 1: ...
(procedural content preserved from original command)
```

### Progressive Disclosure (Anthropic)

1. **Metadata** (~100 tokens) — `name` and `description` loaded at startup
2. **Instructions** (<5000 tokens recommended) — full SKILL.md loaded on activation
3. **Resources** (as needed) — files in `references/`, `assets/`, `scripts/`

For skills >500 lines, extract detail into reference files:

```
rith-create-plan/
├── SKILL.md                    # Core methodology (<500 lines)
├── references/
│   └── plan-confirmation.md    # How to verify a plan is still valid
└── assets/
    └── plan-template.md        # Plan output template
```

---

## Lessons From First Attempt

The first attempt collapsed 21 commands into 6 "methodology guide" skills and
inlined 15 commands into workflow prompts. Three fundamental errors:

### Error 1: Wrote abstractions instead of converting procedures

A skill's SKILL.md body serves the same role as a command's body — it's the
step-by-step instructions the agent executes. The first attempt produced 100-200
line "methodology summaries" that replaced 300-700 line step-by-step procedures.
The agent lost the actual phases, bash snippets, output templates, and checklists.

**Fix:** The conversion preserves procedural content. Add front matter, strip
Claude-isms, extract large templates to `assets/` — but keep the phases.

### Error 2: Collapsed independent procedures into single skills

"Create a PR" and "resolve merge conflicts" became one `rith-git` skill. Each
review dimension agent became one `rith-review` skill. These are independent SOPs
with different phases, inputs, and outputs. Collapsing them lost specificity and
violated the "discoverable" and "self-contained" criteria.

**Fix:** Apply the five criteria above. Each independently useful SOP becomes
its own skill. Merge only when >90% identical (like fix-issue / implement-issue).

### Error 3: Force-classified everything as either "skill" or "inline"

The original plan had only two buckets: "become skills" and "inline into
workflows." This ignored the third option: keep as a command. The `command:`
system still works — it's just unused in defaults after migration. Workflow-
specific procedures that fail the skill criteria should stay as commands,
especially in maintainer workflows.

**Fix:** Three buckets — skill, command, inline — based on the five criteria.

---

## Problem

1. **Commands are a weaker primitive than skills.** `command:` just inlines a
   markdown file as the prompt. Skills add: YAML front matter for discovery,
   asset directories for progressive disclosure, the agentskills.io standard
   for cross-tool compatibility, and `~/.rith/skills/` for user-global sharing.

2. **Claude Code assumptions baked in.** 16 commands reference `CLAUDE.md`,
   `Claude Code`, `TodoWrite`, or `subagent_type="Explore"`. Rith uses Pi
   Coding Agent — these are confusing at best, harmful at worst.

3. **Dead package references.** `rith-create-issue.yaml` references removed
   packages (`@rith/web`, `@rith/server`, `@rith/adapters`), PostgreSQL,
   Slack/Telegram/Discord.

4. **Test/maintainer mixed with production.** E2E smoke tests and maintainer
   workflows live alongside production defaults with no separation.

5. **136KB generated TypeScript file.** `bundled-defaults.generated.ts` bakes
   56 files as string literals into the binary.

## Scope

**In scope:**

- Evaluate every command against the five criteria
- Convert qualifying commands to skills with agentskills.io front matter
- Inline trivial commands into workflow `prompt:` fields
- Keep workflow-specific commands as `command:` files
- Move test workflows to `.rith/workflows/e2e/`
- Move maintainer artifacts to `.rith/maintainer/`
- Kill bundled-defaults codegen
- Update skill/workflow resolution to search `.rith/skills/`
- Update production workflows to use `skills:` instead of `command:`
- Purge dead package references from workflows

**Deferred to follow-up PR:**

- Claude-specific content cleanup (CLAUDE.md compliance sections, subagent_type,
  TodoWrite). See Appendix A for full inventory.

**Out of scope:**

- Deprecating `command:` node type in schema/runtime (leave functional)
- Rewriting workflow DAG topology
- Adding new workflows

---

## Complete Command Inventory & Disposition

### DELETE — 3 orphaned commands (not referenced by any workflow)

| Command                  | Lines | Reason                                                 |
| ------------------------ | ----- | ------------------------------------------------------ |
| `rith-auto-fix-review`   | 390   | Orphaned                                               |
| `rith-post-review-to-pr` | 199   | Orphaned                                               |
| `rith-ralph-prd`         | 415   | Orphaned — `rith-ralph-dag` uses `rith-ralph-generate` |

### BECOME SKILLS — 18 commands → 18 skills

Each passes all five criteria: genuine expertise, discoverable, reusable,
self-contained, appropriately scoped.

#### Git Operations (4 skills)

| Command                        | Lines | Skill Name                     | Expertise Claude Lacks                                      |
| ------------------------------ | ----- | ------------------------------ | ----------------------------------------------------------- |
| `rith-create-pr`               | 238   | `rith-create-pr`               | Worktree-aware PR creation, template usage, branch strategy |
| `rith-finalize-pr`             | 419   | `rith-finalize-pr`             | Selective staging, commit format, PR update-vs-create logic |
| `rith-sync-pr-with-main`       | 416   | `rith-sync-pr-with-main`       | Behind-count check, rebase flow, force-push safety          |
| `rith-resolve-merge-conflicts` | 506   | `rith-resolve-merge-conflicts` | Conflict categorization, 3-way merge resolution strategy    |

#### Implementation (3 skills — 2 merges)

| Command(s)                                | Lines   | Skill Name       | Notes                                                                                                                                                          |
| ----------------------------------------- | ------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rith-implement` + `rith-implement-tasks` | 505+392 | `rith-implement` | implement-tasks is the inner loop of implement — same methodology at narrower scope. ONE skill; workflow node prompt says "execute task list only" when needed |
| `rith-fix-issue` + `rith-implement-issue` | 513+578 | `rith-fix-issue` | 90% identical; implement-issue adds 2 phases (PR + self-review). ONE skill with optional PR phase                                                              |
| `rith-validate`                           | 350     | `rith-validate`  | Project-specific validation sequence and failure handling                                                                                                      |

#### Planning (1 skill + 1 reference file)

| Command(s)                               | Lines   | Skill Name         | Notes                                                                                                                                                                            |
| ---------------------------------------- | ------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rith-create-plan` + `rith-confirm-plan` | 704+343 | `rith-create-plan` | confirm-plan is tightly coupled to create-plan's output format. Becomes `references/plan-confirmation.md` inside the skill. Plan template extracted to `assets/plan-template.md` |

#### Code Review (7 skills)

| Command                       | Lines | Skill Name                    | Expertise                                                           |
| ----------------------------- | ----- | ----------------------------- | ------------------------------------------------------------------- |
| `rith-code-review-agent`      | 299   | `rith-code-review`            | Code quality criteria, convention compliance, bug detection         |
| `rith-error-handling-agent`   | 272   | `rith-error-handling-review`  | Silent failure detection, error pattern analysis, async correctness |
| `rith-test-coverage-agent`    | 293   | `rith-test-coverage-review`   | Test gap analysis, coverage quality, mock isolation                 |
| `rith-comment-quality-agent`  | 266   | `rith-comment-quality-review` | Comment accuracy, rot risk, value assessment                        |
| `rith-docs-impact-agent`      | 277   | `rith-docs-impact-review`     | Missing/stale documentation detection                               |
| `rith-synthesize-review`      | 412   | `rith-synthesize-review`      | Deduplication, severity ranking, PR comment drafting                |
| `rith-implement-review-fixes` | 473   | `rith-implement-review-fixes` | Review fix triage by severity, fix-and-validate loop                |

Note: `rith-pr-review-scope` is NOT a skill — see "Extract + Inline" below.

#### Investigation & Fixing (2 skills)

| Command                  | Lines | Skill Name               | Expertise                                                      |
| ------------------------ | ----- | ------------------------ | -------------------------------------------------------------- |
| `rith-investigate-issue` | 600   | `rith-investigate-issue` | Root cause analysis methodology, codebase exploration strategy |
| `rith-self-fix-all`      | 428   | `rith-self-fix-all`      | Prioritized iterative fix loop with stop conditions            |

#### PRD Generation (1 skill)

| Command               | Lines | Skill Name            | Expertise                                              |
| --------------------- | ----- | --------------------- | ------------------------------------------------------ |
| `rith-ralph-generate` | 423   | `rith-ralph-generate` | PRD structure, story decomposition, codebase grounding |

### INLINE — 6 commands (fail "genuine expertise" criterion)

These don't carry expertise Claude lacks. They're prompts, templates, or
instructions Claude can handle from a brief workflow node `prompt:` field.

| Command                        | Lines | Why Not a Skill                                                                    | Disposition                                                                   |
| ------------------------------ | ----- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `rith-assist`                  | 35    | "You are a helpful assistant" — trivial prompt                                     | Inline in workflow `prompt:`                                                  |
| `rith-plan-setup`              | 361   | "Read plan, ensure branch, write artifact" — workflow orchestration, not expertise | Inline: split into `bash:` (git setup) + `prompt:` (context) in workflow node |
| `rith-simplify-changes`        | 121   | Claude already knows how to simplify diffs                                         | Inline in workflow `prompt:`                                                  |
| `rith-issue-completion-report` | 340   | Output template, not methodology                                                   | Inline as output template in workflow `prompt:`                               |
| `rith-workflow-summary`        | 514   | 90% output template specification                                                  | Inline as output template in workflow `prompt:`                               |
| `rith-web-research`            | 268   | Claude already knows how to do web research and verify sources                     | Inline in workflow `prompt:`                                                  |

### EXTRACT + INLINE — 1 command (has useful core buried in workflow plumbing)

| Command                | Lines | Disposition                                                                                                                                                                                                                                                         |
| ---------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rith-pr-review-scope` | 534   | ~60% is artifact directory setup (`mkdir $ARTIFACTS_DIR/review`, writing `.pr-number` files). The useful 40% (PR context gathering, reviewability assessment) inlines into the workflow node `prompt:`. The artifact plumbing becomes `bash:` nodes in the workflow |

### KEEP AS COMMANDS — 13 commands (workflow-specific, fail "discoverable" criterion)

These are tightly coupled to specific workflow DAGs. Their "use when" requires
knowing the workflow. The `command:` system remains functional — these stay as
`.md` files referenced via `command:` in their workflows.

#### Maintainer PR Validation (5 commands → stay in `.rith/maintainer/commands/`)

| Command                                | Lines | Why Not a Skill                                                                  |
| -------------------------------------- | ----- | -------------------------------------------------------------------------------- |
| `rith-validate-pr-code-review-main`    | 163   | "Use when the validate-pr workflow needs code review of main" — not discoverable |
| `rith-validate-pr-code-review-feature` | 202   | Same — tightly coupled to validate-pr DAG                                        |
| `rith-validate-pr-e2e-main`            | 361   | References `$ARTIFACTS_DIR` artifacts from upstream nodes                        |
| `rith-validate-pr-e2e-feature`         | 357   | Same                                                                             |
| `rith-validate-pr-report`              | 232   | Reads specific artifacts from the validate-pr DAG                                |

#### Maintainer Review (7 commands → stay in `.rith/maintainer/commands/`)

| Command                             | Lines | Why Not a Skill                                                             |
| ----------------------------------- | ----- | --------------------------------------------------------------------------- |
| `maintainer-review-code-review`     | 138   | Maintainer-specific output format, `$WORKFLOW_ID`/`$ARTIFACTS_DIR` coupling |
| `maintainer-review-comment-quality` | 108   | Same                                                                        |
| `maintainer-review-docs-impact`     | 131   | Same                                                                        |
| `maintainer-review-error-handling`  | 106   | Same                                                                        |
| `maintainer-review-report`          | 65    | Same                                                                        |
| `maintainer-review-synthesize`      | 166   | Same                                                                        |
| `maintainer-review-test-coverage`   | 115   | Same                                                                        |

#### Maintainer Standup (1 command → stays in `.rith/maintainer/commands/`)

| Command              | Lines | Why Not a Skill                                                                                                                                            |
| -------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maintainer-standup` | 254   | Has genuine expertise but is tightly coupled to maintainer workflow artifacts (`$ARTIFACTS_DIR`, state persistence). Could become a skill in a future pass |

---

## Workflow Inventory & Disposition

### Production — 15 workflows (`.rith/workflows/defaults/`)

Migrate `command:` → `skills:` for skill-qualified commands. Keep `command:`
for non-skill commands (there are none in production workflows after the
analysis above — all production workflow commands either become skills or
get inlined).

`rith-assist`, `rith-plan-to-pr`, `rith-idea-to-pr`, `rith-fix-github-issue`,
`rith-feature-development`, `rith-piv-loop`, `rith-adversarial-dev`,
`rith-refactor-safely`, `rith-architect`, `rith-interactive-prd`,
`rith-ralph-dag`, `rith-smart-pr-review`, `rith-workflow-builder`,
`rith-create-issue`, `rith-remotion-generate`

### Move to `.rith/workflows/e2e/` — 5 test workflows

`e2e-opencode-all-nodes-smoke`, `e2e-opencode-inline-multi-agents`,
`e2e-opencode-smoke`, `rith-test-pi`, `rith-test-loop-dag`

### Move to `.rith/maintainer/workflows/` — 2 maintainer workflows

`rith-validate-pr`, `rith-issue-review-full`

These keep `command:` refs for workflow-specific commands. Convert to `skills:`
refs only for commands that qualified as skills (e.g., `rith-code-review-agent`
→ `skills: [rith-code-review]`).

### DELETE — 2 workflows

`rith-resolve-conflicts` (15 lines, just calls a command),
`rith-comprehensive-pr-review` (subset of `rith-smart-pr-review`)

---

## Core Design Decision: Files on Disk, Not Strings in Binary

**Before:** Binary bakes commands and workflows as string literals into
`bundled-defaults.generated.ts`. Runtime resolves from compiled map.

**After:** Installer places skills and workflows as regular files to `~/.rith/`.
Runtime reads from disk. No generated code, no `isBinaryBuild()` branching.

```
~/.rith/
  skills/                       # installed by installer
    rith-create-pr/SKILL.md
    rith-implement/SKILL.md
    rith-code-review/SKILL.md
    ... (18 production skills)
  workflows/                    # installed by installer
    rith-assist.yaml
    rith-plan-to-pr.yaml
    ... (15 production workflows)
```

**Skill resolution order** (first match wins):

1. `.rith/skills/` (project-local) — user's customizations and overrides
2. `~/.rith/skills/` (user-global) — installed defaults
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

- `dist/content/` in build output with raw files
- Installer copies to `~/.rith/skills/` and `~/.rith/workflows/`
- On upgrade, installer overwrites defaults (project-local `.rith/` untouched)

---

## Implementation Tasks

### Phase 1: Housekeeping — move and delete

#### Task 1: Create directory structure

```
.rith/skills/
.rith/workflows/e2e/
.rith/workflows/e2e/commands/
.rith/maintainer/commands/
.rith/maintainer/workflows/
```

#### Task 2: Move test workflows to e2e

Move 4 e2e yamls from `.rith/workflows/` → `.rith/workflows/e2e/`.
Move `rith-test-loop-dag.yaml` from `.rith/workflows/defaults/` → `.rith/workflows/e2e/`.
Move `e2e-echo-command.md` from `.rith/commands/` → `.rith/workflows/e2e/commands/`.

#### Task 3: Move maintainer artifacts

Move `maintainer-*.md` from `.rith/commands/` → `.rith/maintainer/commands/`.
Move `rith-validate-pr.yaml`, `rith-issue-review-full.yaml` from
`.rith/workflows/defaults/` → `.rith/maintainer/workflows/`.

#### Task 4: Delete orphaned and redundant files

Commands: `rith-auto-fix-review.md`, `rith-post-review-to-pr.md`,
`rith-ralph-prd.md`.
Workflows: `rith-resolve-conflicts.yaml`, `rith-comprehensive-pr-review.yaml`.

### Phase 2: Create skills

**Guiding principle:** The SKILL.md body preserves the original command's
procedural content — phases, bash snippets, output templates, checklists. Add
front matter and strip Claude-isms, but keep the instructions intact. Extract
large templates to `assets/` only when the SKILL.md would exceed 500 lines.

#### Task 5: Create git skills (4 skills)

Convert `rith-create-pr`, `rith-finalize-pr`, `rith-sync-pr-with-main`,
`rith-resolve-merge-conflicts` → individual skill directories.

#### Task 6: Create implementation skills (3 skills, 2 merges)

- `rith-implement` ← absorb `rith-implement-tasks` (inner loop of same methodology)
- `rith-fix-issue` ← absorb `rith-implement-issue` (add optional PR phase)
- `rith-validate` (1:1 conversion)

For merged skills: include both procedures' phases, add a conditional section
("If a PR is needed..." / "If executing tasks only without full environment
setup...").

#### Task 7: Create planning skill (1 skill + references)

- `rith-create-plan` with `references/plan-confirmation.md` (from confirm-plan)
  and `assets/plan-template.md` (extracted from the 704-line body)

#### Task 8: Create review skills (7 skills)

Convert each review agent 1:1. Rename from `-agent` suffix to `-review` suffix
for clarity: `rith-code-review`, `rith-error-handling-review`,
`rith-test-coverage-review`, `rith-comment-quality-review`,
`rith-docs-impact-review`, `rith-synthesize-review`,
`rith-implement-review-fixes`.

#### Task 9: Create investigation, fixing, and PRD skills (3 skills)

Convert `rith-investigate-issue`, `rith-self-fix-all`, `rith-ralph-generate`
→ individual skill directories.

### Phase 3: Migrate workflows (command → skills + inline)

For each workflow node:

- If the command became a skill → `skills: [skill-name]`
- If the command should be inlined → expand into `prompt:` (and `bash:` if
  needed) directly in the workflow YAML
- If the command is in the "extract + inline" category → split useful content
  into `prompt:`, plumbing into `bash:` nodes

The `prompt:` field on a skill-referencing node should contain ONLY node-specific
context (PR number, branch name, "execute tasks only"), NOT the procedural
instructions. The skill carries the full procedure.

#### Task 10: Migrate simple workflows

`rith-assist` (inline the 811B prompt), `rith-feature-development`.

#### Task 11: Migrate plan-to-pr family

`rith-plan-to-pr`, `rith-idea-to-pr`.

#### Task 12: Migrate review workflow

`rith-smart-pr-review` — each dimension node gets its specific review skill.

#### Task 13: Migrate issue workflow

`rith-fix-github-issue` — includes inlining `rith-web-research`,
`rith-simplify-changes`, `rith-issue-completion-report`, and extracting
`rith-pr-review-scope` into prompt + bash.

#### Task 14: Migrate complex workflows

`rith-piv-loop`, `rith-adversarial-dev`, `rith-refactor-safely`.

#### Task 15: Migrate remaining workflows

`rith-ralph-dag`, `rith-create-issue` (purge dead refs), `rith-interactive-prd`,
`rith-architect`, `rith-workflow-builder`, `rith-remotion-generate`.

#### Task 16: Migrate maintainer workflows

`rith-validate-pr` — keep `command:` for the 5 validate-pr-specific commands;
convert shared commands (like `rith-code-review-agent`) to `skills:` refs.

`rith-issue-review-full` — convert qualifying commands to `skills:` refs, keep
workflow-specific commands as `command:` refs.

#### Task 17: Delete old commands directory

After all migrations, delete remaining default command files from
`.rith/commands/defaults/`.

### Phase 4: Kill bundled-defaults codegen, update runtime

#### Task 18: Flatten `packages/pi/src/shared/` → `packages/pi/src/`

Move `skills.ts`, `structured-output.ts`. Update all imports. Delete `shared/`.

#### Task 19: Add `.rith/skills/` to skill resolution

Add `cwd/.rith/skills/` and `~/.rith/skills/` as highest-priority search roots
in `skillSearchRoots()`.

#### Task 20: Add `~/.rith/workflows/` to workflow discovery

Add `~/.rith/workflows/` as search location for user-global installed workflows.

#### Task 21: Add `.rith/skills/` to validator

Update skill existence checks to match the resolution order.

#### Task 22: Delete bundled-defaults infrastructure

- Delete `bundled-defaults.generated.ts`, `bundled-defaults.ts`, test, type defs
- Delete `scripts/generate-bundled-defaults.ts`, `scripts/check-bundled-skill.ts`
- Delete `packages/cli/src/bundled-skill.ts`
- Remove npm scripts: `generate:bundled`, `check:bundled`, `check:bundled-skill`
- Remove `check:bundled` from `validate` script
- Remove `isBinaryBuild()` and all `BUNDLED_COMMANDS`/`BUNDLED_WORKFLOWS` refs
- Update `workflow-discovery.ts`, `executor-shared.ts`, `validator.ts`
- Update `doctor.ts` `checkBundledDefaults` to use disk discovery

#### Task 23: Update installer scripts

`scripts/install.sh`, `scripts/install.ps1`, `scripts/build-binaries.sh`:

- Package `.rith/skills/` and `.rith/workflows/defaults/` into distribution
- Install to `~/.rith/skills/` and `~/.rith/workflows/`
- Overwrite on upgrade (defaults, not user config)

### Phase 5: Validation

#### Task 24: Run full validation

`bun run validate` — type-check, lint, format, tests all pass.

#### Task 25: Verify zero contamination

```bash
# Zero command: refs in production workflows
grep -r "command:" .rith/workflows/defaults/ | grep -v "^#"
# Zero dead package refs
grep -r "@rith/web\|@rith/server\|@rith/adapters" .rith/workflows/defaults/
```

#### Task 26: Verify skill count and structure

```bash
# 18 skill directories, each with SKILL.md + valid front matter
ls -d .rith/skills/*/
for skill in .rith/skills/*/SKILL.md; do head -5 "$skill"; echo "---"; done
```

---

## Success Criteria

- [ ] 18 production skills in `.rith/skills/`, each with valid agentskills.io front matter
- [ ] Each SKILL.md preserves its source command's procedural phases and detail
- [ ] Zero `command:` references in production workflows
- [ ] Maintainer workflows use `command:` for workflow-specific commands, `skills:` for shared skills
- [ ] 13 maintainer/workflow-specific commands remain as `.md` files (not forced into skills)
- [ ] 6 inlined commands fully expanded in their workflow `prompt:`/`bash:` fields
- [ ] Zero references to removed packages in workflows
- [ ] `bundled-defaults.generated.ts` deleted
- [ ] Skill resolution searches `.rith/skills/` (project and home)
- [ ] `bun run validate` passes
- [ ] `shared/` directory in `@rith/pi` flattened
- [ ] Test workflows in `.rith/workflows/e2e/`
- [ ] Maintainer artifacts in `.rith/maintainer/`

---

## Appendix A: Claude-Specific Content Inventory (Deferred to Follow-up PR)

16 of 36 commands contain Claude-specific content. Deferred to a separate PR
because it requires per-command judgment — output format restructuring, not
just string substitution.

### Category 1: CLAUDE.md as project-rules file (13 commands)

These reference `CLAUDE.md` as a source of project conventions. The fix:

- `cat CLAUDE.md` → discover whatever rules file exists
  (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`)
- "CLAUDE.md rules" → "project conventions"
- "CLAUDE.md Compliance" output section → "Project Conventions Compliance"

| Command                                | CLAUDE.md refs | Structural Impact                                 |
| -------------------------------------- | -------------- | ------------------------------------------------- |
| `rith-code-review-agent`               | 13             | Has "CLAUDE.md Compliance" TABLE in output format |
| `rith-docs-impact-agent`               | 9              | References CLAUDE.md as doc source                |
| `rith-pr-review-scope`                 | 6              | "Check for CLAUDE.md" phase step                  |
| `rith-validate-pr-code-review-feature` | 4              | CLAUDE.md in review criteria                      |
| `rith-create-plan`                     | 3              | "Read CLAUDE.md" phase step                       |
| `rith-simplify-changes`                | 3              | CLAUDE.md reference in review                     |
| `rith-workflow-summary`                | 3              | CLAUDE.md in summary context                      |
| `rith-error-handling-agent`            | 3              | CLAUDE.md in review criteria                      |
| `rith-ralph-generate`                  | 2              | CLAUDE.md in codebase exploration                 |
| `rith-validate-pr-report`              | 1              | CLAUDE.md in report context                       |
| 6 maintainer-review-\*                 | varies         | CLAUDE.md in review criteria                      |

### Category 2: Claude-specific tool/API references (5 commands)

| Command                       | Reference                       | Fix                          |
| ----------------------------- | ------------------------------- | ---------------------------- |
| `rith-create-plan`            | `subagent_type="Explore"` (2x)  | → "use a read-only subagent" |
| `rith-investigate-issue`      | `subagent_type="Explore"` (1x)  | → "use a read-only subagent" |
| `rith-ralph-generate`         | `subagent_type="Explore"` (1x)  | → "use a read-only subagent" |
| `rith-implement-review-fixes` | `TodoWrite` (1x)                | → "use todo tracking"        |
| `rith-assist`                 | `Claude Code capabilities` (2x) | → "agent capabilities"       |

### Category 3: Dead package references (3 commands)

| Command                        | Reference      | Fix    |
| ------------------------------ | -------------- | ------ |
| `rith-plan-setup`              | `Discord`      | Remove |
| `rith-validate-pr-e2e-feature` | `@rith/server` | Remove |
| `rith-validate-pr-e2e-main`    | `@rith/server` | Remove |

---

## Appendix B: Workflow → Skill Reference Map

Exact mapping of which skill each production workflow node should reference.

### rith-smart-pr-review

| Node ID         | Old `command:`              | New `skills:`                 |
| --------------- | --------------------------- | ----------------------------- |
| scope           | rith-pr-review-scope        | _(inline — extract + inline)_ |
| sync            | rith-sync-pr-with-main      | [rith-sync-pr-with-main]      |
| code-review     | rith-code-review-agent      | [rith-code-review]            |
| error-handling  | rith-error-handling-agent   | [rith-error-handling-review]  |
| test-coverage   | rith-test-coverage-agent    | [rith-test-coverage-review]   |
| comment-quality | rith-comment-quality-agent  | [rith-comment-quality-review] |
| docs-impact     | rith-docs-impact-agent      | [rith-docs-impact-review]     |
| synthesize      | rith-synthesize-review      | [rith-synthesize-review]      |
| implement-fixes | rith-implement-review-fixes | [rith-implement-review-fixes] |

### rith-fix-github-issue

| Node ID         | Old `command:`               | New                           | Notes                        |
| --------------- | ---------------------------- | ----------------------------- | ---------------------------- |
| research        | rith-web-research            | _(inline)_                    | Claude knows how to research |
| investigate     | rith-investigate-issue       | [rith-investigate-issue]      |                              |
| plan            | rith-create-plan             | [rith-create-plan]            |                              |
| implement       | rith-fix-issue               | [rith-fix-issue]              |                              |
| validate        | rith-validate                | [rith-validate]               |                              |
| review-scope    | rith-pr-review-scope         | _(inline — extract + inline)_ |                              |
| code-review     | rith-code-review-agent       | [rith-code-review]            |                              |
| error-handling  | rith-error-handling-agent    | [rith-error-handling-review]  |                              |
| test-coverage   | rith-test-coverage-agent     | [rith-test-coverage-review]   |                              |
| comment-quality | rith-comment-quality-agent   | [rith-comment-quality-review] |                              |
| docs-impact     | rith-docs-impact-agent       | [rith-docs-impact-review]     |                              |
| synthesize      | rith-synthesize-review       | [rith-synthesize-review]      |                              |
| self-fix        | rith-self-fix-all            | [rith-self-fix-all]           |                              |
| simplify        | rith-simplify-changes        | _(inline)_                    |                              |
| report          | rith-issue-completion-report | _(inline)_                    |                              |

### rith-plan-to-pr / rith-idea-to-pr

| Node ID          | Old `command:`              | New                           | Notes                                       |
| ---------------- | --------------------------- | ----------------------------- | ------------------------------------------- |
| create-plan      | rith-create-plan            | [rith-create-plan]            |                                             |
| plan-setup       | rith-plan-setup             | _(inline — bash + prompt)_    | Workflow glue                               |
| confirm-plan     | rith-confirm-plan           | [rith-create-plan]            | Skill has `references/plan-confirmation.md` |
| implement-tasks  | rith-implement-tasks        | [rith-implement]              | Prompt: "execute task list only"            |
| validate         | rith-validate               | [rith-validate]               |                                             |
| finalize-pr      | rith-finalize-pr            | [rith-finalize-pr]            |                                             |
| review-scope     | rith-pr-review-scope        | _(inline — extract + inline)_ |                                             |
| sync             | rith-sync-pr-with-main      | [rith-sync-pr-with-main]      |                                             |
| code-review      | rith-code-review-agent      | [rith-code-review]            |                                             |
| error-handling   | rith-error-handling-agent   | [rith-error-handling-review]  |                                             |
| test-coverage    | rith-test-coverage-agent    | [rith-test-coverage-review]   |                                             |
| comment-quality  | rith-comment-quality-agent  | [rith-comment-quality-review] |                                             |
| docs-impact      | rith-docs-impact-agent      | [rith-docs-impact-review]     |                                             |
| synthesize       | rith-synthesize-review      | [rith-synthesize-review]      |                                             |
| implement-fixes  | rith-implement-review-fixes | [rith-implement-review-fixes] |                                             |
| workflow-summary | rith-workflow-summary       | _(inline)_                    | Output template                             |

### rith-feature-development

| Node ID   | Old `command:` | New `skills:`    |
| --------- | -------------- | ---------------- |
| implement | rith-implement | [rith-implement] |
| create-pr | rith-create-pr | [rith-create-pr] |

### rith-ralph-dag

| Node ID  | Old `command:`      | New `skills:`         |
| -------- | ------------------- | --------------------- |
| generate | rith-ralph-generate | [rith-ralph-generate] |

### Maintainer: rith-issue-review-full

| Node ID         | Old `command:`              | New                           | Notes                         |
| --------------- | --------------------------- | ----------------------------- | ----------------------------- |
| investigate     | rith-investigate-issue      | [rith-investigate-issue]      | Shared skill                  |
| implement       | rith-implement-issue        | [rith-fix-issue]              | Prompt: "create PR after fix" |
| review-scope    | rith-pr-review-scope        | _(inline — extract + inline)_ |                               |
| sync            | rith-sync-pr-with-main      | [rith-sync-pr-with-main]      | Shared skill                  |
| code-review     | rith-code-review-agent      | [rith-code-review]            | Shared skill                  |
| error-handling  | rith-error-handling-agent   | [rith-error-handling-review]  | Shared skill                  |
| test-coverage   | rith-test-coverage-agent    | [rith-test-coverage-review]   | Shared skill                  |
| comment-quality | rith-comment-quality-agent  | [rith-comment-quality-review] | Shared skill                  |
| docs-impact     | rith-docs-impact-agent      | [rith-docs-impact-review]     | Shared skill                  |
| synthesize      | rith-synthesize-review      | [rith-synthesize-review]      | Shared skill                  |
| implement-fixes | rith-implement-review-fixes | [rith-implement-review-fixes] | Shared skill                  |
| summary         | rith-workflow-summary       | _(inline)_                    | Output template               |

### Maintainer: rith-validate-pr

All 5 command nodes keep `command:` references — they're workflow-specific.
No changes needed.

---

## Risks

| Risk                                                         | Mitigation                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Inlined commands make workflow YAMLs large                   | Only 6 commands inlined; largest is workflow-summary (514L) — extract the template to a reference file if needed |
| Merged skills (implement + implement-tasks) lose distinction | Conditional phase with clear heading; workflow prompt narrows scope                                              |
| Skills >500 lines (rith-create-plan at 704L)                 | Extract templates and confirmation to `references/` and `assets/`                                                |
| Maintainer workflows mixing `command:` and `skills:`         | Clear and intentional — shared expertise uses skills, workflow plumbing uses commands                            |
| Installer changes break existing installs                    | Additive only — new dirs, no removal                                                                             |
| Runtime can't find workflows after bundled-defaults removal  | Task 20 adds `~/.rith/workflows/` before Task 22 deletes old path                                                |

## Rollback

All changes are prompt text, YAML, file locations, and one 136KB generated file
deletion. No schema migrations, no runtime behavior changes, no interface
changes. `git revert` restores previous state. The `command:` node type remains
functional.
