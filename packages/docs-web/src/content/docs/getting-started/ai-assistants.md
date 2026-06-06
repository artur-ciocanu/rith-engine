---
title: Pi Coding Agent
description: Configure Pi Coding Agent as the AI executor for Rith Engine workflows.
category: getting-started
area: clients
audience: [user]
status: current
sidebar:
  order: 4
---

Pi Coding Agent is the sole AI executor in Rith Engine. It drives all workflow nodes via `@mariozechner/pi-coding-agent`, a coding-agent harness that supports ~20 LLM backends — Anthropic, OpenAI, Google (Gemini + Vertex), Groq, Mistral, Cerebras, xAI, OpenRouter, Hugging Face, and local inference (LM Studio, ollama, llamacpp, custom OpenAI-compatible endpoints registered in `~/.pi/agent/models.json`).

## Install

Pi is included as a dependency of `@rith/pi` — no separate install needed. It's available immediately after `bun install`.

## Authentication

Pi supports both OAuth subscriptions and API keys. Rith Engine reads your existing Pi credentials from `~/.pi/agent/auth.json` (written by running `pi` → `/login`) AND from env vars — env vars take priority per-request so codebase-scoped overrides work.

**OAuth subscriptions (run `pi /login` locally):**
- Anthropic Claude Pro/Max
- OpenAI ChatGPT Plus/Pro
- GitHub Copilot
- Google Gemini CLI
- Google Antigravity

**API keys (env vars):**

| Pi provider id | Env var |
|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `google` | `GEMINI_API_KEY` |
| `groq` | `GROQ_API_KEY` |
| `mistral` | `MISTRAL_API_KEY` |
| `cerebras` | `CEREBRAS_API_KEY` |
| `xai` | `XAI_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `huggingface` | `HUGGINGFACE_API_KEY` |

Additional cloud backends exist (Azure, Bedrock, Vertex, etc.) — file an issue if you need an env-var shortcut wired for them.

**Local / custom providers (no credentials needed):**

Providers that aren't in the env-var table above (LM Studio, ollama, llamacpp, custom OpenAI-compatible endpoints) work without any Rith Engine-side configuration. Register them in `~/.pi/agent/models.json` per Pi's own docs and reference them as `<pi-provider-id>/<model-id>`:

```yaml
# .rith/config.yaml
pi:
  model: lm-studio/qwen2.5-coder-14b   # whatever ID you registered with Pi
```

Rith Engine logs an info-level `pi.auth_missing` event when no credentials are found and continues — Pi's SDK then connects directly to the local endpoint defined in `models.json`. If the provider does require auth (a less-common cloud backend not in the env-var table) the SDK call fails downstream; the `pi.auth_missing` breadcrumb in the log lets you trace it back to a missing env-var mapping.

## Configuration

Configure Pi's behavior in `.rith/config.yaml`:

```yaml
pi:
  model: anthropic/claude-haiku-4-5       # '<pi-provider-id>/<model-id>' format
  enableExtensions: false                 # load Pi's extension ecosystem (default: false)
  extensionFlags:                         # per-extension feature flags (Pi's --flag CLI switches)
    plan: true
  maxConcurrent: 4                        # max concurrent Pi session.prompt() calls (default: unlimited)
```

### Provider defaults reference

| Field | Type | Default | Description |
|---|---|---|---|
| `model` | `string` | — | Model ref in `<pi-provider-id>/<model-id>` format, e.g. `google/gemini-2.5-pro` |
| `enableExtensions` | `boolean` | `false` | Load Pi's extension ecosystem (~540 community packages) |
| `extensionFlags` | `Record<string, boolean \| string>` | — | Per-extension feature flags, equivalent to `pi --<name>` CLI switches |
| `maxConcurrent` | `number` | unlimited | Max concurrent `session.prompt()` calls. Prevents cascading 429s in parallel workflows |

### Configuration priority

1. Workflow-level options (in YAML `model`, `effort`, etc.)
2. Config file defaults (`.rith/config.yaml` `pi.*`)
3. Pi SDK defaults (from `~/.pi/agent/settings.json`)

## Pi settings (baseline behavior)

Rith Engine reads your Pi settings files as the starting point for every session:

- **`~/.pi/agent/settings.json`** — global Pi preferences (retry counts, transport, compaction strategy, thinking budgets, default model, etc.)
- **`<repo>/.pi/settings.json`** — project-level overrides on top of global

All settings flow in automatically. You do not need to re-state them in Rith Engine's `config.yaml`. To configure baseline Pi settings, edit `~/.pi/agent/settings.json` directly.

Rith Engine never writes back to these files — `~/.pi/agent/settings.json` is read-only from Rith Engine's perspective. Session-level changes (model switches, thinking-level adjustments) are held in memory only and discarded when the session ends.

If Pi settings files do not exist (Docker, first-time setup, compiled binary with no Pi home directory), Rith Engine falls back to Pi SDK defaults. Parse errors in the settings files are logged as warnings (`pi.settings_load_error`) and never prevent the session from starting.

## Extensions (on by default)

A major reason to pick Pi is its **extension ecosystem**: community packages (installed via `pi install npm:<package>`) and your own local ones that hook into the agent's lifecycle. Extensions can intercept tool calls, gate execution on human review, post to external systems, render UIs — anything the Pi extension API exposes.

Rith Engine turns extensions **on by default**. To opt out in `.rith/config.yaml`:

```yaml
pi:
  enableExtensions: false   # skip extension discovery entirely
```

Most extensions need three config surfaces:

| Surface | Purpose |
|---|---|
| `extensionFlags` | Per-extension feature flags (maps 1:1 to Pi's `--flag` CLI switches) |
| `env` | Env vars the extension reads at runtime (managed via `.rith/config.yaml`) |
| Workflow-level `interactive: true` | Required for approval-gate extensions — forces foreground execution so the user can respond in the CLI |

**Example — [plannotator](https://github.com/dmcglinn/plannotator) (human-in-the-loop plan review):**

```bash
# One-time install into your Pi home
pi install npm:@plannotator/pi-extension
```

```yaml
# .rith/config.yaml
pi:
  model: anthropic/claude-haiku-4-5
  extensionFlags:
    plan: true              # enables the plannotator "plan" flag
env:
  PLANNOTATOR_REMOTE: "1"   # exposes the review URL on 127.0.0.1:19432 so you can open it from anywhere
```

```yaml
# .rith/workflows/my-piv.yaml
name: my-piv
interactive: true             # plannotator gates the node on human approval
```

When the node runs, plannotator prints a review URL and blocks until you click approve/deny in the browser. Rith Engine's CLI batch buffer flushes that URL to you immediately so you never get stuck waiting on a node that silently wants input.

## Model reference format

Pi models use a `<pi-provider-id>/<model-id>` format:

```yaml
pi:
  model: anthropic/claude-haiku-4-5       # via Anthropic
  # model: google/gemini-2.5-pro           # via Google
  # model: groq/llama-3.3-70b-versatile   # via Groq
  # model: openrouter/qwen/qwen3-coder    # via OpenRouter (nested slashes allowed)
```

## Usage in workflows

```yaml
name: my-workflow
model: anthropic/claude-haiku-4-5

nodes:
  - id: fast-node
    model: groq/llama-3.3-70b-versatile   # per-node override — switches backends
    prompt: "..."
    effort: low
    allowed_tools: [read, grep]            # Pi's built-in tools: read, bash, edit, write, grep, find, ls

  - id: careful-node
    model: anthropic/claude-opus-4-5
    prompt: "..."
    effort: high
    skills: [rith-dev]                   # Rith Engine name refs work — see capabilities below
```

## Capabilities

| Feature | Support | YAML field |
|---|---|---|
| Extensions (community + local) | ✅ (default on) | `enableExtensions: false` to disable; `extensionFlags: { <name>: true }` per extension |
| Session resume | ✅ | automatic (Rith Engine persists `sessionId`) |
| Tool restrictions | ✅ | `allowed_tools` / `denied_tools` (read, bash, edit, write, grep, find, ls) |
| Thinking level | ✅ | `effort: low\|medium\|high\|max` (max → xhigh) |
| Skills | ✅ | `skills: [name]` (searches `.agents/skills`, `.claude/skills`, user-global) |
| System prompt override | ✅ | `systemPrompt:` |
| Codebase env vars (`envInjection`) | ✅ | `.rith/config.yaml` `env:` section |
| Structured output | ✅ (best-effort) | `output_format:` — schema is appended to the prompt and JSON is parsed out of the assistant text. Handles bare JSON, ```json```-fenced, and reasoning-model prose preambles. Not SDK-enforced. |
| Inline sub-agents | ❌ | `agents:` is not supported; ignored with a warning |
| MCP servers | ❌ | Pi rejects MCP by design |
| Cost limits (`maxBudgetUsd`) | ❌ | tracked in result chunk, not enforced |
| Fallback model | ❌ | not native in Pi |
| Sandbox | ❌ | not native in Pi |

Unsupported YAML fields trigger a visible warning from the dag-executor when the workflow runs, so you always know what was ignored.

## See also

- [Pi on GitHub](https://github.com/badlogic/pi-mono) — upstream project.
