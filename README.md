# Rith Engine

> **Fork of [Archon](https://github.com/coleam00/Archon)** by Cole Medin (MIT).
> See [ATTRIBUTION.md](ATTRIBUTION.md) for details.

A workflow engine for AI coding agents. Define development processes as YAML workflows — planning, implementation, validation, code review, PR creation — and run them deterministically.

## What It Does

Encode your development process as a workflow. The workflow defines the phases, validation gates, and artifacts. The AI fills in the intelligence at each step, but the structure is deterministic and owned by you.

- **Repeatable** — Same workflow, same sequence, every time
- **Isolated** — Every workflow run gets its own git worktree; run fixes in parallel
- **Composable** — Mix deterministic nodes (bash, tests, git ops) with AI nodes (planning, code generation, review)
- **Portable** — Define workflows in `.rith/workflows/`, commit to your repo

## Example

```yaml
# .rith/workflows/build-feature.yaml
nodes:
  - id: plan
    prompt: "Explore the codebase and create an implementation plan"

  - id: implement
    depends_on: [plan]
    loop:
      prompt: "Read the plan. Implement the next task. Run validation."
      until: ALL_TASKS_COMPLETE
      fresh_context: true

  - id: run-tests
    depends_on: [implement]
    bash: "bun run validate"

  - id: review
    depends_on: [run-tests]
    prompt: "Review all changes against the plan. Fix any issues."

  - id: create-pr
    depends_on: [review]
    prompt: "Push changes and create a pull request"
```

## Getting Started

```bash
git clone https://github.com/artur-ciocanu/rith-engine
cd rith-engine
bun install
```

### CLI

```bash
rith workflow list                    # List available workflows
rith workflow run <name> [message]    # Run a workflow
rith version                         # Show version
```

### Build Binary

```bash
bun build --compile --minify packages/cli/src/cli.ts --outfile dist/rith
./dist/rith version
```

## Configuration

- **Global config**: `~/.rith/config.yaml`
- **Global env**: `~/.rith/.env`
- **Per-repo workflows**: `.rith/workflows/`
- **Per-repo skills**: `.rith/skills/`
- **Per-repo env**: `.rith/.env`

Override the home directory with `RITH_HOME`.

## Architecture

```
CLI
 │
 ▼
Orchestrator (message routing)
 │
 ▼
Workflow Executor (DAG nodes: bash, prompt, skills)
 │
 ▼
AI Provider (Pi)
 │
 ▼
SQLite
```

## License

[MIT](LICENSE)
