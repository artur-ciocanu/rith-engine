---
title: Authoring Workflows
description: Create multi-step YAML workflows with DAG nodes, conditional branching, and parallel execution.
category: guides
area: workflows
audience: [user]
status: current
sidebar:
  order: 1
---

This guide explains how to create workflows that orchestrate multiple AI steps into automated pipelines.

## What is a Workflow?

A workflow is a **YAML file** that defines a directed acyclic graph (DAG) of AI steps to execute. Workflows enable:

- **Multi-step automation**: Chain multiple AI agents together
- **Parallel execution**: Independent nodes run concurrently
- **Conditional branching**: Route to different paths based on node output
- **Artifact passing**: Output from one node becomes input for downstream nodes
- **Iterative loops**: Loop nodes repeat until a completion signal

```yaml
name: fix-github-issue
description: Investigate and fix a GitHub issue end-to-end

nodes:
  - id: investigate
    prompt: "Investigate the reported GitHub issue. Identify root cause and affected files."

  - id: implement
    prompt: "Implement the fix based on the investigation findings."
    depends_on: [investigate]
    context: fresh
```

> **Using defaults as templates:** Rith Engine ships default workflows in `.rith/workflows/defaults/` (12 bundled into the binary, plus additional ones available on disk in source builds). Browse them for real-world examples, then copy and modify:
> ```bash
> cp .rith/workflows/defaults/rith-fix-github-issue.yaml .rith/workflows/my-fix-issue.yaml
> ```
> Same-named files in `.rith/workflows/` override the bundled defaults.

---

## File Location

Workflows live in `.rith/workflows/` relative to the working directory:

```
.rith/
├── workflows/
│   ├── my-workflow.yaml
│   └── review/
│       └── full-review.yaml    # Subdirectories work
└── skills/
    └── [skills used by workflows]
```

Rith Engine discovers workflows recursively - subdirectories are fine. If a workflow file fails to load (syntax error, validation failure), it's skipped and the error is reported via `/workflow list`.

> **Global workflows:** For workflows that apply to every project, place them in `~/.rith/workflows/`. Global workflows are overridden by same-named repo workflows. See [Global Workflows](/guides/global-workflows/).

> The CLI reads workflow files from wherever you run it (sees uncommitted changes).

---

## Workflow Structure

Workflows use DAG-based execution with `nodes:`. Each node runs an inline prompt or shell command, declares dependencies, and supports conditional branching:

```yaml
name: classify-and-fix
description: Classify issue type, then run the appropriate fix path

nodes:
  - id: classify
    prompt: "Classify the issue as BUG or FEATURE."
    output_format:
      type: object
      properties:
        type:
          type: string
          enum: [BUG, FEATURE]
      required: [type]

  - id: investigate
    prompt: "Investigate the bug. Identify root cause."
    depends_on: [classify]
    when: "$classify.output.type == 'BUG'"

  - id: plan
    prompt: "Plan the feature implementation."
    depends_on: [classify]
    when: "$classify.output.type == 'FEATURE'"

  - id: implement
    prompt: "Implement the changes based on the investigation or plan."
    depends_on: [investigate, plan]
    trigger_rule: none_failed_min_one_success

Nodes without `depends_on` run immediately. Nodes in the same topological layer run concurrently via `Promise.allSettled`. Skipped nodes (failed `when:` condition or `trigger_rule`) propagate their skipped state to dependants.

> **Note:** The `steps:` (sequential) format has been removed. All workflows use `nodes:` (DAG) format exclusively.

---

## DAG-Based Workflow Schema

```yaml
# Required
name: workflow-name
description: |
  What this workflow does.

# Optional workflow-level configuration
model: anthropic/claude-sonnet-4-5
worktree:                        # Optional: pin isolation behavior regardless of caller
  enabled: false                 #   false = always run in the live checkout (--no-worktree).
                                 #           Use for read-only workflows like triage/reporting.
                                 #           true = must use a worktree; CLI --no-worktree
                                 #           hard-errors. Omit to let the caller decide
                                 #           (current default = worktree).
tags: [GitLab, Review]           # Optional: filter tags for categorization. Overrides the
                                 #   keyword-based tag inference. An empty list (`tags: []`)
                                 #   suppresses inference and shows no tags. Omit to fall
                                 #   back to inferred tags (the default).

# Required for DAG-based
nodes:
  - id: classify                 # Unique node ID (used for dependency refs and $id.output)
    prompt: "Classify the issue as BUG or FEATURE."
    output_format:               # Optional: structured JSON output. Best-effort on Pi (schema appended to prompt, JSON extracted from result text).
      type: object
      properties:
        type:
          type: string
          enum: [BUG, FEATURE]
      required: [type]

  - id: investigate
    prompt: "Investigate the bug. Identify root cause and affected files."
    depends_on: [classify]       # Wait for classify to complete
    when: "$classify.output.type == 'BUG'"  # Skip if condition is false

  - id: plan
    prompt: "Plan the feature implementation."
    depends_on: [classify]
    when: "$classify.output.type == 'FEATURE'"

  - id: implement
    prompt: "Implement the changes."
    depends_on: [investigate, plan]
    trigger_rule: none_failed_min_one_success  # Run if at least one dep succeeded

  - id: inline-node
    prompt: "Summarize the changes made in $implement.output"
    depends_on: [implement]
    context: fresh               # Force fresh session for this node
    model: anthropic/claude-haiku-4-5  # Per-node model override
    # hooks: ...                 # NOT supported under Pi (Claude Agent SDK only)
    # mcp: .rith/mcp/servers.json  # NOT supported under Pi (Claude Agent SDK only)
    # skills: [remotion-best-practices]  # Optional: per-node skills — see skills guide
```

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | string | Inline prompt string |
| `bash` | string | Shell script (no AI). Stdout captured as `$nodeId.output`. Optional `timeout` (ms, default 120000) |
| `script` | string | TypeScript/JavaScript (via `bun`) or Python (via `uv`) — inline code or named reference to `.rith/scripts/`. Stdout captured as `$nodeId.output`. Requires `runtime: bun` or `runtime: uv`. Optional `deps` (uv only) and `timeout` (ms, default 120000). See [Script Nodes](/guides/script-nodes/) |
| `loop` | object | Iterative AI prompt until completion signal. See [Loop Nodes](/guides/loop-nodes/) |
| `approval` | object | Pauses workflow for human review. See [Approval Nodes](/guides/approval-nodes/) |
| `cancel` | string | Terminates the workflow run with a reason string. Uses existing cancellation plumbing — in-flight parallel nodes are stopped |

**Common fields** — apply to all node types:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | required | Unique node identifier. Used in `depends_on`, `when:`, and `$id.output` substitution |
| `depends_on` | string[] | `[]` | Node IDs that must complete before this node runs |
| `when` | string | — | Condition expression. Node is skipped if false. See [Condition Syntax](#when-condition-syntax) |
| `trigger_rule` | string | `all_success` | Join semantics when multiple upstreams exist |
| `context` | `'fresh'` \| `'shared'` | — | `fresh` = new session; `shared` = inherit from prior node. Defaults to `fresh` for parallel layers, inherited for sequential |
| `idle_timeout` | number | — | Kill node if idle for this many milliseconds |
| `retry` | object | — | Per-node retry configuration. See [Retry Configuration](#retry-configuration) |
| `always_run` | boolean | `false` | Opt out of resume caching: re-run this node on resume even if a prior run completed it. See [Opting Out of Resume Caching](#opting-out-of-resume-caching) |

**AI node options** — apply to `prompt` nodes:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | inherited | Per-node model override (Pi `<provider-id>/<model-id>` ref) |
| `output_format` | object | — | JSON Schema for structured output. Best-effort on Pi (schema appended to prompt, JSON extracted from result text) |
| `allowed_tools` | string[] | — | Whitelist of built-in tools. `[]` = no tools. Pi enforces tool restrictions (built-ins: `read, bash, edit, write, grep, find, ls`) |
| `denied_tools` | string[] | — | Tools to remove. Applied after `allowed_tools`. Enforced by Pi |
| `skills` | string[] | — | Skills to preload. Resolved from `.agents/skills` and `.claude/skills`. See [Skills](/guides/skills/) |
| `effort` | `'low'`\|`'medium'`\|`'high'`\|`'max'` | — | Reasoning depth (Pi maps low\|medium\|high\|max; `max`→`xhigh`). Also settable at workflow level |
| `thinking` | string | — | Thinking mode, string form (e.g. `thinking: high`). Object form is Claude-specific and ignored by Pi. Prefer `effort`. Also settable at workflow level |
| `systemPrompt` | string | — | Override Pi's default system prompt (string form only; non-string forms ignored with a warning). Per-node or request-level |
| `hooks` | object | — | **Not supported under Pi** (Claude Agent SDK only); accepted but ignored. See [Hooks](/guides/hooks/) |
| `mcp` | string | — | **Not supported under Pi** (Claude Agent SDK only); accepted but ignored. See [MCP Servers](/guides/mcp-servers/) |
| `agents` | object | — | Inline sub-agent definitions. **Not supported under Pi** (ignored). See [Inline sub-agents](#inline-sub-agents) |
| `maxBudgetUsd` | number | — | **Not supported under Pi** (cost control ignored). Per-node only |
| `fallbackModel` | string | — | **Not supported under Pi** (ignored). Also settable at workflow level |
| `betas` | string[] | — | **Not supported under Pi** (Claude Agent SDK only) |
| `sandbox` | object | — | **Not supported under Pi** (ignored). Also settable at workflow level |

### Reasoning Options (Pi)

Pi supports two reasoning controls, settable **per-node** or at the **workflow level** as defaults (per-node takes precedence).

**effort** — reasoning depth. Pi maps `low | medium | high | max` (with `max` raised to `xhigh`):

```yaml
- id: thorough-review
  prompt: "Review the code changes."
  effort: high   # 'low' | 'medium' | 'high' | 'max'
```

**thinking** — extended thinking mode. Use the **string form** only; the object form is Claude-specific and Pi ignores it with a warning. Prefer `effort`:

```yaml
- id: deep-analysis
  prompt: "Analyze the architecture."
  thinking: high                  # string form (e.g. 'high')
```

**Workflow-level defaults** (inherited by all nodes unless overridden per-node):

```yaml
name: my-workflow
effort: high         # All nodes use high effort by default
thinking: high       # All nodes use this thinking level

nodes:
  - id: step1
    prompt: "Execute step 1."
    # Inherits workflow-level effort and thinking

  - id: step2
    prompt: "Execute step 2."
    effort: low      # Per-node override — ignores workflow-level effort
```

### Claude Agent SDK Options (not supported under Pi)

The following fields map to the Claude Agent SDK. In the Pi-only build they are **ignored** — the schema may still accept them, but Pi does not act on them: `mcp`, `agents`, `hooks`, `sandbox`, `betas`, `settingSources`, `fallbackModel`, and `maxBudgetUsd`. Don't rely on them.

### `trigger_rule` Values

| Value | Behavior |
|-------|----------|
| `all_success` | Run only if all upstream deps completed successfully (default) |
| `one_success` | Run if at least one upstream dep completed successfully |
| `none_failed_min_one_success` | Run if no deps failed AND at least one succeeded (skipped deps are ok) |
| `all_done` | Run when all deps are in a terminal state (completed, failed, or skipped) |

### `when:` Condition Syntax

Conditions gate whether a node runs based on upstream node outputs.

**String operators** (value compared as string):
```yaml
when: "$nodeId.output == 'VALUE'"
when: "$nodeId.output != 'VALUE'"
when: "$nodeId.output.field == 'VALUE'"    # JSON dot notation for output_format nodes
```

**Numeric operators** (both sides must parse as numbers; fail-closed if not):
```yaml
when: "$nodeId.output > '80'"
when: "$nodeId.output >= '0.9'"
when: "$nodeId.output < '100'"
when: "$nodeId.output <= '5'"
when: "$nodeId.output.score >= '0.9'"      # dot notation + numeric comparison
```

**Compound expressions** (`&&` binds tighter than `||`):
```yaml
when: "$a.output == 'X' && $b.output != 'Y'"
when: "$a.output == 'X' || $b.output == 'Y'"
when: "$score.output > '80' && $flag.output == 'true'"
# Precedence: (A && B) || C
when: "$a.output == 'X' && $b.output == 'Y' || $c.output == 'Z'"
```

- `$nodeId.output` references the full output string of a completed node
- `$nodeId.output.field` accesses a JSON field (for `output_format` nodes)
- Invalid or unparseable expressions default to `false` (fail-closed — node is skipped with a warning)
- Numeric operators fail-closed if either side is not a finite number
- Parentheses are not supported — use standard AND/OR precedence to structure conditions
- Skipped nodes propagate their skipped state to dependants

### `$node_id.output` Substitution
In node prompts, reference the output of any upstream node:

```yaml
nodes:
  - id: classify
    prompt: "Classify the issue as BUG or FEATURE."

  - id: fix
    prompt: "Implement the fix. Classification: $classify.output"
    depends_on: [classify]
    # Downstream prompts can use $classify.output or $classify.output.field
```

Variable substitution order:
1. Standard variables (`$WORKFLOW_ID`, `$USER_MESSAGE`, `$ARTIFACTS_DIR`, etc.)
2. Node output references (`$nodeId.output`, `$nodeId.output.field`)

### `output_format` for Structured JSON

Use `output_format` to request JSON output from an AI node. On Pi this is best-effort: the schema is appended to the prompt and JSON is extracted from the result text. The captured JSON is available for `when:` conditions and `$nodeId.output` substitution:

```yaml
nodes:
  - id: classify
    prompt: "Classify the issue as BUG or FEATURE."
    output_format:
      type: object
      properties:
        type:
          type: string
          enum: [BUG, FEATURE]
        severity:
          type: string
          enum: [low, medium, high]
      required: [type]
```

- The output is captured as a JSON string and available via `$classify.output` (full JSON) or `$classify.output.type` (field access)
- Use `output_format` when downstream nodes need to branch on specific values via `when:`

### `allowed_tools` and `denied_tools` for Tool Restrictions

Restrict which built-in tools a node can use without relying on prompt instructions. Restrictions are enforced by Pi.

```yaml
nodes:
  - id: review
    prompt: "Review the code for quality and correctness."
    allowed_tools: [read, grep, find]   # whitelist — only these tools available

  - id: implement
    prompt: "Implement the feature."
    denied_tools: [write, bash]         # blacklist — remove these tools

  - id: mcp-only
    prompt: "Run MCP-specific operations."
    allowed_tools: []                   # empty list = disable all built-in tools
```

- `allowed_tools: []` disables all built-in tools
- If both are set, `denied_tools` is applied after `allowed_tools`
- `undefined` (field absent) and `[]` have different semantics — absent means use default tool set, `[]` means no tools
- Enforced by Pi. Unknown tool names (e.g. Claude's `WebFetch`) are ignored with a warning

### Inline sub-agents

> **Not supported under Pi.** The `agents:` field is accepted by the schema but the Pi provider ignores it — inline sub-agents require the Claude Agent SDK. The example below is retained for reference only.

Define sub-agents directly in the workflow YAML. The main agent can spawn them in parallel via the `Task` tool — useful for map-reduce patterns where a cheap model (e.g. Haiku) briefs items and a stronger model reduces.

```yaml
nodes:
  - id: triage
    prompt: |
      Fetch open issues via `gh issue list ...`. For each issue, spawn the
      brief-gen sub-agent in parallel (one message, multiple Task tool calls)
      to produce a 2-3 sentence brief. Then cluster briefs for duplicates.
    model: anthropic/claude-sonnet-4-5
    allowed_tools: [Bash, Read, Write, Task]
    agents:
      brief-gen:
        description: Summarises a single GitHub issue in 2-3 sentences
        prompt: |
          You are concise. Read the issue provided in the caller's prompt.
          Return JSON { summary, primarySymptom, affectedArea }.
        model: anthropic/claude-haiku-4-5
        tools: [Bash, Read]
```

Keys:

- Agent IDs must be **kebab-case** (`^[a-z0-9]+(-[a-z0-9]+)*$`)
- Each definition requires `description` and `prompt`; `model`, `tools`, `disallowedTools`, `skills`, and `maxTurns` are optional
- Map is merged with any SDK-level agents and with the internal `dag-node-skills` wrapper created by `skills:` — user-defined agents win on ID collision (a warning is logged when this happens)
- **Not supported under Pi** — the field is ignored with a warning.

**When to use `agents:` vs `.claude/agents/*.md` files:**

- **`agents:` (inline)** — use when the sub-agent is specific to ONE workflow's needs. Keeps the workflow self-contained in a single YAML file; travels cleanly in PRs and forks.
- **`.claude/agents/*.md` (on-disk)** — use when the sub-agent is shared across multiple workflows OR the whole project (for example, a `triage-agent` used by several maintenance workflows). On-disk agents live outside workflow YAMLs. (Both sources require the Claude Agent SDK and are ignored under Pi.)

Both sources coexist — inline agents and on-disk agents are both available to `Task(subagent_type=...)` at runtime.

---

## Retry Configuration

Every node automatically retries on **transient** errors (SDK subprocess crashes, rate limits, network timeouts) using a default configuration: **2 retries** (3 total attempts), **3 s base delay** with exponential backoff. You will see a platform notification before each retry attempt.

To customise, add a `retry:` block:

```yaml
nodes:
  - id: flaky-node
    prompt: "Run the flaky operation."
    retry:
      max_attempts: 3       # 3 retries = 4 total attempts
      delay_ms: 5000
      on_error: transient

  - id: aggressive-retry
    prompt: "Summarise the output"
    retry:
      max_attempts: 4       # 4 retries = 5 total attempts
      on_error: all         # Retry even non-transient errors (use with caution)
```

### Retry Fields

| Field | Type | Default | Constraints | Description |
|-------|------|---------|-------------|-------------|
| `max_attempts` | number | `2` | 1–5 | Number of retry attempts (not including the initial attempt). `1` = one retry (2 total attempts) |
| `delay_ms` | number | `3000` | 1000–60000 | Base delay in ms before the first retry. Doubles each attempt (exponential backoff) |
| `on_error` | `'transient'` \| `'all'` | `'transient'` | — | Which errors trigger a retry. `'transient'` = SDK crashes, rate limits, network timeouts only. `'all'` = any error including unknown errors (FATAL errors such as auth failures are never retried regardless) |

### Error Classification

Rith Engine classifies errors into three buckets before deciding whether to retry:

| Class | Examples | Retried by default? |
|-------|----------|---------------------|
| **FATAL** | Auth failure, permission denied, credit balance exhausted | Never (even with `on_error: all`) |
| **TRANSIENT** | Process crashed (`exited with code`), rate limit, network timeout | Yes |
| **UNKNOWN** | Unrecognised error messages | No (unless `on_error: all`) |

### Retry Notifications

Before each retry the platform receives a message like:

```
Node `node-id` failed with transient error (attempt 1/3). Retrying in 3s...
```

### Two-Layer Retry Stack

Rith Engine uses two independent retry layers:

```
SDK subprocess retry (claude.ts)  — 3 total attempts, 2 s base backoff
    ↓ only if all SDK retries exhausted
Node retry (dag-executor)  — default 2 retries, 3 s base backoff
    ↓ only if all node retries exhausted
Workflow fails → user opts in to resume on next invocation
```

This means a single transient crash may trigger up to **3 SDK retries** before a single node retry attempt is consumed.

> **DAG resume**: For `nodes:` (DAG) workflows, resume is opt-in — pass `--resume` to `rith workflow run` or run `rith workflow resume <id>`. Plain `rith workflow run <name>` always starts a fresh run. See [DAG Resume on Failure](#dag-resume-on-failure) below.

---

## DAG Resume on Failure

When a `nodes:` (DAG) workflow fails, the prior run stays in the database as a candidate for resume. Resume is **explicit**: you opt in by flag or button.

**How to resume:**

- **CLI**: `rith workflow run <name> --resume` resumes the most recent failed run for `(workflow_name, cwd)`. Or `rith workflow resume <run-id>` to target a specific run.

**What happens on resume:**

1. The CLI looks up the resumable run, loads its `node_completed` events to determine which nodes finished successfully, and transitions the row back to `running`.
2. Completed nodes are skipped; only failed and not-yet-run nodes are executed.
3. You receive a platform message like: `Resuming workflow — skipping 3 already-completed node(s).`

> **Why opt-in?** Earlier versions silently auto-resumed on plain `rith workflow run`, which caused state from prior failed runs (e.g. cached node outputs with stale inputs) to bleed into new invocations of the same workflow at the same path. See #1392 for the bug; now resume is always a user-driven decision.

**Orphaned runs**: If a crash leaves a row stuck as `running`, transition it to a terminal status explicitly:

- **CLI**: `rith workflow abandon <run-id>`. Run IDs are listed by `rith workflow status`.

Once the row reaches a terminal status, you can resume it explicitly via the paths above. Plain `rith workflow run` never resumes implicitly.

> Not to be confused with `rith workflow cleanup [days]`, which **deletes** old terminal runs (`completed`/`failed`/`cancelled`) from the database for disk hygiene. It does not transition `running` rows.

**Known limitation**: AI session context from prior nodes is not restored. If a downstream node relies on in-context knowledge from a prior run's session (rather than artifacts), it may need to re-read those artifacts explicitly.

**Fresh start**: If zero nodes completed in the prior run, Rith Engine starts fresh (no nodes to skip).

### Opting Out of Resume Caching

By default, resume skips any node that completed successfully in the prior run and feeds its cached output to downstream consumers. That's the right behavior when a node's exit code captures the validity of its output (e.g. AI prompts, scripts that produce structured stdout).

It's the wrong behavior when a node's success status doesn't capture output validity — typically a producer whose exit code reports the side effect (a file written, a service called) but whose downstream consumer parses the side effect's contents on every run. If the producer succeeded but wrote garbage, resume will replay the cached "success" forever without ever re-executing the producer.

Set `always_run: true` on the node to force re-execution on resume, even when the prior run marked it completed:

```yaml
nodes:
  - id: fetch-data
    bash: ./scripts/download.sh > $ARTIFACTS_DIR/data.json
    always_run: true        # Re-fetch on resume; download.sh exit code doesn't validate the JSON

  - id: process-data
    prompt: "Summarize $ARTIFACTS_DIR/data.json"
    depends_on: [fetch-data]
```

On resume, `fetch-data` re-runs regardless of prior success, so `process-data` reads a freshly produced file. Normal cached nodes in the same run are still skipped — `always_run` is per-node.

---

## The Artifact Chain

Workflows work because **artifacts pass data between nodes**:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Node 1          │     │ Node 2          │     │ Node 3          │
│ investigate     │     │ implement       │     │ create-pr       │
│                 │     │                 │     │                 │
│ Reads: input    │     │ Reads: artifact │     │ Reads: git diff │
│ Writes: artifact│────▶│ Writes: code    │────▶│ Writes: PR      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │
         ▼                       ▼
  $ARTIFACTS_DIR/         src/feature.ts
  issues/issue-123.md     src/feature.test.ts
```

### Designing Artifact Flow

When creating a workflow, plan the artifact chain:

| Node | Reads | Writes |
|------|-------|--------|
| `investigate-issue` | GitHub issue via `gh` | `$ARTIFACTS_DIR/issues/issue-{n}.md` |
| `implement-issue` | Artifact from `investigate-issue` | Code files, tests |
| `create-pr` | Git diff | GitHub PR |

Each command must know:
- Where to find its input
- Where to write its output
- What format to use

---

## Model Configuration

Workflows can configure AI models and provider-specific options at the workflow level.

### Configuration Priority

Model and options are resolved in this order:

1. **Workflow-level** - Explicit settings in the workflow YAML
2. **Config defaults** - `pi.*` in `.rith/config.yaml`
3. **Pi SDK defaults** - Built-in defaults from `~/.pi/agent/settings.json`

### Model

```yaml
name: my-workflow
model: anthropic/claude-sonnet-4-5   # Model override (default: from config pi.model)
```

**Model strings:** Whatever you write in `model:` is forwarded verbatim to Pi as a `<pi-provider-id>/<model-id>` ref. Rith Engine doesn't keep an internal allow-list — Pi's resolved backend decides whether the string is valid at request time.

Common shapes you'll see in practice:

- **Pi format** — `<pi-provider-id>/<model-id>` refs, e.g. `anthropic/claude-sonnet-4-5`, `google/gemini-2.5-pro`, `openrouter/qwen/qwen3-coder`.

If Pi rejects the string at request time, the node fails loudly with Pi's error message.



### Approval Gates and Interactive Loops

Approval gates and interactive loop nodes pause for user input automatically — there is no workflow-level toggle to enable this. (The former workflow-level `interactive:` option has been removed.)

```yaml
name: my-workflow

nodes:
  - id: plan
    prompt: "Create a plan for $USER_MESSAGE"
  - id: review-gate
    approval:
      message: "Does this plan look good?"
    depends_on: [plan]
  - id: implement
    prompt: "Implement the approved plan."
    depends_on: [review-gate]
```

### Model Validation

Model strings are not validated at load time — they're forwarded to Pi as-is and validated by Pi's resolved backend at request time. A model must resolve from the node `model:`, the workflow `model:`, or `pi.model` in config; if none resolves, Pi errors with `Pi provider requires a model`.

### Resource Validation (CLI)

To validate that all referenced MCP config files and skill directories exist on disk, run:

```bash
rith validate workflows <name>
```

This checks resource resolution beyond what load-time validation covers. Use `--json` for machine-readable output. See the [CLI Reference](/reference/cli/) for details.

### Example: Config Defaults + Workflow Override

**`.rith/config.yaml`:**
```yaml
pi:
  model: anthropic/claude-haiku-4-5  # Fast model for most tasks
```

**Workflow with override:**
```yaml
name: complex-analysis
description: Deep code analysis requiring powerful model
model: anthropic/claude-opus-4-5  # Override config default for this workflow

nodes:
  - id: analyze
    prompt: "Analyze the architecture of this codebase."

  - id: report
    prompt: "Generate a report based on the analysis."
    depends_on: [analyze]
    context: fresh
```

The workflow uses `anthropic/claude-opus-4-5` instead of the config default `anthropic/claude-haiku-4-5`, but other settings inherit from config.

---

## Workflow Description Best Practices

Write descriptions that help with routing and user understanding:

```yaml
description: |
  Investigate and fix a GitHub issue end-to-end.

  **Use when**: User provides a GitHub issue number or URL
  **NOT for**: Feature requests, refactoring, documentation

  **Produces**:
  - Investigation artifact
  - Code changes
  - Pull request linked to issue

  **Steps**:
  1. Investigate root cause
  2. Implement fix with tests
  3. Create PR
```

Good descriptions include:
- What the workflow does
- When to use it (and when NOT to)
- What it produces
- High-level steps

---

## Variable Substitution

All workflows support variable substitution in prompts. The most commonly used:

| Variable | Description |
|----------|-------------|
| `$ARGUMENTS` / `$USER_MESSAGE` | The user's input message that triggered the workflow |
| `$WORKFLOW_ID` | Unique ID for this workflow run |
| `$ARTIFACTS_DIR` | Pre-created artifacts directory for this workflow run |
| `$BASE_BRANCH` | Base branch (auto-detected or configured) |
| `$DOCS_DIR` | Documentation directory path (default: `docs/`) |
| `$CONTEXT` | GitHub issue/PR context (if available) |
| `$nodeId.output` | Output of a completed upstream node |
| `$nodeId.output.field` | JSON field from a structured upstream node output |

See the [Variable Reference](/reference/variables/) for the complete list, including `$LOOP_USER_INPUT`, `$REJECTION_REASON`, positional arguments, substitution order, and context variable behavior.

Example:
```yaml
prompt: |
  Workflow: $WORKFLOW_ID
  Original request: $USER_MESSAGE

  GitHub context:
  $CONTEXT

  [Instructions...]
```

---

## Example Workflows

### Quick Fix

```yaml
name: quick-fix
description: |
  Fast bug fix without full investigation.
  Use when: Simple, obvious bugs.

nodes:
  - id: fix
    prompt: "Analyze the bug and implement a fix."

  - id: pr
    prompt: "Create a pull request with the changes."
    depends_on: [fix]
    context: fresh
```

### Investigation Pipeline

```yaml
name: fix-github-issue
description: |
  Full investigation and fix for GitHub issues.
  Use when: User provides issue number/URL

nodes:
  - id: investigate
    prompt: "Investigate the reported issue. Identify root cause and affected files."

  - id: implement
    prompt: "Implement the fix based on the investigation."
    depends_on: [investigate]
    context: fresh
```

### Parallel Review

```yaml
name: comprehensive-pr-review
description: |
  Multi-agent PR review covering code, comments, tests, and security.

nodes:
  - id: scope
    prompt: "Create the review scope: identify changed files, summarize the PR intent."

  - id: code-review
    prompt: "Review code quality, patterns, and correctness."
    depends_on: [scope]
    context: fresh

  - id: comment-review
    prompt: "Review comment quality and documentation."
    depends_on: [scope]
    context: fresh

  - id: test-review
    prompt: "Review test coverage and quality."
    depends_on: [scope]
    context: fresh

  - id: security-review
    prompt: "Review for security vulnerabilities."
    depends_on: [scope]
    context: fresh

  - id: synthesize
    prompt: "Synthesize all review findings into a single report."
    depends_on: [code-review, comment-review, test-review, security-review]
    context: fresh
```

### Iterative Implementation (Loop Node)

```yaml
name: implement-prd
description: |
  Autonomously implement a PRD, iterating until all stories pass.

nodes:
  - id: implement-loop
    loop:
      prompt: |
        Read PRD from `.rith/prd.md`.
        Read progress from `.rith/progress.json`.
        Implement the next incomplete story with tests.
        Run validation: `bun run validate`.
        Update progress file.
        If ALL stories complete: <promise>COMPLETE</promise>
      until: COMPLETE
      max_iterations: 15
      fresh_context: true
```

### Classify and Route

```yaml
name: classify-and-fix
description: |
  Classify issue type and run the appropriate path.

  Use when: User reports a bug or requests a feature
  Produces: Code fix (bug path) or feature plan (feature path), then PR

nodes:
  - id: classify
    prompt: "Classify the issue as BUG or FEATURE."
    output_format:
      type: object
      properties:
        type:
          type: string
          enum: [BUG, FEATURE]
      required: [type]

  - id: investigate
    prompt: "Investigate the bug. Identify root cause."
    depends_on: [classify]
    when: "$classify.output.type == 'BUG'"

  - id: plan
    prompt: "Plan the feature implementation."
    depends_on: [classify]
    when: "$classify.output.type == 'FEATURE'"

  - id: implement
    prompt: "Implement the changes."
    depends_on: [investigate, plan]
    trigger_rule: none_failed_min_one_success

  - id: create-pr
    prompt: "Create a pull request."
    depends_on: [implement]
    context: fresh
```

---

## Common Patterns

### Pattern: Gated Execution

Run different paths based on conditions:

```yaml
name: smart-fix
description: Route to appropriate fix strategy based on issue complexity

nodes:
  - id: analyze
    prompt: "Analyze the complexity of this issue."
    output_format:
      type: object
      properties:
        complexity:
          type: string
          enum: [simple, complex]
      required: [complexity]

  - id: quick-fix
    prompt: "Apply a quick fix for the simple issue."
    depends_on: [analyze]
    when: "$analyze.output.complexity == 'simple'"

  - id: deep-fix
    prompt: "Perform a deep investigation and fix for the complex issue."
    depends_on: [analyze]
    when: "$analyze.output.complexity == 'complex'"
```

### Pattern: Checkpoint and Resume

For long workflows, DAG resume lets you skip already-completed nodes — opt in with `--resume`:

```yaml
name: large-migration
description: Multi-file migration with automatic checkpoint recovery

nodes:
  - id: plan
    prompt: "Create the migration plan."

  - id: batch-1
    prompt: "Execute migration batch 1."
    depends_on: [plan]
    context: fresh

  - id: batch-2
    prompt: "Execute migration batch 2."
    depends_on: [batch-1]
    context: fresh

  - id: validate
    prompt: "Validate the migration results."
    depends_on: [batch-2]
    context: fresh
```

If the workflow fails at `batch-2`, run `rith workflow run large-migration --resume` to skip `plan` and `batch-1`. Plain `rith workflow run large-migration` (without `--resume`) starts fresh.

### Pattern: Human-in-the-Loop

Use an `approval` node to pause for human review before continuing:

```yaml
name: careful-refactor
description: Refactor with human approval gate

nodes:
  - id: propose
    prompt: "Propose a refactoring plan."

  - id: review-gate
    approval:
      message: "Review the proposed refactor before proceeding. Check the artifacts directory."
    depends_on: [propose]

  - id: execute
    prompt: "Execute the approved refactoring."
    depends_on: [review-gate]

  - id: pr
    prompt: "Create a pull request."
    depends_on: [execute]
    context: fresh
```

When the workflow reaches `review-gate`, it pauses and notifies you. Approve or reject via:

- **Natural language** (recommended): Just type your response in the conversation — the system detects the paused workflow and auto-resumes
- **CLI**: `bun run cli workflow approve <run-id>` or `bun run cli workflow reject <run-id>` — auto-resumes
- **Explicit command**: `/workflow approve <run-id>` or `/workflow reject <run-id>` — auto-resumes when issued in the originating conversation

All paths auto-resume the workflow from the next node. The user's approval comment is available as `$review-gate.output` in downstream nodes only when `capture_response: true` is set on the approval node.

Without `on_reject`: rejecting cancels the workflow.
With `on_reject`: rejecting triggers an AI rework prompt and re-pauses for re-review.
See [Approval Nodes](/guides/approval-nodes/) for full details.

### Pattern: Early Termination with Cancel

Use a `cancel:` node to stop a workflow when a precondition fails — preventing wasted compute on downstream branches:

```yaml
nodes:
  - id: check
    bash: "git merge-base --is-ancestor HEAD origin/main && echo ok || echo blocked"

  - id: stop-if-blocked
    cancel: "PR has merge conflicts — cannot proceed with review"
    depends_on: [check]
    when: "$check.output == 'blocked'"

  - id: review
    prompt: "Review the PR..."
    depends_on: [check]
    when: "$check.output == 'ok'"
```

When a `cancel:` node executes (passes its `when:` gate), it sets the workflow run to `cancelled` with the reason string and stops all in-flight nodes. Unlike node failure, cancellation is intentional — the status is `cancelled`, not `failed`.

### Choosing: Interactive Loop vs Approval with on_reject

Two primitives handle human-in-the-loop iteration. Use the right one for your pattern:

| | Interactive Loop | Approval + on_reject |
|---|---|---|
| YAML | `loop.interactive: true` | `approval.on_reject: { prompt }` |
| User input variable | `$LOOP_USER_INPUT` | `$REJECTION_REASON` |
| How it works | Same prompt runs each iteration, user input injected as variable | Specific on_reject prompt runs only on rejection |
| Best for | **Conversational iteration** — explore, refine, review cycles where the AI and human go back and forth | **Gate-then-fix** — approve to proceed, or reject to trigger a specific corrective action |
| Approval signal | AI detects user intent in its output (`<promise>DONE</promise>`) | User explicitly approves or rejects via button/command |
| Example | PIV loop: explore → user feedback → explore again | Report generation: generate → user rejects → AI revises specific section |

**Interactive loop** (`loop.interactive: true`):

```yaml
- id: refine-plan
  loop:
    prompt: |
      User's feedback: $LOOP_USER_INPUT
      Read the plan, apply feedback, present changes.
    until: PLAN_APPROVED
    max_iterations: 10
    interactive: true
    gate_message: "Review the plan. Provide feedback or say 'approved'."
```

The AI runs each iteration, pauses for user input, user's text feeds into the next iteration via `$LOOP_USER_INPUT`. The AI decides when to emit the completion signal based on the user's response.

**Approval with on_reject** (`approval.on_reject`):

```yaml
- id: review
  approval:
    message: "Review the report. Approve or request changes."
    capture_response: true
    on_reject: { prompt: "Revise based on: $REJECTION_REASON", max_attempts: 5 }
  depends_on: [generate]
```

The workflow pauses at the approval gate. User approves -> workflow continues. User rejects with feedback -> the `on_reject` prompt runs with `$REJECTION_REASON`, then re-pauses at the same gate.

**Rule of thumb**: If the human and AI are having a conversation (exploring, refining, iterating), use an interactive loop. If the workflow should proceed unless the human objects, use an approval gate with `on_reject`.

---

## Debugging Workflows

### Check Workflow Discovery

```bash
bun run cli workflow list
```

### Run with Verbose Output

```bash
bun run cli workflow run {name} "test input"
```

Watch the streaming output to see each step.

### Check Artifacts

After a workflow runs, check the artifacts in the `$ARTIFACTS_DIR` for that run (located at `~/.rith/workspaces/owner/repo/artifacts/runs/{workflow-id}/`).

### Check Logs

Workflow execution logs to:
```
~/.rith/workspaces/owner/repo/logs/{workflow-id}.jsonl
```

Each line is a JSON event (step start, AI response, tool call, etc.).

---

## Workflow Validation

Before deploying a workflow:

1. **Test each node individually**
   ```bash
   bun run cli workflow run {workflow} "test input"
   ```

2. **Verify artifact flow**
   - Does the first node produce what the second expects?
   - Are paths correct?
   - Is the format complete?

3. **Test edge cases**
   - What if the input is invalid?
   - What if a node fails?
   - What if an artifact is missing?

4. **Check iteration limits** (for loops)
   - Is `max_iterations` reasonable?
   - What happens when limit is hit?

---

## Summary

1. **Workflows orchestrate AI steps** — YAML files defining a DAG of execution nodes
2. **`nodes:` define the graph** — each node runs a prompt, bash script, script, or loop
3. **Artifacts are the glue** — nodes communicate via files, not in-memory context
4. **`context: fresh`** — forces a fresh AI session for a node (works from artifacts only)
5. **Parallel by default** — nodes in the same topological layer run concurrently
6. **Conditional branching** — `when:` conditions and `trigger_rule` control which nodes run
7. **`output_format`** — enforce structured JSON output from AI nodes for reliable branching
8. **`allowed_tools` / `denied_tools`** — restrict tools per node, enforced by Pi
9. **`retry:`** — auto-retries transient errors (default: 2 retries / 3 total attempts, 3 s backoff); customize per node
10. **`hooks`** — Claude Agent SDK hooks; not supported under Pi
11. **`mcp:`** — MCP servers; not supported under Pi
12. **`skills:`** — preload skills into nodes for domain expertise
13. **`agents:`** — inline sub-agent definitions; not supported under Pi
14. **`effort` / `thinking`** — control reasoning depth (Pi; `thinking` string form) per node or workflow
15. **`maxBudgetUsd`** — cost cap; not supported under Pi
16. **`systemPrompt`** — override Pi's default system prompt (string form)
17. **`sandbox`** — OS-level restrictions; not supported under Pi
18. **Loop nodes** — use `loop:` within a DAG node for iterative execution until completion signal
19. **Defaults as templates** — browse `.rith/workflows/defaults/` for real examples to copy and modify
20. **Test thoroughly** — each node, the artifact flow, and edge cases
