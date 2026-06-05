---
title: New Developer Guide
description: Codebase orientation for new Rith Engine developers — architecture overview, workflows, CLI, and first steps.
category: contributing
audience: [developer]
status: current
sidebar:
  order: 1
---

> **TL;DR**: Rith Engine is a CLI workflow engine that runs the Pi Coding Agent in isolated git worktrees. CI systems or developers invoke `rith workflow run` to execute multi-step AI workflows defined as YAML DAGs.

---

## The Problem We Solve

```
┌─────────────────────────────────────────────────────────────────────┐
│                        WITHOUT RITH ENGINE                         │
│                                                                    │
│   You want AI to fix an issue, review a PR, or implement a        │
│   feature — but there's no structured way to chain multiple        │
│   AI steps, isolate work, or integrate with CI.                   │
│                                                                    │
│   ┌──────────┐     ❌ No isolation    ┌──────────────────┐        │
│   │  CI / Dev│ ──────────────────────│  AI Assistant     │        │
│   │          │     ❌ No multi-step  │  (Pi)            │        │
│   └──────────┘     ❌ No DAG flows   └──────────────────┘        │
│                                                                    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         WITH RITH ENGINE                           │
│                                                                    │
│   ┌──────────┐                       ┌──────────────────┐         │
│   │  CI Job  │ ─rith workflow run───▶│  Rith Engine CLI │         │
│   │  or Dev  │                       │                  │         │
│   └──────────┘                       │  ┌────────────┐  │         │
│        │                             │  │Pi Coding   │  │         │
│        │                             │  │Agent SDK   │  │         │
│        │                             │  └─────┬──────┘  │         │
│        │                             │        │         │         │
│        │                             │  ┌─────▼──────┐  │         │
│        │◀────exit 0 + PR created─────│  │ Git Repo   │  │         │
│        │                             │  │ (worktree) │  │         │
│                                      │  └────────────┘  │         │
│                                      └──────────────────┘         │
│                                                                    │
│   Structured, isolated, automatable AI coding workflows.          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Core Concept: CLI → Workflow → AI → Code

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   TRIGGER                  RITH ENGINE                         CODEBASE  │
│                                                                          │
│   ┌─────────┐            ┌─────────────────┐            ┌──────────┐   │
│   │ CI Job  │            │                 │            │          │   │
│   │ or Dev  │──workflow──▶│  Workflow       │─────Pi────▶│ Git Repo │   │
│   │ Terminal│   run      │  Executor       │            │          │   │
│   │         │◀──exit ────│  (DAG runner)   │◀──────────│ (files)  │   │
│   └─────────┘   code     └─────────────────┘            └──────────┘   │
│                                                                          │
│   You run a workflow, AI works on code, you get results + exit code.    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## How to Use Rith Engine

### Command Line

Run workflows from your terminal or CI pipeline:

```
┌─────────────────────────────────────────────────────────────────┐
│ TERMINAL                                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ $ rith workflow list                                            │
│                                                                 │
│ Available workflows in .rith/workflows/:                        │
│   - rith-assist                General help and questions       │
│   - rith-fix-github-issue      Investigate and fix issues       │
│   - rith-comprehensive-pr-review  Full PR review with agents    │
│                                                                 │
│ $ rith workflow run rith-assist "How does the auth module work?"│
│                                                                 │
│ 🔧 READ                                                         │
│ Reading: packages/core/src/services/auth.ts                     │
│                                                                 │
│ The auth module handles token validation and session             │
│ management. It validates JWT tokens from the GitHub OAuth        │
│ flow and manages session state in the database...               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Good for:** Local development, CI/CD automation, testing workflows, scripting

### CI Integration

Rith Engine is designed to be triggered from CI systems:

```
┌─────────────────────────────────────────────────────────────────┐
│ CI PIPELINE (GitHub Actions / GitLab CI / Jenkins)              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   on:                                                           │
│     issues:                                                     │
│       types: [labeled]                                          │
│                                                                 │
│   steps:                                                        │
│     - run: |                                                    │
│         rith workflow run rith-fix-github-issue \                │
│           --branch fix/issue-${{ github.event.issue.number }} \ │
│           --issue-context '${{ toJson(github.event.issue) }}'   │
│           "Fix issue #${{ github.event.issue.number }}"         │
│                                                                 │
│   # Exit code 0 = success, 1 = failure                          │
│   # --json flag for machine-readable output                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Workflows (Multi-Step Automation)

This is where Rith Engine shines — automated multi-step AI workflows:

```
┌─────────────────────────────────────────────────────────────────┐
│ WORKFLOW EXECUTION                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ $ rith workflow run rith-fix-github-issue \                      │
│     --branch fix/issue-42 \                                     │
│     --issue-context @issue.json \                               │
│     "Fix issue #42"                                             │
│                                                                 │
│   🔍 [investigate] Reading issue, exploring code...             │
│   ✅ [investigate] Root cause: touch event handler missing       │
│                                                                 │
│   🔧 [implement] Making changes, running tests...               │
│   ✅ [implement] Fix applied, tests passing                     │
│                                                                 │
│   📤 PR #127 created on branch fix/issue-42                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## How Workflows Work (The Magic)

A workflow is a YAML file that chains AI prompts together:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   .rith/workflows/fix-github-issue.yaml                                │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ name: fix-github-issue                                          │  │
│   │ description: Investigate and fix a GitHub issue                 │  │
│   │                                                                 │  │
│   │ nodes:                                                          │  │
│   │   - id: investigate                                             │  │
│   │     command: investigate-issue    ◀── Node 1: Research         │  │
│   │   - id: implement                                               │  │
│   │     command: implement-issue      ◀── Node 2: Fix              │  │
│   │     depends_on: [investigate]                                   │  │
│   │     context: fresh                                              │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│                              │                                          │
│                              ▼                                          │
│                                                                         │
│   EXECUTION FLOW:                                                       │
│                                                                         │
│   ┌──────────────────┐      ┌──────────────────┐      ┌────────────┐  │
│   │  investigate-    │      │   implement-     │      │            │  │
│   │  issue.md        │─────▶│   issue.md       │─────▶│  PR #127   │  │
│   │                  │      │                  │      │            │  │
│   │  - Read issue    │      │  - Read artifact │      │  Created!  │  │
│   │  - Explore code  │      │  - Make changes  │      │            │  │
│   │  - Find root     │      │  - Run tests     │      │            │  │
│   │    cause         │      │  - Commit        │      │            │  │
│   │  - Save artifact │      │  - Create PR     │      │            │  │
│   └──────────────────┘      └──────────────────┘      └────────────┘  │
│                                                                         │
│   Each "command" is a markdown file with AI instructions.              │
│   The workflow executor runs nodes in dependency order.                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Available Workflows

The table below lists the key bundled workflows. All bundled workflows are prefixed with `rith-`. Run `rith workflow list` to see the full current list.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   WORKFLOW                              TRIGGER PHRASES    WHAT IT DOES │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ rith-fix-github-issue    "fix this issue"        Investigate   │  │
│   │                            "implement #42"         + Fix + PR    │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ rith-comprehensive-     "review this PR"        5 parallel     │  │
│   │   pr-review               "code review"           review agents  │  │
│   │                                                   + auto-fix     │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ rith-resolve-conflicts  "resolve conflicts"     Auto-resolve   │  │
│   │                           "fix merge conflicts"   git conflicts  │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ rith-ralph-dag          "run ralph"             PRD loop       │  │
│   │                           "ralph dag"             (autonomous)   │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ rith-assist             (anything else)         General help    │  │
│   │                           "what does X do?"       questions,     │  │
│   │                           "help me debug"         debugging      │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Parallel Agents: The PR Review Example

The `rith-comprehensive-pr-review` workflow runs 5 AI agents simultaneously:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   $ rith workflow run rith-comprehensive-pr-review --branch pr/127     │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ Step 1: pr-review-scope        Determine what changed           │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ Step 2: sync-pr-with-main      Rebase onto latest main          │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ Step 3: PARALLEL BLOCK (5 agents running at once)               │  │
│   │                                                                 │  │
│   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │  │
│   │   │ code-review  │  │ error-       │  │ test-        │         │  │
│   │   │ agent        │  │ handling     │  │ coverage     │         │  │
│   │   │              │  │ agent        │  │ agent        │         │  │
│   │   │ Style,       │  │ Catch blocks │  │ Missing      │         │  │
│   │   │ patterns,    │  │ Silent fails │  │ tests?       │         │  │
│   │   │ bugs         │  │ Logging      │  │ Edge cases   │         │  │
│   │   └──────────────┘  └──────────────┘  └──────────────┘         │  │
│   │                                                                 │  │
│   │   ┌──────────────┐  ┌──────────────┐                           │  │
│   │   │ comment-     │  │ docs-        │                           │  │
│   │   │ quality      │  │ impact       │                           │  │
│   │   │ agent        │  │ agent        │                           │  │
│   │   │              │  │              │                           │  │
│   │   │ Outdated?    │  │ README?      │                           │  │
│   │   │ Accurate?    │  │ CLAUDE.md?   │                           │  │
│   │   └──────────────┘  └──────────────┘                           │  │
│   │                                                                 │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ Step 4: synthesize-review      Combine all findings             │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ Step 5: implement-review-fixes  Auto-fix CRITICAL/HIGH issues   │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## The Ralph Loop: Autonomous PRD Implementation

For larger features, Ralph executes user stories one-by-one until complete. The workflow is `rith-ralph-dag`:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   PRD FILE: .rith/ralph/my-feature/prd.json                            │
│                                                                         │
│   {                                                                     │
│     "stories": [                                                        │
│       { "id": "S1", "title": "Add button", "passes": true },           │
│       { "id": "S2", "title": "Add handler", "passes": true },          │
│       { "id": "S3", "title": "Add tests", "passes": false }, ◀─ NEXT  │
│       { "id": "S4", "title": "Add docs", "passes": false }             │
│     ]                                                                   │
│   }                                                                     │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   RALPH LOOP EXECUTION:                                                 │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ Iteration 1                                                     │  │
│   │ ─────────────────────────────────────────────────────────────── │  │
│   │ 1. Read prd.json → Find S3 (first with passes: false)          │  │
│   │ 2. Implement S3: "Add tests"                                    │  │
│   │ 3. Run: bun run type-check && bun test                         │  │
│   │ 4. Commit: "feat: S3 - Add tests"                              │  │
│   │ 5. Update prd.json: S3.passes = true                           │  │
│   │ 6. More stories remain → Continue                              │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ Iteration 2                                                     │  │
│   │ ─────────────────────────────────────────────────────────────── │  │
│   │ 1. Read prd.json → Find S4 (next with passes: false)           │  │
│   │ 2. Implement S4: "Add docs"                                     │  │
│   │ 3. Run validation                                               │  │
│   │ 4. Commit                                                       │  │
│   │ 5. Update prd.json: S4.passes = true                           │  │
│   │ 6. ALL stories pass → Create PR                                │  │
│   │ 7. Output: <promise>COMPLETE</promise>                          │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│                        LOOP STOPS                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   CI SYSTEM / DEVELOPER                                                 │
│                                                                         │
│   ┌──────────────────┐                                                  │
│   │ GitHub Actions   │                                                  │
│   │ GitLab CI        │──── rith workflow run ────┐                      │
│   │ Jenkins          │                           │                      │
│   │ Terminal         │                           │                      │
│   └──────────────────┘                           │                      │
│                                                  ▼                      │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ packages/cli          CLI entry point, argument parsing         │  │
│   │                       Creates worktree, resolves workflow       │  │
│   └──────────────────────────────┬──────────────────────────────────┘  │
│                                  │                                      │
│                                  ▼                                      │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ packages/workflows    Workflow executor (DAG runner)            │  │
│   │                       Resolves nodes, manages dependencies     │  │
│   └──────────────────────────────┬──────────────────────────────────┘  │
│                                  │                                      │
│                                  ▼                                      │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ packages/providers    Pi Coding Agent interface                 │  │
│   │                       pi-coding-agent SDK (sole AI provider)    │  │
│   └──────────────────────────────┬──────────────────────────────────┘  │
│                                  │                                      │
│                                  ▼                                      │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ packages/isolation    Git worktree creation and management     │  │
│   │ packages/git          Branch operations, merge detection       │  │
│   │ packages/paths        Path resolution for workspaces           │  │
│   │ packages/core         Database, config, shared services        │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Isolation: Git Worktrees

Each workflow run gets its own isolated copy of the repo:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   ~/.rith/workspaces/owner/repo/worktrees/                             │
│   │                                                                     │
│   ├── fix/issue-42/           ◀── Fixing issue #42                     │
│   │   └── (full repo)            Working on fix for mobile bug         │
│   │                                                                     │
│   ├── feat/dark-mode/         ◀── Feature development                  │
│   │   └── (full repo)            Adding dark mode feature              │
│   │                                                                     │
│   └── pr/127/                 ◀── PR review worktree                   │
│       └── (full repo)            Running review workflow                │
│                                                                         │
│   WHY WORKTREES?                                                        │
│   ─────────────────────────────────────────────────────────────────     │
│   - Multiple workflows can run simultaneously                          │
│   - No branch conflicts between parallel work                          │
│   - Each gets isolated file changes                                    │
│   - Cleaned up with `rith isolation cleanup`                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Configuration Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   CONFIGURATION LAYERS (later overrides earlier)                       │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ 1. DEFAULTS (hardcoded)                                         │  │
│   │    pi.model: anthropic/claude-sonnet-4-5  # built-in default    │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ 2. GLOBAL CONFIG (~/.rith/config.yaml)                         │  │
│   │    pi.model: anthropic/claude-opus-4-5                          │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ 3. REPO CONFIG (.rith/config.yaml)                             │  │
│   │    pi:                       # This repo's AI settings          │  │
│   │      model: anthropic/claude-sonnet-4-5                         │  │
│   │    commands: { folder: .rith/commands/custom }                  │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │ 4. ENVIRONMENT VARIABLES (highest priority)                     │  │
│   │    DATABASE_URL=postgres://...   # overrides config             │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   YOUR REPO                         RITH ENGINE STATE                   │
│                                                                         │
│   my-app/                           ~/.rith/                            │
│   ├── .rith/                        ├── config.yaml      (global cfg)  │
│   │   ├── config.yaml               ├── rith.db          (SQLite)      │
│   │   ├── commands/                 ├── workspaces/      (worktrees)   │
│   │   │   ├── investigate-issue.md  │   └── user/repo/                 │
│   │   │   ├── implement-issue.md   │       ├── source/    (clone)      │
│   │   │   └── assist.md            │       └── worktrees/ (isolation)  │
│   │   ├── workflows/               │           ├── fix/issue-42/       │
│   │   │   ├── fix-github-issue.yaml│           └── feat/dark-mode/     │
│   │   │   └── assist.yaml          │                                   │
│   │   └── artifacts/                                                   │
│   │       └── issues/                                                  │
│   │           └── issue-42.md                                          │
│   ├── packages/                                                        │
│   └── ...                                                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Reference: Common Commands

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   WHAT YOU WANT                     COMMAND                             │
│                                                                         │
│   List available workflows          rith workflow list                  │
│   Run a workflow                    rith workflow run <name> "<msg>"    │
│   Run with branch isolation         rith workflow run <name> -b <br>   │
│   Run without isolation             rith workflow run <name>            │
│                                       --no-worktree "<msg>"            │
│   Resume a failed run               rith workflow run <name> --resume  │
│   JSON output (for CI)              rith workflow run <name> --json    │
│   Check workflow status             rith workflow status               │
│   Approve a paused workflow         rith workflow approve <id>         │
│   Reject a paused workflow          rith workflow reject <id>          │
│   List active worktrees             rith isolation list                │
│   Clean up stale worktrees          rith isolation cleanup             │
│   Clean up merged branches          rith isolation cleanup --merged    │
│   Complete a branch                 rith complete <branch>             │
│   Show version                      rith version                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   RITH ENGINE = CLI Workflow Engine for AI Coding Assistants            │
│                                                                         │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                                                                │   │
│   │   CI / Terminal ──▶ rith workflow run ──▶ AI (Pi)              │   │
│   │                           │                    │               │   │
│   │                           ▼                    ▼               │   │
│   │                      Workflows           Git Worktrees         │   │
│   │                     (DAG executor)       (isolation)           │   │
│   │                                                                │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   KEY CAPABILITIES:                                                    │
│   ─────────────────                                                    │
│   ✓ CLI-first: invoke from terminal or any CI system                   │
│   ✓ Automated multi-step workflows (YAML DAGs)                        │
│   ✓ Parallel AI agents for complex tasks                              │
│   ✓ Isolated environments via git worktrees                           │
│   ✓ Custom prompts versioned in Git                                   │
│   ✓ Exit code + optional JSON output for CI integration               │
│                                                                         │
│   WHEN TO USE:                                                         │
│   ─────────────                                                        │
│   ✓ You want CI-driven issue fixing and PR reviews                    │
│   ✓ You want automated multi-step AI coding workflows                 │
│   ✓ You want parallel development without branch conflicts            │
│   ✓ You want custom AI workflows for your project                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Next Steps

1. **Read**: [Getting Started](/getting-started/overview/) - Set up your first instance
2. **Explore**: `.rith/workflows/` - See example workflows
3. **Customize**: `.rith/commands/` - Create your own prompts
4. **Configure**: `.rith/config.yaml` - Tweak settings
