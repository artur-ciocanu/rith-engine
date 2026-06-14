---
title: Core Concepts
description: Key concepts in Rith Engine — workflows, nodes, skills, and isolation.
category: getting-started
audience: [user]
sidebar:
  order: 1
---

Rith Engine runs AI coding agents through four core concepts. Understanding these will make everything else click.

## Workflows

A **workflow** is a YAML file that defines a multi-step AI coding task as a directed acyclic graph (DAG). Each workflow lives in `.rith/workflows/` and has a name, description, and a set of nodes with declared dependencies.

```yaml
name: fix-issue
description: Investigate and fix a GitHub issue

nodes:
  - id: investigate
    prompt: "Investigate the reported GitHub issue. Identify root cause and affected files."

  - id: implement
    prompt: "Implement the fix based on the investigation."
    depends_on: [investigate]
    context: fresh
```

Nodes without dependencies run immediately. Nodes in the same dependency layer run in parallel. This means a workflow with three independent review nodes will fan out and run all three concurrently, then converge at a downstream node that depends on all of them.

Rith Engine ships with bundled default workflows. Run `rith workflow list` to see what's available, or browse `.rith/workflows/defaults/` for real examples.

## Nodes

Nodes are the building blocks of workflows. Each node does exactly one thing, and every node must specify exactly one of these types:

| Type | What it does |
|------|-------------|
| `prompt:` | Sends an inline prompt string to an AI agent |
| `bash:` | Runs a shell script (no AI). Stdout is captured as `$nodeId.output` |
| `loop:` | Runs an AI prompt repeatedly until a completion signal is detected |
| `approval:` | Pauses the workflow for human review (approve or reject) |
| `cancel:` | Terminates the workflow early with a reason string |

Nodes connect through `depends_on` to form a DAG. You can add conditional branching with `when:` expressions, control join behavior with `trigger_rule`, and override the model per node.

```yaml
nodes:
  - id: classify
    prompt: "Classify the issue as BUG or FEATURE."
    output_format:
      type: object
      properties:
        type: { type: string, enum: [BUG, FEATURE] }
      required: [type]

  - id: fix-bug
    prompt: "Investigate and fix the bug."
    depends_on: [classify]
    when: "$classify.output.type == 'BUG'"

  - id: build-feature
    prompt: "Plan and build the feature."
    depends_on: [classify]
    when: "$classify.output.type == 'FEATURE'"
```

## Skills

A **skill** is a directory in `.rith/skills/` containing a `SKILL.md` file that provides domain expertise to AI nodes. When a workflow node references `skills: [my-skill]`, Rith Engine loads `.rith/skills/my-skill/SKILL.md` and includes it as context for the AI.

Skills are the reusable knowledge units of Rith Engine. They encode best practices, conventions, and domain-specific instructions that AI agents use to produce better results.

Rith Engine ships with bundled default skills. Repo-level skills in `.rith/skills/` override bundled defaults with the same name.

## Isolation (Worktrees)

Every workflow run gets its own **git worktree** by default -- an isolated copy of your repository. This gives you three things:

1. **Your working branch stays clean.** Workflow changes happen in a separate directory.
2. **Multiple workflows run in parallel** without conflicting with each other.
3. **Failed runs don't leave a mess.** Clean up with `rith isolation cleanup`.

Worktrees live at `~/.rith/workspaces/<owner>/<repo>/worktrees/`. Each worktree gets its own branch, so you can inspect the work, create a PR from it, or discard it.

To opt out of isolation (run directly in your checkout), pass `--no-worktree`:

```bash
rith workflow run quick-fix --no-worktree "Fix the typo in README"
```

When you're done with a worktree's branch, clean up everything (worktree + local and remote branches) with:

```bash
rith complete <branch-name>
```

---

## Next Steps

- [Quick Start](/getting-started/quick-start/) -- Run your first workflow
- [Authoring Workflows](/guides/authoring-workflows/) -- Create your own multi-step workflows
- [Variable Reference](/reference/variables/) -- All supported variables
