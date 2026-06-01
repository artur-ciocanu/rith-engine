<p align="center">
  <img src="assets/logo.png" alt="Rith Engine" width="160" />
</p>

<h1 align="center">Rith Engine</h1>

<p align="center">
  The first open-source harness builder for AI coding. Make AI coding deterministic and repeatable.
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/13964" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13964" alt="artur-ciocanu%2Frith-engine | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://github.com/artur-ciocanu/rith-engine/actions/workflows/test.yml"><img src="https://github.com/artur-ciocanu/rith-engine/actions/workflows/test.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/artur-ciocanu/rith-engine"><img src="https://img.shields.io/badge/docs-rith--engine-blue" alt="Docs" /></a>
</p>

---

Rith Engine is a workflow engine for AI coding agents. Define your development processes as YAML workflows - planning, implementation, validation, code review, PR creation - and run them reliably across all your projects.

Like what Dockerfiles did for infrastructure and GitHub Actions did for CI/CD - Rith Engine does for AI coding workflows. Think n8n, but for software development.

## Why Rith Engine?

When you ask an AI agent to "fix this bug", what happens depends on the model's mood. It might skip planning. It might forget to run tests. It might write a PR description that ignores your template. Every run is different.

Rith Engine fixes this. Encode your development process as a workflow. The workflow defines the phases, validation gates, and artifacts. The AI fills in the intelligence at each step, but the structure is deterministic and owned by you.

- **Repeatable** - Same workflow, same sequence, every time. Plan, implement, validate, review, PR.
- **Isolated** - Every workflow run gets its own git worktree. Run 5 fixes in parallel with no conflicts.
- **Fire and forget** - Kick off a workflow, go do other work. Come back to a finished PR with review comments.
- **Composable** - Mix deterministic nodes (bash scripts, tests, git ops) with AI nodes (planning, code generation, review). The AI only runs where it adds value.
- **Portable** - Define workflows once in `.rith/workflows/`, commit them to your repo. They work the same from CLI, Web UI, Slack, Telegram, or GitHub.

## What It Looks Like

Here's an example of a Rith Engine workflow that plans, implements in a loop until tests pass, gets your approval, then creates the PR:

```yaml
# .rith/workflows/build-feature.yaml
nodes:
  - id: plan
    prompt: "Explore the codebase and create an implementation plan"

  - id: implement
    depends_on: [plan]
    loop:                                      # AI loop - iterate until done
      prompt: "Read the plan. Implement the next task. Run validation."
      until: ALL_TASKS_COMPLETE
      fresh_context: true                      # Fresh session each iteration

  - id: run-tests
    depends_on: [implement]
    bash: "bun run validate"                   # Deterministic - no AI

  - id: review
    depends_on: [run-tests]
    prompt: "Review all changes against the plan. Fix any issues."

  - id: approve
    depends_on: [review]
    loop:                                      # Human approval gate
      prompt: "Present the changes for review. Address any feedback."
      until: APPROVED
      interactive: true                        # Pauses and waits for human input

  - id: create-pr
    depends_on: [approve]
    prompt: "Push changes and create a pull request"
```

Tell your coding agent what you want, and Rith Engine handles the rest:

```
You: Use rith to add dark mode to the settings page

Agent: I'll run the rith-idea-to-pr workflow for this.
       → Creating isolated worktree on branch rith/task-dark-mode...
       → Planning...
       → Implementing (task 1/4)...
       → Implementing (task 2/4)...
       → Tests failing - iterating...
       → Tests passing after 2 iterations
       → Code review complete - 0 issues
       → PR ready: https://github.com/you/project/pull/47
```

## Previous Version

Looking for the original Python-based project (task management + RAG)? It's fully preserved on the [`archive/v1-task-management-rag`](https://github.com/artur-ciocanu/rith-engine/tree/archive/v1-task-management-rag) branch.

## Getting Started

> **Most users should start with the [Full Setup](#full-setup-5-minutes)** - it walks you through credentials, installs the Rith Engine skill into your projects, and gives you the web dashboard.
>
> **Already have Claude Code and just want the CLI?** Jump to the [Quick Install](#quick-install-30-seconds).

### Full Setup (5 minutes)

Clone the repo and use the guided setup wizard. This configures credentials, platform integrations, and copies the Rith Engine skill into your target projects.

<details>
<summary><b>Prerequisites</b> - Bun, Claude Code, and the GitHub CLI</summary>

**Bun** - [bun.sh](https://bun.sh)

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
irm bun.sh/install.ps1 | iex
```

**GitHub CLI** - [cli.github.com](https://cli.github.com/)

```bash
# macOS
brew install gh

# Windows (via winget)
winget install GitHub.cli

# Linux (Debian/Ubuntu)
sudo apt install gh
```

**Claude Code** - [claude.ai/code](https://claude.ai/code)

```bash
# macOS/Linux/WSL
curl -fsSL https://claude.ai/install.sh | bash

# Windows (PowerShell)
irm https://claude.ai/install.ps1 | iex
```

</details>

```bash
git clone https://github.com/artur-ciocanu/rith-engine
cd rith-engine
bun install
claude
```

Then say: **"Set up Rith Engine"**

The setup wizard walks you through everything: CLI installation, authentication, platform selection, and copies the Rith Engine skill to your target repo.

### Quick Install (30 seconds)

Already have Claude Code set up? Install the standalone CLI binary and skip the wizard.

**macOS / Linux**
```bash
curl -fsSL https://github.com/artur-ciocanu/rith-engine/install | bash
```

**Windows (PowerShell)**
```powershell
irm https://github.com/artur-ciocanu/rith-engine/install.ps1 | iex
```

**Homebrew**
```bash
brew install artur-ciocanu/rith-engine/rith
```

> **Compiled binaries need a `CLAUDE_BIN_PATH`.** The quick-install binaries
> don't bundle Claude Code. Install it separately, then point Rith Engine at it:
>
> ```bash
> # macOS / Linux / WSL
> curl -fsSL https://claude.ai/install.sh | bash
> export CLAUDE_BIN_PATH="$HOME/.local/bin/claude"
>
> # Windows (PowerShell)
> irm https://claude.ai/install.ps1 | iex
> $env:CLAUDE_BIN_PATH = "$env:USERPROFILE\.local\bin\claude.exe"
> ```
>
> Or set `assistants.claude.claudeBinaryPath` in `~/.rith/config.yaml`.
> The Docker image ships Claude Code pre-installed. See [AI Assistants → Binary path configuration](https://github.com/artur-ciocanu/rith-engine/docs/getting-started/ai-assistants/#binary-path-configuration-compiled-binaries-only) for details.

### Start Using Rith Engine

Once you've completed either setup path, go to your project and start working:

```bash
cd /path/to/your/project
claude
```

```
Use rith to fix issue #42
```

```
What rith workflows do I have? When would I use each one?
```

The coding agent handles workflow selection, branch naming, and worktree isolation for you. Projects are registered automatically the first time they're used.

> **Important:** Always run Claude Code from your target repo, not from the Rith Engine repo. The setup wizard copies the Rith Engine skill into your project so it works from there.

## Web UI

Rith Engine includes a web dashboard for chatting with your coding agent, running workflows, and monitoring activity. Binary installs: run `rith serve` to download and start the web UI in one step. From source: ask your coding agent to run the frontend from the Rith Engine repo, or run `bun run dev` from the repo root yourself.

Register a project by clicking **+** next to "Project" in the chat sidebar - enter a GitHub URL or local path. Then start a conversation, invoke workflows, and watch progress in real time.

**Key pages:**
- **Chat** - Conversation interface with real-time streaming and tool call visualization
- **Dashboard** - Mission Control for monitoring running workflows, with filterable history by project, status, and date
- **Workflow Builder** - Visual drag-and-drop editor for creating DAG workflows with loop nodes
- **Workflow Execution** - Step-by-step progress view for any running or completed workflow

**Monitoring hub:** The sidebar shows conversations from **all platforms** - not just the web. Workflows kicked off from the CLI, messages from Slack or Telegram, GitHub issue interactions - everything appears in one place.

See the [Web UI Guide](https://github.com/artur-ciocanu/rith-engine/adapters/web/) for full documentation.

## What Can You Automate?

Rith Engine ships with workflows for common development tasks:

| Workflow | What it does |
|----------|-------------|
| `rith-assist` | General Q&A, debugging, exploration - full Claude Code agent with all tools |
| `rith-fix-github-issue` | Classify issue → investigate/plan → implement → validate → PR → smart review → self-fix |
| `rith-idea-to-pr` | Feature idea → plan → implement → validate → PR → 5 parallel reviews → self-fix |
| `rith-plan-to-pr` | Execute existing plan → implement → validate → PR → review → self-fix |
| `rith-issue-review-full` | Comprehensive fix + full multi-agent review pipeline for GitHub issues |
| `rith-smart-pr-review` | Classify PR complexity → run targeted review agents → synthesize findings |
| `rith-comprehensive-pr-review` | Multi-agent PR review (5 parallel reviewers) with automatic fixes |
| `rith-create-issue` | Classify problem → gather context → investigate → create GitHub issue |
| `rith-validate-pr` | Thorough PR validation testing both main and feature branches |
| `rith-resolve-conflicts` | Detect merge conflicts → analyze both sides → resolve → validate → commit |
| `rith-feature-development` | Implement feature from plan → validate → create PR |
| `rith-architect` | Architectural sweep, complexity reduction, codebase health improvement |
| `rith-refactor-safely` | Safe refactoring with type-check hooks and behavior verification |
| `rith-ralph-dag` | PRD implementation loop - iterate through stories until done |
| `rith-remotion-generate` | Generate or modify Remotion video compositions with AI |
| `rith-test-loop-dag` | Loop node test workflow - iterative counter until completion |
| `rith-piv-loop` | Guided Plan-Implement-Validate loop with human review between iterations |

Rith Engine ships 17 default workflows - run `rith workflow list` or describe what you want and the router picks the right one.

**Or define your own.** Default workflows are great starting points - copy one from `.rith/workflows/defaults/` and customize it. Workflows are YAML files in `.rith/workflows/`, commands are markdown files in `.rith/commands/`. Same-named files in your repo override the bundled defaults. Commit them - your whole team runs the same process.

See [Authoring Workflows](https://github.com/artur-ciocanu/rith-engine/guides/authoring-workflows/) and [Authoring Commands](https://github.com/artur-ciocanu/rith-engine/guides/authoring-commands/).

## Add a Platform

The Web UI and CLI work out of the box. Optionally connect a chat platform for remote access:

| Platform | Setup time | Guide |
|----------|-----------|-------|
| **Telegram** | 5 min | [Telegram Guide](https://github.com/artur-ciocanu/rith-engine/adapters/telegram/) |
| **Slack** | 15 min | [Slack Guide](https://github.com/artur-ciocanu/rith-engine/adapters/slack/) |
| **GitHub Webhooks** | 15 min | [GitHub Guide](https://github.com/artur-ciocanu/rith-engine/adapters/github/) |
| **Discord** | 5 min | [Discord Guide](https://github.com/artur-ciocanu/rith-engine/adapters/community/discord/) |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Platform Adapters (Web UI, CLI, Telegram, Slack,       │
│                    Discord, GitHub)                     │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                     Orchestrator                        │
│          (Message Routing & Context Management)         │
└─────────────┬───────────────────────────┬───────────────┘
              │                           │
      ┌───────┴────────┐          ┌───────┴────────┐
      │                │          │                │
      ▼                ▼          ▼                ▼
┌───────────┐  ┌────────────┐  ┌──────────────────────────┐
│  Command  │  │  Workflow  │  │    AI Assistant Clients  │
│  Handler  │  │  Executor  │  │   (Claude / Codex / Pi)  │
│  (Slash)  │  │  (YAML)    │  │                          │
└───────────┘  └────────────┘  └──────────────────────────┘
      │              │                      │
      └──────────────┴──────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              SQLite / PostgreSQL (7 Tables)             │
│   Codebases • Conversations • Sessions • Workflow Runs  │
│    Isolation Environments • Messages • Workflow Events  │
└─────────────────────────────────────────────────────────┘
```

## Documentation

Full documentation is available at **[github.com/artur-ciocanu/rith-engine](https://github.com/artur-ciocanu/rith-engine)**.

| Topic | Description |
|-------|-------------|
| [Getting Started](https://github.com/artur-ciocanu/rith-engine/getting-started/overview/) | Setup guide (Web UI or CLI) |
| [The Book of Rith Engine](https://github.com/artur-ciocanu/rith-engine/book/) | 10-chapter narrative tutorial |
| [CLI Reference](https://github.com/artur-ciocanu/rith-engine/reference/cli/) | Full CLI reference |
| [Authoring Workflows](https://github.com/artur-ciocanu/rith-engine/guides/authoring-workflows/) | Create custom YAML workflows |
| [Authoring Commands](https://github.com/artur-ciocanu/rith-engine/guides/authoring-commands/) | Create reusable AI commands |
| [Configuration](https://github.com/artur-ciocanu/rith-engine/reference/configuration/) | All config options, env vars, YAML settings |
| [AI Assistants](https://github.com/artur-ciocanu/rith-engine/getting-started/ai-assistants/) | Claude, Codex, and Pi setup details |
| [Deployment](https://github.com/artur-ciocanu/rith-engine/deployment/) | Docker, VPS, production setup |
| [Architecture](https://github.com/artur-ciocanu/rith-engine/reference/architecture/) | System design and internals |
| [Troubleshooting](https://github.com/artur-ciocanu/rith-engine/reference/troubleshooting/) | Common issues and fixes |

## Telemetry

Rith Engine sends a single anonymous event — `workflow_invoked` — each time a workflow starts, so maintainers can see which workflows get real usage and prioritize accordingly. **No PII, ever.**

**What's collected:** the workflow name, the workflow description (both authored by you in YAML), the platform that triggered it (`cli`, `web`, `slack`, etc.), the Rith Engine version, and a random install UUID stored at `~/.rith/telemetry-id`. Nothing else.

**What's *not* collected:** your code, prompts, messages, git remotes, file paths, usernames, tokens, AI output, workflow node details — none of it.

**Opt out:** set any of these in your environment:

```bash
RITH_TELEMETRY_DISABLED=1
DO_NOT_TRACK=1        # de facto standard honored by Astro, Bun, Prisma, Nuxt, etc.
```

Self-host PostHog or use a different project by setting `POSTHOG_API_KEY` and `POSTHOG_HOST`.

## Contributing

Contributions welcome! See the open [issues](https://github.com/artur-ciocanu/rith-engine/issues) for things to work on.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.

## Star History

[![Star History Chart](https://api.star-history.com/chart?repos=artur-ciocanu/rith-engine&type=date&legend=top-left)](https://www.star-history.com/?repos=artur-ciocanu%2Frith-engine&type=date&legend=top-left)

## License

[MIT](LICENSE)
