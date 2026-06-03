---
title: CLI Reference
description: Complete reference for the Rith Engine command-line interface and all available commands.
category: reference
area: cli
audience: [user]
status: current
sidebar:
  order: 3
---

Run AI-powered workflows from your terminal.

## Prerequisites

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/artur-ciocanu/rith-engine
   cd Rith Engine
   bun install
   ```

2. Make CLI globally available (recommended):
   ```bash
   cd packages/cli
   bun link
   ```
   This creates an `rith` command available from anywhere.

3. Authenticate with Claude:
   ```bash
   claude /login
   ```

**Note:** Examples below use `rith` (after `bun link`). If you skip step 2, use `bun run cli` from the repo directory instead.

## Quick Start

```bash
# List available workflows (requires git repository)
rith workflow list --cwd /path/to/repo

# Run a workflow (auto-creates isolated worktree by default)
rith workflow run assist --cwd /path/to/repo "Explain the authentication flow"

# Explicit branch name for the worktree
rith workflow run plan --cwd /path/to/repo --branch feature-auth "Add OAuth support"

# Opt out of isolation (run in live checkout)
rith workflow run assist --cwd /path/to/repo --no-worktree "Quick question"
```

**Note:** Workflow and isolation commands require running from within a git repository. Running from subdirectories automatically resolves to the repo root. The `version`, `help`, `chat`, `setup`, `serve`, and `doctor` commands work anywhere.

## Commands

### `chat <message>`

Send a message for a one-off AI interaction.

```bash
rith chat "What does this function do?"
```

### `setup`

Interactive setup wizard for credentials and configuration.

```bash
rith setup                      # writes ~/.rith/.env (home scope, default)
rith setup --scope project      # writes <cwd>/.rith/.env instead
rith setup --force              # overwrite instead of merging (backup still written)
rith setup --spawn              # open in a new terminal window
```

**Flags:**

| Flag | Effect |
|------|--------|
| `--scope home` | Write to `~/.rith/.env` (default). Applies to every project. |
| `--scope project` | Write to `<cwd>/.rith/.env`. Overrides user scope for this repo only. |
| `--force` | Overwrite the target file wholesale instead of merging. A timestamped backup is still written. |
| `--spawn` | Open setup wizard in a new terminal window. |

**Write safety**: `rith setup` never writes to `<cwd>/.env` — that file belongs to you. The wizard always targets one rith-owned file chosen by `--scope`, merges into existing content (so user-added keys survive), and writes a timestamped backup before every rewrite (e.g. `~/.rith/.env.rith-backup-2026-04-20T09-28-11-000Z`).

### `doctor`

Verify your Rith Engine setup. Runs a checklist of common failure points: Claude binary spawn, gh CLI auth, Pi auth (when Pi is configured as default), database reachability, workspace writability, bundled defaults.

```bash
rith doctor
```

Exit code 0 if all checks pass or are skipped; 1 if any critical check fails. Adapter pings degrade to `skip` on network errors — a flaky connection does not flip the result red.

Also runs automatically at the end of `rith setup` (optional).

### `workflow list`

List workflows available in target directory.

```bash
rith workflow list --cwd /path/to/repo

# Machine-readable output for scripting
rith workflow list --cwd /path/to/repo --json
```

Discovers workflows from `.rith/workflows/` (recursive), `~/.rith/workflows/` (global, home-scoped), and bundled defaults. See [Global Workflows](/guides/global-workflows/).

**Flags:**

| Flag | Effect |
|------|--------|
| `--cwd <path>` | Target directory (required for most use cases) |
| `--json` | Output machine-readable JSON instead of formatted text |

With `--json`, outputs `{ "workflows": [...], "errors": [...] }`. Optional fields (`provider`, `model`, `modelReasoningEffort`, `webSearchMode`) are omitted when not set on a workflow.

### `workflow run <name> [message]`

Run a workflow with an optional user message.

```bash
# Basic usage
rith workflow run assist --cwd /path/to/repo "What does this function do?"

# With isolation
rith workflow run plan --cwd /path/to/repo --branch feature-x "Add caching"
```

Progress events (node start/complete/fail/skip, approval gates) are written to stderr during execution.

**Flags:**

| Flag | Effect |
|------|--------|
| `--cwd <path>` | Target directory (required for most use cases) |
| `--branch <name>` | Explicit branch name for the worktree |
| `--from <branch>`, `--from-branch <branch>` | Override base branch (start-point for worktree) |
| `--no-worktree` | Opt out of isolation -- run directly in live checkout |
| `--resume` | Resume from last failed run at the working path (skips completed nodes) |
| `--quiet`, `-q` | Suppress all progress output to stderr |
| `--verbose`, `-v` | Also show tool-level events (tool name and duration) |

**Default (no flags):**
- Creates worktree with auto-generated branch (`rith/task-<workflow>-<timestamp>`)
- Auto-registers codebase if in a git repo

**With `--branch`:**
- Creates/reuses worktree at `~/.rith/workspaces/<owner>/<repo>/worktrees/<branch>/`
- Reuses existing worktree if healthy

**With `--no-worktree`:**
- Runs in target directory directly (no isolation)
- Mutually exclusive with `--branch` and `--from`

**Name Matching:**

Workflow names are resolved using a 4-tier fallback hierarchy:
1. **Exact match** - `rith-assist` matches `rith-assist`
2. **Case-insensitive** - `Rith Engine-Assist` matches `rith-assist`
3. **Suffix match** - `assist` matches `rith-assist` (looks for `-assist` suffix)
4. **Substring match** - `smart` matches `rith-smart-pr-review`

If multiple workflows match at the same tier, an error lists the candidates:
```
Ambiguous workflow 'review'. Did you mean:
  - rith-review
  - custom-review
```

### `workflow status`

Show all running workflow runs across all worktrees.

```bash
rith workflow status
rith workflow status --json
```

### `workflow resume`

Resume a failed workflow run. Re-executes the workflow, automatically skipping nodes that completed in the prior run.

```bash
rith workflow resume <run-id>
```

### `workflow abandon`

Discard a workflow run (marks it as `cancelled`). Use this to unblock a worktree when you don't want to resume — the path lock is released immediately so a new workflow can start.

```bash
rith workflow abandon <run-id>
```

### `workflow approve`

Approve a paused workflow run at an interactive approval gate. Optionally provide a comment that is available to the workflow via `$LOOP_USER_INPUT`.

```bash
rith workflow approve <run-id>
rith workflow approve <run-id> "Looks good, proceed"
rith workflow approve <run-id> --comment "Looks good, proceed"
```

### `workflow reject`

Reject a paused workflow run at an approval gate. Optionally provide a reason that is available to the workflow via `$REJECTION_REASON`.

```bash
rith workflow reject <run-id>
rith workflow reject <run-id> --reason "Needs more tests"
```

### `workflow cleanup`

Delete old terminal workflow run records from the database.

```bash
rith workflow cleanup        # Default: 7 days
rith workflow cleanup 30     # Custom threshold
```

### `workflow event emit`

Emit a workflow event directly to the database. Primarily used inside workflow loop prompts to record story-level lifecycle events.

```bash
rith workflow event emit --run-id <uuid> --type <event-type> [--data <json>]
```

**Flags:**

| Flag | Required | Description |
|------|----------|-------------|
| `--run-id` | Yes | UUID of the workflow run |
| `--type` | Yes | Event type (e.g., `ralph_story_started`, `node_completed`) |
| `--data` | No | JSON string attached to the event. Invalid JSON prints a warning and is ignored. |

Exit code: 0 on success, 1 when `--run-id`, `--type` is missing, or `--type` is not a valid event type. Event persistence is best-effort (non-throwing) -- check server logs if events appear missing.

### `isolation list`

Show all active worktree environments.

```bash
rith isolation list
```

Groups by codebase, shows branch, workflow type, platform, and days since activity.

### `isolation cleanup [days]`

Remove stale environments.

```bash
# Default: 7 days
rith isolation cleanup

# Custom threshold
rith isolation cleanup 14

# Remove environments with branches merged into main (also deletes remote branches)
rith isolation cleanup --merged

# Also remove environments whose PRs were closed without merging
rith isolation cleanup --merged --include-closed
```

Merge detection uses three signals in order: git branch ancestry (fast-forward / merge commit),
patch equivalence (squash-merge via `git cherry`), and GitHub PR state via the `gh` CLI.
The `gh` CLI is optional — if absent, only git signals are used.

By default, branches with a **CLOSED** PR are skipped. Pass `--include-closed` to clean
those up as well. Branches with an **OPEN** PR are always skipped.

### `validate workflows [name]`

Validate workflow YAML definitions and their referenced resources (command files, MCP configs, skill directories).

```bash
rith validate workflows                 # Validate all workflows
rith validate workflows my-workflow     # Validate a single workflow
rith validate workflows my-workflow --json  # Machine-readable JSON output
```

Checks: YAML syntax, DAG structure (cycles, dependency refs), command file existence, MCP config files, skill directories, provider compatibility. Returns actionable error messages with "did you mean?" suggestions for typos.

Exit code: 0 = all valid, 1 = errors found.

### `validate commands [name]`

Validate command files (.md) in `.rith/commands/`.

```bash
rith validate commands                  # Validate all commands
rith validate commands my-command       # Validate a single command
```

Checks: file exists, non-empty, valid name.

Exit code: 0 = all valid, 1 = errors found.

### `complete <branch> [branch2 ...]`

Remove a branch's worktree, local branch, and remote branch, and mark its isolation environment as destroyed.

```bash
rith complete feature-auth
rith complete feature-auth --force  # bypass uncommitted-changes check
```

**Flags:**

| Flag | Effect |
|------|--------|
| `--force` | Skip uncommitted-changes guard |

Use this after a PR is merged and you no longer need the worktree or branches. Accepts multiple branch names in one call.

### `serve`

Start the optional web dashboard server (binary installs only). On first run, downloads a pre-built web UI tarball from the matching GitHub release, verifies the SHA-256 checksum, and extracts it. Subsequent runs use the cached copy.
**Binary installs only** — in development, use `bun run dev` instead.

```bash
# Start web UI server (downloads on first run)
rith serve

# Override the default port
rith serve --port 4000

# Download the web UI without starting the server
rith serve --download-only
```

**Flags:**

| Flag | Effect |
|------|--------|
| `--port <port>` | Override server port (default: 3090, range: 1–65535) |
| `--download-only` | Download and cache the web UI, then exit without starting the server |

The cached web UI is stored at `~/.rith/web-dist/<version>/`. Each version is cached independently, so upgrading the binary automatically downloads the matching web UI.

### `skill install [path]`

Install the bundled Rith Engine skill files into a project's `.claude/skills/rith/` directory. Always overwrites existing files to ensure the latest version shipped with the current Rith Engine binary is installed.

```bash
# Install into the current directory
rith skill install

# Install into a specific project
rith skill install /path/to/project
```

The Rith Engine skill teaches Claude Code how to work with Rith Engine workflows, commands, and project conventions. It is also installed automatically during `rith setup`.

### `version`

Show version, build type, and database info.

```bash
rith version
```

## Global Options

| Option | Effect |
|--------|--------|
| `--cwd <path>` | Override working directory (default: current directory) |
| `--quiet`, `-q` | Reduce log verbosity to warnings and errors only |
| `--verbose`, `-v` | Show debug-level output |
| `--json` | Output machine-readable JSON (for workflow list, workflow status) |
| `--help`, `-h` | Show help message |

## Working Directory

The CLI determines where to run based on:

1. `--cwd` flag (if provided)
2. Current directory (default)

Running from a subdirectory (e.g., `/repo/packages/cli`) automatically resolves to the git repository root (e.g., `/repo`).

When using `--branch`, workflows run inside the worktree directory.

> **Commands and workflows are loaded from the working directory at runtime.** The CLI reads directly from disk, so it picks up uncommitted changes immediately.

## Environment

At startup, the CLI strips all Bun-auto-loaded CWD `.env` keys and nested Claude Code session markers from `process.env`, then loads two rith-owned env files with `override: true`. Keys in rith-owned files pass through to AI subprocesses — no allowlist filtering.

On startup, the CLI:
1. Strips `<cwd>/.env*` keys + `CLAUDECODE` markers from `process.env` (via `stripCwdEnv`). Emits `[rith] stripped N keys from <cwd> (...)` when N > 0.
2. Loads `~/.rith/.env` (user scope). Emits `[rith] loaded N keys …` when N > 0 **and** `RITH_VERBOSE_BOOT=1` or `LOG_LEVEL=debug/trace` is set.
3. Loads `<cwd>/.rith/.env` (project scope, overrides user scope). Same verbosity gate as step 2.
4. Auto-enables global Claude auth if no explicit tokens are set.

`<cwd>/.env` is never loaded — it belongs to the target project. See [Configuration Reference: `.env` File Locations](/reference/configuration/#env-file-locations) for the full three-path model.

## Database

- **Without `DATABASE_URL` (default):** Uses SQLite at `~/.rith/rith.db` -- zero setup, auto-initialized on first run
- **With `DATABASE_URL`:** Uses PostgreSQL (optional, for cloud/advanced deployments)

Both work transparently. Most users never need to configure a database.

## Examples

```bash
# One-off AI chat
rith chat "How does error handling work in this codebase?"

# Interactive setup wizard
rith setup

# Quick question (auto-isolated in rith/task-assist-<timestamp>)
rith workflow run assist --cwd ~/projects/my-app "How does error handling work here?"

# Quick question without isolation
rith workflow run assist --cwd ~/projects/my-app --no-worktree "How does error handling work here?"

# Plan a feature (auto-isolated)
rith workflow run plan --cwd ~/projects/my-app "Add rate limiting to the API"

# Implement with explicit branch name
rith workflow run implement --cwd ~/projects/my-app --branch feature-rate-limit "Add rate limiting"

# Branch from a specific source branch instead of auto-detected default
rith workflow run implement --cwd ~/projects/my-app --branch test-adapters --from feature/extract-adapters "Test adapter changes"

# Approve or reject a paused workflow
rith workflow approve <run-id> "Ship it"
rith workflow reject <run-id> --reason "Missing test coverage"

# Check worktrees after work session
rith isolation list

# Clean up old worktrees
rith isolation cleanup
```
