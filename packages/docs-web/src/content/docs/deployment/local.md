---
title: Local Development
description: Run Rith Engine locally with SQLite or PostgreSQL for development and personal use.
category: deployment
area: infra
audience: [operator]
status: current
sidebar:
  order: 1
---

This guide covers running Rith Engine on your own machine. Rith is a CLI — there is no server to start, no port to bind, and no web UI. You install the `rith` binary (or run from source) and invoke `rith workflow run`.

## Local Development

SQLite is the default store, so no database setup is needed.

### Prerequisites

- [Bun](https://bun.sh) 1.0+ (only needed to run from source)
- Pi Coding Agent authenticated (Rith Engine's LLM executor) — see [AI Assistants](/getting-started/ai-assistants/)
- A GitHub token for repository cloning (`GH_TOKEN` / `GITHUB_TOKEN`)

### From source

```bash
# 1. Clone and install
git clone https://github.com/artur-ciocanu/rith-engine
cd rith-engine
bun install

# 2. Configure environment
cp .env.example .env
nano .env  # Add your Pi credentials / API keys and GitHub token

# 3. Run a workflow
rith workflow run rith-assist "Hello world"
```

### From a binary install

Install the binary, then run workflows directly — no clone required:

```bash
curl -fsSL https://raw.githubusercontent.com/artur-ciocanu/rith-engine/main/scripts/install.sh | bash
rith workflow run rith-assist "Hello world"
```

Run `rith doctor` to verify your environment (Pi auth, GitHub auth, database, workspace).

## Using PostgreSQL Instead of SQLite

SQLite is fine for single-user CLI use. To use PostgreSQL instead, point `DATABASE_URL` at any Postgres instance in your `.env`:

```bash
DATABASE_URL=postgresql://user:password@host:5432/rith
```

The schema is created automatically on first run.

## Database Options Summary

| Option | Setup | Best For |
|--------|-------|----------|
| **SQLite** (default) | Zero config, just omit `DATABASE_URL` | Single-user, CLI usage, local development |
| **PostgreSQL** | Set `DATABASE_URL` to any Postgres instance | Shared state, larger run history |

SQLite stores data at `~/.rith/rith.db`. It is auto-initialized on first run.