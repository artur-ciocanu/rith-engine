# Plan Output Template

Write to `$ARTIFACTS_DIR/plan.md` using this template:

````markdown
# Feature: {Feature Name}

## Summary

{One paragraph: What we're building and high-level approach}

## User Story

As a {user type}
I want to {action}
So that {benefit}

## Problem Statement

{Specific problem this solves - must be testable}

## Solution Statement

{How we're solving it - architecture overview}

## Metadata

| Field            | Value                                             |
| ---------------- | ------------------------------------------------- |
| Type             | NEW_CAPABILITY / ENHANCEMENT / REFACTOR / BUG_FIX |
| Complexity       | LOW / MEDIUM / HIGH                               |
| Systems Affected | {comma-separated list}                            |
| Dependencies     | {external libs/services with versions}            |
| Estimated Tasks  | {count}                                           |

---

## UX Design

### Before State

{ASCII diagram - current user experience with data flows}

### After State

{ASCII diagram - new user experience with data flows}

### Interaction Changes

| Location         | Before         | After          | User Impact             |
| ---------------- | -------------- | -------------- | ----------------------- |
| {path/component} | {old behavior} | {new behavior} | {what changes for user} |

---

## Mandatory Reading

**CRITICAL: Implementation agent MUST read these files before starting any task:**

| Priority | File                  | Lines | Why Read This             |
| -------- | --------------------- | ----- | ------------------------- |
| P0       | `path/to/critical.ts` | 10-50 | Pattern to MIRROR exactly |
| P1       | `path/to/types.ts`    | 1-30  | Types to IMPORT           |
| P2       | `path/to/test.ts`     | all   | Test pattern to FOLLOW    |

**External Documentation:**

| Source                            | Section        | Why Needed        |
| --------------------------------- | -------------- | ----------------- |
| [Lib Docs v{version}](url#anchor) | {section name} | {specific reason} |

---

## Patterns to Mirror

**NAMING_CONVENTION:**

```typescript
// SOURCE: {file:lines}
// COPY THIS PATTERN:
{actual code snippet from codebase}
```
````

**ERROR_HANDLING:**

```typescript
// SOURCE: {file:lines}
// COPY THIS PATTERN:
{actual code snippet from codebase}
```

**LOGGING_PATTERN:**

```typescript
// SOURCE: {file:lines}
// COPY THIS PATTERN:
{actual code snippet from codebase}
```

**TEST_STRUCTURE:**

```typescript
// SOURCE: {file:lines}
// COPY THIS PATTERN:
{actual code snippet from codebase}
```

---

## Files to Change

| File                          | Action | Justification    |
| ----------------------------- | ------ | ---------------- |
| `src/features/new/models.ts`  | CREATE | Type definitions |
| `src/features/new/service.ts` | CREATE | Business logic   |
| `src/existing/index.ts`       | UPDATE | Add integration  |

---

## NOT Building (Scope Limits)

Explicit exclusions to prevent scope creep:

- {Item 1 - explicitly out of scope and why}
- {Item 2 - explicitly out of scope and why}

---

## Step-by-Step Tasks

Execute in order. Each task is atomic and independently verifiable.

### Task 1: {CREATE/UPDATE} `{file path}`

- **ACTION**: {CREATE new file / UPDATE existing file}
- **IMPLEMENT**: {specific what to implement}
- **MIRROR**: `{source-file:lines}` - follow this pattern exactly
- **IMPORTS**: `{specific imports needed}`
- **GOTCHA**: {known issue to avoid}
- **VALIDATE**: `{validation-command}` - must pass before next task

### Task 2: {CREATE/UPDATE} `{file path}`

{... repeat for each task ...}

---

## Testing Strategy

### Unit Tests to Write

| Test File                                | Test Cases           | Validates      |
| ---------------------------------------- | -------------------- | -------------- |
| `src/features/new/tests/service.test.ts` | CRUD ops, edge cases | Business logic |

### Edge Cases Checklist

- [ ] Empty string inputs
- [ ] Missing required fields
- [ ] Unauthorized access attempts
- [ ] Not found scenarios
- [ ] {feature-specific edge case}

---

## Validation Commands

### Level 1: STATIC_ANALYSIS

```bash
{runner} run type-check && {runner} run lint
```

**EXPECT**: Exit 0, no errors or warnings

### Level 2: UNIT_TESTS

```bash
{runner} test {path/to/feature/tests}
```

**EXPECT**: All tests pass

### Level 3: FULL_SUITE

```bash
{runner} run validate
```

**EXPECT**: All tests pass, build succeeds

---

## Acceptance Criteria

- [ ] All specified functionality implemented per user story
- [ ] Level 1-3 validation commands pass with exit 0
- [ ] Code mirrors existing patterns exactly (naming, structure, logging)
- [ ] No regressions in existing tests
- [ ] UX matches "After State" diagram

---

## Completion Checklist

- [ ] All tasks completed in dependency order
- [ ] Each task validated immediately after completion
- [ ] All acceptance criteria met

---

## Risks and Mitigations

| Risk               | Likelihood   | Impact       | Mitigation                              |
| ------------------ | ------------ | ------------ | --------------------------------------- |
| {Risk description} | LOW/MED/HIGH | LOW/MED/HIGH | {Specific prevention/handling strategy} |

---

## Notes

{Additional context, design decisions, trade-offs, future considerations}

````
