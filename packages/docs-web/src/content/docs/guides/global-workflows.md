---
title: Global Workflows, Commands, and Scripts
description: Define user-level workflows, commands, and scripts that apply to every project on your machine.
category: guides
area: workflows
audience: [user]
status: current
sidebar:
  order: 9
---

Workflows placed in `~/.rith/workflows/`, commands in `~/.rith/commands/`, and scripts in `~/.rith/scripts/` are loaded globally -- they appear in every project and can be invoked from any repository. Workflows and commands carry the `source: 'global'` label; scripts resolve under the same repo-wins-over-home precedence.

## Paths

```
~/.rith/workflows/
~/.rith/commands/
~/.rith/scripts/
```

Or, if you have set `RITH_HOME`:

```
$RITH_HOME/workflows/
$RITH_HOME/commands/
$RITH_HOME/scripts/
```

Create the directories if they do not exist:

```bash
mkdir -p ~/.rith/workflows ~/.rith/commands ~/.rith/scripts
```

> **Note on location.** These are direct children of `~/.rith/` -- same level as `workspaces/`, `rith.db`, and `config.yaml`. Earlier Rith Engine versions stored global workflows at `~/.rith/.rith/workflows/`; see [Migrating from the old path](#migrating-from-the-old-path) below.

## Subfolders (1 level deep)

Each directory supports one level of subfolders for grouping, matching the existing `defaults/` convention. Deeper nesting is ignored silently.

```
~/.rith/workflows/
├── my-review.yaml              # ✅ top-level file
├── triage/                     # ✅ 1-level subfolder (grouping)
│   └── weekly-cleanup.yaml     # ✅ resolvable as `weekly-cleanup`
└── team/personal/too-deep.yaml # ❌ ignored — 2 levels down
```

Resolution is by **filename without extension** (for commands) or **exact filename** (for workflows), regardless of which subfolder the file lives in. Duplicate basenames within the same scope are a user error -- keep each name unique within `~/.rith/commands/` (or `<repoRoot>/.rith/commands/`), across whatever subfolders you use.

## Load Priority

1. **Bundled defaults** (lowest priority) -- the `rith-*` workflows/commands embedded in the Rith Engine binary.
2. **Global / home-scoped** -- `~/.rith/workflows/`, `~/.rith/commands/`, `~/.rith/scripts/` (override bundled by filename).
3. **Repo-specific** -- `<repoRoot>/.rith/workflows/`, `<repoRoot>/.rith/commands/`, `<repoRoot>/.rith/scripts/` (override global by filename).

Same-named files at a higher scope win. A repo can override a personal helper by dropping a file with the same name in its own `.rith/workflows/`, `.rith/commands/`, or `.rith/scripts/`.

## Practical Examples

### Personal Code Review

A workflow that runs your preferred review checklist on every project:

```yaml
# ~/.rith/workflows/my-review.yaml
name: my-review
description: Personal code review with my standards
model: sonnet

nodes:
  - id: review
    prompt: |
      Review the changes on this branch against main.
      Check for: error handling, test coverage, naming conventions,
      and unnecessary complexity. Be direct and specific.
```

### Custom Linting or Formatting Check

A workflow that runs project-agnostic checks:

```yaml
# ~/.rith/workflows/lint-check.yaml
name: lint-check
description: Check for common code quality issues across any project

nodes:
  - id: check
    prompt: |
      Scan this codebase for:
      1. Functions longer than 50 lines
      2. Deeply nested conditionals (>3 levels)
      3. TODO/FIXME comments without issue references
      Report findings as a prioritized list.
```

### Quick Explain

A simple workflow for understanding unfamiliar codebases:

```yaml
# ~/.rith/workflows/explain.yaml
name: explain
description: Quick explanation of a codebase or module
model: haiku

nodes:
  - id: explain
    prompt: |
      Give a concise explanation of this codebase.
      Focus on: what it does, key entry points, and how the main
      pieces connect. Keep it under 500 words.
      Topic: $ARGUMENTS
```

### Personal Command Helpers

Commands placed in `~/.rith/commands/` are available to every workflow on the machine. Useful for prompts you reuse across projects.

```markdown
<!-- ~/.rith/commands/review-checklist.md -->
Review the uncommitted changes in the current worktree.
Check for:
- Error handling gaps
- Missing tests
- Surprising API shapes
- Unnecessary cleverness
Be terse. Report findings grouped by file.
```

A workflow in any repo can then reference it:

```yaml
nodes:
  - id: review
    command: review-checklist
```

## Syncing with Dotfiles

If you manage your configuration with a dotfiles repository, you can include your global content:

```bash
# In your dotfiles repo
dotfiles/
└── rith/
    ├── workflows/
    │   ├── my-review.yaml
    │   └── explain.yaml
    └── commands/
        └── review-checklist.md
```

Then symlink during dotfiles setup:

```bash
ln -sf ~/dotfiles/rith/workflows ~/.rith/workflows
ln -sf ~/dotfiles/rith/commands  ~/.rith/commands
```

Or copy them as part of your dotfiles install script:

```bash
mkdir -p ~/.rith/workflows ~/.rith/commands
cp ~/dotfiles/rith/workflows/*.yaml ~/.rith/workflows/
cp ~/dotfiles/rith/commands/*.md    ~/.rith/commands/
```

This way your personal workflows and commands travel with you across machines.

## CLI Support

The CLI discovers home-scoped content automatically -- no flag, no config option.

```bash
# Lists bundled + global + repo-specific workflows
rith workflow list

# Run a global workflow from any repo
rith workflow run my-review
```

## Migrating from the old path

Pre-refactor versions of Rith Engine stored global workflows at `~/.rith/.rith/workflows/` (with an extra nested `.rith/`). That location is no longer read. If you have workflows there, Rith Engine emits a one-time deprecation warning on first use telling you the exact migration command:

```bash
mv ~/.rith/.rith/workflows ~/.rith/workflows && rmdir ~/.rith/.rith
```

Run it once; the warning stops firing on subsequent invocations. There was no prior home-scoped commands location, so `~/.rith/commands/` is new capability -- nothing to migrate.

## Troubleshooting

### Workflow Not Appearing in List

1. **Check the path** -- The directory must be exactly `~/.rith/workflows/` (a direct child of `~/.rith/`, not the old double-nested `~/.rith/.rith/workflows/`).

   ```bash
   ls ~/.rith/workflows/
   ```

2. **Check file extension** -- Workflow files must end in `.yaml` or `.yml`.

3. **Check YAML validity** -- A syntax error in the YAML will cause the workflow to appear in the errors list rather than the workflow list. Run:

   ```bash
   rith validate workflows my-workflow
   ```

4. **Check for name conflicts** -- If a repo-specific workflow has the same filename, it overrides the global one. The global version will not appear when you are in that repo.

5. **Check RITH_HOME** -- If you have set `RITH_HOME` to a custom path, global workflows must be at `$RITH_HOME/workflows/`, not `~/.rith/workflows/`.
