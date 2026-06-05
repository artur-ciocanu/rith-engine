---
title: Per-Node Hooks
description: Attach Claude Agent SDK hooks to individual workflow nodes for tool control, context injection, and input modification.
category: guides
area: workflows
audience: [user]
status: current
sidebar:
  order: 6
---

Per-node `hooks` were a Claude Agent SDK feature and are **not supported** in the
current Pi-only build. The `hooks` field may still be accepted by the workflow
schema, but Pi ignores it — attaching hooks to a node has no effect.

For node-level tool control on Pi, use `allowed_tools` / `denied_tools` instead
(see [Authoring Workflows](/guides/authoring-workflows/)).

## Related

- [Authoring Workflows](/guides/authoring-workflows/) — node fields and tool restrictions