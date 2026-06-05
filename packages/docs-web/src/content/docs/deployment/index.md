---
title: Deployment Overview
description: Overview of deployment options for running Rith Engine locally and in CI.
category: deployment
area: infra
audience: [operator]
status: current
sidebar:
  order: 0
---

Rith Engine is a CLI workflow engine. "Deployment" means installing the `rith` binary and invoking `rith workflow run` — locally, on a workstation, or as a CI step. There is no long-running server, daemon, or web UI.

## Deployment Options

| Method | Best For | Guide |
|--------|----------|-------|
| **Local** | Development, personal use | [Local Development](/deployment/local/) |
| **Windows** | Native Windows or WSL2 | [Windows](/deployment/windows/) |
| **CI** | GitHub Actions, GitLab CI, Jenkins | [CI Integration](/deployment/ci-integration/) |

## Database Options

| Option | Setup | Best For |
|--------|-------|----------|
| **SQLite** (default) | Zero config, just omit `DATABASE_URL` | Single-user, CLI usage, local development |
| **PostgreSQL** | Set `DATABASE_URL` to any Postgres instance | Shared state, larger run history |

SQLite stores data at `~/.rith/rith.db`. It is auto-initialized on first run.
