---
name: rith-maintainer-review
description: |
  Deep PR review methodology for maintainers. Runs multi-dimension analysis
  (code quality, error handling, test coverage, comment quality, docs impact),
  then synthesizes findings into an actionable report. Use for thorough PR
  reviews, maintainer review workflows, or when comprehensive code analysis
  is needed.
  Triggers: "maintainer review", "deep review", "thorough PR review",
  "maintainer PR analysis".
metadata:
  author: rith-engine
  version: "1.0"
---

# Maintainer Review Skill

Multi-dimension PR review that produces a synthesized, maintainer-ready report with a draft PR comment. Each dimension runs independently, then findings are aggregated, deduplicated, and prioritized.

## Review Process

1. **Load PR context** — read the PR diff (`gh pr diff <number>`), project rules/conventions, and any gate decision from prior triage.
2. **Run review dimensions** — each dimension analyzes the diff through its lens (see below). Not all dimensions run on every PR; skip dimensions that don't apply (e.g., skip comment-quality if no comments changed).
3. **Synthesize** — aggregate findings across dimensions, deduplicate overlaps, group by severity.
4. **Report** — produce a final verdict, structured findings, and a draft PR comment.

## Review Dimensions

Each dimension produces a findings file with severity-ranked issues (CRITICAL / HIGH / MEDIUM / LOW). For detailed evaluation criteria per dimension, see `references/review-dimensions.md`.

### Code Quality

Always runs. Covers bugs, correctness, project convention compliance, and bug-likelihood signals. Looks for logic errors, off-by-one, null dereferences, race conditions, resource leaks, API misuse, and cross-package boundary violations.

Key areas: bugs/correctness, project rules compliance (type safety, imports, logging, error handling, database patterns), naming/structure alignment, and bug-likelihood signals (untested branches, hardcoded values, leftover TODOs).

### Error Handling

Runs when the diff touches try/catch, async/await, or new failure paths. Catches silent failures, inappropriate fallbacks, and inconsistent error patterns.

Key areas: silent-failure risks (swallowed errors, overly broad catches, hidden fallbacks), error pattern consistency (structured logging, context in thrown errors), promise/async correctness (unhandled rejections, missing awaits, cancellation), and user-facing error UX (actionable messages, platform adapter surfacing).

### Test Coverage

Runs when the diff touches source code (not pure docs/config). Assesses whether new behavior is properly tested.

Key areas: behavioral coverage (happy path, edge cases, error paths, assertion targets), test quality (determinism, mock isolation, setup/teardown), and coverage gaps (new public functions, conditional branches, bug fixes without regression tests, new error paths).

### Comment Quality

Runs when the diff adds or modifies comments, docstrings, or JSDoc. Keeps comments truthful, valuable, and unlikely to rot.

Key areas: accuracy (does comment match code?), value (explains non-obvious WHY vs restating WHAT), maintenance risk (drift likelihood, implementation-detail coupling), and style (brevity, no trailing summaries).

### Docs Impact

Runs when the diff adds, removes, or renames public APIs, CLI flags, environment variables, or other user-facing behavior. Catches missing or stale documentation.

Key areas: new surface without docs, changed surface with stale docs, removed surface with dangling references. Checks CLI commands/flags, environment variables, API routes, workflow fields, configuration fields, and default behavior changes.

> CHANGELOG.md is out of scope — the project generates changelogs from squash-commit history at release time.

## Synthesis Methodology

The synthesizer reads all dimension findings and:

1. **Deduplicates** — issues surfacing in multiple dimensions (e.g., missing test for an error path appears in both error-handling and test-coverage) get merged with the most actionable wording.
2. **Groups by severity** across all dimensions, not by dimension:
   - **CRITICAL**: merge-blocking, data-loss, silent-failure issues
   - **HIGH**: real bugs, missing test for a fix, missing docs for new public surface, project rules violations
   - **MEDIUM**: edge cases, comment rot risks, minor docs polish
   - **LOW/NITPICK**: style, naming, optional improvements
3. **Orders by file path** within each tier for scannable top-to-bottom reading.

### Synthesis Output

Produces two artifacts:

**Synthesis document** — structured verdict (`ready-to-merge` / `minor-fixes-needed` / `blocking-issues`), summary, all findings grouped by severity with source dimension attribution, project rules compliance summary, and list of aspects run/skipped.

**Draft PR comment** — maintainer-ready markdown for posting to the PR. Addresses the contributor directly, uses specific file:line references with concrete fixes, groups into blocking issues / suggested fixes / minor items, and optionally includes 1-2 genuine compliments. Tone: specific, no corporate-speak, no excessive praise.

## Final Report Format

The final report is a one-screen summary:

- Synthesized verdict and finding counts
- List of aspects run
- Pointer to the full synthesis and draft comment
- 2-3 concrete next-step bullets for the maintainer (e.g., "merge when CI is green", "wait for contributor reply")

## Findings Format

All dimensions use the same structure:

```markdown
### SEVERITY (count)

- **file:line**: description
  - From: dimension(s) that flagged this
  - **Why it matters**: impact
  - **Suggested fix**: concrete change
```

When a dimension finds nothing to flag, it records "None" rather than manufacturing issues.
