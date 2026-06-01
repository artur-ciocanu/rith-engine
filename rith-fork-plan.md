# Rith Fork Plan

Fork of [Archon](https://github.com/coleam00/archon) (MIT, Cole Medin) stripped to a
pure workflow executor with Pi as the sole AI provider.

**Thesis**: Keep the DAG engine, isolation layer, git ops, and CLI. Delete the bot
platform, web UI, server, multi-provider registry, and all Claude/Codex/Copilot SDK
coupling. External infra (Jenkins, GitHub Actions, cron) triggers workflows. Rith
runs them and exits.

---

## Phase 0 — Fork Housekeeping

> Rename the project, update license, establish the boundary.

### 0.1 — Repository Setup
- Fork repo, rename to `rith`
- Update root `package.json`: name `rith`, description, author, repository URL
- Update `LICENSE`: add your copyright line above Cole Medin's (keep his — MIT requires it)
- Delete `CONTRIBUTING.md`, `homebrew/`, `deploy/`, `docker-compose*.yml`, `Dockerfile*`
- Delete `.archon/workflows/maintainer/` (maintainer-specific workflows)
- Delete `.archon/workflows/experimental/`
- Delete `.archon/workflows/test-workflows/` (e2e tests for deleted providers)
- Delete `examples/`

### 0.2 — Global Rename `archon` → `rith`
- Rename workspace packages: `@archon/*` → `@rith/*`
- Rename config directory: `~/.archon/` → `~/.rith/`, `.archon/` → `.rith/`
- Rename in `packages/paths/src/archon-paths.ts` (the canonical path builder):
  all `getArchon*` → `getRith*`, env var `ARCHON_HOME` → `RITH_HOME`
- Rename in DB table prefix: `remote_agent_` → `rith_` (or keep, your call — cosmetic)
- Rename bundled-build.ts constants
- Rename env loader: `.archon/.env` → `.rith/.env`
- Search-and-replace `archon` (case-insensitive) across all remaining source files
  after structural deletions are complete (Phase 1-3 first, then rename — avoids
  renaming code you're about to delete)

---

## Phase 1 — Delete Entire Packages

> Remove packages wholesale. These are self-contained; deleting them produces
> clear import errors that guide Phase 2 cleanup.

### 1.1 — Delete `packages/web/`
- Entire React web UI (Vite, shadcn, React Router, SSE dashboard)
- ~50 components, stores, hooks
- No other package imports from `@archon/web`

### 1.2 — Delete `packages/server/`
- Hono HTTP server, REST API routes, SSE streaming, OpenAPI schema
- Web adapter (`adapters/web.ts`)
- Server startup, port allocation, static file serving
- `packages/cli/src/commands/` references `serve` command → remove that CLI branch

### 1.3 — Delete `packages/docs-web/`
- Astro documentation site
- All markdown guides, reference docs, getting-started content
- No runtime dependency on this

### 1.4 — Delete `packages/adapters/`
- All platform adapters: Slack, Discord, Telegram, GitHub, GitLab, Gitea
- `adapters/src/chat/` — Slack, Telegram
- `adapters/src/forge/` — GitHub webhook handler
- `adapters/src/community/chat/` — Discord
- `adapters/src/community/forge/` — GitLab, Gitea
- `adapters/src/index.ts` — adapter barrel exports
- **Keep**: `packages/cli/src/adapters/cli-adapter.ts` (this is in the CLI package, not adapters)

---

## Phase 2 — Gut the Provider Layer

> Reduce `packages/providers/` from 5 providers + registry to a single Pi wrapper.

### 2.1 — Delete Non-Pi Providers
- Delete `providers/src/claude/` (provider, binary-resolver, config, capabilities, tests)
- Delete `providers/src/codex/` (provider, binary-resolver, config, capabilities, tests)
- Delete `providers/src/community/copilot/` (provider, event-bridge, config, capabilities, tests)
- Delete `providers/src/community/opencode/` (provider, agent-config, session, runtime, tests)

### 2.2 — Delete Provider Registry
- Delete `providers/src/registry.ts` and `providers/src/registry.test.ts`
- Delete `providers/src/errors.ts` (`UnknownProviderError` — one provider, can't be unknown)
- The registration ceremony (`registerBuiltinProviders`, `registerCommunityProviders`) is gone

### 2.3 — Flatten Pi as the Sole Provider
- Move `providers/src/community/pi/` up to `providers/src/pi/` (or inline into a single module)
- Keep: `provider.ts`, `options-translator.ts`, `resource-loader.ts`, `session-resolver.ts`,
  `model-ref.ts`, `event-bridge.ts`, `capabilities.ts` (simplify to just flags), `config.ts`
- Keep: `providers/src/shared/skills.ts` (the agentskills.io resolver — provider-agnostic)
- Keep: `providers/src/shared/structured-output.ts`
- Keep: `providers/src/mcp/config.ts` (MCP server config loading — if Pi supports MCP)

### 2.4 — Simplify `providers/src/types.ts`
- Delete `ClaudeProviderDefaults`, `CodexProviderDefaults`, `CopilotProviderDefaults`,
  `OpencodeProviderDefaults`
- Delete `ProviderRegistration`, `ProviderInfo` (no registry)
- Simplify `ProviderCapabilities` — with one provider, this becomes a static constant
  or is deleted entirely (no capability-warning system needed)
- Keep: `IAgentProvider`, `MessageChunk`, `TokenUsage`, `AgentRequestOptions`,
  `SendQueryOptions`, `NodeConfig`, `SystemPromptInput`

### 2.5 — Simplify `providers/src/index.ts`
- Export only: `PiProvider`, `parsePiConfig`, `type PiProviderDefaults`
- Export shared utilities: `resolveSkillDirectories`, `loadMcpConfig`
- Export types: `IAgentProvider`, `MessageChunk`, `TokenUsage`, `SendQueryOptions`, `NodeConfig`
- Delete all Claude/Codex/Copilot re-exports

### 2.6 — Update `providers/package.json`
- Remove dependencies: `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`,
  `@github/copilot-sdk`, `@opencode-ai/sdk`, `@sinclair/typebox`
- Keep: `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`, `@rith/paths`

---

## Phase 3 — Strip the DSL

> Remove provider-specific fields from the workflow YAML schema.

### 3.1 — Remove `hooks:` from DAG Node Schema
- Delete `packages/workflows/src/schemas/hooks.ts` entirely
- Remove `hooks` field from `dagNodeSchema` in `schemas/dag-node.ts`
- Remove `hooks` from `BASH_NODE_AI_FIELDS` and `LOOP_NODE_AI_FIELDS`
- Remove `hooks` from `NodeConfig` type in `providers/src/types.ts`
- Delete `packages/workflows/src/hooks.test.ts`

### 3.2 — Remove `provider:` from Workflow Schema
- Remove `provider` field from `workflowSchema` in `schemas/workflow.ts`
  (or repurpose as Pi model-provider prefix — decision point, see Notes)
- Remove `provider` field from `dagNodeSchema` in `schemas/dag-node.ts`
- Remove provider resolution chain in `dag-executor.ts`:
  `resolveNodeProviderAndModel()` simplifies to just model resolution
- Remove provider capability warnings from `dag-executor.ts` (lines ~386-430)
- Remove provider capability checks from `validator.ts`

### 3.3 — Simplify `model:` Semantics
- `model:` in YAML becomes a Pi model ref directly: `anthropic/claude-sonnet-4`,
  `google/gemini-2.5-pro`, `openai/gpt-5`
- Remove Claude-specific model aliases (`opus`, `haiku`, `sonnet`) from the loader
- The `model-ref.ts` in the Pi provider already parses `<provider>/<model>` format

### 3.4 — Remove `settingSources` from Everything
- Delete from `ClaudeProviderDefaults` (already gone with type deletion)
- Delete from `WorkflowConfig.assistants.claude` in `deps.ts`
- Delete from `config-types.ts` `AssistantDefaults`
- Delete forwarding in `orchestrator-agent.ts`, `orchestrator.test.ts`
- Delete from `config-loader.ts` merge logic
- Delete from `config-loader.test.ts`

---

## Phase 4 — Simplify Core

> Remove orchestrator, conversations, platform abstractions, multi-provider config.

### 4.1 — Delete the Orchestrator
- Delete `packages/core/src/orchestrator/orchestrator-agent.ts` and test
- Delete `packages/core/src/orchestrator/orchestrator-isolation.test.ts`
- Delete `packages/core/src/orchestrator/prompt-builder.ts` and test
- The orchestrator is the "read user message, decide which workflow to run" AI router.
  With rith, the caller specifies the workflow explicitly: `rith run <workflow-name>`.

### 4.2 — Delete Conversation & Message System
- Delete `packages/core/src/db/conversations.ts` and test
- Delete `packages/core/src/db/messages.ts` and test
- Delete `packages/core/src/services/title-generator.ts` and test
- Delete `packages/core/src/state/session-transitions.ts` and test
- These exist for multi-turn chat (Slack threads, web chat). Rith is single-shot.

### 4.3 — Simplify Sessions
- `packages/core/src/db/sessions.ts` — evaluate whether session tracking is needed.
  If workflows don't resume mid-run (Pi is stateless), sessions can be simplified to
  just a run-ID attached to the workflow run. May be deletable entirely if workflow_runs
  table covers the need.

### 4.4 — Simplify Config Types
- `GlobalConfig`: delete `botName`, `streaming`, `concurrency.maxConversations`
- `RepoConfig`: keep `commands`, `worktree`, `docs`, `env`, `defaults` — all useful
- `MergedConfig`: delete `botName`, `streaming`, `concurrency`; simplify `assistant`
  to just `defaultModel` (a Pi model ref string); delete `assistants` map (one provider,
  config goes at top level)
- `SafeConfig`: delete entirely (was for web client projection)
- Delete `toSafeConfig()` in config-loader

### 4.5 — Simplify Config Loader
- Remove `registerBuiltinProviders()` / `registerCommunityProviders()` calls
- Remove `getRegisteredProviderNames()` — no registry
- Remove `SAFE_ASSISTANT_FIELDS` and `toSafeAssistantDefaults()` — no web client
- Remove multi-provider `assistants:` merge logic — single provider config at top level

### 4.6 — Delete Core Types That Reference Platforms
- In `packages/core/src/types/index.ts`:
  - `IPlatformAdapter` — simplify to a minimal output interface (just stdout + log)
  - `IWebPlatformAdapter` — delete
  - `isWebAdapter()` — delete
  - `HandleMessageContext` — delete (orchestrator concept)
  - `Conversation` — delete or radically simplify to just a run context
  - `MessageMetadata` — simplify

### 4.7 — Delete Command Handler
- Delete `packages/core/src/handlers/command-handler.ts` and test
  (handles `/slash-commands` from chat platforms — not needed)
- The `clone.ts` handler may be worth keeping if you want `rith clone` to set up repos

### 4.8 — Delete Core Services
- Delete `packages/core/src/services/cleanup-service.ts` and test
  (background scheduler for stale worktree cleanup — replace with a CLI command or cron)

---

## Phase 5 — Simplify CLI

> Strip CLI to: `run`, `validate`, `list`, `isolation`, `version`, `help`.

### 5.1 — Delete CLI Commands
- Delete `commands/chat.ts` (orchestrator chat — gone)
- Delete `commands/setup.ts` and test (68KB interactive wizard — replace with a
  minimal config generator or just documentation)
- Delete `commands/doctor.ts` and test (checks Claude binary, Codex binary, etc.)
- Delete `commands/skill.ts` and test (installs skills into `.claude/skills/` — if
  keeping skill support, rewrite for `.agents/skills/` or `.rith/skills/`)
- Delete `commands/serve.ts` if present (web UI server — gone with `packages/server/`)
- Delete `commands/continue.ts` if present (resume orchestrator conversation)
- Delete `bundled-skill.ts` (bundles the "archon" skill into .claude/skills/)

### 5.2 — Keep & Simplify CLI Commands
- `commands/workflow.ts` — the core. Keep `run`, `list`, `validate`, `status`.
  Remove `approve`, `abandon`, `cancel` if those are only used from web UI.
  Remove marketplace `search`/`install` (or keep if useful).
- `commands/isolation.ts` — keep `list`, `cleanup`, `cleanup --merged`, `complete`
- `commands/version.ts` — keep, update branding
- `commands/validate.ts` — keep

### 5.3 — Simplify CLI Entrypoint (`cli.ts`)
- Remove provider registration bootstrap (`registerBuiltinProviders`, etc.)
- Remove Claude auth defaults (lines 26-32: `CLAUDE_USE_GLOBAL_AUTH`)
- Remove `chat`, `setup`, `doctor`, `serve`, `skill`, `continue` command branches
- Remove `--spawn`, `--port`, `--download-only` flags
- Remove update-check notice
- Remove telemetry (or keep if you want usage tracking)

### 5.4 — New CLI Surface
```
rith run <workflow> [args]        Run a workflow
  --cwd <path>                    Working directory (default: .)
  --branch, -b <name>            Create/reuse worktree branch
  --from <branch>                 Branch from specific start point
  --no-worktree                   Run without isolation
  --resume                        Resume last failed run
  --model <ref>                   Override default model (e.g. google/gemini-2.5-pro)
  --quiet, -q                     Warnings only
  --verbose, -v                   Debug output
  --json                          Machine-readable output

rith list [--cwd <path>]          List available workflows
rith validate [name]              Validate workflow YAML
rith isolation list               List active worktrees
rith isolation cleanup [days]     Remove stale environments
rith version                      Show version
```

---

## Phase 6 — Simplify Workflow Engine

> The engine is the diamond. Clean it up, don't redesign it.

### 6.1 — Simplify `WorkflowDeps`
- `getAgentProvider: AgentProviderFactory` → singleton `getPiProvider()` or inline.
  The factory pattern was for multi-provider dispatch. With one provider, a direct
  function or a module-level instance suffices.
- `loadConfig` stays (workflow engine still reads `.rith/config.yaml`)
- `store` stays (workflow runs DB)

### 6.2 — Simplify `WorkflowConfig` (deps.ts)
- Remove typed `assistants.claude` and `assistants.codex` entries
- Replace `assistant: string` with `defaultModel: string` (Pi model ref)
- Keep: `baseBranch`, `docsPath`, `envVars`, `commands`, `defaults`

### 6.3 — Simplify DAG Executor
- Remove the entire capability-warning block (~lines 386-447)
- Remove provider resolution: `resolveNodeProviderAndModel()` becomes just model
  resolution — `node.model ?? workflow.model ?? config.defaultModel`
- Remove `hooks` from `nodeConfig` forwarding
- Remove `provider` from node options building
- The executor calls `piProvider.sendQuery(prompt, cwd, undefined, options)` directly

### 6.4 — Simplify Executor (`executor.ts`)
- Remove provider resolution at workflow level
- Remove `isRegisteredProvider()` check — always Pi
- Simplify `resolvedProvider` / `providerSource` logging

### 6.5 — Simplify Validator (`validator.ts`)
- Remove all capability-driven warnings (hooks, agents, skills, effort, etc.)
  With one provider, validation is static: does the YAML parse correctly?
  Does the command file exist? Are `depends_on` references valid?
- Remove `resolveProvider()` helper
- Remove `getProviderCapabilities()` calls

### 6.6 — Remove Hooks Test File
- Delete `packages/workflows/src/hooks.test.ts`
- Remove hook-related test cases from `dag-executor.test.ts`
- Remove hook-related test cases from `validator.test.ts`
- Remove hook-related test cases from `loader.test.ts`

---

## Phase 7 — Simplify DB Schema

> Drop platform-centric tables, keep workflow execution state.

### 7.1 — Tables to Keep
- `rith_workflow_runs` — execution state, status, timing
- `rith_workflow_events` — step transitions, artifacts, errors
- `rith_codebases` — project registration (cwd, repo URL, env vars)
- `rith_codebase_env_vars` — per-project secrets
- `rith_isolation_environments` — worktree lifecycle

### 7.2 — Tables to Drop or Simplify
- `rith_conversations` — exists for chat platform threads.
  Workflow runs currently FK to conversations. Decision: either drop conversations
  and make workflow_runs standalone (null the FK), or keep a minimal "run context"
  row. Leaning toward drop — workflow_runs already has `codebase_id`, `user_message`,
  `working_path`, `status`, `metadata`. It doesn't need a conversation wrapper.
- `rith_sessions` — Claude session resume IDs. Pi is stateless. Drop.
- `rith_messages` — chat message history. Drop.

### 7.3 — Schema Column Cleanup
- `codebases.ai_assistant_type` — drop (always Pi, decided by model ref)
- `conversations.platform_type` — drop with table
- `conversations.ai_assistant_type` — drop with table
- `sessions.ai_assistant_type` — drop with table
- `sessions.assistant_session_id` — drop with table
- `workflow_runs.conversation_id` — null the FK or add `codebase_id` directly (already exists)
- `workflow_runs.parent_conversation_id` — drop (orchestrator concept)
- `isolation_environments.created_by_platform` — drop or keep as metadata

### 7.4 — Migration Strategy
- Write a single new `000_rith_schema.sql` that creates the clean schema from scratch
- Don't carry forward 21 incremental Archon migrations
- This is a fork, not an upgrade path — fresh schema

---

## Phase 8 — Bundled Workflows & Commands

> Strip Claude-specific content, make workflows provider-agnostic.

### 8.1 — Workflow YAML Cleanup
- Remove `provider: claude` from all bundled workflow nodes
- Replace Claude model names (`opus[1m]`, `haiku`, `sonnet`) with Pi model refs
  or a configurable default (`$DEFAULT_MODEL` / omit and let config decide)
- Remove `hooks:` blocks from `archon-architect.yaml` and `archon-refactor-safely.yaml`
  — move the steering instructions into the node's `prompt:` or into the command file
- Remove `settingSources` references

### 8.2 — Command File Cleanup
- Search-and-replace "CLAUDE.md compliance" → remove or generalize
- Search-and-replace "CLAUDE.md" references in command prompts
- Rename command files: `archon-*` → `rith-*` (or drop prefix entirely)

### 8.3 — Bundled Defaults Regeneration
- Update `scripts/generate-bundled-defaults.ts` to read from `.rith/` paths
- Regenerate `bundled-defaults.generated.ts` after all YAML/command edits

### 8.4 — Decide on Prompt-in-YAML vs Commands-Only
- Per your earlier instinct: if a node has >3 lines of prompt, it should be a command
  file. Enforce this in the validator as a warning.
- Short prompts (`prompt: "Summarize $review.output"`) stay inline.

---

## Phase 9 — Paths & Build

### 9.1 — Update `packages/paths/`
- Rename `archon-paths.ts` → `rith-paths.ts`
- All path functions: `getArchonHome()` → `getRithHome()`,
  `getArchonConfigPath()` → `getRithConfigPath()`, etc.
- Config directory: `~/.rith/`, `.rith/`
- Env var: `RITH_HOME` (override home directory)
- Delete `strip-cwd-env.ts` logic that strips Claude-specific env vars
  (`CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_API_KEY`, etc.)
- Keep env-loader.ts, update to load `.rith/.env`
- Delete or simplify telemetry.ts (remove Archon-specific telemetry endpoints)
- Delete update-check.ts (homebrew/npm update notifications)

### 9.2 — Update Build Script
- `scripts/build-binaries.sh` — update binary name from `archon` to `rith`
- Remove the `--bytecode` disable comment (re-test whether Pi works with bytecode
  now that Claude/Codex/Copilot SDKs are gone — may fix the CJS/ESM interop issue)
- Update `BUNDLED_BUILD_FILE` path
- Update version extraction from `package.json`
- Test: `bun build --compile --minify packages/cli/src/cli.ts --outfile rith`

### 9.3 — Update Root Config Files
- `tsconfig.json` — update workspace references (remove deleted packages)
- `package.json` — update workspace glob, scripts, name
- Remove `docker-compose.yml`, `docker-compose.override.example.yml`
- Remove `Dockerfile.user.example`

---

## Phase 10 — Verification

### 10.1 — Type Check
- `bun run type-check` across all remaining packages
- Fix broken imports from deleted packages (this is the main work — follow the errors)

### 10.2 — Test Suite
- Run remaining tests: `bun test` in each kept package
- Delete test files that reference deleted modules
- Update test mocks that reference `getAgentProvider` registry patterns
- Major test files to update:
  - `dag-executor.test.ts` (~247KB) — remove provider capability tests, hooks tests,
    multi-provider routing tests. Keep DAG execution, node ordering, variable
    substitution, retry, loop, when-guard tests.
  - `executor.test.ts` — remove provider resolution tests
  - `loader.test.ts` — remove `provider:` field parsing tests (or update if field removed)

### 10.3 — Build Verification
- `bun build --compile packages/cli/src/cli.ts --outfile dist/rith`
- Run: `./dist/rith version`
- Run: `./dist/rith list --cwd <test-repo>`
- Run: `./dist/rith run <simple-workflow> --cwd <test-repo>`
- Verify Pi executes, streams output, exits cleanly

### 10.4 — Smoke Test
- Create a minimal `test-smoke.yaml`:
  ```yaml
  name: smoke
  nodes:
    - id: greet
      bash: echo "rith works"
    - id: think
      prompt: "Say hello in one sentence."
      model: anthropic/claude-sonnet-4
      depends_on: [greet]
  ```
- `ANTHROPIC_API_KEY=xxx ./dist/rith run smoke --no-worktree --cwd .`
- Verify bash node runs, Pi calls Anthropic API, output streams to stdout, exit 0.

---

## Notes & Decision Points

### `provider:` Field — Delete or Repurpose?
**Recommendation: Delete.** The `model:` field already encodes the LLM provider as a
Pi model ref prefix (`anthropic/`, `google/`, `openai/`). A separate `provider:` field
that used to mean "which SDK to use" is now meaningless — it's always Pi.

### SQLite vs Postgres
Archon supports both via `packages/core/src/db/adapters/`. For a CLI tool, **SQLite
only** is probably right. Delete the Postgres adapter and the `DATABASE_URL` env var
plumbing. Local SQLite file at `~/.rith/rith.db`.

### Skill System
Keep the shared resolver (`providers/src/shared/skills.ts`). Update search paths:
```
1. <cwd>/.agents/skills/<name>/SKILL.md    ← agentskills.io standard (primary)
2. <cwd>/.rith/skills/<name>/SKILL.md      ← rith convention
3. ~/.agents/skills/<name>/SKILL.md         ← user-global
4. ~/.rith/skills/<name>/SKILL.md           ← user-global rith
```
Drop `.claude/skills/` from the search order.

### MCP Support
Pi doesn't natively support MCP (capabilities show `mcp: false`). The `mcp:` field
in workflow YAML may need to be dropped or reimplemented. Evaluate whether Pi's
extension system can bridge to MCP servers.

### What About the `packages/git/` Package?
**Keep entirely.** Clean git operations library with no provider coupling: clone,
branch, commit, worktree management, remote sync. Used by isolation layer and
workflow execution.

### What About `packages/isolation/`?
**Keep entirely.** Worktree provider, resolver, PR state, copy logic. No provider
coupling. This is the safe-parallel-execution layer.

---

## Estimated File Counts

| Action | Files Affected |
|--------|---------------|
| Delete entire packages (web, server, docs-web, adapters) | ~300 files |
| Delete provider code (claude, codex, copilot, opencode, registry) | ~60 files |
| Delete orchestrator, conversations, sessions, command-handler | ~30 files |
| Delete CLI commands (setup, doctor, skill, chat, serve) | ~15 files |
| Delete hooks schema + tests | ~5 files |
| Modify (config, deps, types, dag-executor, executor, validator, CLI, paths) | ~40 files |
| Rename archon → rith (remaining files after deletion) | ~100 files |

**Net result**: from ~544 source files to roughly ~130-150.
The binary goes from bundling 5 SDKs to bundling 1.
