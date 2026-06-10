---
title: Database
description: Database storage location, schema overview, and how Rith Engine initializes its SQLite database.
category: reference
area: database
audience: [developer, operator]
status: current
sidebar:
  order: 5
---

Rith Engine uses SQLite at `~/.rith/rith.db`. The schema is auto-initialized on first run, so there is no setup required.

## Storage Location

On first connect, Rith Engine automatically:
- Creates a SQLite database at `~/.rith/rith.db`
- Initializes the schema
- Uses this database for all operations

No configuration, external service, or manual migration step is needed.

## Verifying the Database

Inspect the database with the `sqlite3` CLI:

```bash
sqlite3 ~/.rith/rith.db ".tables"
```

## Schema Overview

The database has 8 tables, all prefixed with `remote_agent_`:

1. **`remote_agent_codebases`** - Repository metadata
   - Commands stored as JSONB: `{command_name: {path, description}}`
   - AI assistant type per codebase
   - Default working directory

2. **`remote_agent_conversations`** - Platform conversation tracking
   - Platform type + conversation ID (unique constraint)
   - Linked to codebase via foreign key
   - AI assistant type locked at creation

3. **`remote_agent_sessions`** - AI session management
   - Active session flag (one per conversation)
   - Session ID for resume capability
   - Metadata JSONB for command context

4. **`remote_agent_isolation_environments`** - Worktree isolation
   - Tracks git worktrees per issue/PR
   - Enables worktree sharing between linked issues and PRs

5. **`remote_agent_workflow_runs`** - Workflow execution tracking
   - Tracks active workflows per conversation
   - Locks concurrent execution per `working_path`: a second dispatch on a path with an active run (status `pending`/`running`/`paused`) is auto-cancelled with an actionable message. Stale `pending` rows older than 5 minutes are treated as orphaned and ignored.
   - Stores workflow state, step progress, and parent conversation linkage

6. **`remote_agent_workflow_events`** - Step-level workflow event log
   - Records step transitions, artifacts, and errors per workflow run
   - Lean UI-relevant events (verbose logs stored in JSONL files)
   - Enables workflow run detail views and debugging

7. **`remote_agent_messages`** - Conversation message history
   - Persists user and assistant messages with timestamps
   - Stores tool call metadata (name, input, duration) in JSONB
   - Stores message history for conversation continuity

8. **`remote_agent_codebase_env_vars`** - Per-project env vars for workflow execution
   - Key-value pairs scoped to a codebase
   - Injected into Claude SDK subprocess environment at execution time
   - Managed via `env:` in `.rith/config.yaml`
