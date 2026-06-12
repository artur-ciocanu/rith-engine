---
name: rith-ralph
description: |
  PRD generation and story decomposition. Produces prd.md and prd.json through
  systematic codebase exploration and autonomous decision-making. Use when
  writing product requirements, decomposing features into stories, or generating
  PRDs from feature descriptions.
  Triggers: "create PRD", "write requirements", "generate PRD", "decompose
  feature", "ralph", "product requirements".
metadata:
  author: rith-engine
  version: "1.0"
---

# Ralph — PRD Generation & Story Decomposition

Generate production-quality PRD files (`prd.md` + `prd.json`) through systematic codebase exploration and autonomous decision-making.

## Core Principles

- **Codebase first** — explore the project before writing anything. Stories must reference real files, patterns, and types.
- **Autonomous** — make informed decisions without interactive questions. Base judgments on codebase analysis and the input description.
- **Right-sized stories** — each story completable in one iteration (~15-30 min of agent work).

## Input Detection

| Input                          | Action                                           |
| ------------------------------ | ------------------------------------------------ |
| Path to existing `.md` PRD     | Parse it, generate `prd.json` stories from it    |
| `.rith/ralph/{slug}/prd.md`    | Generate `prd.json` alongside it                 |
| Free-form text                 | Generate both `prd.md` and `prd.json`            |
| Empty                          | Stop — require input                             |

If an existing PRD is detected, extract its goals/context/scope and skip directly to technical grounding.

## Workflow Phases

### 1. Understand — Problem & Context

Autonomously determine: problem statement, target user, goals, success metrics, MVP scope, and explicit non-goals.

### 2. UX & Design — User Journey

Map: trigger event, happy path steps, states (empty/loading/error/success), edge cases, and interaction model (CLI, API, UI).

### 3. Technical Grounding — Codebase Exploration

**Critical phase.** Use a read-only subagent to explore:

- Similar implementations with `file:line` references
- Types/interfaces to extend or use
- Naming conventions, error handling, test patterns
- Integration points and import patterns
- Project rules/conventions

Read the project rules file and extract coding standards.

### 4. Story Breakdown — Split Into Iterations

**Layer decomposition:**

| Layer         | Examples                           | Typical count |
| ------------- | ---------------------------------- | ------------- |
| Schema/types  | DB columns, interfaces, schemas    | 1-2           |
| Backend logic | Services, utilities, API endpoints | 2-4           |
| UI components | New components, modifications      | 1-3           |
| Integration   | Wiring, config, exports            | 1-2           |
| Tests         | Dedicated test stories if complex  | 0-2           |

**Sizing rules:** one story = one iteration. "Build entire feature" is too big — split by layer.

**Dependency ordering:** lower priority runs first, `dependsOn` only references lower-priority stories, no circular deps.

**Acceptance criteria:** every criterion must be pass/fail testable. No vague "works correctly" — specify exact behavior.

### 5. Generate — Write PRD Files

1. Generate a kebab-case slug (max 50 chars)
2. Create `.rith/ralph/{slug}/`
3. Write `prd.md` using the [PRD template](assets/prd-template.md)
4. Write `prd.json` conforming to the [PRD schema](assets/prd-json-schema.md)
5. Commit both files

### 6. Output — Report

Report: feature name, directory path, story count, dependency validity, and a summary table of stories.

## Story Quality Checklist

- [ ] Each story completable in one iteration
- [ ] Dependencies form a valid DAG (no cycles)
- [ ] All acceptance criteria are verifiable (pass/fail)
- [ ] Technical notes reference real files and patterns from exploration
- [ ] Stories ordered: schema → types → backend → UI → integration

## Interactive Refinement

When revisiting an existing PRD:

1. Re-read the current `prd.md` and `prd.json`
2. Re-run technical grounding if codebase has changed
3. Update stories — adjust sizing, fix stale file references, add missing criteria
4. Bump completed stories (`passes: true`) and update notes

## Progress Tracking

Track story completion via `prd.json`:

- `passes: false` → not started or in progress
- `passes: true` → story complete, all acceptance criteria met
- `notes` field — record deviations, blockers, or implementation decisions
- Priority order determines execution sequence; respect `dependsOn` constraints

## Success Criteria

- `prd.md` has goals, user context, UX, and technical patterns from real codebase exploration
- Each story is single-iteration sized
- Dependencies form a valid DAG
- All acceptance criteria are pass/fail testable
- Technical notes reference real files, types, and patterns
