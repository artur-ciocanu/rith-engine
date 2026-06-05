# Architectural Review — Rith Engine

**Date:** 2026-06-03
**Commit:** `043f823d`
**Lenses:** DDD, GRASP, SOLID
**Dimensions:** Data Modeling, Concurrency, Security, Performance, Observability

---

## Overall Architecture Snapshot

A CLI-only DAG workflow engine forked from Archon, stripped to a single AI provider (Pi), with a monorepo of 7 packages: `core` (DB + config + ops), `workflows` (schemas + executor + DAG engine), `providers` (Pi adapter), `cli`, `git`, `isolation`, `paths`. Post-fork cleanup removed ~95k lines of dead multi-provider, web UI, server, adapter, and Docker code.

---

## 1. Data Modeling

### Strengths

- Zod schemas are the single source of truth for runtime types (`WorkflowRun`, `DagNode`, `NodeOutput`). The `nodeOutputSchema` uses a discriminated union on `state`, and there's an explicit compile-time assertion (`AssertNodeOutputCoversNodeState`) that forces updates when `NodeState` gains new variants. That's textbook.
- `IWorkflowStore` is a clean domain trait — the workflow engine depends on a narrow 14-method interface, not on `@rith/core` directly. The store-adapter bridge (`createWorkflowStore`) satisfies it structurally. GRASP Information Expert is applied correctly here.
- `WorkflowDeps` is minimal: `{ store, getAgentProvider, loadConfig }`. Good restraint — it's a Composition Root, not a service locator.

### Concerns

| Issue                                           | Severity | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ghost entity: `Codebase`**                    | Medium   | `Codebase` in `core/types/index.ts` is an anemic struct with no domain behavior. It's just a DTO mirroring the DB row. The `commands` field is `Record<string, { path, description }>` — a JSON blob stored in a TEXT column with zero schema enforcement. If a codebase's command map goes stale or invalid, the system silently uses garbage. This violates DDD's "make illegal states unrepresentable" principle.                                                                                                                                                             |
| **`metadata` is `Record<string, unknown>`**     | Medium   | `WorkflowRun.metadata` is an opaque JSON bag. Approval context, node counts, cost, and prior completed nodes are all shoved in. This is a schemaless extension point pretending to be structured data. Any consumer must do runtime type narrowing (`isApprovalContext`), which breaks at silent corruption — a misspelled key is invisible. Consider discriminating metadata by status (e.g., `PausedMetadata`, `CompletedMetadata`).                                                                                                                                           |
| **`remote_agent_` table prefix**                | Low      | Acknowledged as tech debt in the code. The legacy naming leaks Archon provenance into every SQL query. Not architectural, but erodes trust in schema ownership.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **No aggregate root for WorkflowRun lifecycle** | Medium   | `workflowDb` is a bag of free functions with no transactional invariant enforcement. `pauseWorkflowRun` can be called on a `completed` run — the function does `UPDATE ... SET status = 'paused'` with no `WHERE status = 'running'` guard. Same for `cancelWorkflowRun`. The state machine (`pending → running → paused/completed/failed/cancelled`) is enforced ad-hoc by callers, not by the model. This is a DDD aggregate root violation — the invariant "only running runs can be paused" should be enforced at the model boundary, not scattered across the DAG executor. |

---

## 2. Concurrency

### Strengths

- DAG layers use `Promise.allSettled` for parallel node execution — correct: a failing node doesn't nuke its siblings.
- Session threading is well-reasoned: parallel layers always get fresh sessions; sequential layers thread `lastSequentialSessionId` forward. The comment at line 2842 (`context: 'fresh'`) shows deliberate design.
- Cancel/status checks between layers are throttled (`CANCEL_CHECK_INTERVAL_MS = 10s`) and non-fatal — good resilience.

### Concerns

| Issue                                                         | Severity | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module-level mutable singletons**                           | High     | `lastNodeCancelCheck`, `lastNodeActivityUpdate` (both `Map<string, number>`) are module-level globals. If two `executeDagWorkflow` calls ever run concurrently in the same process (e.g., two CLI invocations via a hypothetical server or test runner), these maps cross-contaminate. The throttle state for run A's cancel check bleeds into run B. These should be scoped per-run, not per-module.                                                                                                                      |
| **`nodeOutputs` shared across parallel nodes**                | Medium   | Within a layer, all nodes read from the same `nodeOutputs` Map. This is safe **today** because parallel nodes only read upstream outputs and write their own `nodeId` key after completion (line 2953). But there's no structural guarantee — a future refactoring that adds mid-execution writes from parallel nodes would introduce a data race. `Map` reads/writes are not atomic in JS when interleaved with awaits. Consider making the map immutable for the layer and collecting results in a separate accumulator. |
| **`WorkflowEventEmitter` is a global singleton**              | Medium   | `getWorkflowEventEmitter()` returns a process-wide singleton backed by Node's `EventEmitter`. The `unregisterRun` cleanup is manual and failure-path-dependent (lines 3024-3026). If an exception skips the unregister call, listeners leak. In long-running processes this would be a slow memory bleed. The emitter should use a `try/finally` pattern or scope listeners to run lifetime via `AbortSignal`.                                                                                                             |
| **SQLite has no connection pooling / no write serialization** | Medium   | `SqliteAdapter` wraps a single `bun:sqlite` `Database` instance. WAL mode is enabled (line 30), which allows concurrent reads, but writes are still serialized at the SQLite level. The fire-and-forget `.catch()` pattern on `createWorkflowEvent` means multiple parallel nodes can issue overlapping writes. In WAL mode this won't corrupt data, but it can cause `SQLITE_BUSY` under load with no retry logic.                                                                                                        |

---

## 3. Security

### Strengths

- `shellQuote()` (line 223) properly handles single-quote escaping for bash injection prevention.
- `shellQuoteOrFile()` uses a file-based fallback for large outputs (>32KB), avoiding argv overflow.
- `formatSubprocessFailure` sanitizes error messages before logging/display — no raw stack traces to users.
- `credentialSanitizer` exists and is exported from core.

### Concerns

| Issue                                               | Severity             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bash nodes execute arbitrary user-supplied code** | High (accepted risk) | `executeBashNode` runs `bash -c <finalScript>` where `finalScript` comes from the workflow YAML's `bash:` field, after variable substitution. This is **by design** — workflows are trusted authored artifacts. But the `$nodeId.output` substitution injects upstream node output into the shell via `shellQuote`, and `substituteNodeOutputRefs` has an `escapedForBash = true` path. If a compromised upstream node returns output containing `$()` or backtick sequences, the `shellQuote` single-quoting prevents evaluation — but only if the workflow author doesn't double-interpolate (e.g., `bash: echo $my_node.output` without quotes). The engine correctly quotes for `$nodeId.output` references, but raw `$ARGUMENTS` and `$USER_MESSAGE` are injected into env vars and are shell-expanded if the script references them unquoted. **Document this trust boundary clearly in the authoring guide.** |
| **Env var injection surface**                       | Medium               | Lines 1258-1272 spread `process.env` into the subprocess env, then overlay workflow-specific vars. A workflow with `env: { PATH: "/evil" }` could hijack the subprocess's PATH. No allowlisting of which env vars can be overridden.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **No YAML schema validation before execution**      | Low                  | `parseDagNode` validates structure via Zod, but the `bash:` content is an opaque string. There's no static analysis or sandboxing. The `sandbox` field exists in the schema but is not enforced in `executeBashNode`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **SQLite path from env**                            | Low                  | The SQLite DB path defaults to `~/.rith/data/rith.db`. If `DATABASE_URL` is set, it switches to PostgreSQL. But the SQLite path is constructed from `getRithHome()` which reads `RITH_HOME` env var — an attacker with env control could redirect the DB to an arbitrary location. Low severity since local CLI tool.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

---

## 4. Performance

### Strengths

- Lazy logger initialization (`let cachedLog; function getLog()`) avoids unnecessary allocations — consistent pattern across all modules.
- `buildTopologicalLayers` uses Kahn's algorithm (O(V+E)), correct and efficient for DAG scheduling.
- `NODE_OUTPUT_FILE_THRESHOLD = 32KB` prevents shell argument overflow — pragmatic.
- Activity heartbeat writes are throttled to 60s intervals (`ACTIVITY_HEARTBEAT_INTERVAL_MS`).

### Concerns

| Issue                                                    | Severity               | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3170-line god file**                                   | High (maintainability) | `dag-executor.ts` is 3170 lines with 8 functions taking 10-15 parameters each. `executeNodeInternal` alone is ~700 lines. This is a GRASP Controller violation — the DAG executor is a single class responsible for bash execution, script execution, loop management, approval gates, cancel handling, MCP config loading, session threading, retry logic, cost tracking, log writing, event emission, and variable substitution. Extract at minimum: `BashNodeRunner`, `ScriptNodeRunner`, `LoopNodeRunner`, `ApprovalNodeRunner` as separate modules with a shared `NodeExecutionContext` parameter object. |
| **Parameter object anti-pattern**                        | Medium                 | Every `execute*Node` function takes the same 12+ positional parameters (`deps, platform, conversationId, cwd, workflowRun, node, artifactsDir, logDir, baseBranch, docsDir, nodeOutputs, ...`). This is a textbook case for a `DagExecutionContext` parameter object. The current signature is error-prone and resists refactoring.                                                                                                                                                                                                                                                                            |
| **`allDependencies` computed from scratch on every run** | Low                    | Line 3162: `new Set(workflow.nodes.flatMap(n => n.depends_on ?? []))` — computed at the end of every run to find terminal nodes. Negligible for typical DAG sizes (<100 nodes), but the set could be precomputed alongside `buildTopologicalLayers`.                                                                                                                                                                                                                                                                                                                                                           |
| **Synchronous `writeFileSync` in async context**         | Low                    | Line 8: `import { writeFileSync } from 'fs'` — used for artifact/log writes from within async node execution. This blocks the event loop during file I/O. Use `writeFile` from `fs/promises`.                                                                                                                                                                                                                                                                                                                                                                                                                  |

---

## 5. Observability

### Strengths

- **Dual-channel observability**: Every node lifecycle event is recorded both as a DB event (`createWorkflowEvent`) and as an in-process emission (`WorkflowEventEmitter`). The DB provides durability; the emitter provides real-time streaming. Smart separation.
- **Fire-and-forget with explicit error logging**: Event persistence uses `.catch()` with structured logging (`workflow_event_persist_failed`), never silently swallowing. The `IWorkflowStore.createWorkflowEvent` contract explicitly states "MUST NOT throw."
- **Structured log keys are consistent**: `workflowRunId`, `nodeId`, `eventType`, `durationMs` — grep-friendly, machine-parseable.
- **Cost tracking**: `totalCostUsd` is accumulated per-run and stored in completion metadata. Good for operational visibility.
- Activity heartbeats (`updateWorkflowActivity`) enable stale/zombie run detection.
- `logNodeStart`, `logNodeComplete`, `logNodeError`, `logNodeSkip`, `logWorkflowComplete`, `logWorkflowError` — filesystem logs as a crash-recovery audit trail independent of the DB.

### Concerns

| Issue                                    | Severity | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **No distributed tracing / correlation** | Medium   | There's no trace ID or span propagation. A workflow run has `workflowRun.id`, but individual node executions within parallel layers share no parent-child span relationship. If you're debugging why a parallel layer took 5 minutes, there's no way to see which node was the bottleneck without correlating timestamps across log lines. Add OpenTelemetry spans or at minimum a `layerIdx` + `nodeId` composite key to the structured logs (partially present, but inconsistent). |
| **Event emitter has no backpressure**    | Low      | `WorkflowEventEmitter.emit()` is synchronous fanout to all listeners. If a listener blocks (e.g., a slow SSE flush), it blocks the executor. For a CLI tool this is academic; for any future server mode it becomes a latency hazard.                                                                                                                                                                                                                                                |
| **No metrics surface**                   | Low      | No Prometheus/StatsD counters for node execution rate, failure rate, retry count, or cost distribution. The data exists in DB events but requires post-hoc querying. For operational use, consider emitting counters from the event emitter.                                                                                                                                                                                                                                         |

---

## Summary Verdict

| Dimension         | Grade | Key Issue                                                                                              |
| ----------------- | ----- | ------------------------------------------------------------------------------------------------------ |
| **Data Modeling** | B-    | Missing aggregate root for WorkflowRun lifecycle; `metadata` bag; anemic `Codebase`                    |
| **Concurrency**   | B     | `Promise.allSettled` is correct; module-level mutable state is the primary hazard                      |
| **Security**      | B     | Shell quoting is solid; env var injection and trust boundary documentation need work                   |
| **Performance**   | C+    | The 3170-line god file is the main concern; actual runtime perf is fine for DAG sizes seen in practice |
| **Observability** | A-    | Dual-channel event system is well-designed; missing distributed tracing and metrics emission           |

The post-fork cleanup was aggressive and effective — 95k lines removed, multi-provider indirection collapsed to a single `PiProvider`, hexagonal port interfaces retained. The remaining architectural debt is concentrated in `dag-executor.ts` (god file) and the `WorkflowRun` lifecycle (no aggregate root). Both are tractable and should be addressed before the codebase grows further.

---

## Recommended Priority Actions

1. **Extract `DagExecutionContext` parameter object** — collapses 12+ positional params into a single typed struct; unblocks all subsequent refactors.
2. **Extract node runners** (`BashNodeRunner`, `ScriptNodeRunner`, `LoopNodeRunner`, `ApprovalNodeRunner`) from `dag-executor.ts` — each becomes a focused module with the shared context.
3. **Add `WHERE status = 'running'` guards** to `pauseWorkflowRun`, `cancelWorkflowRun`, `completeWorkflowRun` — enforces the state machine at the DB layer.
4. **Scope throttle maps per-run** — move `lastNodeCancelCheck` and `lastNodeActivityUpdate` into the `executeDagWorkflow` closure.
5. **Discriminate `WorkflowRun.metadata`** — replace `Record<string, unknown>` with a tagged union keyed on `status`.
6. **Document the bash node trust boundary** in the workflow authoring guide.
7. **Allowlist overridable env vars** in bash/script node execution.
