# Review — Skill

Systematic code review methodology: scoping, multi-dimension analysis, synthesis, and fix implementation.

## Overview

A review is a structured pass over a PR or changeset across five dimensions (see `review-dimensions.md`). The workflow:

1. **Scope** — gather context, verify reviewability
2. **Analyze** — evaluate each dimension in parallel
3. **Synthesize** — consolidate, deduplicate, prioritize
4. **Fix** — implement CRITICAL/HIGH findings, push to branch

## Scoping a Review

Before analysis, verify the PR is reviewable:

- No merge conflicts (block if present)
- Note CI status, draft status, behind-base count
- Categorize changed files: source, test, docs, config
- Extract scope limits from plan/investigation artifacts — intentional exclusions are NOT bugs
- Scan the diff for new abstractions; flag potential primitive duplication

Write a scope manifest capturing: changed files, file categories, project rules to check, review focus areas, and any scope limits.

## Analyzing Each Dimension

For each dimension in `review-dimensions.md`:

1. Load the PR diff and scope manifest
2. Read project rules/conventions relevant to that dimension
3. Evaluate every changed file against the dimension's criteria
4. For each finding, record: severity, category, location, evidence, impact
5. Provide fix suggestions with multiple options and reasoning
6. Reference existing codebase patterns as evidence

**Severity levels:**
- **CRITICAL** — must fix before merge (bugs, security, data loss)
- **HIGH** — should fix before merge (silent failures, missing validation)
- **MEDIUM** — consider fixing (code quality, naming, minor gaps)
- **LOW** — nice-to-have (style, minor comments)

## Synthesizing Findings

After all dimensions are analyzed:

1. Aggregate findings across all dimensions by severity
2. Deduplicate — same issue found by multiple dimensions gets merged
3. Resolve conflicting recommendations
4. Compute statistics per dimension and severity
5. Determine overall verdict: APPROVE, REQUEST_CHANGES, or NEEDS_DISCUSSION
6. Identify auto-fix candidates (CRITICAL + HIGH with clear fixes)
7. Present MEDIUM issues with options: fix now / create issue / skip
8. List LOW issues as a summary table
9. Note positive observations — good patterns, clean code, thorough tests
10. Suggest follow-up issues for deferred items

Post the consolidated review as a PR comment with collapsible detail sections.

## Implementing Fixes

After synthesis, implement all CRITICAL and HIGH findings:

1. Check out the PR's head branch (never create a new branch)
2. For each finding marked for auto-fix:
   - Read the target file
   - Apply the recommended fix
   - Run type-check immediately; fix any errors
3. For test coverage gaps on fixed code, add tests
4. If a fix cannot be applied (code drift, architectural complexity, ambiguity), mark as BLOCKED with reason
5. Validate: type-check, lint, tests must all pass
6. Stage only files you edited — never bulk-add
7. Commit with a message listing fixes applied, tests added, and items skipped
8. Push to the PR branch

### Triage Rules

**Fix** (default — lean towards fixing):
- Real bugs, type errors, silent failures
- Missing tests for code touched by the PR
- Missing or outdated documentation
- Error handling gaps, comment quality issues
- Any finding where the fix is concrete and within the PR's touched area

**Skip** only when:
- The fix introduces a genuinely new feature unrelated to the PR
- The fix requires architectural changes to untouched subsystems
- The finding is factually wrong

For each skipped finding, document the specific reason. Suggest follow-up issues for skipped/blocked items that warrant separate work.

## Output Behavior

Keep working output minimal — the final report is what matters. Do not narrate each step. Use todo tracking for silent progress. Output only the structured fix report at the end.

## Assets

- `review-dimensions.md` — criteria, anti-patterns, and pass/fail signals for each review dimension
