---
name: rith-maintainer-standup
description: |
  Daily maintainer standup briefing synthesis. Gathers git activity, PR status,
  issue state, and produces a prioritized daily brief with persistent state
  tracking. Use for morning standups, daily project status, or maintainer
  briefings.
  Triggers: "standup", "morning brief", "daily status", "maintainer standup",
  "project status".
metadata:
  author: rith-engine
  version: "1.0"
---

# Maintainer Standup Briefing

Produces a prioritized daily brief for the project maintainer by gathering git activity, GitHub PR/issue state, and cross-referencing against the project's direction document and maintainer profile. Tracks state across runs to detect progress, new items, and aging carry-overs.

## What the Standup Produces

1. **Brief markdown** — a single-screen maintainer-ready status starting with `# Maintainer Standup — YYYY-MM-DD`
2. **State JSON block** — delimited by `RITH_STATE_JSON_BEGIN` / `RITH_STATE_JSON_END` markers for persistence across runs

The output format template is in `assets/brief-template.md`. The state JSON schema is in `assets/state-schema.md`.

## Data Gathering Methodology

The standup consumes three upstream data sources (all pre-gathered as JSON):

### Git Status

Fields: `current_dev_sha`, `prior_dev_sha`, `current_branch`, `is_dirty`, `pull_status`, `new_commits`, `diff_stat`. Tracks origin/dev movement since the last run.

### GitHub Data

Fields: `gh_handle`, `since_date`, `all_open_prs`, `review_requested`, `authored_by_me`, `issues_assigned`, `recent_unlabeled_issues`, `recently_closed_prs`, `recently_closed_issues`, `my_recent_commits`, `replies_since_last_run`.

`replies_since_last_run` groups contributor replies on PRs/issues since the last run (kind: `issue` / `pr_conversation` / `pr_review`; maintainer's own comments filtered out). Used for the "Replies waiting on you" section.

### Local Context

Fields: `direction` (markdown), `profile` (markdown), `prior_state` (object or null), `recent_briefs` (array of `{date, content}`), `today`, `deadline_3d`, `reviewed_prs` (map of PR number → `{ reviewed_at, gate_verdict, run_id }`).

## Analysis Methodology

### First-Run vs Ongoing

If `prior_state` is null and `recent_briefs` is empty, skip "Since last run" comparisons. Produce a baseline triage and state snapshot.

### Progress Detection (when prior_state exists)

- **Resolved since last run**: PRs in `prior_state.observed_prs` not in current `all_open_prs` — cross-reference `recently_closed_prs` (merged vs closed). Same for issues.
- **Carry-over revisited**: each `prior_state.carry_over` item — still open? Status changed? If resolved, mention in brief and DROP from state. If pending, keep with original `first_seen` date.
- **What you shipped**: `my_recent_commits` grouped by area, notable highlights.
- **New since last run**: PRs/issues in current data but not in `prior_state.observed_prs`/`observed_issues`.

### PR Triage (P1–P4)

For each PR in `all_open_prs`:

- **P1 (Do today)**: Ready-to-merge awaiting review (`mergeStateStatus: clean`), security fixes, items breaking dev, release blockers. For ambiguous CI, run `gh pr checks <number>`.
- **P2 (This week)**: In-flight PRs needing review/feedback, merge conflicts that can be unblocked, focus-area PRs progressing.
- **P3 (Whenever)**: Low-urgency, drafts, exploratory, outside current focus.
- **P4 (Polite-decline)**: Conflicts with direction doc. Each MUST cite a specific clause (e.g., `direction.md §single-developer-tool`).

Use `gh pr view/diff/checks <number>` to drill into 5–10 ambiguous cases. Don't drill into all.

### Issue Triage

Issues in `issues_assigned` and `recent_unlabeled_issues` follow the same P1–P4 classification. Recently-filed unlabeled issues are candidates for first-pass labeling.

### Direction Questions

PRs raising "we don't have a stance on this" questions go under **Direction questions raised** and into `state.direction_questions`.

### Carry-Over Aging

Items in `carry_over` for multiple runs (check `first_seen`) are higher priority — surface prominently, consider escalating P-level.

### Review-History Awareness

`reviewed_prs` records past review workflow runs. When listing PRs in any tier, append markers:

- **Reviewed**: `✓ reviewed Nd ago`
- **Declined**: `✓ declined Nd ago`
- **Unclear**: `✓ triaged Nd ago (unclear)`

**Staleness check**: if PR's `updatedAt > reviewed_at`, append `⚠ contributor pushed since` (skip same-day commits).

## Output Rules

- Response starts with the `# Maintainer Standup` heading. No prose preamble.
- Do NOT wrap in a JSON object. Do NOT use code fences around state markers.
- Nothing after the closing `RITH_STATE_JSON_END` marker.
- Every PR in `all_open_prs` must be classified into P1–P4 AND included in `observed_prs`.
- All P4 entries cite a specific direction doc clause.
- Carry-over items preserve original `first_seen`.
- Resolved items surfaced in brief AND removed from `state.carry_over`.

## State Persistence

The persist node parses the output by splitting on the `RITH_STATE_JSON_BEGIN`/`RITH_STATE_JSON_END` delimiters:

- **Brief**: everything before `RITH_STATE_JSON_BEGIN` → written to `.rith/maintainer-standup/briefs/<date>.md`
- **State**: JSON between the markers → written to `.rith/maintainer-standup/state.json`

See `assets/state-schema.md` for the full state JSON schema and field semantics. See `assets/brief-template.md` for the output template.

## Profile and Direction Integration

- **Profile scope** drives breadth: `scope: everything` means classify all open PRs.
- **Direction clauses** drive polite-decline: PRs contradicting the IS-NOT list go to P4 with a citation.
- **Profile focus areas** weight prioritization within P1–P3.

## Checkpoints

- Response starts with `# Maintainer Standup` heading (no preamble)
- State block uses exact markers, each on its own line
- State block is valid JSON (no trailing commas, all required fields)
- Nothing follows the closing marker
- Every PR in `all_open_prs` classified or in `observed_prs`
- Carry-over `first_seen` dates preserved
- `state.last_dev_sha` set from `git-status.output.current_dev_sha`
- `state.observed_prs` includes ALL currently-open PRs
