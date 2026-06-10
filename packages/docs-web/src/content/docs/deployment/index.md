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

## Database

Rith Engine uses SQLite, stored at `~/.rith/rith.db` and auto-initialized on first run. No configuration or setup is required.
