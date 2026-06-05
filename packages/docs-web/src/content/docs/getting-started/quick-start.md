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
2. [Install Pi Coding Agent](/getting-started/ai-assistants/) — Rith Engine uses it as the AI executor
3. Authenticate Pi (see [Pi Coding Agent auth](/getting-started/ai-assistants/#authentication))
4. Navigate to any git repository
5. For private repos: set `GH_TOKEN` (GitHub), `GITLAB_TOKEN` (GitLab), or `GITEA_TOKEN` (Gitea/Forgejo) — Rith Engine uses these to authenticate when cloning

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

For the full getting started guide -- installation, authentication, CLI setup, and troubleshooting -- see the [Overview](/getting-started/overview/).

- [Overview](/getting-started/overview/) — Complete onboarding guide
- [Core Concepts](/getting-started/concepts/) — Understand workflows, nodes, commands, and isolation
- [Configuration](/getting-started/configuration/) — Customize Rith Engine for your project
- [Authoring Workflows](/guides/authoring-workflows/) — Create your own workflows
- [GitHub Repository](https://github.com/artur-ciocanu/rith-engine) — Source code, issues, and discussions
