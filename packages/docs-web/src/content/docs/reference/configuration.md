---
title: Configuration Reference
description: Full reference for Rith Engine's layered configuration system including YAML config, environment variables, and streaming modes.
category: reference
area: config
audience: [user, operator]
status: current
sidebar:
  order: 6
---

Rith Engine supports a layered configuration system with sensible defaults, optional YAML config files, and environment variable overrides. For a quick introduction, see [Getting Started: Configuration](/getting-started/).

## Directory Structure

### User-Level (~/.rith/)

```
~/.rith/
├── workspaces/owner/repo/  # Project-centric layout
│   ├── source/             # Clone or symlink -> local path
│   ├── worktrees/          # Git worktrees for this project
│   ├── artifacts/          # Workflow artifacts
│   └── logs/               # Workflow execution logs
├── workflows/              # Home-scoped workflows (source: 'global')
├── commands/               # Home-scoped commands (source: 'global')
├── scripts/                # Home-scoped scripts (runtime: bun | uv)
├── rith.db               # SQLite database (when DATABASE_URL not set)
└── config.yaml             # Global configuration (optional)
```

Home-scoped `workflows/`, `commands/`, and `scripts/` apply to every project on the machine. Repo-local files at `<repoRoot>/.rith/{workflows,commands,scripts}/` override them by filename (or script name). Each directory supports one level of subfolders for grouping; deeper nesting is ignored. See [Global Workflows](/guides/global-workflows/) for details and dotfiles-sync examples.

### Repository-Level (.rith/)

```
.rith/
├── commands/       # Custom commands
│   └── plan.md
├── workflows/      # Workflow definitions (YAML files)
└── config.yaml     # Repo-specific configuration (optional)
```

## Configuration Priority

Settings are loaded in this order (later overrides earlier):

1. **Defaults** - Sensible built-in defaults
2. **Global Config** - `~/.rith/config.yaml`
3. **Repo Config** - `.rith/config.yaml` in repository
4. **Environment Variables** - Always highest priority

## Global Configuration

Create `~/.rith/config.yaml` for user-wide preferences:

```yaml
# Default AI assistant
defaultAssistant: claude # must match a registered provider (e.g. claude, codex)

# Assistant defaults
assistants:
  claude:
    model: sonnet
    settingSources:   # Which sources the Claude SDK loads (default: ['project', 'user'])
      - project       # Project-level <cwd>/.claude/ (CLAUDE.md, skills, commands, agents)
      - user          # User-level ~/.claude/ (CLAUDE.md, skills, commands, agents)
    # Optional: absolute path to the Claude Code executable.
    # Required in compiled Rith Engine binaries when CLAUDE_BIN_PATH is not set.
    # Accepts the native binary (~/.local/bin/claude from the curl installer),
    # the npm-installed cli.js, or the npm platform-package directory
    # (e.g. @anthropic-ai/claude-code-win32-x64 — auto-expanded to claude/claude.exe).
    # Source/dev mode auto-resolves.
    # claudeBinaryPath: /absolute/path/to/claude
  codex:
    model: gpt-5.3-codex
    modelReasoningEffort: medium
    webSearchMode: disabled
    additionalDirectories:
      - /absolute/path/to/other/repo
    # codexBinaryPath: /absolute/path/to/codex  # Optional: Codex CLI path


# Custom paths (usually not needed)
paths:
  workspaces: ~/.rith/workspaces
  worktrees: ~/.rith/worktrees

# Concurrency limits
concurrency:
  maxConversations: 10

```

## Repository Configuration

Create `.rith/config.yaml` in any repository for project-specific settings:

```yaml
# AI assistant for this project (used as default provider for workflows)
assistant: claude

# Assistant defaults (override global)
assistants:
  claude:
    model: sonnet
    settingSources:  # Override global settingSources for this repo
      - project
  codex:
    model: gpt-5.3-codex
    webSearchMode: live

# Commands configuration
commands:
  folder: .rith/commands
  autoLoad: true

# Worktree settings
worktree:
  baseBranch: main  # Optional: auto-detected from git when not set
  copyFiles:  # Optional: Gitignored files/dirs to copy into new worktrees.
              # `.rith/` is always copied automatically — don't list it.
    - .env
    - .vscode               # Copy entire directory
    - plans/                # Local plans not committed to the team repo
  initSubmodules: true  # Optional: default true — auto-detects .gitmodules and runs
                        # `git submodule update --init --recursive`. Set false to opt out.
  path: .worktrees      # Optional: co-locate worktrees with the repo at
                        # <repoRoot>/.worktrees/<branch> instead of under
                        # ~/.rith/workspaces/<owner>/<repo>/worktrees/.
                        # Must be relative; no absolute, no `..` segments.

# Documentation directory
docs:
  path: docs  # Optional: default is docs/

# Defaults configuration
defaults:
  loadDefaultCommands: true   # Load app's bundled default commands at runtime
  loadDefaultWorkflows: true  # Load app's bundled default workflows at runtime

# Per-project environment variables for workflow execution
# Injected into the Pi subprocess env. Configure in .rith/config.yaml.
# env:
#   MY_API_KEY: value
#   CUSTOM_ENDPOINT: https://...

```

### Claude settingSources

Controls which sources the Claude Agent SDK loads during sessions — `CLAUDE.md`, skills, commands, agents, and hooks:

| Value | Description |
|-------|-------------|
| `project` | Load project-level `<cwd>/.claude/` (CLAUDE.md, skills, commands, agents) |
| `user` | Load user-level `~/.claude/` (CLAUDE.md, skills, commands, agents) |

**Default**: `['project', 'user']` — both project-level and user-level sources are loaded.

To restrict a project to project-level resources only (e.g. CI, shared environments, or when `~/.claude/` contains personal commands you don't want surfacing in workflows):

```yaml
assistants:
  claude:
    settingSources:
      - project
```

Set in `~/.rith/config.yaml` (global) or `.rith/config.yaml` (repo-specific).

### Worktree file copying (`worktree.copyFiles`)

`git worktree add` only copies **tracked** files into a new worktree. Anything gitignored — secrets, local planning docs, agent reports, IDE settings, data fixtures — is absent by default. Rith Engine's `worktree.copyFiles` closes that gap: after the worktree is created, each listed path is copied from the canonical repo into the worktree via raw filesystem copy (not git), so gitignored content comes along for the ride.

**Defaults — no config needed for the common case.** `.rith/` is always copied automatically. If you gitignore `.rith/` (or it's just not committed), your custom commands, workflows, and scripts still reach every worktree. You do not need to list `.rith/` in `copyFiles` — it's merged in for you.

**Common entries:**

```yaml
worktree:
  copyFiles:
    - .env                  # local secrets
    - .vscode/              # editor settings
    - .claude/              # per-repo Claude Code config (agents, skills, hooks)
    - plans/                # working docs that aren't committed
    - reports/              # agent-generated markdown reports
    - data/fixtures/        # local-only test data
```

**Semantics:**

- Each entry is a path (file or directory) relative to the repo root — source and destination are always identical. No rename syntax.
- Missing files are silently skipped (`ENOENT` at debug level), so you can list "optional" entries without bookkeeping.
- Directories are copied recursively.
- Per-entry failures are isolated — one bad entry won't abort the rest. Non-ENOENT failures (permissions, disk full) are surfaced as warnings on the environment.
- Path-traversal attempts (entries resolving outside the repo root, or absolute paths on a different drive) are rejected — the entry is logged and skipped.

**Interaction with `worktree.path`:** The copy step runs identically whether worktrees live under `~/.rith/workspaces/<owner>/<repo>/worktrees/` (default) or inside the repo at `<repoRoot>/<worktree.path>/` (repo-local). Both layouts get the same gitignored-file treatment.

**Defaults behavior:** The app's bundled default commands and workflows are loaded at runtime and merged with repo-specific ones. Repo commands/workflows override app defaults by name. Set `defaults.loadDefaultCommands: false` or `defaults.loadDefaultWorkflows: false` to disable runtime loading.

**Submodule behavior:** When a repo contains `.gitmodules`, submodules are initialized in new worktrees by default (git's `worktree add` does not do this). The check is a cheap filesystem probe — repos without submodules pay zero cost. Submodule init failure throws a classified error (credentials, network, timeout) rather than silently producing a worktree with empty submodule directories. Set `worktree.initSubmodules: false` to opt out.

**Base branch behavior:** Before creating a worktree, the canonical workspace is synced to the latest code. Resolution order:
1. If `worktree.baseBranch` is set: Uses the configured branch. **Fails with an error** if the branch doesn't exist on remote (no silent fallback).
2. If omitted: Auto-detects the default branch via `git remote show origin`. Works without any config for standard repos.
3. If auto-detection fails and a workflow references `$BASE_BRANCH`: Fails with an error explaining the resolution chain.

**Docs path behavior:** The `docs.path` setting controls where the `$DOCS_DIR` variable points. When not configured, `$DOCS_DIR` defaults to `docs/`. Unlike `$BASE_BRANCH`, this variable always has a safe default and never throws an error. Configure it when your documentation lives outside the standard `docs/` directory (e.g., `packages/docs-web/src/content/docs`).

**Worktree path behavior:** By default, every repo's worktrees live under `~/.rith/workspaces/<owner>/<repo>/worktrees/<branch>` — outside the repo, invisible to the IDE. Set `worktree.path` to opt in to a **repo-local** layout instead: worktrees are created at `<repoRoot>/<worktree.path>/<branch>` so they show up in the file tree and editor workspace. A common choice is `.worktrees`. Because worktrees now live inside the repository tree, you should add the directory to your `.gitignore` (Rith Engine does not modify user-owned files). The configured path must be relative to the repo root; absolute paths and paths containing `..` segments fail loudly at worktree creation rather than silently falling back.

## Environment Variables

Environment variables override all other configuration. They are organized by category below.

### Core

| Variable | Description | Default |
| --- | --- | --- |
| `RITH_HOME` | Base directory for all Rith Engine-managed files. **Ignored in Docker** — the container always uses `/.rith`. | `~/.rith` |
| `PORT` | HTTP server listen port | `3090` (auto-allocated in worktrees) |
| `LOG_LEVEL` | Logging verbosity (`fatal`, `error`, `warn`, `info`, `debug`, `trace`) | `info` |
| `BOT_DISPLAY_NAME` | Bot name shown in batch-mode "starting" messages | `Rith Engine` |
| `DEFAULT_AI_ASSISTANT` | Default AI assistant. Must match a registered provider id — currently `pi`. | `pi` |
| `MAX_CONCURRENT_CONVERSATIONS` | Maximum concurrent AI conversations | `10` |
| `SESSION_RETENTION_DAYS` | Delete inactive sessions older than N days | `30` |
| `RITH_SUPPRESS_NESTED_CLAUDE_WARNING` | When set to `1`, suppresses the stderr warning emitted when `rith` is run inside a Claude Code session | -- |
| `RITH_VERBOSE_BOOT` | When set to `1`, prints `[rith] loaded N keys from …` lines to stderr at boot. Also enabled by `LOG_LEVEL=debug` or `LOG_LEVEL=trace`. Silent by default to avoid interleaving with interactive command output. | -- |

### AI Providers -- Claude

| Variable | Description | Default |
| --- | --- | --- |
| `CLAUDE_USE_GLOBAL_AUTH` | Use global auth from `claude /login` (`true`/`false`) | Auto-detect |
| `CLAUDE_CODE_OAUTH_TOKEN` | Explicit OAuth token (alternative to global auth) | -- |
| `CLAUDE_API_KEY` | Explicit API key (alternative to global auth) | -- |
| `TITLE_GENERATION_MODEL` | Lightweight model for generating conversation titles | SDK default |
| `RITH_CLAUDE_FIRST_EVENT_TIMEOUT_MS` | Timeout (ms) before Claude subprocess is considered hung (throws with diagnostic log) | `60000` |

When `CLAUDE_USE_GLOBAL_AUTH` is unset, Rith Engine auto-detects: it uses explicit tokens if present, otherwise falls back to global auth.

### AI Providers -- Codex

| Variable | Description | Default |
| --- | --- | --- |
| `CODEX_ID_TOKEN` | Codex ID token (from `~/.codex/auth.json`) | -- |
| `CODEX_ACCESS_TOKEN` | Codex access token | -- |
| `CODEX_REFRESH_TOKEN` | Codex refresh token | -- |
| `CODEX_ACCOUNT_ID` | Codex account ID | -- |

### AI Providers -- Copilot (community)

| Variable | Description | Default |
| --- | --- | --- |
| `COPILOT_GITHUB_TOKEN` | Explicit GitHub PAT for the Copilot provider. Always wins over `useLoggedInUser` when set. | -- |
| `COPILOT_BIN_PATH` | Absolute path to the Copilot CLI binary. Required in compiled Rith Engine binaries when `assistants.copilot.copilotCliPath` is not set; auto-detected in dev mode. | -- |

The Copilot provider also reads `assistants.copilot.{model, modelReasoningEffort, copilotCliPath, configDir, enableConfigDiscovery, useLoggedInUser, logLevel}` from `~/.rith/config.yaml` or `.rith/config.yaml`. See the [AI Assistants guide](/getting-started/ai-assistants/) for the full setup.

### Forge Integrations -- GitHub

| Variable | Description | Default |
| --- | --- | --- |
| `GITHUB_TOKEN` | GitHub personal access token (also used by `gh` CLI) | -- |
| `GH_TOKEN` | Alias for `GITHUB_TOKEN` (used by GitHub CLI) | -- |
| `WEBHOOK_SECRET` | HMAC SHA-256 secret for GitHub webhook signature verification | -- |
| `GITHUB_ALLOWED_USERS` | Comma-separated GitHub usernames for whitelist (case-insensitive) | Open access |
| `GITHUB_BOT_MENTION` | @mention name the bot responds to in issues/PRs | Falls back to `BOT_DISPLAY_NAME` |

### Forge Integrations -- Gitea

| Variable | Description | Default |
| --- | --- | --- |
| `GITEA_URL` | Self-hosted Gitea instance URL (e.g. `https://gitea.example.com`) | -- |
| `GITEA_TOKEN` | Gitea personal access token or bot account token | -- |
| `GITEA_WEBHOOK_SECRET` | HMAC SHA-256 secret for Gitea webhook signature verification | -- |
| `GITEA_ALLOWED_USERS` | Comma-separated Gitea usernames for whitelist (case-insensitive) | Open access |
| `GITEA_BOT_MENTION` | @mention name the bot responds to in issues/PRs | Falls back to `BOT_DISPLAY_NAME` |

### Database

| Variable | Description | Default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (omit to use SQLite) | SQLite at `~/.rith/rith.db` |


### Worktree Management

| Variable | Description | Default |
| --- | --- | --- |
| `STALE_THRESHOLD_DAYS` | Days before an inactive worktree is considered stale | `14` |
| `MAX_WORKTREES_PER_CODEBASE` | Max worktrees per codebase before auto-cleanup | `25` |
| `CLEANUP_INTERVAL_HOURS` | How often the background cleanup service runs | `6` |

### Docker / Deployment

| Variable | Description | Default |
| --- | --- | --- |
| `RITH_DATA` | Host path for Rith Engine data (workspaces, worktrees, artifacts). Compose-only — read by `docker-compose.yml` to choose the bind-mount source for `/.rith`; not read by Rith Engine source code. | Docker-managed volume |
| `RITH_USER_HOME` | Host path for `/home/appuser` (Claude/Codex/Pi config, `~/.gitconfig`, shell history). Compose-only — read by `docker-compose.yml` to choose the bind-mount source for `/home/appuser`; not read by Rith Engine source code. Persisted by default to a Docker-managed volume so user state survives rebuilds. | Docker-managed volume |
| `DOMAIN` | Public domain for Caddy reverse proxy (TLS auto-provisioned) | -- |
| `CADDY_BASIC_AUTH` | Caddy basicauth directive to protect API | Disabled |
| `COOKIE_MAX_AGE` | Auth cookie lifetime in seconds | `86400` |

### `.env` File Locations

Rith Engine keys env loading on **directory ownership, not filename**. `.rith/` (at `~/` or `<cwd>/`) is rith-owned. Anything else is yours.

| Path | Stripped at boot? | Rith Engine loads? | `rith setup` writes? |
| --- | --- | --- | --- |
| `<cwd>/.env` | **yes** (safety guard) | never | never |
| `<cwd>/.rith/.env` | no | yes (repo scope, overrides user scope) | yes iff `--scope project` |
| `~/.rith/.env` | no | yes (user scope) | yes iff `--scope home` (default) |

**Load order at boot** (every entry point — CLI and server):

1. Strip keys Bun auto-loaded from `<cwd>/.env`, `.env.local`, `.env.development`, `.env.production` (prevents target-repo env from leaking into Rith Engine).
2. Load `~/.rith/.env` with `override: true` (rith config wins over shell-inherited vars).
3. Load `<cwd>/.rith/.env` with `override: true` (repo scope wins over user scope).

**Operator log lines** (stderr, emitted only when there is something to report):

```
[rith] stripped 2 keys from /path/to/target-repo (.env, .env.local) to prevent target repo env from leaking into Rith Engine processes
```

The `[rith] loaded N keys from …` lines are suppressed by default (they would otherwise interleave with `rith setup`/`rith doctor` checklist output). To enable them, set `RITH_VERBOSE_BOOT=1` or `LOG_LEVEL=debug` before running:

```
[rith] loaded 3 keys from ~/.rith/.env
[rith] loaded 2 keys from /path/to/target-repo/.rith/.env (repo scope, overrides user scope)
```

**Which file should I use?**

- **`~/.rith/.env`** — user-wide defaults (your personal `DATABASE_URL`, tokens, etc.). Applies to every project.
- **`<cwd>/.rith/.env`** — per-project overrides. Different tokens per repo, different DB per environment, etc.
- **`<cwd>/.env`** — **your app's** env file. Rith Engine does not read this file; it strips the keys at boot so they do not leak into Rith Engine's process.

## Docker Configuration

In Docker containers, paths are automatically set:

```
/.rith/
├── workspaces/owner/repo/
│   ├── source/
│   ├── worktrees/
│   ├── artifacts/
│   └── logs/
└── rith.db
```

Environment variables still work and override defaults.

## Command Folder Detection

When cloning or switching repositories, Rith Engine looks for commands in this priority order:

1. `.rith/commands/` - Always searched first
2. Configured folder from `commands.folder` in `.rith/config.yaml` (if specified)

Example `.rith/config.yaml`:
```yaml
commands:
  folder: .claude/commands/rith  # Additional folder to search
  autoLoad: true
```

## Examples

### Minimal Setup (Using Defaults)

No configuration needed. Rith Engine works out of the box with:

- `~/.rith/` for all managed files
- Pi as default AI assistant
### Custom AI Preference

```yaml
# ~/.rith/config.yaml
defaultAssistant: codex
```

### Project-Specific Settings

```yaml
# .rith/config.yaml in your repo
assistant: claude  # Workflows inherit this provider unless they specify their own
commands:
  autoLoad: true
```

### Docker with Custom Volume

```bash
docker run -v /my/data:/.rith ghcr.io/artur-ciocanu/rith-engine
```


---

## Concurrency Settings

Control how many conversations the system processes simultaneously:

```ini
MAX_CONCURRENT_CONVERSATIONS=10  # Default: 10
```

**How it works:**
- Conversations are processed with a lock manager
- If the max concurrent limit is reached, new messages are queued
- Prevents resource exhaustion and API rate limits
- Each conversation maintains its own independent context

**Tuning guidance:**

| Resources | Recommended Setting |
|-----------|-------------------|
| Low resources | 3-5 |
| Standard | 10 (default) |
| High resources | 20-30 (monitor API limits) |

---

## Health Check Endpoints

The application exposes health check endpoints for monitoring:

**Basic Health Check:**
```bash
curl http://localhost:3090/health
```
Returns: `{"status":"ok"}`

**Database Connectivity:**
```bash
curl http://localhost:3090/health/db
```
Returns: `{"status":"ok","database":"connected"}`

**Concurrency Status:**
```bash
curl http://localhost:3090/health/concurrency
```
Returns: `{"status":"ok","active":0,"queued":0,"maxConcurrent":10}`

**Use cases:**
- Docker healthcheck configuration
- Load balancer health checks
- Monitoring and alerting systems (Prometheus, Datadog, etc.)
- CI/CD deployment verification

---

## Troubleshooting

### Config Parse Errors

If your config file has invalid YAML syntax, you'll see error messages like:

```
[Config] Failed to parse global config at ~/.rith/config.yaml: <error details>
[Config] Using default configuration. Please fix the YAML syntax in your config file.
```

Common YAML syntax issues:
- Incorrect indentation (use spaces, not tabs)
- Missing colons after keys
- Unquoted values with special characters

The application will continue running with default settings until the config file is fixed.
