---
name: rith-git
description: |
  Git workflow conventions for branch management, commits, PRs, rebasing, and
  conflict resolution. Use when creating branches, making commits, opening or
  updating pull requests, syncing with main, or resolving merge conflicts.
  Triggers: "create PR", "open pull request", "sync with main", "resolve
  conflicts", "rebase", "commit changes", "finalize PR".
compatibility: Requires git CLI
metadata:
  author: rith-engine
  version: "1.0"
---

# Git Workflow

Conventions and guardrails for branch management, commits, PRs, rebasing, and conflict resolution in Rith Engine worktrees.

---

## Worktree & Branch Awareness

Before any git operation, detect the environment:

```bash
BRANCH=$(git branch --show-current)
BASE_BRANCH=$BASE_BRANCH  # from workflow config, typically "main" or "dev"
```

- Rith workflows run in **isolated worktrees** — never assume you're in the main checkout.
- Always `git fetch origin $BASE_BRANCH` before comparing or rebasing.
- Use `git rev-list --count HEAD..origin/$BASE_BRANCH` to check how far behind you are.

---

## Selective Staging

**NEVER** use `git add -A`, `git add .`, or `git add -u`.

Stage only the files you intentionally changed:

```bash
git add path/to/file1 path/to/file2
git status --porcelain          # verify nothing unexpected is staged
git diff --cached --name-only   # final review of staged files
```

**Never stage** scratch or workflow artifacts:
- `.pr-body.md`, `*.scratch.md`, `*.tmp.md`
- `review/`, `*-report.md` at repo root
- Anything under the workflow artifacts directory
- `.env`, credentials, secrets

---

## Commit Format

Use imperative mood. Include a summary line and bullet-point body for non-trivial changes:

```
<summary of implementation>

- <key change 1>
- <key change 2>
- <key change 3>

Implements #<issue> | Fixes #<issue>
```

Only reference an issue number if one exists. Don't fabricate references.

---

## PR Creation

### Pre-flight Checks

1. **Duplicate detection** — extract issue number from branch name, search for existing open PRs:
   ```bash
   ISSUE_NUM=$(echo "$BRANCH" | grep -oE '[0-9]+' | tail -1)
   gh pr list --search "Fixes #${ISSUE_NUM} OR Closes #${ISSUE_NUM}" --state open --json number,url,headRefName
   ```
   If a matching PR exists, report it and stop — don't create duplicates.

2. **Existing PR on branch** — check before creating:
   ```bash
   gh pr list --head "$BRANCH" --json number,url,state
   ```
   If one exists, update it instead of creating a new one.

3. **Commits exist** — verify `git log origin/$BASE_BRANCH..HEAD --oneline` is non-empty.

### PR Template

Check `.github/pull_request_template.md` (or `PULL_REQUEST_TEMPLATE.md`, or `docs/` variant). If found, fill in **every section** — no placeholders. If absent, use: Summary, Changes (file list), Validation (checklist), and a `Closes #XXX` footer.

### Title & Body

- Concise, imperative mood title from implementation summary or commits.
- Write body to a file to avoid shell-escaping: `gh pr create --title "<title>" --body-file pr-body.md --base $BASE_BRANCH`
- Capture PR number after creation: `PR_NUMBER=$(gh pr view --json number -q '.number')`

- If created as draft, mark ready: `gh pr ready $PR_NUMBER`

---

## Sync with Base Branch

Use rebase to keep history linear. Only sync when behind.

### Decision Flow

1. Check: `BEHIND=$(git rev-list --count HEAD..origin/$BASE_BRANCH)`
2. If `BEHIND=0` → skip, already current.
3. If `BEHIND>0` → rebase:
   ```bash
   git rebase origin/$BASE_BRANCH
   ```
4. On success → validate (type-check, tests), then force-push.
5. On conflict → resolve (see below), then continue rebase.

### Force Push Safely

Always use `--force-with-lease` — it fails if someone else pushed to the branch:

```bash
git push --force-with-lease origin $BRANCH
```

---

## Merge Conflict Resolution

### Conflict Categories

| Type | Description | Auto-resolvable? |
|------|-------------|-------------------|
| **SIMPLE_ADDITION** | One side added, other unchanged | Yes |
| **DIFFERENT_AREAS** | Both changed different lines | Yes |
| **IMPORT_MERGE** | Both added different imports | Yes |
| **SIMPLE_DELETION** | One side deleted, other unchanged | Maybe — check intent |
| **SAME_LINES** | Both changed identical lines | No — needs decision |
| **STRUCTURAL** | File moved/renamed + modified | No — needs decision |

### Auto-Resolution Rules

- Both added different things → keep both additions
- One updated, other didn't touch → keep the update
- Import additions → merge both import lists
- Comment changes → prefer the more informative version

### Complex Conflict Resolution

When both sides changed the same lines:

1. Understand intent — read the three versions:
   ```bash
   git show :1:<file>   # base (common ancestor)
   git show :2:<file>   # ours (current branch)
   git show :3:<file>   # theirs (incoming)
   ```
2. Choose based on: PR intent, code correctness, which change is more recent/complete.
3. Document reasoning for non-obvious choices.

### Rebase Conflict Loop

```bash
git rebase origin/$BASE_BRANCH
# For each conflict:
#   1. Identify: git diff --name-only --diff-filter=U
#   2. Resolve each file
#   3. Stage: git add <file>
#   4. Continue: git rebase --continue
# Repeat until rebase completes
```

---

## Error Recovery

| Problem | Action |
|---------|--------|
| No commits to push | Nothing to PR — report and stop |
| Push rejected | `git pull --rebase origin $BASE_BRANCH`, retry |
| Permission denied | Check GitHub access/token |
| Rebase fails badly | `git rebase --abort`, try merge-based approach |
| PR already exists for branch | Update existing PR instead of creating new |

---

## Guardrails

- **Never** commit without reviewing `git diff --cached`.
- **Never** force-push without `--force-with-lease`.
- **Never** auto-resolve `SAME_LINES` or `STRUCTURAL` conflicts — these require understanding intent.
- **Always** validate (type-check, test, lint) after conflict resolution before pushing.
- **Always** check for existing PRs before creating new ones.
- **Always** use the project's PR template when one exists.
