# {Feature Name} — Product Requirements

## Overview

**Problem**: {What pain this solves}
**Solution**: {What we're building}
**Branch**: `ralph/{slug}`

---

## Goals & Success

### Primary Goal

{The main outcome}

### Success Metrics

| Metric   | Target   | How Measured |
| -------- | -------- | ------------ |
| {metric} | {target} | {method}     |

### Non-Goals (Out of Scope)

- {Item 1} — {why excluded}
- {Item 2} — {why excluded}

---

## User & Context

### Target User

- **Who**: {description}
- **Role**: {their context}
- **Current Pain**: {what they struggle with}

### User Journey

1. **Trigger**: {what prompts the need}
2. **Action**: {what they do}
3. **Outcome**: {success state}

---

## UX Requirements

### Interaction Model

{How users interact — CLI commands, API endpoints, UI components}

### States to Handle

| State   | Description | Behavior       |
| ------- | ----------- | -------------- |
| Empty   | {when}      | {what happens} |
| Loading | {when}      | {what happens} |
| Error   | {when}      | {what happens} |
| Success | {when}      | {what happens} |

---

## Technical Context

### Patterns to Follow

- **Similar implementation**: `{file:lines}` — {what to mirror}
- **Component pattern**: `{file:lines}` — {pattern description}
- **Test pattern**: `{file:lines}` — {how to test}

### Types & Interfaces

```typescript
// Key types to use or extend
{relevant type definitions from codebase exploration}
```

### Architecture Notes

- {Key technical decisions}
- {Integration points}
- {Dependencies}

---

## Implementation Summary

### Story Overview

| ID     | Title   | Priority | Dependencies |
| ------ | ------- | -------- | ------------ |
| US-001 | {title} | 1        | —            |
| US-002 | {title} | 2        | US-001       |

### Dependency Graph

```
US-001 (schema/types)
    ↓
US-002 (backend)
    ↓
US-003 (UI) → US-004 (integration)
```

---

## Validation Requirements

Every story must pass:

- [ ] Type-check
- [ ] Lint
- [ ] Tests
- [ ] Format check

---

_Generated: {ISO timestamp}_
