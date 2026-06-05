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
# Pi Coding Agent defaults
pi:
  model: anthropic/claude-sonnet-4-5  # <pi-provider-id>/<model-id> (required: node > workflow > config)
  enableExtensions: false             # load Pi's extension ecosystem (default: false)
  extensionFlags: { plan: true }      # per-extension feature flags (pi --<flag>)
  maxConcurrent: 4                    # cap concurrent Pi sessions across parallel DAG nodes

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
# Pi Coding Agent defaults (override global)
pi:
  model: anthropic/claude-sonnet-4-5
  enableExtensions: true

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

### Worktree file copying (`worktree.copyFiles`)

`git worktree add` only copies **tracked** files into a new worktree. Anything gitignored — secrets, local planning docs, agent reports, IDE settings, data fixtures — is absent by default. Rith Engine's `worktree.copyFiles` closes that gap: after the worktree is created, each listed path is copied from the canonical repo into the worktree via raw filesystem copy (not git), so gitignored content comes along for the ride.

**Defaults — no config needed for the common case.** `.rith/` is always copied automatically. If you gitignore `.rith/` (or it's just not committed), your custom commands, workflows, and scripts still reach every worktree. You do not need to list `.rith/` in `copyFiles` — it's merged in for you.

**Common entries:**

```yaml
worktree:
  copyFiles:
    - .env                  # local secrets
    - .vscode/              # editor settings
    - .claude/              # skills Pi loads from .claude/skills
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
| `LOG_LEVEL` | Logging verbosity (`fatal`, `error`, `warn`, `info`, `debug`, `trace`) | `info` |
| `RITH_SUPPRESS_NESTED_CLAUDE_WARNING` | When set to `1`, suppresses the stderr warning emitted when `rith` is run inside a Claude Code session | -- |
| `RITH_VERBOSE_BOOT` | When set to `1`, prints `[rith] loaded N keys from …` lines to stderr at boot. Also enabled by `LOG_LEVEL=debug` or `LOG_LEVEL=trace`. Silent by default to avoid interleaving with interactive command output. | -- |

### AI Provider -- Pi

Pi Coding Agent is the sole AI provider and is bundled with Rith Engine — there is no separate binary to install. Authenticate once, either via OAuth or API keys:

| Variable | Description | Default |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | API key for Anthropic models (Pi provider id `anthropic`) | -- |
| `OPENAI_API_KEY` | API key for OpenAI models (Pi provider id `openai`) | -- |
| `GEMINI_API_KEY` | API key for Google models (Pi provider id `google`) | -- |
| `RITH_MODEL` | Overrides `pi.model` for a single run — set to a `<provider-id>/<model-id>` ref (e.g. `anthropic/claude-opus-4-5`). Highest precedence; blank values are ignored. | `pi.model` from config |

Run `pi /login` (OAuth) to write `~/.pi/agent/auth.json`, which Rith Engine picks up automatically. API keys in the environment override `auth.json`. Local backends (LM Studio, ollama) need no credentials — register them in `~/.pi/agent/models.json`. Baseline Pi settings live in `~/.pi/agent/settings.json` (plus `<repo>/.pi/settings.json`).

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
| `RITH_USER_HOME` | Host path for `/home/appuser` (Pi config, `~/.gitconfig`, shell history). Compose-only — read by `docker-compose.yml` to choose the bind-mount source for `/home/appuser`; not read by Rith Engine source code. Persisted by default to a Docker-managed volume so user state survives rebuilds. | Docker-managed volume |
| `DOMAIN` | Public domain for Caddy reverse proxy (TLS auto-provisioned) | -- |
| `CADDY_BASIC_AUTH` | Caddy basicauth directive to protect API | Disabled |
| `COOKIE_MAX_AGE` | Auth cookie lifetime in seconds | `86400` |

### `.env` File Locations

Rith Engine keys env loading on **directory ownership, not filename**. `.rith/` (at `~/` or `<cwd>/`) is rith-owned. Anything else is yours.

| Path | Stripped at boot? | Rith Engine loads? |
| --- | --- | --- |
| `<cwd>/.env` | **yes** (safety guard) | never |
| `<cwd>/.rith/.env` | no | yes (repo scope, overrides user scope) |
| `~/.rith/.env` | no | yes (user scope) |

**Load order at boot** (every entry point — CLI and server):

1. Strip keys Bun auto-loaded from `<cwd>/.env`, `.env.local`, `.env.development`, `.env.production` (prevents target-repo env from leaking into Rith Engine).
2. Load `~/.rith/.env` with `override: true` (rith config wins over shell-inherited vars).
3. Load `<cwd>/.rith/.env` with `override: true` (repo scope wins over user scope).

**Operator log lines** (stderr, emitted only when there is something to report):

```
[rith] stripped 2 keys from /path/to/target-repo (.env, .env.local) to prevent target repo env from leaking into Rith Engine processes
```

The `[rith] loaded N keys from …` lines are suppressed by default (they would otherwise interleave with interactive command output). To enable them, set `RITH_VERBOSE_BOOT=1` or `LOG_LEVEL=debug` before running:

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

### Custom Model Preference

```yaml
# ~/.rith/config.yaml
pi:
  model: anthropic/claude-opus-4-5
```

### Project-Specific Settings

```yaml
# .rith/config.yaml in your repo
pi:
  model: anthropic/claude-sonnet-4-5  # default model for this repo's workflows
commands:
  autoLoad: true
```

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
