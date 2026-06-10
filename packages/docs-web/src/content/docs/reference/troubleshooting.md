---
title: Troubleshooting
description: Common issues and solutions when running Rith Engine locally.
category: reference
audience: [user, operator]
status: current
sidebar:
  order: 7
---

Common issues and their solutions when running Rith Engine.

## Database Connection Errors

Rith Engine uses SQLite at `~/.rith/rith.db`. The database is created and its schema initialized automatically on first run — no setup is required.

If you see database errors:
- Check that the `~/.rith/` directory exists and is writable.
- Inspect the tables with `sqlite3 ~/.rith/rith.db ".tables"`.
- If the database file is corrupted, remove it — Rith Engine recreates it on the next run:

```bash
rm ~/.rith/rith.db
```

## Clone Command Fails

**Verify GitHub token:**
```bash
cat .env | grep GH_TOKEN
# Should have both GH_TOKEN and GITHUB_TOKEN set
```

**Test token validity:**
```bash
# Test GitHub API access
curl -H "Authorization: token $GH_TOKEN" https://api.github.com/user
```

**Check workspace permissions:**

The workspace directory is `~/.rith/workspaces/` by default. Make sure it exists and is writable.

**Try manual clone:**
```bash
git clone https://github.com/user/repo ~/.rith/workspaces/test-repo
```

## Pi Provider Errors

**Symptom:** A workflow fails with `Pi provider requires a model`.

**Cause:** No model resolved. Pi needs a model from one of these sources (highest priority first): a node's `model:`, the workflow's top-level `model:`, or `pi.model` in `.rith/config.yaml`.

**Fix:** Set a model in Pi format `<pi-provider-id>/<model-id>` (e.g. `anthropic/claude-sonnet-4-5`):

```yaml
# ~/.rith/config.yaml or .rith/config.yaml
pi:
  model: anthropic/claude-sonnet-4-5
```

**Symptom:** Authentication errors when Pi calls the model backend.

**Cause:** No credentials. Pi is bundled with Rith Engine — there is nothing to install — but it still needs auth for the chosen backend.

**Fix:** Run `pi /login` (OAuth, writes `~/.pi/agent/auth.json`, picked up automatically) or export an API key — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`. Local backends (LM Studio, ollama) registered in `~/.pi/agent/models.json` need no credentials.

## Workflows Hang Silently When Run Inside Claude Code

**Symptom:** Workflows started from within a Claude Code session (e.g., via the Terminal tool) produce no output, or the CLI emits a warning about `CLAUDECODE=1` before the workflow hangs.

**Cause:** Nested Claude Code sessions can deadlock — the outer session waits for tool results that the inner session never delivers.

**Fix:** Run `rith` from a regular shell outside a nested session.

**Suppress the warning:** If you have a non-deadlocking setup and want to silence the warning:

```bash
RITH_SUPPRESS_NESTED_CLAUDE_WARNING=1 rith workflow run ...
```

## Worktree Belongs to a Different Clone

**Symptom:** Running a workflow (especially with `--branch <name>`) from one local clone surfaces one of these errors:

- `Worktree at <path> belongs to a different clone (<other-clone-path>). Remove it from that clone or use a different codebase registration.`
- `Cannot verify worktree ownership at <path>: <reason>`
- `Cannot adopt <path>: path contains a full git checkout, not a worktree.`
- `Cannot adopt <path>: .git pointer is not a git-worktree reference.`

**Cause:** Rith Engine derives codebase identity from the remote URL (`owner/repo`), so two local clones of the same remote share one `codebase_id`. Worktrees are stored under a shared path (`~/.rith/workspaces/<owner>/<repo>/worktrees/`), which means a worktree created by clone A is visible on disk from clone B. The isolation system refuses to silently adopt across clones because it would operate on the wrong filesystem state.

**Fix — pick one:**

1. **Remove the other clone's worktree.** If you no longer need the other clone's in-progress work:

   ```bash
   # From the other clone's directory, find and remove the conflicting worktree
   rith isolation list
   rith complete <branch-name>          # graceful cleanup
   # or, if no work to preserve:
   git worktree remove <path> --force
   ```

2. **Use a different branch name** for this run so the two clones don't compete for the same worktree path:

   ```bash
   rith workflow run <name> --branch <different-name> "task"
   ```

3. **Work from a single clone.** If both local checkouts are for the same project, consolidate to one. Rith Engine's codebase registration currently assumes one local path per remote; true multi-clone support is tracked in [#1192](https://github.com/artur-ciocanu/rith-engine/issues/1192).

**Other variants:**

- `path contains a full git checkout, not a worktree`: something non-Rith Engine created a full git repo at the worktree path. Remove or move it.
- `.git pointer is not a git-worktree reference`: the `.git` file at that path points somewhere unexpected (submodule, malformed). Inspect it with `cat <path>/.git` and clean up manually.
- `Cannot verify worktree ownership`: filesystem permission or I/O error reading `<path>/.git`. Check `ls -la <path>` and file permissions on `~/.rith/workspaces`.
