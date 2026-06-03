## Project Overview

**CLI Workflow Engine**: Run AI coding workflows from the command line using Pi Coding Agent. Built with **Bun + TypeScript + SQLite**, single-developer tool for AI-assisted development practitioners. Architecture prioritizes simplicity, flexibility, and user control.

## Core Principles

**Single-Developer Tool**
- No multi-tenant complexity

**CLI-Only**
- Single entry point via `rith` CLI; no server, web UI, or platform adapters

**Type Safety (CRITICAL)**
- Strict TypeScript configuration enforced
- All functions must have complete type annotations
- No `any` types without explicit justification
- Interfaces for all major abstractions

**Zod Schema Conventions**
- Schema naming: camelCase, descriptive suffix (e.g., `workflowRunSchema`, `errorSchema`)
- Type derivation: always use `z.infer<typeof schema>` — never write parallel hand-crafted interfaces
- Import `z` from `@hono/zod-openapi` (not from `zod` directly)
- Engine schemas live in `packages/workflows/src/schemas/` — one file per concern (dag-node, workflow, workflow-run, retry, loop, hooks); `index.ts` re-exports all
- Engine schema naming: camelCase (e.g., `dagNodeSchema`, `workflowBaseSchema`, `nodeOutputSchema`)
- `TRIGGER_RULES` and `WORKFLOW_HOOK_EVENTS` are derived from schema `.options` — never duplicate as a plain array
- `loader.ts` uses `dagNodeSchema.safeParse()` for node validation; graph-level checks (cycles, deps, `$nodeId.output` refs) remain as imperative code in `validateDagStructure()`

**Git Workflow and Releases**
- `main` is the release branch. Never commit directly to `main`.
- `dev` is the working branch. All feature work branches off `dev` and merges back into `dev`.
- All PRs must use the template at `.github/PULL_REQUEST_TEMPLATE.md` — fill in every section. When opening a PR via `gh pr create`, copy the template into the body explicitly; GitHub only auto-applies it through the web UI.
- Link the issue with `Closes #<number>` (or `Fixes` / `Resolves`) in the PR description so it auto-closes on merge.
- To release, use the `/release` skill. It compares `dev` to `main`, generates changelog entries, bumps the version, and creates a PR to merge `dev` into `main`.
- Releases follow Semantic Versioning: `/release` (patch), `/release minor`, `/release major`.
- Changelog lives in `CHANGELOG.md` and follows Keep a Changelog format.
- Version is the single `version` field in the root `package.json`.

**Git as First-Class Citizen**
- Let git handle what git does best (conflicts, uncommitted changes, branch management)
- Surface git errors to users for actionable issues (conflicts, uncommitted changes)
- Handle expected failure cases gracefully (missing directories during cleanup)
- Trust git's natural guardrails (e.g., refuse to remove worktree with uncommitted changes)
- Use `@rith/git` functions for git operations; use `execFileAsync` (not `exec`) when calling git directly
- Worktrees enable parallel development per conversation without branch conflicts
- Workspaces automatically sync with origin before worktree creation (ensures latest code)
- **NEVER run `git clean -fd`** - it permanently deletes untracked files (use `git checkout .` instead)

## Engineering Principles

These are implementation constraints, not slogans. Apply them by default.

**KISS — Keep It Simple, Stupid**
- Prefer straightforward control flow over clever meta-programming
- Prefer explicit branches and typed interfaces over hidden dynamic behavior
- Keep error paths obvious and localized

**YAGNI — You Aren't Gonna Need It**
- Do not add config keys, interface methods, feature flags, or workflow branches without a concrete accepted use case
- Do not introduce speculative abstractions without at least one current caller
- Keep unsupported paths explicit (error out) rather than adding partial fake support

**DRY + Rule of Three**
- Duplicate small, local logic when it preserves clarity
- Extract shared utilities only after the same pattern appears at least three times and has stabilized
- When extracting, preserve module boundaries and avoid hidden coupling

**SRP + ISP — Single Responsibility + Interface Segregation**
- Keep each module and package focused on one concern
- Extend behavior by implementing existing narrow interfaces (`IPlatformAdapter`, `IAgentProvider`, `IDatabase`, `IWorkflowStore`) whenever possible — note `IAgentProvider` is a slim send-query contract (no `getType`/`getCapabilities` methods)
- Avoid fat interfaces and "god modules" that mix policy, transport, and storage
- Do not add unrelated methods to an existing interface — define a new one

**Fail Fast + Explicit Errors** — Silent fallback in agent runtimes can create unsafe or costly behavior
- Prefer throwing early with a clear error for unsupported or unsafe states — never silently swallow errors
- Never silently broaden permissions or capabilities
- Document fallback behavior with a comment when a fallback is intentional and safe; otherwise throw

**No Autonomous Lifecycle Mutation Across Process Boundaries**
- When a process cannot reliably distinguish "actively running elsewhere" from "orphaned by a crash" — typically because the work was started by a different process or input source (CLI, cron) — it must not autonomously mark that work as failed/cancelled/abandoned based on a timer or staleness guess.
- Surface the ambiguous state to the user and provide a one-click action.
- Heuristics for *recoverable* operations (retry backoff, subprocess timeouts, hygiene cleanup of terminal-status data) remain appropriate; the rule is about destructive mutation of *non-terminal* state owned by an unknowable other party.
- Reference: #1216 and the CLI orphan-cleanup precedent at `packages/cli/src/cli.ts:256-258`.

**Determinism + Reproducibility**
- Prefer reproducible commands and locked dependency behavior in CI-sensitive paths
- Keep tests deterministic — no flaky timing or network dependence without guardrails
- Ensure local validation commands (`bun run validate`) map directly to CI expectations

**Reversibility + Rollback-First Thinking**
- Keep changes easy to revert: small scope, clear blast radius
- For risky changes, define the rollback path before merging
- Avoid mixed mega-patches that block safe rollback

## Essential Commands

### Development

```bash
# Run CLI in dev mode
bun run cli <command>

# Run all package dev tasks
bun run dev
```

### Testing

```bash
bun run test                # Run all tests (per-package, isolated processes)
bun test --watch            # Watch mode (single package)
bun test packages/core/src/handlers/command-handler.test.ts  # Single file
```

**Test isolation (mock.module pollution):** Bun's `mock.module()` permanently replaces modules in the process-wide cache — `mock.restore()` does NOT undo it ([oven-sh/bun#7823](https://github.com/oven-sh/bun/issues/7823)). To prevent cross-file pollution, packages that have conflicting `mock.module()` calls split their tests into separate `bun test` invocations: `@rith/core` (7 batches), `@rith/workflows` (5), `@rith/adapters` (6), `@rith/isolation` (3). See each package's `package.json` for the exact splits.

**Do NOT run `bun test` from the repo root** — it discovers all test files across all packages and runs them in one process, causing ~135 mock pollution failures. Always use `bun run test` (which uses `bun --filter '*' test` for per-package isolation).

### Type Checking & Linting

```bash
bun run type-check
bun run lint
bun run lint:fix
bun run format
bun run format:check
```

### Pre-PR Validation

**Always run before creating a pull request:**

```bash
bun run validate
```

This runs `check:bundled`, `check:bundled-skill`, type-check, lint, format check, and tests. All six must pass for CI to succeed.

### ESLint Guidelines

**Zero-tolerance policy**: CI enforces `--max-warnings 0`. No warnings allowed.

**When to use inline disable comments** (`// eslint-disable-next-line`):
- **Almost never** - fix the issue instead
- Only acceptable when:
  1. External SDK types are incorrect (document which SDK and why)
  2. Intentional type assertion after validation (must include comment explaining the validation)

**Never acceptable:**
- Disabling `no-explicit-any` without justification
- Disabling rules to "make CI pass"
- Bulk disabling at file level (`/* eslint-disable */`)

### Database

**SQLite (default — zero setup):**
- Uses SQLite at `~/.rith/rith.db` (auto-initialized)

### CLI (Command Line)

Run workflows from the command line. Workflow and isolation commands require running from within a git repository (subdirectories work - resolves to repo root).

```bash
# List available workflows (requires git repo)
bun run cli workflow list

# Machine-readable JSON output
bun run cli workflow list --json

# Run a workflow
bun run cli workflow run assist "What does the orchestrator do?"

# Run in a specific directory
bun run cli workflow run plan --cwd /path/to/repo "Add dark mode"

# Default: auto-creates worktree with generated branch name (isolation by default)
bun run cli workflow run implement "Add auth"

# Explicit branch name for the worktree
bun run cli workflow run implement --branch feature-auth "Add auth"

# Opt out of isolation (run in live checkout)
bun run cli workflow run quick-fix --no-worktree "Fix typo"

# Show running workflows
bun run cli workflow status

# Resume a failed workflow (re-runs, skipping completed nodes)
bun run cli workflow resume <run-id>

# Discard a non-terminal run
bun run cli workflow abandon <run-id>

# Delete old workflow run records (default: 7 days)
bun run cli workflow cleanup
bun run cli workflow cleanup 30  # Custom days

# Emit a workflow event (used inside workflow loop prompts)
bun run cli workflow event emit --run-id <uuid> --type <event-type> [--data <json>]

# List active worktrees/environments
bun run cli isolation list

# Clean up stale environments (default: 7 days)
bun run cli isolation cleanup
bun run cli isolation cleanup 14  # Custom days

# Clean up environments with branches merged into main (also deletes remote branches)
bun run cli isolation cleanup --merged

# Also remove environments with closed (abandoned) PRs
bun run cli isolation cleanup --merged --include-closed

# Validate workflow definitions and their referenced resources
bun run cli validate workflows              # All workflows
bun run cli validate workflows my-workflow  # Single workflow
bun run cli validate workflows my-workflow --json  # Machine-readable output

# Validate command files
bun run cli validate commands               # All commands
bun run cli validate commands my-command    # Single command

# Complete branch lifecycle (remove worktree + local/remote branches)
bun run cli complete <branch-name>
bun run cli complete <branch-name> --force  # Skip uncommitted-changes check


# Install the bundled Rith Engine skill into a project
bun run cli skill install
bun run cli skill install /path/to/project

# Verify your Rith Engine setup (Claude binary, gh auth, DB, adapters)
bun run cli doctor

# Show version
bun run cli version
```

## Architecture

### Directory Structure

**Monorepo Layout (Bun Workspaces):**

```
packages/
├── cli/                      # @rith/cli - Command-line interface
│   └── src/
│       ├── adapters/         # CLI adapter (stdout output)
│       ├── commands/         # CLI command implementations
│       └── cli.ts            # CLI entry point
├── providers/                # @rith/providers - Pi Coding Agent provider (SDK deps live here)
│   └── src/
│       ├── types.ts          # Contract layer (IAgentProvider, SendQueryOptions, MessageChunk — ZERO SDK deps)
│       ├── pi/               # PiProvider + config + model-ref + event-bridge + session-resolver
│       ├── shared/           # Shared utilities (skills, structured-output)
│       ├── mcp/              # MCP configuration
│       └── index.ts          # Package exports
├── core/                     # @rith/core - Shared business logic
│   └── src/
│       ├── config/           # YAML config loading
│       ├── db/               # Database connection, queries
│       ├── handlers/         # Command handler (slash commands)
│       ├── orchestrator/     # AI conversation management
│       ├── services/         # Background services (cleanup)
│       ├── state/            # Session state machine
│       ├── types/            # TypeScript types and interfaces
│       ├── utils/            # Shared utilities
│       ├── workflows/        # Store adapter (createWorkflowStore) bridging core DB → IWorkflowStore
│       └── index.ts          # Package exports
├── workflows/                # @rith/workflows - Workflow engine (depends on @rith/git + @rith/paths)
│   └── src/
│       ├── schemas/          # Zod schemas for engine types
│       ├── loader.ts         # YAML parsing + validation (parseWorkflow)
│       ├── workflow-discovery.ts # Workflow filesystem discovery (discoverWorkflows, discoverWorkflowsWithConfig)
│       ├── executor-shared.ts # Shared executor infrastructure (error classification, variable substitution)
│       ├── router.ts         # Prompt building + invocation parsing
│       ├── executor.ts       # Workflow execution orchestrator (executeWorkflow)
│       ├── dag-executor.ts   # DAG-specific execution logic
│       ├── store.ts          # IWorkflowStore interface (database abstraction)
│       ├── deps.ts           # WorkflowDeps injection types (IWorkflowPlatform, imports from @rith/providers/types)
│       ├── event-emitter.ts  # Workflow observability events
│       ├── logger.ts         # JSONL file logger
│       ├── validator.ts      # Resource validation (command files, MCP configs, skill dirs)
│       ├── defaults/         # Bundled default commands and workflows
│       └── utils/            # Variable substitution, tool formatting, execution utilities
├── git/                      # @rith/git - Git operations (no @rith/core dep)
│   └── src/
│       ├── branch.ts         # Branch operations (checkout, merge detection, etc.)
│       ├── exec.ts           # execFileAsync and mkdirAsync wrappers
│       ├── repo.ts           # Repository operations (clone, sync, remote URL)
│       ├── types.ts          # Branded types (RepoPath, BranchName, etc.)
│       ├── worktree.ts       # Worktree operations (create, remove, list)
│       └── index.ts          # Package exports
├── isolation/                # @rith/isolation - Worktree isolation (depends on @rith/git + @rith/paths)
│   └── src/
│       ├── types.ts          # Isolation types and interfaces
│       ├── errors.ts         # Error classifiers (classifyIsolationError, IsolationBlockedError)
│       ├── factory.ts        # Provider factory (getIsolationProvider, configureIsolation)
│       ├── resolver.ts       # IsolationResolver (request → environment resolution)
│       ├── store.ts          # IIsolationStore interface
│       ├── worktree-copy.ts  # File copy utilities for worktrees
│       ├── providers/
│       │   └── worktree.ts   # WorktreeProvider implementation
│       └── index.ts          # Package exports
├── paths/                    # @rith/paths - Path resolution and logger (zero @rith/* deps)
│   └── src/
│       ├── rith-paths.ts   # Rith Engine directory path utilities
│       ├── logger.ts         # Pino logger factory
│       └── index.ts          # Package exports
```

**Import Patterns:**

**IMPORTANT**: Always use typed imports - never use generic `import *` for the main package.

```typescript
// ✅ CORRECT: Use `import type` for type-only imports
import type { IPlatformAdapter, Conversation, MergedConfig } from '@rith/core';

// ✅ CORRECT: Use specific named imports for values
import { handleMessage, ConversationLockManager, pool } from '@rith/core';

// ✅ CORRECT: Namespace imports for submodules with many exports
import * as conversationDb from '@rith/core/db/conversations';
import * as git from '@rith/git';

// ✅ CORRECT: Import workflow engine types/functions from direct subpaths
import type { WorkflowDeps } from '@rith/workflows/deps';
import type { IWorkflowStore } from '@rith/workflows/store';
import type { WorkflowDefinition } from '@rith/workflows/schemas/workflow';
import { executeWorkflow } from '@rith/workflows/executor';
import { discoverWorkflowsWithConfig } from '@rith/workflows/workflow-discovery';
import { findWorkflow } from '@rith/workflows/router';

// ❌ WRONG: Never use generic import for main package
import * as core from '@rith/core';  // Don't do this
```

### Database Schema

**Database Tables (all prefixed with `remote_agent_`):**
- `codebases` - Repository metadata and commands (JSONB)
- `conversations` - Track platform conversations with titles and soft-delete
- `sessions` - Track AI SDK sessions with resume capability
- `isolation_environments` - Git worktree isolation tracking
- `workflow_runs` - Workflow execution tracking and state
- `workflow_events` - Step-level workflow event log
- `codebase_env_vars` - Per-project env vars injected into workflow commands, managed via `env:` in config

**Session Transitions:**
- Sessions are immutable - transitions create new linked sessions
- Each transition has explicit `TransitionTrigger` reason (first-message, plan-to-execute, reset-requested, etc.)
- Audit trail: `parent_session_id` links to previous session, `transition_reason` records why
- Only plan→execute creates new session immediately; other triggers deactivate current session

### Architecture Layers

**Package Split:**
- **@rith/paths**: Path resolution utilities, Pino logger factory, web dist cache path (`getWebDistDir`), CWD env stripper (`stripCwdEnv`, `strip-cwd-env-boot`) (no @rith/* deps; `pino` and `dotenv` are allowed external deps)
- **@rith/git**: Git operations - worktrees, branches, repos, exec wrappers (depends only on @rith/paths)
- **@rith/providers**: Pi Coding Agent provider — owns SDK deps, `IAgentProvider` interface, `sendQuery()` contract, and Pi-specific option translation. `@rith/providers/types` is the contract subpath (zero SDK deps, zero runtime side effects) that `@rith/workflows` imports from. The provider lives under `pi/`; shared utilities under `shared/`.
- **@rith/isolation**: Worktree isolation types, providers, resolver, error classifiers (depends only on @rith/git + @rith/paths)
- **@rith/workflows**: Workflow engine - loader, router, executor, DAG, logger, bundled defaults (depends only on @rith/git + @rith/paths + @rith/providers/types + @hono/zod-openapi + zod; DB/AI/config injected via `WorkflowDeps`)
- **@rith/cli**: Command-line interface for running workflows (depends on @rith/core + @rith/providers + @rith/workflows + @rith/git + @rith/isolation)
- **@rith/core**: Business logic, database, orchestration (depends on @rith/providers for AI; provides `createWorkflowStore()` adapter bridging core DB → `IWorkflowStore`)



**2. Command Handler** (`packages/core/src/handlers/`)
- Process registration and clone operations
- Update database, perform operations, return responses

**3. Workflow Executor** (`packages/workflows/src/`)
- DAG-based workflow execution engine
- Variable substitution: `$1`, `$2`, `$3`, `$ARGUMENTS`
- Session management via Pi Coding Agent SDK
- Stream AI responses to CLI output
**4. AI Agent Provider** (`packages/providers/src/`)
- Implements `IAgentProvider` interface
- **PiProvider**: `@mariozechner/pi-coding-agent` — one harness for ~20 LLM backends via `<provider>/<model>` refs (e.g. `anthropic/claude-haiku-4-5`, `openrouter/qwen/qwen3-coder`); supports extensions, skills, tool restrictions, thinking level, best-effort structured output. See `packages/docs-web/src/content/docs/getting-started/ai-assistants.md` for setup, capability matrix, and extension config.
- Streaming: `for await (const event of events) { await platform.send(event) }`

### Configuration

**Environment Variables:**

see .env.example
see .rith/config.yaml setup as needed

**Assistant Defaults:**

Pi provider defaults are configured in `.rith/config.yaml`:

```yaml
assistants:
  pi:
    model: anthropic/claude-haiku-4-5  # '<pi-provider-id>/<model-id>' format
    enableExtensions: false            # load Pi's extension ecosystem (default: false)
    interactive: false                 # give extensions a UI bridge (requires enableExtensions)
    extensionFlags:                    # per-extension feature flags
      plan: true
    env:                               # env vars for extensions
      PLANNOTATOR_REMOTE: "1"
    maxConcurrent: 4                   # max concurrent session.prompt() calls

# docs:
#   path: docs  # Optional: default is docs/
```

**Configuration Priority:**
1. Workflow-level options (in YAML `model`, `modelReasoningEffort`, etc.)
2. Config file defaults (`.rith/config.yaml` `assistants.*`)
3. SDK defaults

**Model Validation:**
- Model strings are NOT validated by Rith Engine. Whatever the user writes in `model:` is forwarded verbatim to the Pi SDK. Vendor SDKs ship new models faster than Rith Engine can update; the SDK and the upstream API are the source of truth for what names exist.
- Pi is the sole provider — no provider selection chain needed. Model selection is configured via `assistants.pi.model` in config.yaml or per-node `model:` in workflow YAML.


### Rith Engine Directory Structure

**User-level (`~/.rith/`):**
```
~/.rith/
├── workspaces/owner/repo/        # Project-centric layout
│   ├── source/                   # Cloned repo or symlink → local path
│   ├── worktrees/                # Git worktrees for this project
│   ├── artifacts/                # Workflow artifacts (NEVER in git)
│   │   ├── runs/{id}/            # Per-run artifacts ($ARTIFACTS_DIR)
│   └── logs/                     # Workflow execution logs
├── update-check.json              # Update check cache (binary builds, 24h TTL)
├── rith.db                     # SQLite database (when DATABASE_URL not set)
└── config.yaml                   # Global configuration (non-secrets)
```

**Repo-level (`.rith/` in any repository):**
```
.rith/
├── commands/       # Custom commands
├── workflows/      # Workflow definitions (YAML files)
├── scripts/        # Named scripts for script: nodes (.ts/.js for bun, .py for uv)
├── state/          # Cross-run workflow state (gitignored — never in git)
└── config.yaml     # Repo-specific configuration
```

- `RITH_HOME` - Override the base directory (default: `~/.rith`)

## Development Guidelines


### When Creating New Features

**Quick reference:**
- **AI Providers**: Implement `IAgentProvider`, session management, streaming
- **Database Operations**: Use `IDatabase` interface (supports SQLite via adapter)
- **Plan insertion points**: Use stable text anchors (e.g., "after the `it('throws on ...')` test block"), never raw line numbers — line numbers drift on every preceding edit.

### SDK Type Patterns

When working with the Pi Coding Agent SDK, prefer importing and using SDK types directly:

```typescript
// ✅ CORRECT - Import SDK types directly from the provider package
import type { IAgentProvider, MessageChunk } from '@rith/providers/types';
```

```typescript
// ❌ AVOID - Defining duplicate types
interface MyMessageChunk {  // Don't duplicate provider types
  type: string;
  content: string;
}
```

This ensures type compatibility with SDK updates and eliminates `as any` casts.

### Testing

**Unit Tests:**
- Test pure functions (variable substitution, command parsing)
- Mock external dependencies (database, AI SDKs, platform APIs)

**Integration Tests:**
- Test database operations with test database
- Test end-to-end flows (mock platforms/AI but use real orchestrator)
- Clean up test data after each test

**Mock isolation rules (IMPORTANT):**
- Bun's `mock.module()` is process-global and irreversible — `mock.restore()` does NOT undo it
- Do NOT add `afterAll(() => mock.restore())` for `mock.module()` cleanup — it has no effect
- Use `spyOn()` for internal modules that other test files import directly (e.g., `spyOn(git, 'checkout')`) — `spy.mockRestore()` DOES work for spies
- Never `mock.module()` a module path that another test file also `mock.module()`s with a different implementation
- When adding a new test file with `mock.module()`, ensure its package.json test script runs it in a separate `bun test` invocation from any conflicting files

**Manual Validation:** Use the web API (`curl`) or CLI commands directly for end-to-end testing of new features.

### Logging

**Structured logging with Pino** (`packages/paths/src/logger.ts`):

```typescript
import { createLogger } from '@rith/paths';

const log = createLogger('orchestrator');

// Event naming: {domain}.{action}_{state}
// Standard states: _started, _completed, _failed, _validated, _rejected
async function createSession(conversationId: string, codebaseId: string) {
  log.info({ conversationId, codebaseId }, 'session.create_started');

  try {
    const session = await doCreate();
    log.info({ conversationId, codebaseId, sessionId: session.id }, 'session.create_completed');
    return session;
  } catch (e) {
    const err = e as Error;
    log.error(
      { conversationId, error: err.message, errorType: err.constructor.name, err },
      'session.create_failed',
    );
    throw err;
  }
}
```

**Event naming rules:**
- Format: `{domain}.{action}_{state}` — e.g. `workflow.step_started`, `isolation.create_failed`
- Avoid generic events like `processing` or `handling`
- Always pair `_started` with `_completed` or `_failed`
- Include context: IDs, durations, error details

**Log Levels:** `fatal` > `error` > `warn` > `info` (default) > `debug` > `trace`

**Verbosity:**
- CLI: `rith --quiet` (errors only) — suppresses Pino logs and workflow progress output
- CLI: `rith --verbose` (debug) — enables debug Pino logs and tool-level workflow progress events

**Never log:** API keys or tokens (mask: `token.slice(0, 8) + '...'`), user message content, PII.

### Command System

**Variable Substitution:**
- `$1`, `$2`, `$3` - Positional arguments
- `$ARGUMENTS` - All arguments as single string
- `$ARTIFACTS_DIR` - External artifacts directory for the current workflow run (pre-created by executor)
- `$WORKFLOW_ID` - The workflow run ID
- `$BASE_BRANCH` - Base branch; auto-detected from git when `worktree.baseBranch` is not set; fails only if referenced in a prompt and auto-detection also fails
- `$DOCS_DIR` - Documentation directory path; configured via `docs.path` in `.rith/config.yaml`. Defaults to `docs/`. Never throws.
- `$LOOP_USER_INPUT` - User feedback provided via `/workflow approve <id> <text>` at an interactive loop gate. Only populated on the first iteration of a resumed interactive loop; empty string on all other iterations.
- `$REJECTION_REASON` - Reviewer feedback provided via `/workflow reject <id> <reason>` at an approval gate. Only populated in `on_reject` prompts; empty string elsewhere.
- `$LOOP_PREV_OUTPUT` - Cleaned output of the previous loop iteration (loop nodes only). Empty string on the first iteration (no prior output exists). Useful for `fresh_context: true` loops that need to reference what the previous pass produced or why it failed without carrying full session history.

**Command Types:**

1. **Codebase Commands** (per-repo):
   - Stored in `.rith/commands/` (plain text/markdown)
   - Discovered from the repository `.rith/commands/` directory
   - Surfaced via `GET /api/commands` for the workflow builder and invoked by workflow `command:` nodes

2. **Workflows** (YAML-based):
   - Stored in `.rith/workflows/` (searched recursively)
   - Multi-step AI execution chains, discovered at runtime
   - **`nodes:` (DAG format)**: Nodes with explicit `depends_on` edges; independent nodes in the same topological layer run concurrently. Node types: `command:` (named command file), `prompt:` (inline prompt), `bash:` (shell script, stdout captured as `$nodeId.output`, no AI, receives managed per-project env vars in its subprocess environment when configured), `loop:` (iterative AI prompt until completion signal), `approval:` (human gate; pauses until user approves or rejects; `capture_response: true` stores the user's comment as `$<node-id>.output` for downstream nodes, default false), `script:` (inline TypeScript/Python or named script from `.rith/scripts/`, runs via `bun` or `uv`, stdout captured as `$nodeId.output`, no AI, receives managed per-project env vars in its subprocess environment when configured, supports `deps:` for dependency installation and `timeout:` in ms, requires `runtime: bun` or `runtime: uv`) . Supports `when:` conditions, `trigger_rule` join semantics, `$nodeId.output` substitution, `output_format` for structured JSON output (Claude and Codex via SDK enforcement; Pi best-effort via prompt augmentation + JSON extraction), `allowed_tools`/`denied_tools` for per-node tool restrictions (Claude only), `hooks` for per-node SDK hook callbacks (Claude only), `mcp` for per-node MCP server config files (Claude only, env vars expanded at execution time), and `skills` for per-node skill preloading via AgentDefinition wrapping (Claude only), `agents` for inline sub-agent definitions invokable via the Task tool (Claude only), and `effort`/`thinking`/`maxBudgetUsd`/`systemPrompt`/`fallbackModel`/`betas`/`sandbox` for Claude SDK advanced options (Claude only, also settable at workflow level)
   - Provider inherited from `.rith/config.yaml` unless explicitly set; per-node `provider` and `model` overrides supported
   - Model and options can be set per workflow or inherited from config defaults
   - `interactive: true` at the workflow level forces foreground execution (required for approval-gate workflows)
   - Model validation ensures provider/model compatibility at load time
   - Commands: `/workflow list`, `/workflow reload`, `/workflow status`, `/workflow cancel`, `/workflow resume <id>` (re-runs failed workflow, skipping completed nodes), `/workflow abandon <id>`, `/workflow cleanup [days]` (CLI only — deletes old run records)
   - Resilient loading: One broken YAML doesn't abort discovery; errors shown in `/workflow list`
   - `resolveWorkflowName()` (in `router.ts`) resolves workflow names via a 4-tier fallback — exact, case-insensitive, suffix (`-name`), substring — with ambiguity detection; used by both the CLI and all chat platforms
   - Router fallback: if no `/invoke-workflow` is produced, falls back to `rith-assist` (with "Routing unclear" notice); raw AI response returned only when `rith-assist` is unavailable
   - Claude routing calls use `tools: []` to prevent tool use at the API level; Codex tool bypass is detected and triggers the same fallback

**Defaults:**
- Bundled in `.rith/commands/defaults/` and `.rith/workflows/defaults/`
- Binary builds: Embedded at compile time (no filesystem access needed) via `packages/workflows/src/defaults/bundled-defaults.generated.ts`
- Source builds: Loaded from filesystem at runtime
- Merged with repo-specific commands/workflows (repo overrides defaults by name)
- Opt-out: Set `defaults.loadDefaultCommands: false` or `defaults.loadDefaultWorkflows: false` in `.rith/config.yaml`
- **After adding, removing, or editing a default file, run `bun run generate:bundled`** to refresh the embedded bundle. `bun run validate` (and CI) run `check:bundled` and `check:bundled-skill` and will fail loudly if either generated file is stale.

**Home-scoped ("global") workflows, commands, and scripts** (user-level, applies to every project):
- Workflows: `~/.rith/workflows/` (or `$RITH_HOME/workflows/`)
- Commands: `~/.rith/commands/` (or `$RITH_HOME/commands/`)
- Scripts: `~/.rith/scripts/` (or `$RITH_HOME/scripts/`)
- Source label: `source: 'global'` on workflows and commands (scripts don't have a source label)
- Load priority: bundled < global < project (repo overrides global by filename or script name)
- Subfolders: supported 1 level deep (e.g. `~/.rith/workflows/triage/foo.yaml`). Deeper nesting is ignored silently.
- Discovery is automatic — `discoverWorkflowsWithConfig(cwd, loadConfig)` and `discoverScriptsForCwd(cwd)` both read home-scoped paths unconditionally; no caller option needed
- **Migration from pre-0.x `~/.rith/.rith/workflows/`**: if Rith Engine detects files at the old location it emits a one-time WARN with the exact `mv` command and does NOT load from there. Move with: `mv ~/.rith/.rith/workflows ~/.rith/workflows && rmdir ~/.rith/.rith`
- See the docs site at `packages/docs-web/` for details

### Error Handling

**Database Errors:**
```typescript
// INSERT operations
try {
  await db.query('INSERT INTO conversations ...', params);
} catch (error) {
  log.error({ err: error, params }, 'db_insert_failed');
  throw new Error('Failed to create conversation');
}

// UPDATE operations - verify rowCount to catch missing records
try {
  await db.updateConversation(conversationId, { codebase_id: codebaseId });
} catch (error) {
  // updateConversation throws if no rows matched (conversation not found)
  log.error({ err: error, conversationId }, 'db_update_failed');
  throw error; // Re-throw to surface the issue
}
```

**Git Operation Errors (don't fail silently):**
```typescript
// When isolation environment creation fails:
try {
  // ... isolation creation logic ...
} catch (error) {
  const err = error as Error;
  const userMessage = classifyIsolationError(err);
  log.error({ err, codebaseId, codebaseName }, 'isolation_creation_failed');
  await platform.sendMessage(conversationId, userMessage);
}
```

Pattern: Use `classifyIsolationError()` (from `@rith/isolation`) to map git errors (permission denied, timeout, no space, not a git repo) to user-friendly messages. Always log the raw error for debugging and send a classified message to the user.

### CLI Commands

See `rith --help` for the full command list. Key commands:
- `rith workflow list` — list available workflows
- `rith workflow run <name>` — run a workflow
- `rith workflow status` — show running workflows
- `rith workflow cancel <id>` — cancel a running workflow
- `rith workflow resume <id>` — resume a failed workflow
