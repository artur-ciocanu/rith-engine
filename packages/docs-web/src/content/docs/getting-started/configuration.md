---
title: Configuration
description: Configure Rith Engine with API keys, Pi settings, and project configuration.
category: getting-started
area: config
audience: [user, operator]
sidebar:
  order: 3
---

## Environment Variables

Set these in your shell or `.env` file:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | No | Anthropic API key for Pi auth (alternative to `pi /login`) |
| `OPENAI_API_KEY` | No | OpenAI API key for Pi auth (alternative to `pi /login`) |
| `GEMINI_API_KEY` | No | Google Gemini API key for Pi auth (alternative to `pi /login`) |
| `GH_TOKEN` | No | GitHub personal access token — used to authenticate when cloning private GitHub repos |
| `GITLAB_TOKEN` | No | GitLab personal/project access token — used to authenticate when cloning private GitLab repos (also used by the GitLab adapter) |
| `GITEA_TOKEN` | No | Gitea/Forgejo access token — used to authenticate when cloning private Gitea/Forgejo repos (also used by the Gitea adapter) |
| `LOG_LEVEL` | No | `debug`, `info` (default), `warn`, `error` |

## Project Configuration

Create `.rith/config.yaml` in your repository:

```yaml
pi:
  model: anthropic/claude-sonnet-4-5
  enableExtensions: false           # load Pi's extension ecosystem (default: false)
  extensionFlags: { plan: true }    # per-extension feature flags (pi --<flag>)
  maxConcurrent: 4                   # cap concurrent Pi sessions across parallel DAG nodes

# docs:
#   path: packages/docs-web/src/content/docs  # Optional: default is docs/

See the [full configuration reference](/reference/configuration/) for all options.
