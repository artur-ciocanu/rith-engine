# Rith Engine Fork Cleanup Plan

## Scope

Strip all dead code, stale references, and architectural debt inherited from Archon that no longer serves the Rith Engine's reality: **CLI-only entry point, Pi as sole provider, no server/web/adapters**.

Every item below is grounded in traced import chains from `packages/cli/src/cli.ts`. "Dead" means unreachable from any CLI command path. "Stale" means references to removed concepts.

---

## Phase 1: Dead Utility Modules in @rith/core

These files are exported from `packages/core/src/index.ts` but **never imported by CLI, workflows, isolation, providers, git, or paths**. Only their own `.test.ts` files import them.

### 1.1 Delete `packages/core/src/utils/conversation-lock.ts` + test

- **Evidence:** `ConversationLockManager` is exported from `core/index.ts:76`. Zero imports outside `conversation-lock.test.ts`. Server-era concurrency primitive for parallel chat conversations — CLI runs one workflow at a time.
- **Action:** Delete `conversation-lock.ts`, `conversation-lock.test.ts`. Remove export from `core/index.ts:76`.

### 1.2 Delete `packages/core/src/utils/port-allocation.ts` + test

- **Evidence:** `getPort` is exported from `core/index.ts:92`. Zero imports outside `port-allocation.test.ts`. Computes port offsets for the Hono HTTP server that was removed.
- **Action:** Delete `port-allocation.ts`, `port-allocation.test.ts`. Remove export from `core/index.ts:92`.

### 1.3 Delete `packages/core/src/utils/github-graphql.ts` + test

- **Evidence:** `getLinkedIssueNumbers` is exported from `core/index.ts:86`. Zero imports outside `github-graphql.test.ts`. Uses GitHub's GraphQL API to find linked issues for PRs — only useful for forge adapter integration that was removed.
- **Action:** Delete `github-graphql.ts`, `github-graphql.test.ts`. Remove export from `core/index.ts:86`.

### 1.4 Delete `packages/core/src/utils/error-formatter.ts` + test

- **Evidence:** `classifyAndFormatError` is exported from `core/index.ts:79`. Zero imports outside `error-formatter.test.ts`. The function body references Claude OAuth errors (`/login`, `claude logout`), Codex auth errors (`codex login`), and session `/reset` commands — all from the server/chat adapter era. Pi provider errors are handled differently (event-bridge maps them to MessageChunk).
- **Action:** Delete `error-formatter.ts`, `error-formatter.test.ts`. Remove export from `core/index.ts:79`.

### 1.5 Delete `packages/core/src/utils/credential-sanitizer.ts` + test (if exists)

- **Evidence:** `sanitizeCredentials` and `sanitizeError` are exported from `core/index.ts:83`. Search for imports in CLI/workflows/providers/isolation returned zero hits.
- **Action:** Verify no callers exist. Delete files and remove exports from `core/index.ts:82-83`.

### 1.6 Audit `packages/core/src/utils/commands.ts`

- **Evidence:** Exported but needs verification of whether CLI uses it directly or through workflow discovery.
- **Action:** Trace imports. If only consumed by removed server routes, delete. If used by workflow operations, keep.

---

## Phase 2: Dead Database Code

### 2.1 Remove `conversations` and `sessions` table creation + migrations

- **Evidence:** `remote_agent_conversations` and `remote_agent_sessions` tables are created in `packages/core/src/db/adapters/sqlite.ts:256-287`. The CLI never creates conversations or sessions — it writes directly to `workflow_runs` and `workflow_events`. However, these tables are referenced by FK constraints and JOIN queries in live code (see 2.2).
- **Action:** This requires a phased approach:
  1. First complete Phase 2.2 (remove queries that reference these tables)
  2. Then drop the table creation DDL and migration columns from `sqlite.ts`
  3. Drop indexes: `idx_conversations_platform`, `idx_sessions_conversation`, `idx_sessions_active`, `idx_conversations_hidden`, `idx_conversations_codebase`

### 2.2 Remove conversation/session references from live DB modules

These queries JOIN against or reference `remote_agent_conversations` / `remote_agent_sessions` but are either dead functions or can be simplified:

| File                                   | Function                              | Reference                              | Action                                                                                                 |
| -------------------------------------- | ------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `db/workflows.ts:434`                  | `getWorkflowRunByWorkerPlatformId()`  | JOINs conversations                    | **Delete entire function** — zero callers anywhere                                                     |
| `db/workflows.ts:776-778`              | `listWorkflowRuns()` query            | LEFT JOINs conversations twice         | **Remove the JOINs** — CLI doesn't need conversation platform IDs                                      |
| `db/workflows.ts:852`                  | Filter branch in `listWorkflowRuns()` | Subquery into conversations            | **Remove filter branch** or rewrite to filter by codebase_id directly                                  |
| `db/codebases.ts:172-178`              | `deleteCodebase()`                    | UPDATEs sessions and conversations     | **Remove the two UPDATE statements** — those tables will be empty/gone                                 |
| `db/isolation-environments.ts:176-180` | `getConversationsUsingEnv()`          | SELECTs from conversations             | **Delete entire function** — verify no CLI callers                                                     |
| `db/isolation-environments.ts:202-205` | `getStaleEnvironments()` query        | NOT EXISTS subquery into conversations | **Remove the NOT EXISTS clause** — stale detection should use `last_activity_at` on the env row itself |
| `db/isolation-environments.ts:271-273` | Status query                          | Subquery into conversations            | **Remove subquery**, simplify activity detection                                                       |

**Test files that need updating:** `codebases.test.ts` (lines ~427-461), `isolation-environments.test.ts` (lines ~261-268), `workflows.test.ts` (any test for `getWorkflowRunByWorkerPlatformId` or the conversation JOIN paths).

### 2.3 Remove `workflow_runs.conversation_id` and `parent_conversation_id` columns

- **Evidence:** `remote_agent_workflow_runs` has `conversation_id` and `parent_conversation_id` columns, both FK-referencing `remote_agent_conversations`. In CLI mode, the `workflowRunCommand` in `packages/cli/src/commands/workflow.ts` creates workflow runs — check what values it passes for these columns.
- **Action:** Trace the `createWorkflowRun` call chain from CLI to see if conversation_id is populated. If it's always null or a synthetic value, drop the columns. If it's used for run identity, rename to something meaningful (e.g., `cli_session_id`).

### 2.4 Evaluate Postgres adapter reachability

- **Evidence:** `packages/core/src/db/connection.ts:35-38` — if `DATABASE_URL` is set, it instantiates `PostgresAdapter`. The CLI's env-loading pipeline strips `DATABASE_URL` from Bun auto-load (to prevent accidental connection to a target app's database), but a user's `~/.rith/.env` or `.rith/.env` could set it intentionally.
- **Action:** **Keep for now** — it's a legitimate user-controlled path. But document that it's the only way Postgres is reachable (not via server anymore). Remove the Docker-specific warning in `connection.ts:45-53` (Docker deployment was removed).

---

## Phase 3: Archon Naming Remnants

### 3.1 Config file references

| File                | Line(s)            | What                                      | Action                                                         |
| ------------------- | ------------------ | ----------------------------------------- | -------------------------------------------------------------- |
| `.gitignore`        | 35, 49-60, 68, 122 | `.archon/` directory patterns             | Replace with `.rith/` equivalents or remove if already covered |
| `.prettierignore`   | 31                 | `.archon/`                                | Replace with `.rith/`                                          |
| `bunfig.toml`       | 6                  | Comment says `@archon/core`               | Change to `@rith/core`                                         |
| `package.json` root | `name` field       | Verify it says `rith-engine` not `archon` | Fix if stale (bun.lock line 6 says `archon`)                   |

### 3.2 Files with `archon` in the filename

| File                                                                 | Action                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------- |
| `packages/docs-web/src/content/docs/reference/archon-directories.md` | Rename to `rith-directories.md` or `directories.md`   |
| `packages/docs-web/src/content/docs/book/what-is-archon.md`          | Rename to `what-is-rith-engine.md` and update content |
| `packages/docs-web/public/brand/assets/archon-logo.png`              | Replace with rith logo or remove                      |

### 3.3 Database table prefix `remote_agent_`

- **Evidence:** All 8 tables use the `remote_agent_` prefix from Archon. Every SQL query in `packages/core/src/db/` hardcodes this prefix.
- **Action:** **Defer to a separate migration PR.** This is a high-risk rename touching ~60 SQL strings across 8 files plus their tests. Requires a migration script for existing user databases. Not blocking but should be tracked as tech debt.
- **Interim:** Add a comment in `sqlite.ts` schema creation explaining the prefix is inherited and will be renamed.

### 3.4 CLAUDE.md stale references

| Line(s) | What                                                                                        | Action                               |
| ------- | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| 5       | "AI client adapters (Claude, Codex)" in `core/index.ts` header comment                      | Change to "Pi Coding Agent provider" |
| 10-11   | "Platform Agnostic" / "Unified conversation interface across Slack/Telegram/GitHub/cli/web" | Remove — CLI is the only platform    |
| 11      | "Platform adapters implement `IPlatformAdapter`"                                            | Remove                               |
| 12      | "Stream/batch AI responses in real-time to all platforms"                                   | Remove                               |
| 370-377 | Adapter Authorization Pattern section                                                       | Remove entire section                |
| 468     | "Platform Adapters: Implement `IPlatformAdapter`"                                           | Remove                               |
| 476-502 | SDK Type Patterns referencing Claude Agent SDK                                              | Rewrite for Pi SDK patterns          |

### 3.5 `core/index.ts` header comment

- Line 5: Says "AI client adapters (Claude, Codex)". Change to reflect actual content: "Database operations, configuration, workflow store adapter, utility functions".

---

## Phase 4: Dead Exports and Over-Exported Surface

### 4.1 Clean up `packages/core/src/index.ts`

After Phases 1-2, the following exports should be removed:

```
- ConversationLockManager, LockAcquisitionResult  (Phase 1.1)
- getPort                                          (Phase 1.2)
- getLinkedIssueNumbers                            (Phase 1.3)
- classifyAndFormatError                           (Phase 1.4)
- sanitizeCredentials, sanitizeError               (Phase 1.5)
- toError                                          (verify — zero imports outside core)
```

**Exports the CLI actually uses** (keep these):

```
closeDatabase                    <- cli.ts
getDatabaseType                  <- version.ts
loadConfig, loadRepoConfig       <- workflow.ts, validate.ts
registerRepository               <- workflow.ts
createWorkflowStore              <- workflow.ts
```

**Exports used by isolation/workflows** (keep):

```
pool, getDatabase, getDialect    <- used by DB modules internally
codebaseDb, isolationEnvDb, workflowDb, workflowEventDb  <- namespace re-exports
workflowOperations, isolationOperations  <- used by CLI commands
cloneRepository, RegisterResult  <- used by workflow.ts
readConfigFile, loadGlobalConfig, clearConfigCache, logConfig, updateGlobalConfig  <- verify usage
syncRithToWorktree               <- verify (zero imports outside core found)
isPathWithinWorkspace, validateAndResolvePath  <- verify (zero imports in CLI/workflows/isolation found)
```

### 4.2 Verify and potentially remove `syncRithToWorktree`

- **Evidence:** Exported from `core/index.ts:95`. Zero imports found in CLI, workflows, isolation, or providers. Only imported by its own test.
- **Action:** Check if it's called indirectly (e.g., through `workflowOperations` or `isolationOperations`). If not, delete.

### 4.3 Verify and potentially remove `isPathWithinWorkspace` / `validateAndResolvePath`

- **Evidence:** Exported from `core/index.ts:89`. Zero imports found in CLI, workflows, isolation, or providers.
- **Action:** Check if called through operations modules. If not, delete.

---

## Phase 5: Dead Code in DB Query Layer

### 5.1 Audit every exported function in `packages/core/src/db/workflows.ts`

This is the largest DB module. Functions to verify:

| Function                                      | Suspected Status                                            |
| --------------------------------------------- | ----------------------------------------------------------- |
| `getWorkflowRunByWorkerPlatformId`            | **Dead** — zero callers, JOINs conversations                |
| `cancelRunningWorkflows`                      | Verify — may have been server-only (cancel all on shutdown) |
| Any function with `conversation_id` parameter | Verify — may need parameter removed                         |

### 5.2 Audit `packages/core/src/db/isolation-environments.ts`

| Function                   | Suspected Status                                                  |
| -------------------------- | ----------------------------------------------------------------- |
| `getConversationsUsingEnv` | **Dead** — zero callers outside test, queries conversations table |

---

## Phase 6: Provider Package Cleanup

### 6.1 Verify `packages/providers/src/pi/ui-context-stub.ts`

- **Evidence:** Name suggests it's a stub for UI context that the web UI would have provided.
- **Action:** Read the file. If it stubs out web-UI-specific interfaces for CLI compatibility, it may still be needed. If it's dead, delete.

### 6.2 Verify all MessageChunk variants are used

- **Evidence:** `types.ts` defines MessageChunk as a discriminated union with variants: `text`, `system`, `thinking`, `result`, `rate_limit`, `tool_call`, `workflow_dispatch`.
- **Action:** Search for each variant's `type:` literal in the codebase. Remove any variant that is never constructed or pattern-matched.

### 6.3 Remove Claude/Codex references from provider types

- **Evidence:** `ProviderDefaults` in `types.ts` may still have fields or comments referencing Claude/Codex capabilities.
- **Action:** Audit and clean.

---

## Phase 7: Documentation Cleanup

### 7.1 CLAUDE.md full audit

Beyond the items in 3.4, audit every section for:

- References to `/reset`, `/help`, `/status` as chat commands (these are now CLI subcommands or removed)
- References to "orchestrator treats only these top-level commands as deterministic" (line 381) — orchestrator is dead in CLI-only mode
- The "Adapter Authorization Pattern" section (lines 370-377) — removed
- "unified conversation interface across Slack/Telegram/GitHub/cli/web" (line 11) — removed
- SDK Type Patterns referencing `@anthropic-ai/claude-agent-sdk` (line 480)

### 7.2 docs-web content audit

- `book/what-is-archon.md` — rename and rewrite
- `reference/archon-directories.md` — rename
- Any deployment docs referencing Docker, docker-compose, server setup, cloud deployment
- Any getting-started docs referencing web UI, multi-provider setup, adapter configuration
- `reference/database.md` — update to reflect CLI-only reality

### 7.3 Remove `.env.example` if it exists

- **Evidence:** Root `.env.example` was not found in the tree listing, but check if docs reference it.
- **Action:** If any `.env.example` exists with server/adapter config, clean it.

---

## Phase 8: Test Cleanup

### 8.1 Remove tests for deleted modules

Each deletion in Phases 1-5 has a corresponding `.test.ts` file. Remove them:

- `conversation-lock.test.ts`
- `port-allocation.test.ts`
- `github-graphql.test.ts`
- `error-formatter.test.ts`
- `credential-sanitizer.test.ts` (if exists)

### 8.2 Update test batch configuration

`packages/core/package.json` has a `test` script that runs specific test files in separate `bun test` invocations (to avoid mock pollution). After deleting test files, remove their entries from the test script.

### 8.3 Verify all remaining tests pass

After all deletions, run `bun run test` from repo root to verify nothing broke.

---

## Phase 9: Logger Naming Hygiene (Low Priority)

### 9.1 Fix inconsistent logger names

| File                                          | Current Name    | Should Be                                  |
| --------------------------------------------- | --------------- | ------------------------------------------ |
| `isolation/src/worktree-copy.ts`              | `worktree-copy` | `isolation.worktree-copy`                  |
| `workflows/src/utils/idle-timeout.ts`         | `idle-timeout`  | `workflow.idle-timeout`                    |
| `core/src/operations/isolation-operations.ts` | `operations`    | `operations.isolation`                     |
| `core/src/operations/workflow-operations.ts`  | `operations`    | `operations.workflow`                      |
| `cli/src/commands/version.ts`                 | `cli:version`   | `cli.version` (colon vs dot inconsistency) |

### 9.2 Remove loggers in dead code

After Phase 1 deletions, the following loggers disappear: `conversation-lock`, `github-graphql`, `port-allocation`. This reduces `createLogger()` edges from 45 to 42.

---

## Phase 10: Structural Improvements (Future)

These are not cleanup but architectural improvements surfaced by the analysis. Track as separate issues.

### 10.1 Remove `core/types/index.ts` re-exports of workflow schema types

- `ModelReasoningEffort`, `WebSearchMode`, `EffortLevel`, `ThinkingConfig`, `SandboxSettings` are re-exported from core but defined in `@rith/workflows/schemas/`. This creates a reverse dependency (core -> workflows). Consumers should import directly from `@rith/workflows/schemas/`.
- **Action:** Find all importers of these types from `@rith/core`, redirect to `@rith/workflows/schemas/*`, then remove the re-exports.

### 10.2 Consider splitting `@rith/paths`

The package contains path resolution, logging, telemetry, update-checking, env-loading, bundled-build detection, and CWD stripping. "Paths" undersells its role as the infrastructure kernel. Options:

- Rename to `@rith/infra` or `@rith/foundation`
- Or accept the name and document it as "leaf infrastructure utilities"

### 10.3 Rename `remote_agent_` table prefix

See Phase 3.3. Track as separate PR with migration script.

### 10.4 Simplify `@rith/core` by extracting DB into `@rith/db`

`@rith/core` is the least cohesive package. Extracting DB adapters, connection management, and query modules into `@rith/db` would leave core with just config, operations, and the store-adapter bridge.

---

## Execution Order

```
Phase 1  (Dead utility modules)     -- independent, can be parallelized
Phase 2  (Dead DB code)             -- depends on Phase 1 for clean removal
Phase 3  (Archon naming)            -- independent of Phases 1-2
Phase 4  (Dead exports)             -- depends on Phases 1-2
Phase 5  (DB query audit)           -- part of Phase 2, listed separately for tracking
Phase 6  (Provider cleanup)         -- independent
Phase 7  (Docs)                     -- independent, can be parallelized with everything
Phase 8  (Tests)                    -- depends on Phases 1-5
Phase 9  (Logger naming)            -- independent, low priority
Phase 10 (Structural)               -- future work, separate PRs
```

**Parallel batches:**

- Batch A: Phase 1 + Phase 3 + Phase 6 + Phase 7 (all independent)
- Batch B: Phase 2 + Phase 4 + Phase 5 (depend on Phase 1)
- Batch C: Phase 8 (verify everything passes)
- Batch D: Phase 9 + Phase 10 (polish)

---

## Estimated Deletions

| Category                     | Files           | Lines (est.)     |
| ---------------------------- | --------------- | ---------------- |
| Dead utility modules + tests | ~10             | ~800             |
| Dead DB functions + queries  | ~5 functions    | ~200             |
| Dead table DDL + migrations  | ~2 tables       | ~80              |
| Dead exports from index.ts   | ~8 export lines | ~8               |
| Stale CLAUDE.md sections     | --              | ~50              |
| Doc file renames             | 3 files         | --               |
| Config file fixes            | 4 files         | ~15              |
| **Total estimated removal**  | **~15 files**   | **~1,150 lines** |
