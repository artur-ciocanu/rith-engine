---
title: Installation
description: Install Rith Engine on macOS, Linux, or Windows.
category: getting-started
audience: [user, operator]
sidebar:
  order: 0
---

## Quick Install

### macOS / Linux

```bash
curl -fsSL https://github.com/artur-ciocanu/rith-engine/install | bash
```

### Windows (PowerShell)

```powershell
irm https://github.com/artur-ciocanu/rith-engine/install.ps1 | iex
```

### Homebrew (macOS / Linux)

```bash
brew install coleam00/rith/rith
```

### Docker

```bash
docker run --rm -v "$PWD:/workspace" ghcr.io/artur-ciocanu/rith-engine:latest workflow list
```

## From Source

```bash
git clone https://github.com/artur-ciocanu/rith-engine
cd Rith Engine
bun install
```

### Prerequisites (Source Install)

- [Bun](https://bun.sh) >= 1.0.0
- [GitHub CLI](https://cli.github.com/) (`gh`)
- [git](https://git-scm.com/)

## AI provider (Pi) is bundled

Rith Engine uses [Pi Coding Agent](https://github.com/badlogic/pi-mono) as its AI provider. Pi
ships as a dependency of `@rith/providers` — there is no separate AI binary to install.

Authenticate Pi once, either via OAuth or API keys:

```bash
# OAuth (writes ~/.pi/agent/auth.json, picked up automatically)
pi /login
```

Or set provider API keys in your environment:

```bash
export ANTHROPIC_API_KEY=...   # anthropic/* models
export OPENAI_API_KEY=...      # openai/* models
export GEMINI_API_KEY=...      # google/* models
```

See [AI Assistants](/getting-started/ai-assistants/) for full authentication and model details.

## Verify Installation

```bash
rith version
```

## Next Steps

- [Core Concepts](/getting-started/concepts/) — Understand workflows, nodes, commands, and isolation
- [Quick Start](/getting-started/quick-start/) — Run your first workflow
- [Configuration](/getting-started/configuration/) — Set up API keys and preferences
