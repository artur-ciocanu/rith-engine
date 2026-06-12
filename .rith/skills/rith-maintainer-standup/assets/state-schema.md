# State JSON Schema

The state JSON block is emitted at the end of every standup brief, delimited by exact marker lines:

```
RITH_STATE_JSON_BEGIN
{ ... }
RITH_STATE_JSON_END
```

Each marker must be on its own line. No code fences around the markers. Valid JSON between them.

## Schema

```json
{
  "last_run_at": "<ISO-8601 timestamp>",
  "last_dev_sha": "<current_dev_sha from git-status>",
  "carry_over": [
    {
      "kind": "pr | issue | task | direction_question",
      "id": "<PR/issue number as string>",
      "note": "<why carried>",
      "first_seen": "<YYYY-MM-DD>"
    }
  ],
  "observed_prs": [
    {
      "number": 123,
      "title": "<PR title>"
    }
  ],
  "observed_issues": [
    {
      "number": 45,
      "title": "<issue title>"
    }
  ],
  "direction_questions": ["<surfaced question string>"]
}
```

## Field Semantics

### `last_run_at`
Current ISO-8601 timestamp at synthesis time. Used by the next run to compute "since last run" windows.

### `last_dev_sha`
Value from `git-status.output.current_dev_sha`. Used to detect new commits between runs.

### `carry_over`
Items the next run should remember as "still pending."

- `kind`: one of `pr`, `issue`, `task`, `direction_question`
- `id`: PR or issue number as a string
- `note`: why the item is carried over
- `first_seen`: `YYYY-MM-DD` — **preserve the original date** for items already in prior state so age is tracked correctly across runs

Items resolved since the last run MUST be removed from `carry_over` and surfaced in the "Resolved since last run" brief section.

### `observed_prs`
Snapshot of ALL currently-open PRs (number + title only). Must include every entry in `all_open_prs`, not just classified ones. Used to detect new PRs and resolved PRs on the next run.

### `observed_issues`
Same as `observed_prs` but for assigned + unlabeled issues.

### `direction_questions`
New direction questions surfaced this run (string array). Questions about project stances not covered by the direction document.

## Rules

- Use empty arrays `[]` for sections with no entries — do not omit fields.
- All fields are required.
- `carry_over[].first_seen` must be preserved from prior state for ongoing items.
- `observed_prs` must be exhaustive (all open PRs, not a subset).
