---
title: Rith Engine Directories
description: Directory structure, path resolution, and configuration system for Rith Engine.
category: reference
area: config
audience: [developer]
status: current
sidebar:
  order: 2
---

This document explains the Rith Engine directory structure and configuration system for developers contributing to or extending Rith Engine.

## Overview

Rith Engine provides a unified directory and configuration system with:

1. **Consistent paths** across all platforms (Mac, Linux, Windows, Docker)
2. **Configuration precedence** chain (env > global > repo > defaults)
3. **Workflow engine integration** with YAML definitions in `.rith/workflows/`

## Directory Structure

### User-Level: `~/.rith/`

```
~/.rith/                    # RITH_HOME
├── workspaces/               # Cloned repositories (project-centric layout)
│   └── owner/
│       └── repo/
│           ├── source/       # Clone or symlink -> local path
│           └── worktrees/    # Git worktrees for this project
├── worktrees/                # Legacy global worktrees (for repos not in workspaces/)
├── update-check.json         # Update check cache (binary builds only, 24h TTL)
└── config.yaml               # Global user configuration
```

**Purpose:**
- `workspaces/` - Repositories cloned via `/clone` command or GitHub adapter
- `workspaces/owner/repo/worktrees/` - Git worktrees for this project (new registrations)
- `worktrees/` - Legacy fallback for repos not registered under `workspaces/`
- `config.yaml` - Non-secret user preferences

### Repo-Level: `.rith/`

```
any-repo/.rith/
├── commands/                 # Custom commands
│   ├── plan.md
│   └── execute.md
├── workflows/                # Workflow definitions (YAML files)
│   └── pr-review.yaml
├── scripts/                  # Named scripts for script: nodes (.ts/.js for bun, .py for uv)
├── state/                    # Cross-run workflow state (gitignored)
└── config.yaml               # Repo-specific configuration
```

**Purpose:**
- `commands/` - Slash commands (auto-loaded on clone)
- `workflows/` - YAML workflow definitions, discovered recursively at runtime
- `scripts/` - Named scripts referenced by `script:` nodes
- `state/` - Cross-run memory written by workflows (e.g. `repo-triage` dedup state). Gitignored; never committed.
- `config.yaml` - Project-specific settings

### Docker: `/.rith/`

In Docker containers, the Rith Engine home is fixed at `/.rith/` (root level). This is:
- Mounted as a named volume for persistence
- Not overridable by end users (simplifies container setup)

## Path Resolution

All path resolution is centralized in `packages/paths/src/rith-paths.ts` (`@rith/paths`).

### Core Functions

```typescript
// Get the Rith Engine home directory
getRithHome(): string
// Returns: ~/.rith (local) or /.rith (Docker)

// Get workspaces directory
getRithWorkspacesPath(): string
// Returns: ${RITH_HOME}/workspaces

// Get global worktrees directory (legacy fallback)
getRithWorktreesPath(): string
// Returns: ${RITH_HOME}/worktrees

// Get global config path
getRithConfigPath(): string
// Returns: ${RITH_HOME}/config.yaml


### Docker Detection

```typescript
function isDocker(): boolean {
  return (
    process.env.WORKSPACE_PATH === '/workspace' ||
    (process.env.HOME === '/root' && Boolean(process.env.WORKSPACE_PATH)) ||
    process.env.RITH_DOCKER === 'true'
  );
}
```

### Platform-Specific Paths

| Platform | `getRithHome()` |
|----------|-------------------|
| macOS | `/Users/<username>/.rith` |
| Linux | `/home/<username>/.rith` |
| Windows | `C:\Users\<username>\.rith` |
| Docker | `/.rith` |

## Configuration System

### Precedence Chain

Configuration is resolved in this order (highest to lowest priority):

1. **Environment Variables** - Secrets, deployment-specific
2. **Global Config** (`~/.rith/config.yaml`) - User preferences
3. **Repo Config** (`.rith/config.yaml`) - Project-specific
4. **Built-in Defaults** - Hardcoded in `packages/core/src/config/config-types.ts`

### Config Loading

```typescript
// Load merged config for a repo
const config = await loadConfig(repoPath);

// Load just global config
const globalConfig = await loadGlobalConfig();

// Load just repo config
const repoConfig = await loadRepoConfig(repoPath);
```

### Configuration Options

Key configuration options:

| Option | Env Override | Default |
|--------|--------------|---------|
| `RITH_HOME` | `RITH_HOME` | `~/.rith` |

## Skills Folders

Skills detection searches in priority order:

1. `.rith/skills/` - Always searched first
2. Configured folder from `skills.folder` in `.rith/config.yaml` (if specified)

Example configuration:
```yaml
# .rith/config.yaml
skills:
  folder: .claude/skills/rith  # Additional folder to search
```

## Extension Points

### Adding New Paths

To add a new managed directory:

1. Add function to `packages/paths/src/rith-paths.ts`:
```typescript
export function getRith EngineNewPath(): string {
  return join(getRithHome(), 'new-directory');
}
```

2. Update Docker setup in `Dockerfile`
3. Update volume mounts in `docker-compose.yml`
4. Add tests in `packages/paths/src/rith-paths.test.ts`

### Adding Config Options

To add new configuration options:

1. Add type to `packages/core/src/config/config-types.ts`:
```typescript
export interface GlobalConfig {
  // ...existing
  newFeature?: {
    enabled?: boolean;
    setting?: string;
  };
}
```

2. Add default in `getDefaults()` function
3. Use via `loadConfig()` in your code

## Design Decisions

### Why `~/.rith/` instead of `~/.config/rith/`?

- Simpler path (fewer nested directories)
- Follows Claude Code pattern (`~/.claude/`)
- Cross-platform without XDG complexity
- Easy to find and manage manually

### Why YAML for config?

- Bun has native support (via `yaml` package)
- Supports comments (unlike JSON)
- Workflow definitions use YAML
- Human-readable and editable

### Why fixed Docker paths?

- Simplifies container setup
- Predictable volume mounts
- No user confusion about env vars in containers
- Matches convention (apps use fixed paths in containers)

### Why config precedence chain?

- Mirrors git config pattern (familiar to developers)
- Secrets stay in env vars (security)
- User preferences in global config (portable)
- Project settings in repo config (version-controlled)

## Integration

- CLI configuration
- API-driven config updates
- Real-time config validation
