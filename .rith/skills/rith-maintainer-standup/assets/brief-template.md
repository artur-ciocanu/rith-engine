# Brief Output Template

The standup brief follows this structure. Adapt sections — omit empty ones, add others if useful. Keep entries to one line each. The brief should be readable on a single screen.

```markdown
# Maintainer Standup — YYYY-MM-DD

## Since last run

- (Summary of new commits on dev with notable highlights, or "first run — baseline snapshot")
- (Mention pull_status if not 'pulled': dirty/not_on_dev/pull_failed)

## What you shipped

- (One-line summary grouped by area, derived from `my_recent_commits`. Omit if empty.)

## Resolved since last run

- **PR #N** — [title] — merged ✓ / closed
- **Issue #N** — [title] — closed
- (Omit section if nothing resolved.)

## Replies waiting on you

- **PR #N** — @author replied (N comments since last run): [one-line excerpt of latest comment]. [URL]
- **Issue #N** — @author commented: [excerpt]. [URL]
- (Sort by recency; surface inline-review-comment kinds first since they usually need a code-level response. Omit section if `replies_since_last_run` is empty.)

## P1 — Do today

- **PR #N** — [title] ([+X/-Y]) — [why P1, e.g. "ready to merge, awaiting your review"]
- **Issue #N** — [title] — [why P1]

## P2 — This week

- (Same format)

## P3 — Whenever

- (Same format)

## P4 — Polite-decline candidates

- **PR #N** — [title] by @[author] — Conflicts with `direction.md §[clause]`. [One-line reason.]

## Direction questions raised

- (PR #N raises: should Rith Engine support [Y]? Add a stance to direction.md.)
- (Or omit if none.)

## Carry-over still pending

- **PR #N** — [title] — first seen YYYY-MM-DD ([N] runs ago) — [current status]
- (Omit section if nothing carried over.)
```

## Output Sequence

1. Brief markdown starting with the `# Maintainer Standup` heading
2. State JSON block delimited by `RITH_STATE_JSON_BEGIN` and `RITH_STATE_JSON_END`

## Hard Rules

- Start the response with the `#` heading. No prose preamble.
- Do NOT wrap the response in a JSON object.
- Do NOT use markdown code fences around the state markers.
- Nothing after the closing marker.
