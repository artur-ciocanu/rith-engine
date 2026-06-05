---
title: Your First Five Minutes
description: Get your first Rith Engine workflow running in under five minutes against your own codebase.
category: book
part: orientation
audience: [user]
sidebar:
  order: 2
---

Let's skip the theory and get you to a win. By the end of this chapter, you'll have run two real Rith Engine workflows against your own codebase.

---

## Prerequisites

Before you start, make sure you have:

- [ ] **Git** installed (`git --version` should work)
- [ ] **Bun** installed — get it at [bun.sh](https://bun.sh) if you don't have it (`bun --version`)
- [ ] **Pi authentication** — Pi (the AI agent) is bundled with Rith Engine, so there's nothing extra to install. Authenticate with `pi /login` (OAuth), or set an API key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`)
- [ ] **A git repository** to run workflows against — any project works

> **Authenticating Pi**: `pi /login` writes OAuth credentials to `~/.pi/agent/auth.json`, which Rith Engine picks up automatically. Already have an `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` / `GEMINI_API_KEY`) in your environment? That works too — no extra setup needed.

---

## Install Rith Engine (60 seconds)

```bash
# Clone and install
git clone https://github.com/artur-ciocanu/rith-engine.git
cd Rith Engine
bun install

# Register the rith command globally
cd packages/cli && bun link && cd ../..

# Verify it worked
rith version
```

You should see something like `rith v0.2.12`. That's it — Rith Engine is installed.

> **If `rith` isn't found after `bun link`:** Your shell may need to reload. Run `source ~/.zshrc` (or `~/.bashrc`), then try again. Alternatively, use `bun run cli` from inside the `Rith Engine` directory for this session.

---

## Your First Win: Ask a Question (90 seconds)

Navigate to any git repository on your machine, then run:

```bash
cd /path/to/your/project

rith workflow run rith-assist "What's the entry point for this application?"
```

Rith Engine will analyze your codebase and answer the question with full context. You'll see it thinking through your files in real time, streamed to your terminal.

**You just ran your first Rith Engine workflow.** It's a single-step workflow — one command, one AI call, one answer. Simple, but useful.

> **Tip:** `rith-assist` works for any question. "How does auth work?", "Where is the database configured?", "What does this function do?" — it's your always-available codebase expert.

---

## Your Second Win: Fix an Issue (2 minutes)

If your repository has a GitHub issue open, try this:

```bash
rith workflow run rith-fix-github-issue --branch fix/my-first-run "Fix #<issue-number>"
```

Replace `<issue-number>` with a real issue number from your repo. Then watch what happens:

1. **Investigate** — Rith Engine reads the issue, explores relevant code, and documents its findings
2. **Implement** — It makes the fix based on the investigation
3. **Validate** — It runs your tests to confirm nothing broke
4. **Create PR** — It opens a pull request with a full description

**You just ran a four-step automated workflow.** Each step ran a separate command, passing artifacts to the next step. The PR is ready for your review.

> **No GitHub issues handy?** Try `rith workflow run rith-feature-development --branch feat/test "Add a simple hello world endpoint"` on any web project — it'll implement and create a PR.

---

## What Just Happened?

Those two commands did more than they appeared to. Rith Engine loaded a workflow definition, created an isolated git workspace, ran multiple AI steps in sequence, and connected them through files called **artifacts**.

In [Chapter 3: How Rith Engine Actually Works →](/book/how-it-works/), we'll trace exactly what happened — step by step, file by file — so you understand the system you're working with.
