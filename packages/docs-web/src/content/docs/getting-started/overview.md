---
title: Getting Started
description: Everything you need to go from zero to a working Rith Engine setup.
category: getting-started
audience: [user]
status: current
sidebar:
  order: 0
---

Everything you need to go from zero to running AI coding workflows with the Rith Engine CLI.

---

## Prerequisites

Before you start, make sure you have:

| Requirement                      | How to check       | How to install                                                                                                      |
| -------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **Git**                          | `git --version`    | [git-scm.com](https://git-scm.com/)                                                                                 |
| **Bun** (replaces Node.js + npm) | `bun --version`    | Linux/macOS: `curl -fsSL https://bun.sh/install \| bash` — Windows: `powershell -c "irm bun.sh/install.ps1 \| iex"` |
| **AI provider (Pi)**             | bundled            | Ships with Rith Engine — authenticate with `pi /login` or set `ANTHROPIC_API_KEY` ([details](/getting-started/ai-assistants/)) |
| **GitHub account**               | —                  | [github.com](https://github.com/)                                                                                   |

> **Do not run as root.** Rith Engine does not work when run as the `root` user. If you're on a VPS or server that only has root, create a regular user first:
>
> ```bash
> adduser rith          # create user (Debian/Ubuntu)
> usermod -aG sudo rith # give sudo access
> su - rith             # switch to the new user
> ```
>
> Then follow this guide from within that user's session.

> **Windows users:** Rith Engine runs natively on Windows — no WSL2 required. Install [Git for Windows](https://git-scm.com/) (which includes Git Bash) and [Bun for Windows](https://bun.sh/docs/installation#windows). One caveat: DAG workflow `bash:` nodes need a bash executable — Git Bash provides this automatically.

> **Bun replaces Node.js** — you do not need Node.js or npm installed. Bun is the runtime, package manager, and test runner for this project. If you already have Node.js, that's fine, but Rith Engine won't use it.

---

## Step 1: Clone and Install

First, clone the Rith Engine repository:

**Option A: Home directory** (personal use, single user)

Linux/macOS:

```bash
cd ~  # or your preferred directory
git clone https://github.com/artur-ciocanu/rith-engine
cd Rith Engine
```

Windows (PowerShell):

```powershell
cd $HOME  # or your preferred directory
git clone https://github.com/artur-ciocanu/rith-engine
cd Rith Engine
```

**Option B: /opt** (Linux/macOS server installs — keeps things tidy)

```bash
sudo mkdir -p /opt/rith
sudo chown $USER:$USER /opt/rith
git clone https://github.com/artur-ciocanu/rith-engine /opt/rith
cd /opt/rith
```

Then install dependencies:

```bash
bun install
```

This installs all dependencies across the monorepo. Takes about 30 seconds.

---

## Step 2: Set Up Authentication

You need two things: a GitHub token (for cloning repos) and Pi authentication (for the AI provider).

### GitHub Token

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **"Generate new token (classic)"**
3. Select scope: **`repo`**
4. Copy the token (starts with `ghp_...`)

### Pi Authentication

Pi Coding Agent is bundled with Rith Engine. Authenticate once via OAuth:

```bash
pi /login
```

Follow the browser flow to log in. This writes `~/.pi/agent/auth.json`, which Pi picks up
automatically — no API keys needed.

Alternatively, set provider API keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`.

---

## Step 3: Configure Environment (Optional)

The CLI uses your existing Pi authentication by default. For GitHub integration, set your token:

```bash
# Set in ~/.rith/.env or your repo's .rith/.env
GH_TOKEN=ghp_your_token_here
GITHUB_TOKEN=ghp_your_token_here
```

That's it. Everything else has sensible defaults:

- **Database:** SQLite at `~/.rith/rith.db` (auto-created, zero setup)
- **AI provider:** Pi (default model `anthropic/claude-sonnet-4-5`)

> **Why two GitHub token variables?** `GH_TOKEN` is used by the GitHub CLI (`gh`), and `GITHUB_TOKEN` is used by Rith Engine's GitHub integration. Set them to the same value.

---

## Step 4: Install the CLI globally

```bash
cd packages/cli && bun link && cd ../..
```

This registers the `rith` command globally so you can run it from any repository.

You'll see output like `Success! Registered "@rith/cli"` followed by a message about `bun link @rith/cli` — **ignore that second part**, it's for adding Rith Engine as a dependency in another project.

Bun installs linked binaries to `~/.bun/bin/`. If the `rith` command isn't found, that directory is not in your `PATH` yet. Fix it:

```bash
# Add to your shell profile (~/.bashrc, ~/.zshrc, etc.)
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

Verify it works:

```bash
rith version
```

## Step 5: Run workflows from your repository

```bash
cd /path/to/your/repository

# See available workflows
rith workflow list

# Ask a question about the codebase
rith workflow run rith-assist "How does the auth module work?"

# Plan a feature on an isolated branch
rith workflow run rith-feature-development --branch feat/dark-mode "Add dark mode"

# Fix a GitHub issue
rith workflow run rith-fix-github-issue --branch fix/issue-42 "Fix issue #42"
```

That's it. The CLI auto-detects the git repo, uses SQLite for state tracking (`~/.rith/rith.db`), and streams output to stdout.

> **The target directory must be a git repository.** Rith Engine uses git worktrees for isolation, so it needs a `.git` folder. If your project isn't a git repo yet, run `git init && git add . && git commit -m "initial commit"` first.

---

## CLI Reference

### Workflows

```bash
# List all available workflows
rith workflow list

# Run a workflow
rith workflow run <name> "<message>"

# Run with worktree isolation (recommended for code changes)
rith workflow run <name> --branch <branch-name> "<message>"

# Run directly in the live checkout without worktree isolation
rith workflow run <name> --no-worktree "<message>"

# Run against a different directory
rith workflow run <name> --cwd /path/to/repo "<message>"
```

### CLI Commands

| Command | What It Does |
|---------|-------------|
| `rith workflow list` | List available workflows |
| `rith workflow run <name> [msg]` | Run a workflow |
| `rith workflow status` | Show running workflows |
| `rith workflow resume <id>` | Resume a failed workflow |
| `rith workflow abandon <id>` | Abandon a non-terminal run |
| `rith workflow approve <id> [comment]` | Approve an interactive loop gate |
| `rith workflow reject <id> [--reason "..."]` | Reject an approval gate |
| `rith workflow cleanup [days]` | Delete old run records (default: 7 days) |
| `rith workflow event emit` | Emit a workflow event |
| `rith isolation list` | List active worktrees |
| `rith isolation cleanup [days]` | Remove stale environments |
| `rith isolation cleanup --merged` | Remove merged branches |
| `rith isolation cleanup --merged --include-closed` | Also remove closed (abandoned) PR branches |
| `rith complete <branch>` | Complete branch lifecycle |
| `rith validate workflows [name]` | Validate workflow definitions |
| `rith version` | Show version info |

### Worktree Management

```bash
rith isolation list              # show active worktrees
rith isolation cleanup           # remove stale (>7 days)
rith isolation cleanup 14        # custom staleness threshold
rith isolation cleanup --merged            # remove merged branches (deletes remote too)
rith isolation cleanup --merged --include-closed  # also remove closed/abandoned PR branches
rith complete <branch>           # complete branch lifecycle (worktree + branches)
rith complete <branch> --force   # skip uncommitted-changes check
```

### Available Workflows

| Workflow | What It Does |
|----------|-------------|
| `rith-assist` | General Q&A, debugging, exploration, CI failures — catch-all |
| `rith-fix-github-issue` | Investigate, root cause analysis, implement fix, validate, PR |
| `rith-idea-to-pr` | Feature idea, plan, implement, validate, PR, parallel reviews, self-fix |
| `rith-plan-to-pr` | Execute existing plan, implement, validate, PR, review |
| `rith-feature-development` | Implement feature from plan, validate, create PR |
| `rith-smart-pr-review` | Complexity-adaptive PR review — routes to relevant agents only |
| `rith-create-issue` | Classify problem, gather context, investigate, create GitHub issue |
| `rith-issue-review-full` | Comprehensive fix + full multi-agent review for GitHub issues |
| `rith-refactor-safely` | Safe refactoring with type-check hooks and behavior verification |
| `rith-architect` | Architectural sweep, complexity reduction, codebase health |
| `rith-ralph-dag` | PRD implementation loop (iterate through stories until done) |
| `rith-remotion-generate` | Generate or modify Remotion video compositions with AI |
| `rith-interactive-prd` | Create a PRD through guided conversation |
| `rith-piv-loop` | Guided Plan-Implement-Validate development with human-in-the-loop |
| `rith-adversarial-dev` | Build a complete application from scratch using adversarial development |
| `rith-workflow-builder` | Create new workflow YAML files with AI assistance |

These bundled workflows work for most projects. To customize, copy one from `.rith/workflows/defaults/` into `.rith/workflows/` and modify it — same-named files override the defaults.

> **Auto-selection:** You don't need to remember workflow names. Just describe what you want — the router reads all workflow descriptions and picks the best match. For example, "fix issue #42" routes to `rith-fix-github-issue`, while "review this PR" routes to `rith-smart-pr-review`. If nothing matches clearly, it falls back to `rith-assist`.

---

## Customize Your Target Repo

Add an `.rith/` directory to your target repo for repo-specific behavior:

```
your-repo/
└── .rith/
    ├── config.yaml         # AI assistant, worktree copy rules
    ├── skills/             # Reusable skills (SKILL.md directories)
    └── workflows/           # Custom multi-step workflows (.yaml files)
```

**Example `.rith/config.yaml`:**

```yaml
pi:
  model: anthropic/claude-sonnet-4-5   # AI provider model
worktree:
  copyFiles:                         # gitignored files/dirs to copy into worktrees
    - .env                           # (`.rith/` is copied automatically — no need to list it)
    - plans/
```

Without any `.rith/` config, Rith Engine uses sensible defaults (bundled commands and workflows).

### Custom Skills

Place `SKILL.md` files in your repo's `.rith/skills/`:

```markdown
---
description: Run the full test suite
argument-hint: <module>
---

# Test Runner

Run tests for: $ARGUMENTS
```

Variables available: `$1`, `$2`, `$3` (positional), `$ARGUMENTS` (all args), `$ARTIFACTS_DIR` (workflow artifacts directory), `$WORKFLOW_ID` (run ID), `$BASE_BRANCH` (base branch), `$nodeId.output` (DAG node output).

### Custom Workflows

Place `.yaml` files in your repo's `.rith/workflows/`:

```yaml
name: my-workflow
description: Plan then implement a feature
model: anthropic/claude-sonnet-4-5

nodes:
  - id: plan
    command: plan

  - id: implement
    command: implement
    depends_on: [plan]
    context: fresh
```

Workflows chain multiple commands as DAG nodes, support parallel execution, conditional branching, and carry context between nodes via `$nodeId.output` substitution.

> **Where are commands and workflows loaded from?**
>
> Commands and workflows are loaded at runtime from the current working directory — not from a fixed global location. The CLI reads from wherever you run the `rith` command, so it picks up uncommitted changes immediately.

---

## Isolation (Worktrees)

When you use the `--branch` flag, the CLI creates a git worktree so your work happens in an isolated directory. This prevents parallel tasks from conflicting with each other or your main branch.

```
~/.rith/
├── rith.db              # SQLite database (auto-created)
└── workspaces/            # Project-centric layout
    └── owner/repo/
        ├── source/        # Clone or symlink to local path
        ├── worktrees/     # Isolated working copies per task
        │   ├── fix/issue-42/
        │   └── feat/dark-mode/
        ├── artifacts/     # Workflow artifacts (never in git)
        └── logs/          # Workflow execution logs
```

---

## Using With Claude Code (Skill)

If you use the Claude Code app and want it to invoke Rith Engine workflows on your behalf, copy the
bundled Rith Engine skill into your project:

```bash
cp -r .claude/skills/rith /path/to/your/repo/.claude/skills/
```

Then in Claude Code, say things like "use rith to fix issue #42" and it will invoke the appropriate workflow.

---

## Troubleshooting

### "Cannot create worktree: repository registration failed" (stale workspace symlink)

This happens when `~/.rith/workspaces/<owner>/<repo>/source` is a symlink pointing at a previous checkout (common after moving or renaming the repo). The error message includes the exact cleanup path to follow:

```
Cannot create worktree: repository registration failed.
Error: Source symlink at ~/.rith/workspaces/<owner>/<repo>/source already points to <old-path>, expected <new-path>
Hint: Remove the stale workspace entry at ~/.rith/workspaces/<owner>/<repo> and retry, or use --no-worktree to skip isolation.
```

Follow the hint — delete the stale workspace folder and re-run, or pass `--no-worktree` to skip isolation for one run.

> On Rith Engine versions before this fix, the same root cause surfaced as the misleading "Cannot create worktree: not in a git repository" (even though the repo was valid). If you see that string, upgrade and you'll get the actionable message above.

---

### "command not found: bun"

Install Bun: `curl -fsSL https://bun.sh/install | bash`, then restart your terminal (or `source ~/.bashrc`).

### "AI provider requires a model"

Set a model via node `model:`, workflow `model:`, or `pi.model` in `.rith/config.yaml` (for example `anthropic/claude-sonnet-4-5`).

### Clone command fails with 401/403

Your GitHub token is missing or invalid. Verify:

```bash
# Test your token
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user
```

If it returns your GitHub profile, the token works. If not, regenerate it.

### AI doesn't respond

Check that Pi authentication is working:

```bash
pi /login      # Re-authenticate if needed
```

### "Cannot find module" or dependency errors

```bash
bun install
```

If that doesn't fix it, delete the `node_modules` folder and reinstall:

```bash
bun install
```

---

## Quick Reference

| Action              | Command                             |
| ------------------- | ----------------------------------- |
| Run a workflow      | `rith workflow run <name> "<msg>"`  |
| List workflows      | `rith workflow list`                |
| Run tests           | `bun run test`                      |
| Type check          | `bun run type-check`                |
| Full validation     | `bun run validate`                  |

---

## What's Next?

### Create custom skills and workflows

Add AI prompts to your repo that Rith Engine can execute:

```
your-repo/
└── .rith/
    ├── skills/          # Reusable skills (SKILL.md directories)
    └── workflows/       # YAML files chaining skills together
```

See [Authoring Workflows](/guides/authoring-workflows/) and [Authoring Skills](/guides/authoring-skills/).

---

## Further Reading

- [Configuration](/getting-started/configuration/) — All configuration options
- [AI Assistants](/getting-started/ai-assistants/) — Pi setup and authentication
- [CLI Reference](/reference/cli/) — Full CLI documentation
- [Authoring Workflows](/guides/authoring-workflows/) — Creating custom workflows
