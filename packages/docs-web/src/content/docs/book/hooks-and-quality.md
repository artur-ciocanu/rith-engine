---
title: Hooks and Quality Loops
description: Intercept tool calls during node execution to inject guidance, block actions, or create feedback loops.
category: book
part: advanced
audience: [user]
sidebar:
  order: 9
---

In [Chapter 8](/book/dag-workflows/) you learned to route work through a graph — classify, branch, parallelize. Hooks were the original way to steer the AI *while a node is executing*: intercept each tool call before or after it runs to inject guidance, block actions, or build quality loops.

> **Hooks are not supported in the Pi-only build.** Hooks were a Claude Agent SDK feature. Now that Pi is the sole AI provider, the `hooks:` field is still accepted by the workflow schema for backward compatibility, but Pi ignores it at runtime — no `PreToolUse`/`PostToolUse` callbacks fire. Defining hooks has no effect.

## What to use instead

You can still constrain and steer node behavior without hooks:

- **Restrict tools** — use `allowed_tools` / `denied_tools` on a node to limit what the AI can do. Pi enforces these. Pi's built-in tools are `read, bash, edit, write, grep, find, ls`; `allowed_tools: []` grants no tools at all. This covers most guardrail use cases (e.g. a read-only code-review node).
- **Inject guidance up front** — put standing instructions in the node's `command` or `prompt:` rather than reacting per tool call.
- **Create quality loops with the graph** — use a `loop:` node, or a fresh-context verification node (`context: fresh`) downstream of an implementation node, to get independent re-checking. See [Chapter 8](/book/dag-workflows/).

For the full list of which workflow fields Pi supports, see the [Quick Reference](/book/quick-reference/).

---

[Chapter 10: Quick Reference →](/book/quick-reference/) collects every CLI command, variable, and YAML option in one scannable place.