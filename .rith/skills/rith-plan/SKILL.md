---
name: rith-plan
description: |
  Planning methodology for codebase-first research, primitives inventory, and
  phased implementation plans. Use when creating plans, researching codebases,
  designing architecture, or preparing implementation strategies.
  Triggers: "create plan", "plan implementation", "research codebase",
  "design approach", "prepare plan", "plan setup".
metadata:
  author: rith-engine
  version: "1.0"
---

# Plan Creation Skill

Create implementation plans through systematic codebase exploration, pattern extraction, and strategic research. Plans are context-rich documents that enable one-pass implementation success.

**Core principle**: CODEBASE FIRST, RESEARCH SECOND. Solutions must fit existing patterns before introducing new ones.

---

## Input Resolution

| Input Pattern | Action |
|---|---|
| `.prd.md` or contains "Implementation Phases" | Parse PRD, select next pending phase with dependencies met |
| Existing file path | Read and extract feature description |
| Free-form text | Use directly as feature input |
| Empty | STOP — require input |

For PRD inputs: extract phase goal, scope, success signal, and PRD context. Report selected phase to user. Note parallel phase opportunities.

---

## Phase 1: Feature Understanding

1. **Discover project structure** — do NOT assume `src/`. Check root, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod` to find actual source layout
2. **Read project rules/conventions** — note all coding standards, patterns, and constraints
3. **Extract from input**: core problem, user value, feature type (NEW_CAPABILITY | ENHANCEMENT | REFACTOR | BUG_FIX), complexity (LOW | MEDIUM | HIGH), affected systems
4. **Formulate user story**: As a {user} I want {action} so that {benefit}

**Gate**: If requirements are ambiguous → STOP and ask the user for clarification.

---

## Phase 2: Codebase Intelligence

Use a read-only subagent to thoroughly explore the codebase before any external research.

Discover:
- **Similar implementations** — analogous features with `file:line` references
- **Naming conventions** — actual examples from codebase
- **Error handling patterns** — how errors are created, thrown, caught
- **Logging patterns** — logger usage, message formats
- **Type definitions** — relevant interfaces and types
- **Test patterns** — test file structure, assertion styles
- **Integration points** — where new code connects to existing code
- **Dependencies** — relevant libraries already in use

Document all discoveries in a table: Category | File:Lines | Pattern Description | Code Snippet.

All code snippets MUST be actual (copy-pasted from codebase, not invented).

**Checkpoint**: At least 3 similar implementations found with `file:line` refs. Integration points mapped. Dependencies cataloged with versions.

---

## Phase 3: External Research

Only AFTER Phase 2. Search for:
- Official docs for involved libraries (match versions from package manifest)
- Known gotchas, breaking changes, deprecations
- Security considerations and best practices

Format: `[Library Docs v{version}](url#specific-section)` with KEY_INSIGHT, APPLIES_TO, and GOTCHA annotations. URLs must include specific section anchors.

---

## Phase 4: Primitives Inventory

Before designing the solution, audit existing building blocks:

1. **What primitives exist?** — list core abstractions related to this feature with `file:line` refs
2. **Are they complete?** — do they cover this use case or have gaps?
3. **Extend before adding** — prefer `implements ExistingInterface` over `interface NewInterface`
4. **Minimum primitive surface** — if new primitives ARE needed, what's the smallest addition that enables the feature and remains useful to future callers?
5. **Dependency chain** — what must exist first? What does this feature unlock downstream?

| Primitive | File:Lines | Complete? | Role in Feature |
|---|---|---|---|

---

## Phase 5: Architecture & Design

Consider:
- **Architecture fit**: how does this integrate with existing architecture?
- **Execution order**: what must happen first → second → third?
- **Failure modes**: edge cases, race conditions, error scenarios
- **Performance**: scaling, query optimization
- **Security**: attack vectors, data exposure, auth/authz
- **Maintainability**: will future devs understand this?

Document: approach chosen with rationale, alternatives rejected with reasons, and explicit scope limits (NOT Building section).

---

## Phase 6: Write the Plan

Write to the artifacts directory using the template in `assets/plan-template.md`. Ensure:
- All patterns from codebase exploration documented with `file:line` references
- External docs versioned to match package manifest
- Every task has at least one executable validation command
- Tasks ordered by dependency (executable top-to-bottom)
- Each task is atomic and independently testable
- No placeholders — all content is specific and actionable
- Pattern references include actual code snippets

If input was a PRD: update the phase status to `in-progress` and link the plan.

---

## Phase 7: Verification

### Context completeness
- All patterns documented with `file:line` references
- External docs versioned correctly
- Integration points mapped with specific file paths
- Gotchas captured with mitigation strategies

### Implementation readiness
- Tasks executable top-to-bottom without questions
- No placeholders remain
- Pattern references are actual code (not invented)

### No-prior-knowledge test
Could an agent unfamiliar with this codebase implement using ONLY the plan? If no → add missing context.

---

## Plan Setup

Before implementation begins, prepare the environment:

1. **Locate plan** — from arguments or workflow artifacts
2. **Extract key info**: title, summary, files to change, validation commands, acceptance criteria, scope limits
3. **Derive branch name**: `feature/{slug}` from title (lowercase, hyphens, max 50 chars)
4. **Git state**: ensure correct branch, clean working directory, synced with base
5. **Write context artifact** containing: branch info, plan summary, files to change, scope limits, validation commands, acceptance criteria, patterns to mirror

---

## Plan Confirmation

Before implementation, verify plan research is still valid:

### Verify patterns
For each file in "Patterns to Mirror": check existence, read referenced lines, compare with plan expectations.

| Finding | Severity | Action |
|---|---|---|
| File exists, code matches | OK | Proceed |
| File exists, minor differences | WARNING | Note, proceed with caution |
| File exists, major drift | CONCERN | Flag for review |
| File missing | BLOCKER | Stop, plan needs revision |

### Verify targets
- CREATE files: verify they don't already exist
- UPDATE files: verify they do exist, referenced functions/lines present

### Verify validation commands
Dry-run all validation commands to confirm availability.

### Write confirmation artifact
Status: CONFIRMED | WARNINGS | BLOCKED with recommendation to proceed, proceed with caution, or stop.

---

## Success Criteria

- **CONTEXT_COMPLETE**: All patterns, gotchas, integration points from actual codebase
- **IMPLEMENTATION_READY**: Tasks executable top-to-bottom without questions
- **PATTERN_FAITHFUL**: Every new file mirrors existing codebase style exactly
- **VALIDATION_DEFINED**: Every task has executable verification command
- **ONE_PASS_TARGET**: Confidence score 8+ for first-attempt success
