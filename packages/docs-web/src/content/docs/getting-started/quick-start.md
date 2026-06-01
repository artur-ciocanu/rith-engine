---
title: Quick Start
description: Run your first Rith Engine workflow in minutes.
category: getting-started
audience: [user]
sidebar:
  order: 2
---

## Prerequisites

1. [Install Rith Engine](/getting-started/installation/)
2. [Install Claude Code](/getting-started/ai-assistants/#claude-code) — Rith Engine orchestrates it but does not bundle it
3. Authenticate with Claude: run `claude /login` (uses your existing Claude Pro/Max subscription)
4. In compiled Rith Engine binaries, set `CLAUDE_BIN_PATH` (see [Binary path configuration](/getting-started/ai-assistants/#binary-path-configuration-compiled-binaries-only))
5. Navigate to any git repository
6. For private repos: set `GH_TOKEN` (GitHub), `GITLAB_TOKEN` (GitLab), or `GITEA_TOKEN` (Gitea/Forgejo) — Rith Engine uses these to authenticate when cloning

## Run Your First Workflow

```bash
# List available workflows
rith workflow list

# Ask Rith Engine to assist with your codebase
rith workflow run assist "What does this codebase do?"

# Run a code review
rith workflow run smart-pr-review
```

## What's Next?

For the full getting started guide -- installation, authentication, Web UI setup, CLI setup, and troubleshooting -- see the [Overview](/getting-started/overview/).

- [Overview](/getting-started/overview/) — Complete onboarding guide
- [Core Concepts](/getting-started/concepts/) — Understand workflows, nodes, commands, and isolation
- [Configuration](/getting-started/configuration/) — Customize Rith Engine for your project
- [Authoring Workflows](/guides/authoring-workflows/) — Create your own workflows
- [GitHub Repository](https://github.com/artur-ciocanu/rith-engine) — Source code, issues, and discussions
