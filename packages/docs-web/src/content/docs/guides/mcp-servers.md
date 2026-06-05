---
title: Per-Node MCP Servers
description: Attach MCP (Model Context Protocol) servers to individual workflow nodes for external tool access.
category: guides
area: workflows
audience: [user]
status: current
sidebar:
  order: 7
---

Per-node `mcp` (Model Context Protocol servers) is **not supported** in the
current Pi-only build — Pi's MCP capability is disabled. The `mcp` field may
still be accepted by the workflow schema, but Pi ignores it: no servers are
started and no external tools are added to the node.

For node tooling on Pi, use the built-in tools (`read`, `bash`, `edit`, `write`,
`grep`, `find`, `ls`) together with `allowed_tools` / `denied_tools` to scope
them (see [Authoring Workflows](/guides/authoring-workflows/)).

## Related

- [Authoring Workflows](/guides/authoring-workflows/) — node fields and tool restrictions