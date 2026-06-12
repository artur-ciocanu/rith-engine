# Review Dimensions — Detailed Criteria

Detailed evaluation criteria for each review dimension in the maintainer review skill.

---

## Code Quality

### Bugs and Correctness

- Logic errors, off-by-one, null/undefined dereferences, race conditions, resource leaks.
- Incorrect or missing error handling. Silent catches that swallow errors.
- API misuse (wrong types, wrong arguments, deprecated calls).
- Concurrency bugs in async code.

### Project Rules Compliance

- TypeScript: explicit return types? No `any` without justification?
- Imports: typed imports for types? Namespace imports for submodules?
- Logging: structured Pino with `{domain}.{action}_{state}` event names?
- Error handling: errors surfaced, not swallowed? `classifyIsolationError` used where appropriate?
- Database: rowCount checks on UPDATEs? Errors logged with context?
- Workflow: schema rules followed? `output_format` for `when:` consumers?

### Project Conventions

- Patterns that match existing code (look at neighboring files for reference)?
- Naming, structure, and organization aligned with the rest of the package?
- Cross-package boundaries respected (no `import * from '@rith/core'`, etc.)?

### Bug-Likelihood Signals

- New conditional branches without tests?
- Hardcoded values that should be configurable?
- TODO / FIXME / HACK / XXX comments left in?

### Findings Format

```markdown
# Code Review — PR #<n>

## Summary
<1-2 sentences. Verdict: ready-to-merge / minor-fixes-needed / blocking-issues.>

## Findings

### CRITICAL
- **<file:line>**: <description>
  - **Why it matters**: <impact>
  - **Suggested fix**: <concrete change>

### HIGH
- (same format)

### MEDIUM
- (same format)

### LOW / NITPICK
- (same format)

## Project rules compliance
<bullet list of any violations, or "Compliant.">

## Notes for synthesizer
<anything the synthesize step should know>
```

If nothing to flag: `## Findings\n\nNone — code looks clean.`

---

## Error Handling

### Silent-Failure Risks

- Is an error caught and ignored without logging?
- Is a fallback returned that hides the actual problem from the caller?
- Is a `try` block too broad, catching errors that should propagate?
- Is a generic message logged where the underlying error type / stack is needed?

### Error Consistency

- Does the new code use the project's standard error utilities (`classifyIsolationError`, structured Pino logging)?
- Are error events named per the `{domain}.{action}_{state}` convention?
- Are errors thrown with enough context (id, operation, parameters)?

### Promise / Async Correctness

- Unhandled promise rejections? Missing `await`?
- `Promise.all` vs `Promise.allSettled` — is the choice intentional?
- Cancellation / timeout handling correct?

### User-Facing Error UX

- Are errors surfaced to the user with **actionable** messages, or just generic "something went wrong"?
- For platform adapters: does the error reach the chat / web UI?

### Findings Format

```markdown
# Error Handling Review — PR #<n>

## Summary
<1-2 sentences. Risk level: low / medium / high.>

## Findings

### CRITICAL — silent failures
- **<file:line>**: <description>
  - **Why it matters**: <what breaks silently>
  - **Suggested fix**: <concrete change>

### HIGH — inconsistent error patterns
### MEDIUM — context / actionability
### LOW / NITPICK

## Notes for synthesizer
```

If no concerns: `## Findings\n\nNone — error handling is consistent and surfaces failures appropriately.`

---

## Test Coverage

### Behavioral Coverage

- Is the **happy path** covered?
- Are **edge cases** covered? (Empty input, oversized input, malformed input, concurrent calls, etc.)
- Are **error paths** covered? (Throws when expected, returns null when expected.)
- Is the test asserting on the **right thing**? (Output value? Side effect? Both?)

### Test Quality

- Are tests deterministic? No timing, no real network, no real filesystem unless intentional?
- Mock pollution: does the file use `mock.module()` in a way that conflicts with other test files in the same package?
- Test isolation: does each test set up and tear down its own state?

### Coverage Gaps to Flag

- New public function with no test → flag.
- New conditional branch with no test → flag.
- Bug fix without a regression test → flag (the test should fail before the fix).
- New error path with no test → flag.

### Don't Flag

- Trivial getters/setters with no logic.
- Internal helpers tested transitively through public API tests.
- Documentation-only or formatting-only changes.

### Findings Format

```markdown
# Test Coverage Review — PR #<n>

## Summary
<1-2 sentences. Coverage: adequate / minor-gaps / significant-gaps.>

## Findings

### CRITICAL — bug fix without regression test
- **<file:line>**: <description>
  - **Suggested test**: <what to test, what assertion>

### HIGH — new behavior without coverage
### MEDIUM — edge cases / error paths missing
### LOW — improvements

## Mock isolation concerns
<bullet list or "None.">

## Notes for synthesizer
```

If adequate: `## Findings\n\nAdequate coverage for the changed behavior.`

---

## Comment Quality

### Accuracy

- Does the comment match what the code actually does?
- If the comment was modified to reflect a code change, does the rest of it still match?

### Value

- Does the comment explain a non-obvious WHY (constraint, invariant, gotcha)?
- Or does it restate WHAT the code does? (Restating WHAT = comment rot risk.)
- Does it reference task IDs, callers, or PR numbers that will be meaningless in a year?

### Maintenance Risk

- Is the comment likely to drift out of date when the code changes?
- Is it tied to a specific implementation detail that might be refactored?

### Style

- One short line preferred. Multi-line blocks only when truly necessary.
- No trailing summaries that just describe the next line.

### Comment Policy

- Default to writing **no comments**.
- Only add when the **WHY** is non-obvious (hidden constraint, subtle invariant, workaround).
- Don't explain WHAT (well-named identifiers do that).
- Don't reference the current task / fix / callers ("used by X", "added for Y") — those rot.
- Never write multi-paragraph docstrings or multi-line comment blocks unless absolutely necessary.

### Findings Format

```markdown
# Comment Quality Review — PR #<n>

## Summary
<1-2 sentences. Quality: good / minor-issues / significant-rot-risk.>

## Findings

### HIGH — inaccurate comments (don't match the code)
- **<file:line>**: <description>
  - **Suggested fix**: <update or remove>

### MEDIUM — comment rot risk
### LOW — style / consistency

## Comments that are actually valuable
<optionally call out 1-2 good examples>

## Notes for synthesizer
```

If clean: `## Findings\n\nComments are accurate and capture non-obvious WHY where present.`

---

## Docs Impact

### What Counts as User-Facing

- New CLI command or flag (in `packages/cli/`).
- New environment variable.
- New / removed / renamed API route (in `packages/server/src/routes/`).
- New workflow node type, command file, or workflow YAML field.
- New configuration field in `.rith/config.yaml`.
- Change in default behavior that an existing user would notice.

### What Doesn't Count

- Internal refactors with no API change.
- Test-only changes.
- Bug fixes that restore documented behavior.

### For Each User-Facing Change

- **New surface**: is there a docs page describing it? Is it linked from a landing page or the relevant section?
- **Changed surface**: are existing docs pages still accurate? Do they need updates?
- **Removed surface**: are existing references stale? `grep` the docs site for old name.

### Specific Places to Check

- `packages/docs-web/src/content/docs/getting-started/` — quickstart, install, concepts.
- `packages/docs-web/src/content/docs/guides/` — workflow authoring, hooks, MCP, scripts.
- `packages/docs-web/src/content/docs/reference/` — CLI, variables, configuration.
- `packages/docs-web/src/content/docs/adapters/` — Slack, Telegram, GitHub, Discord, Web.
- `packages/docs-web/src/content/docs/deployment/` — Docker, cloud.

> CHANGELOG.md is out of scope. The project generates changelogs from squash-commit history at release time; do not flag missing CHANGELOG entries.

### Findings Format

```markdown
# Docs Impact Review — PR #<n>

## Summary
<1-2 sentences. Status: in-sync / minor-gaps / significant-gaps.>

## User-facing changes detected
- <change 1> (file:line)

## Findings

### CRITICAL — missing docs for new public surface
- **<change>**: <description>
  - **Where to add**: <path/to/docs/page.md>
  - **What to write**: <one-sentence summary>

### HIGH — stale docs from changed/removed surface
### MEDIUM — minor gaps (examples, missing cross-link)
### LOW — nice-to-have polish

## Pages that look in-sync
<docs updated correctly in the same PR>

## Notes for synthesizer
```

If no user-facing changes: `## Findings\n\nNo user-facing changes — no docs updates needed.`

---

## Synthesis

### Aggregation Rules

1. Read all available dimension findings files. Some may be missing — that's expected.
2. Deduplicate: issues surfacing in multiple dimensions get merged with the most actionable wording.
3. Group by severity across all dimensions (not by dimension):
   - **CRITICAL**: merge-blocking, data-loss, silent-failure issues
   - **HIGH**: real bugs, missing test for a fix, missing docs for new public surface, project rules violation
   - **MEDIUM**: edge cases, comment rot risks, minor docs polish
   - **LOW/NITPICK**: style, naming, optional improvements
4. Order by file path within each tier.

### Synthesis Document Format

```markdown
# Maintainer Review — PR #<n>

## Verdict
<ready-to-merge | minor-fixes-needed | blocking-issues>

## Summary
<2-3 sentence overview>

## Findings

### CRITICAL (N)
- **<file:line>**: <description>
  - From: <which aspect(s) flagged this>
  - **Suggested fix**: <concrete change>

### HIGH (N)
### MEDIUM (N)
### LOW / NITPICK (N)

## Project rules compliance
<violations or "Compliant.">

## Aspects run
- code-review: <yes/no, summary>
- error-handling: <yes/no, summary>
- test-coverage: <yes/no, summary>
- comment-quality: <yes/no, summary>
- docs-impact: <yes/no, summary>

## Aspects skipped
<list with reason>
```

### Draft PR Comment Format

```markdown
## Review Summary

**Verdict**: <ready-to-merge | minor-fixes-needed | blocking-issues>

<2-3 sentence overview for the PR author>

### Blocking issues
- (CRITICAL findings, file:line, fix suggestion)

### Suggested fixes
- (HIGH findings)

### Minor / nice-to-have
- (MEDIUM + LOW combined)

### Compliments
<optional: 1-2 genuine things the PR did well>

---
_Reviewed via maintainer-review workflow. Aspects run: <list>._
```

**Tone**: address the contributor directly ("you", "your change"). Be specific — file:line + concrete fix. No corporate-speak, no excessive praise, no AI-attribution-by-name (the footer line is enough).

---

## Final Report Format

```markdown
# Maintainer Review — PR #<n> — Final

## Outcome
- Synthesized verdict: <verdict>
- Findings: <N CRITICAL / N HIGH / N MEDIUM / N LOW>
- Aspects run: <list>

## Next steps for the maintainer
- <2-3 short bullets with concrete actions>
```

Numbers in the report must match the synthesis (don't invent finding counts). Lists concrete next steps for the maintainer.
