# Rith Engine: Configuration & Model Reference

**Date:** 2026-06-03
**Commit:** `043f823d`

---

## TL;DR

1. **Pi and Rith have separate concerns.** Pi owns auth, API keys, and the model catalog. Rith owns orchestration and default model selection.
2. **Rith's only LLM config is the default model string** — currently `provider.model` in `config.yaml`, proposed to become top-level `model:`.
3. **Pi requires `backend/model-id` format.** Bare names like `sonnet`, `opus`, `haiku` are **invalid** and will hard-fail. Use `anthropic/claude-sonnet-4-5` or `google/gemini-2.5-pro`.
4. **The `[1m]` context window suffix is dead.** It was a Claude SDK feature. Pi does not parse it. Context windows are determined by the model you select in Pi's catalog.
5. **The `provider` field is gone from workflow schemas.** No `provider:` on workflows or nodes — confirmed removed. There is only one provider (Pi).
6. **All bundled workflows are broken.** They still use bare Claude model names. Every one will throw at runtime.

---

## 1. Separation of Concerns: Pi vs Rith

### Pi Owns (`~/.pi/agent/`)

| File          | Purpose                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `auth.json`   | API keys and OAuth tokens for all backends (anthropic, google, openai, etc.). Written by `pi /login`.   |
| `models.json` | Model catalog — maps `backend/model-id` to API endpoints, context windows, capabilities. Updated by Pi. |
| Extensions    | Extension registry, extension-provided models (e.g. kiro registers via `bindExtensions()`).             |

**You never configure these in Rith.** Run `pi /login` to authenticate, `pi models` to see the catalog.

### Rith Owns (`~/.rith/config.yaml` + `.rith/config.yaml`)

| Field        | Purpose                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| `model`      | **The default model string** when a workflow/node doesn't specify one. This is the only LLM-related field. |
| `commands.*` | Command discovery paths                                                                                    |
| `worktree.*` | Isolation settings (base branch, auto-cleanup, copied files)                                               |
| `docs.path`  | Documentation path                                                                                         |
| `env`        | Per-project env vars injected into workflow subprocesses                                                   |
| `defaults.*` | Feature flags (load default workflows/commands)                                                            |
| `paths.*`    | Filesystem layout (workspaces, worktrees)                                                                  |

### How They Compose

```
Rith decides WHAT model string to send  →  Pi decides HOW to reach that model
     (config.yaml: model)                    (auth.json + models.json)
```

No overlap. No duplication. Configure once in each place.

---

## 2. Rith Configuration

### File Locations

| Scope  | Path                       | Purpose               |
| ------ | -------------------------- | --------------------- |
| Global | `~/.rith/config.yaml`      | User-wide defaults    |
| Repo   | `<repo>/.rith/config.yaml` | Per-project overrides |

### Merge Priority (lowest → highest)

```
hardcoded defaults → ~/.rith/config.yaml → .rith/config.yaml
```

> **Note:** There are currently **no environment variable overrides** for config fields. `applyEnvOverrides()` in `config-loader.ts` is a no-op. This is a gap — there is no way to override the default model via env var without editing `config.yaml`.

### Target Config Schema (Proposed)

The current schema uses `provider.model` — a vestige of the multi-provider Archon architecture. With Pi as the sole provider, this nesting is misleading. The target:

```yaml
# ~/.rith/config.yaml — PROPOSED (after migration)
model: anthropic/claude-sonnet-4-5 # Default model for all workflows

paths:
  workspaces: ~/.rith/workspaces
  worktrees: ~/.rith/worktrees
```

```yaml
# .rith/config.yaml (per-repo) — PROPOSED
model: google/gemini-2.5-pro # Override global default for this repo

commands:
  folder: custom-commands
  autoLoad: true

worktree:
  baseBranch: main
  autoCleanup: true
  copyFiles: [.rith]

docs:
  path: docs/

env:
  MY_API_KEY: xxx

defaults:
  copyDefaults: true
  loadDefaultCommands: true
  loadDefaultWorkflows: true
```

### Current Config Schema (Pre-Migration)

Until the migration lands, the model field lives under `provider:`:

```yaml
# ~/.rith/config.yaml — CURRENT
provider:
  model: anthropic/claude-sonnet-4-5 # The only field Rith actually uses from this block
  # enableExtensions, interactive, extensionFlags, env, maxConcurrent
  # are Pi runtime knobs that should NOT be in Rith config — they belong in Pi's own settings
```

### Migration: `provider.model` → `model`

**What changes:**

| Layer                    | Current                                    | Target                       |
| ------------------------ | ------------------------------------------ | ---------------------------- |
| `GlobalConfig`           | `provider?: ProviderDefaults`              | `model?: string`             |
| `RepoConfig`             | `provider?: ProviderDefaults`              | `model?: string`             |
| `MergedConfig`           | `provider: ProviderDefaults`               | `model?: string`             |
| `ProviderDefaults`       | Interface with 6+ fields                   | **Delete entirely**          |
| `config-loader.ts` merge | Spread-merges `provider` + deprecated `pi` | Simple `??` chain on `model` |
| `WorkflowConfig`         | `provider: { model?, [key]: unknown }`     | `model?: string`             |
| Error message            | `assistants.pi.model` (wrong)              | `model`                      |

**What to remove from Rith config:**

- `enableExtensions` — Pi setting, configure in Pi
- `interactive` — Pi setting, configure in Pi
- `extensionFlags` — Pi setting, configure in Pi
- `env` (under provider) — Pi setting, configure in Pi
- `maxConcurrent` — Pi setting, configure in Pi
- `pi:` deprecated alias — dead weight

### API Key Environment Variables

API keys are handled by Pi's auth layer, not Rith's config. These env vars override `~/.pi/agent/auth.json`:

| Env Var               | Pi Backend    | Notes                     |
| --------------------- | ------------- | ------------------------- |
| `ANTHROPIC_API_KEY`   | `anthropic`   | Claude models             |
| `OPENAI_API_KEY`      | `openai`      | GPT / o-series models     |
| `GEMINI_API_KEY`      | `google`      | Gemini models             |
| `GROQ_API_KEY`        | `groq`        | Groq-hosted models        |
| `OPENROUTER_API_KEY`  | `openrouter`  | OpenRouter-proxied models |
| `MISTRAL_API_KEY`     | `mistral`     | Mistral models            |
| `XAI_API_KEY`         | `xai`         | Grok models               |
| `CEREBRAS_API_KEY`    | `cerebras`    | Cerebras-hosted models    |
| `HUGGINGFACE_API_KEY` | `huggingface` | HuggingFace Inference     |

Providers not in this map (ollama, lmstudio, llamacpp) need no credentials — local models.

---

## 3. Model Selection

### Format: `backend/model-id`

Pi uses a strict **`backend/model-id`** format. The string is split on the **first** `/`:

```
anthropic/claude-sonnet-4-5   → backend: "anthropic",   modelId: "claude-sonnet-4-5"
google/gemini-2.5-pro         → backend: "google",      modelId: "gemini-2.5-pro"
openrouter/qwen/qwen3-coder  → backend: "openrouter",  modelId: "qwen/qwen3-coder"
```

**Backend** must match `^[a-z][a-z0-9-]*$` (lowercase, starts with letter).

**Invalid formats** (will throw at runtime):

- `sonnet` — no slash, `parsePiModelRef()` returns `undefined`
- `opus` — same
- `haiku` — same
- `opus[1m]` — same, plus `[1m]` suffix is not recognized by Pi
- `claude-sonnet-4` — no backend prefix

### Resolution Chain

```
node.model  ??  workflow.model  ??  config.model  ??  THROW (no default)
```

First non-undefined wins. If all three are missing, Pi throws. Rith passes the string through opaquely — it never interprets it.

> **Source bug:** The current error message says `assistants.pi.model` but the actual config path is `provider.model` (and will become `model`). Error in `packages/providers/src/pi/provider.ts:212`.

### Available Pi Backends

These are the backends Pi's catalog knows about:

| Backend      | Example Model IDs (from tests/source)                     | API Key Env Var      |
| ------------ | --------------------------------------------------------- | -------------------- |
| `anthropic`  | `claude-haiku-4-5` (verified in tests), `claude-opus-4-5` | `ANTHROPIC_API_KEY`  |
| `google`     | `gemini-2.5-pro`, `gemini-2.5-flash`                      | `GEMINI_API_KEY`     |
| `openai`     | `gpt-4o`, `o3`                                            | `OPENAI_API_KEY`     |
| `groq`       | `llama-3.3-70b-versatile`                                 | `GROQ_API_KEY`       |
| `openrouter` | `qwen/qwen3-coder`                                        | `OPENROUTER_API_KEY` |
| `mistral`    | `mistral-large-latest`                                    | `MISTRAL_API_KEY`    |
| `xai`        | `grok-3`                                                  | `XAI_API_KEY`        |
| `cerebras`   | `llama-4-scout-17b-16e`                                   | `CEREBRAS_API_KEY`   |
| `ollama`     | `llama3.3:70b`                                            | (none — local)       |
| `lmstudio`   | (model names from LM Studio)                              | (none — local)       |

> **Verify model IDs:** Only `anthropic/claude-haiku-4-5` is confirmed in the test suite. Run `pi models` to see your installed catalog's exact model IDs. Anthropic model IDs change with version bumps.

### Context Window / 1M Context

The `[1m]` suffix (e.g. `opus[1m]`) was a **Claude SDK feature** that is **not supported by Pi**. Pi does not parse, strip, or honor this suffix.

Context window is determined by the model you select in Pi's catalog. Pi delegates context management to the upstream model API entirely.

- `google/gemini-2.5-pro` — native 1M context
- For Anthropic extended context, check `pi models` for which model IDs expose it — this is catalog-dependent and may vary across Pi versions

---

## 4. Workflow Configuration

### Confirmed: No `provider` Field in Workflows

The `provider` field has been **removed from both workflow and node schemas** (verified: zero matches in `dag-node.ts` and `workflow.ts`). There is no `provider:` on workflows or nodes. The only model-related fields are:

| Level    | Field           | Schema                         |
| -------- | --------------- | ------------------------------ |
| Workflow | `model`         | `z.string().optional()`        |
| Workflow | `fallbackModel` | `z.string().min(1).optional()` |
| Node     | `model`         | `z.string().optional()`        |
| Node     | `fallbackModel` | `z.string().min(1).optional()` |

### Per-Workflow Default

```yaml
name: my-workflow
model: anthropic/claude-sonnet-4-5 # All nodes inherit this unless overridden

nodes:
  - id: analyze
    command: analyze-code
    # inherits anthropic/claude-sonnet-4-5

  - id: implement
    command: implement-fix
    model: anthropic/claude-opus-4-5 # Per-node override
```

### Per-Node Override

```yaml
nodes:
  - id: classify
    command: classify-issue
    model: google/gemini-2.5-flash # Fast, cheap classification

  - id: implement
    command: implement-fix
    model: anthropic/claude-opus-4-5 # Heavy lifting
```

### Thinking / Effort Control

Pi supports thinking/effort control natively:

```yaml
# Workflow-level
thinking: high # Pi native levels: minimal, low, medium, high, xhigh

# Node-level
nodes:
  - id: deep-analysis
    command: analyze
    thinking: xhigh # Maximum reasoning
    effort: high # Alternative to thinking (thinking takes precedence)
```

| Rith     | Pi                              |
| -------- | ------------------------------- |
| `off`    | `undefined` (Pi's implicit off) |
| `low`    | `low`                           |
| `medium` | `medium`                        |
| `high`   | `high`                          |
| `max`    | `xhigh`                         |

### Pi Capabilities

| Capability        | Supported         | Notes                                   |
| ----------------- | ----------------- | --------------------------------------- |
| Session Resume    | Yes               | Thread sessions across sequential nodes |
| MCP Servers       | No                | Not wired through Pi SDK                |
| Skills            | Yes               | Bundled skill files loaded into context |
| Inline Agents     | No                |                                         |
| Tool Restrictions | Yes               | `allowed_tools` / `denied_tools`        |
| Structured Output | Yes (best-effort) | Prompt engineering, not SDK-enforced    |
| Env Injection     | Yes               | Per-session env vars                    |
| Cost Control      | No                | `maxBudgetUsd` not enforced             |
| Effort Control    | Yes               | Pi thinking levels                      |
| Thinking Control  | Yes               | Native Pi thinking                      |
| Fallback Model    | No                | No automatic model fallback             |
| Sandbox           | No                | Not enforced                            |

---

## 5. Breaking Issue: Bundled Workflows Use Invalid Model Names

Every bundled workflow that specifies a model uses bare Claude names that will **hard-fail** under Pi:

| Workflow                   | Model Value                                                     | Status     |
| -------------------------- | --------------------------------------------------------------- | ---------- |
| `rith-adversarial-dev`     | `sonnet` (workflow), `haiku` (classify), `opus[1m]` (sprint)    | **BROKEN** |
| `rith-fix-github-issue`    | `sonnet` (workflow), `haiku` (classify), `opus[1m]` (implement) | **BROKEN** |
| `rith-validate-pr`         | `opus` (workflow), `haiku` (classify)                           | **BROKEN** |
| `rith-feature-development` | `opus[1m]` (implement)                                          | **BROKEN** |
| `rith-idea-to-pr`          | `opus[1m]` (implement)                                          | **BROKEN** |
| `rith-plan-to-pr`          | `opus[1m]` (implement)                                          | **BROKEN** |
| `rith-ralph-dag`           | `haiku` (detect), `opus[1m]` (loop)                             | **BROKEN** |
| `rith-refactor-safely`     | `opus[1m]` (refactor)                                           | **BROKEN** |
| `rith-interactive-prd`     | `sonnet` (all nodes)                                            | **BROKEN** |
| `rith-piv-loop`            | `sonnet` (plan/review), `claude-opus-4-6[1m]` (implement)       | **BROKEN** |
| `rith-create-issue`        | `haiku` (classify)                                              | **BROKEN** |
| `rith-remotion-generate`   | `haiku` (node)                                                  | **BROKEN** |
| `rith-smart-pr-review`     | `haiku` (classify)                                              | **BROKEN** |
| `rith-workflow-builder`    | `haiku` (extract-intent)                                        | **BROKEN** |

### Workflows with NO model (inherit from config — OK if config is set):

- `rith-architect`
- `rith-assist`
- `rith-comprehensive-pr-review`
- `rith-issue-review-full`
- `rith-resolve-conflicts`
- `rith-test-loop-dag`

### Required Fix

All bundled workflows must be updated to either:

1. **Remove `model:` fields** and let them inherit from `config.yaml` (recommended for most), or
2. **Use Pi-format model refs** like `anthropic/claude-haiku-4-5` where per-node model selection is needed.

**Suggested tiering:**

| Use Case                                   | Suggested Model Ref           | Rationale                            |
| ------------------------------------------ | ----------------------------- | ------------------------------------ |
| Classification, routing, simple extraction | `anthropic/claude-haiku-4-5`  | Fast, cheap (verified in test suite) |
| General tasks, reviews, planning           | `anthropic/claude-sonnet-4-5` | Balanced                             |
| Heavy implementation, complex reasoning    | `anthropic/claude-opus-4-5`   | Maximum capability                   |
| Cost-sensitive bulk work                   | `google/gemini-2.5-flash`     | Very cheap                           |
| Alternative heavy lifting                  | `google/gemini-2.5-pro`       | 1M context natively                  |

> **Verify model IDs:** Only `anthropic/claude-haiku-4-5` is confirmed in the test suite. Run `pi models` to see your installed catalog's exact model IDs before committing these to workflow YAML.

---

## 6. Documentation That Needs Updating

The authoring-workflows guide (`packages/docs-web/src/content/docs/guides/authoring-workflows.md`) still references:

- `provider: claude` — field removed from schema
- Bare model names (`sonnet`, `haiku`, `opus`) — invalid for Pi
- `opus[1m]` suffix — not supported by Pi
- `assistants.claude.model` — config path does not exist
- "Provider selection is independent of the model string" — no longer relevant, single provider

The configuration reference (`packages/docs-web/src/content/docs/reference/configuration.md`) needs updating for the Pi-only world.

The AI assistants guide (`packages/docs-web/src/content/docs/getting-started/ai-assistants.md`) likely needs a complete rewrite.

---

## 7. Recommended Actions

### Priority 1: Fix Runtime Breakage

1. Update all 14 bundled workflows to use Pi-format model refs or remove `model:` fields
2. Fix error message in `packages/providers/src/pi/provider.ts:212` (`assistants.pi.model` → `model`)
3. Regenerate `bundled-defaults.generated.ts`

### Priority 2: Simplify Config Schema

4. Migrate `provider.model` → top-level `model` in `GlobalConfig`, `RepoConfig`, `MergedConfig`
5. Delete `ProviderDefaults` interface from `@rith/providers/types`
6. Remove Pi runtime knobs (`enableExtensions`, `interactive`, `extensionFlags`, `env`, `maxConcurrent`) from Rith config — let Pi manage these in its own settings
7. Remove deprecated `pi:` config alias
8. Simplify `WorkflowConfig` to `{ model?: string }` + orchestration fields
9. Wire `applyEnvOverrides()` to support `RITH_MODEL` env var

### Priority 3: Improve DX

10. Add `rith doctor` check: validate config → Pi connection (parse model ref, check catalog, check credentials)
11. Make `rith setup` detect whether `~/.pi/agent/auth.json` exists and guide the user
12. Update all documentation (authoring guide, config reference, AI assistants guide)
