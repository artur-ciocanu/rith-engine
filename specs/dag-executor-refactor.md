# DAG Executor Refactor — Design (item 14 step 2 + item 15)

**Status:** Implemented (in-package structural refactor), 2026-06-08, behind a green
`bun run validate` (workflows 906/0; full gate green). Landed: the `NodeRunner` registry
(§2.1); `DagRunContext` (renamed from `DagExecutionContext`) + `NodeRunContext` (§2.2);
the `NodeGate` pipeline + `NodeEventSink` (§2.4–2.5); and `WorkflowRunAggregate` as the
**single mutator** of run status (§2.6) — all four status writes (cancel node, approval
pause, interactive-loop pause, approval on-reject cancel) now route through it. New files:
`dag/context.ts`, `dag/node-runner.ts`, `dag/run-aggregate.ts`. The runner classes, gate,
and sink currently live in `dag-executor.ts` (the `runners/` + `gate.ts`/`event-sink.ts`
file split in §5 is deferred: `gate.ts` would import `checkTriggerRule` from
`dag-executor.ts`, a cycle until the scheduler also moves).

**Deferred by decision (2026-06-08):** the `NodeRunResult` control-signal _flip_ (§2.3) and
the discriminated `WorkflowRunMetadata` (§3 / item 15). Runners still return
`{control:'continue'}`; cancel/pause stay in-band and the scheduler still breaks via the
between-layer DB re-read. Rationale: the flip moves status writes from during-layer to
after-layer, changing concurrent-cancel timing (a long AI node in the same layer as a
cancel node would no longer be cut short on its 10s cancel-poll) — not the "externally
identical" the rest of the refactor guarantees. The single-mutator step captures the
aggregate's value (one place writes run status) with **zero behavior change**; the flip +
metadata discriminant remain available as future work when that timing change is acceptable.

Sections below describe the full target design; **§2.3 and §3 are the deferred parts.**

**Scope:** `packages/workflows/src/dag-executor.ts`. Each implemented step preserved
observable behavior, verified by the full `bun run validate`.

---

## 1. Problem (grounded)

`dag-executor.ts` fuses two responsibilities with different lifecycles into one file:

- **Orchestration / scheduling** — `executeDagWorkflow` body (lines 2432–3083):
  topological layering (`buildTopologicalLayers`, 468), per-layer concurrency
  (`Promise.allSettled`, 2521), session threading (`lastSequentialSessionId`,
  2507/2868), retry-with-backoff (2785–2824), trigger-rule + `when` gating
  (2588/2621), prior-success resume skip (2527), skip/event emission, between-layer
  status checks (2890), terminal aggregation (3076), completion/failure writes
  (2973/3004/3033).
- **Per-node execution** — five module-private executors: `executeNodeInternal`
  (515), `executeBashNode` (1201), `executeScriptNode` (1378), `executeLoopNode`
  (1672), `executeApprovalNode` (2259).

Three concrete smells:

1. **Type-switch dispatch.** Lines 2703–2761 are an `if (isBashNode) … isLoopNode …
isApprovalNode … isCancelNode … isScriptNode … else AI` ladder. Adding a node
   kind edits this ladder → OCP violation.
2. **Duplicated gating + event boilerplate.** The prior-success skip (2527),
   trigger-rule skip (2588), and `when`-condition skip (2621) each repeat a
   near-identical `logNodeSkip` + `store.createWorkflowEvent` + `emitter.emit` block
   returning a `skipped` `NodeOutput`. ~5 copies.
3. **Control flow smuggled into node executors.** The cancel node (2726–2755) calls
   `deps.store.cancelWorkflowRun` _inside the per-node lambda_, returns a fake
   `completed` sentinel (2754), and relies on the between-layer status **re-read**
   (2892) to actually stop. Approval pauses the same way. A "node executor" mutates
   global run state and the loop rediscovers it via a DB round-trip.

This is **not** an AST/interpreter problem: the graph is scheduled (topo layers +
concurrency), nodes never own or recurse into children, and data flows through the
`nodeOutputs` blackboard (`Map<string, NodeOutput>`, 170) + `$nodeId.output`
substitution (285), not parent→child calls. So the model is a **scheduler (eval
loop) + node strategies + shared environment**, never `node.evaluate()`.

---

## 2. Target architecture

Five collaborators replace the monolith. The scheduler owns the loop; runners are
stateless strategies selected by a registry; gates and the event sink dedupe the
cross-cutting boilerplate; the aggregate is the single mutator of run status.

```
DagScheduler.run(ctx)
  for each topological layer:
    for each node (concurrently):
      NodeGate.evaluate(rc, node)        -> 'run' | { skip: reason }   (+ records skip via sink)
      NodeRunner = registry.get(kind)
      result = NodeRunner.run(rc, node)             // strategy, polymorphic
      NodeEventSink.recordResult(node, result)      // log + persist + emit, one place
      apply result.control via WorkflowRunAggregate // continue | cancel | pause
    between-layer external-status check (cancel/delete/pause from outside)
  terminal aggregation -> WorkflowRunAggregate.complete | .fail
```

**Naming convention (two roots, on purpose).** Names track the existing inner/outer
seam — `executeDagWorkflow` (node-graph eval) runs _inside_ `executeWorkflow`
(run lifecycle: isolation, resume, persistence, messaging). Keep that boundary:

- **DAG layer** (`Dag*` / `Node*`) — the node-graph execution model. `DagScheduler`,
  `DagRunContext`, `DagNode`, `buildTopologicalLayers`, and the node strategies
  `NodeRunner.run(NodeRunContext) → NodeRunResult`, `NodeGate` → `NodeGateDecision`,
  `NodeEventSink`, `NodeSkipReason`. "DAG" names the defining property (topologically
  layered dependency scheduling), so it is load-bearing, not noise.
- **Workflow layer** (`Workflow*`) — the run entity and its lifecycle, already an
  established family (`WorkflowRun`, `WorkflowDeps`, `WorkflowConfig`,
  `IWorkflowPlatform`, `executeWorkflow`). The aggregate root that wraps the persisted
  `WorkflowRun` belongs here: `WorkflowRunAggregate` (+ `WorkflowRunMetadata`).

Do **not** rename the scheduler `WorkflowScheduler` — it does not own isolation/resume/
run-creation (that is `executeWorkflow`'s job); it owns the graph schedule. Within each
layer, use the **Run** root and avoid `Execution` / `Outcome` synonyms.

### 2.1 `NodeRunner` strategy + registry (kills the type-switch)

The node **stays a pure Value Object** (`schemas/dag-node.ts`, Zod-validated;
consumed as data by loader/validator/router). No `execute()` on the schema type.
Behavior lives in runners.

```ts
// dag/node-runner.ts
export interface NodeRunner<N extends DagNode = DagNode> {
  run(rc: NodeRunContext, node: N): Promise<NodeRunResult>;
}

// dag/registry.ts
export type NodeKind = 'ai' | 'bash' | 'script' | 'loop' | 'approval' | 'cancel';
export function nodeKind(node: DagNode): NodeKind {
  /* reuse existing type guards */
}
export type NodeRunnerRegistry = Record<NodeKind, NodeRunner>;
export function buildNodeRunnerRegistry(deps: WorkflowDeps): NodeRunnerRegistry {
  return {
    ai: new AiNodeRunner(deps),
    bash: new BashNodeRunner(),
    script: new ScriptNodeRunner(),
    loop: new LoopNodeRunner(/* injects AiNodeRunner */),
    approval: new ApprovalNodeRunner(/* injects AiNodeRunner for on_reject */),
    cancel: new CancelNodeRunner(),
  };
}
```

Adding a node kind = new runner + one registry entry. The scheduler never changes.
**DI rule (pedantic, important):** stable collaborators go in the **constructor**;
per-run state goes in the **method argument**. Runners are stateless singletons.
`DagRunContext` is per-run (holds `workflowRun`, the mutating `nodeOutputs`
map) — it must **never** be constructor-injected, or run state leaks across runs.

### 2.2 `NodeRunContext` — ctx-first, carries scheduler per-node decisions

The per-run constants interface (today `DagExecutionContext`, 160–176) is renamed `DagRunContext` for symmetry, otherwise unchanged. Wrap it so
runners receive scheduler-derived per-node facts (session threading, parallelism)
without breaking the uniform interface. Honors the locked **ctx-first** convention
(#22): the context object is the first parameter.

```ts
// dag/context.ts
export interface NodeRunContext {
  readonly run: DagRunContext; // per-run constants (renamed from DagExecutionContext)
  readonly resumeSessionId: string | undefined; // scheduler session-threading decision (2775)
  readonly isParallelLayer: boolean;
}
```

This relocates the two dispatch-site specializations into the runners that own them:
`executeLoopNode`'s `loopModel` resolution (currently inlined at 2710–2713) moves
into `LoopNodeRunner` (it has `node.model`, `rc.run.workflowModel`,
`rc.run.config.pi?.model`); `executeNodeInternal`'s `resolveNodeModelAndOptions`
(2764) moves into `AiNodeRunner`. `envVars` is read from `rc.run.config.envVars` (no
longer threaded as a positional arg).

### 2.3 `NodeRunResult` — runners express intent, scheduler decides flow

The key contribution, and the output half of the `NodeRunContext` → `NodeRunResult`
input/output pairing. Cancel/approval stop _signalling through a DB re-read_ and
instead return a typed control intent; the scheduler (via the aggregate) performs
the status transition. `output` is the existing `NodeOutput` schema type
(workflow-run.ts:70); per-node cost moves onto the envelope — it was the only reason
the old `NodeExecutionResult = NodeOutput & { costUsd }` alias (line 153) existed, so
that alias is dropped.

```ts
// dag/node-runner.ts
export type NodeRunResult =
  | { control: 'continue'; output: NodeOutput; costUsd?: number } // completed | failed | skipped
  | { control: 'cancel'; reason: string; output: NodeOutput }
  | { control: 'pause'; approval: ApprovalContext; output: NodeOutput };
```

- Normal AI/bash/script/loop nodes → `continue` (failure is still `continue`; the
  scheduler's terminal aggregation, 2944–3026, decides whether the _run_ fails).
- `CancelNodeRunner` → `{ control: 'cancel', reason }`; no longer calls
  `store.cancelWorkflowRun` itself.
- `ApprovalNodeRunner` → `{ control: 'pause', approval }` carrying `ApprovalContext`
  (workflow-run.ts:117); no longer flips status itself.

LSP holds: every runner returns one `NodeRunResult`; the union expresses the
legitimate variation instead of overloading a fake `completed` sentinel.

### 2.4 `NodeGate` — dedupe the skip pipeline

A short chain-of-responsibility evaluated before dispatch. Each gate is a pure
predicate over `(rc, node)`; the scheduler records skips through the sink.

```ts
// dag/gate.ts
export type NodeGateDecision = 'run' | { skip: NodeSkipReason };
export interface NodeGate {
  evaluate(rc: NodeRunContext, node: DagNode): NodeGateDecision;
}
// PriorSuccessGate (2527; emits node_always_run_reset + returns 'run' on always_run),
// TriggerRuleGate (checkTriggerRule, 427), WhenConditionGate (evaluateCondition, 2621).
```

`NodeSkipReason` = `'prior_success' | 'trigger_rule' | 'when_condition' |
'when_condition_parse_error'` — exactly today's reason strings.

### 2.5 `NodeEventSink` — one place for log + persist + emit

Collapses every `logNodeSkip`/`store.createWorkflowEvent`/`emitter.emit` triple
(scattered across 2530–2616, 2733–2752, 2830–2846, etc.) into a single fabrication.
Owns the `.catch` error-logging policy currently copy-pasted at each call site.

```ts
// dag/event-sink.ts
export interface NodeEventSink {
  recordSkip(node: DagNode, reason: NodeSkipReason): void;
  recordResult(node: DagNode, result: NodeRunResult): void; // node_failed/completed/cancelled
  recordPreRunFailure(node: DagNode, err: Error): void; // 2827 catch path
}
```

### 2.6 `WorkflowRunAggregate` — single mutator of run status (GRASP aggregate root)

Centralizes the scattered status transitions (cancel 2746, fail 2973/3004, complete 3033) plus the `skipIfStatusChanged` guard + conditional emitter-unregister rule
(2934–2942: terminal states unregister; `paused` stays registered for SSE). This is
the seam for **item 15**.

```ts
// dag/run-aggregate.ts
export class WorkflowRunAggregate {
  constructor(
    private deps: WorkflowDeps,
    private run: WorkflowRun
  ) {}
  async cancel(reason: string): Promise<void>;
  async pause(meta: WorkflowRunMetadata & { kind: 'approval' | 'interactive_loop' }): Promise<void>;
  async complete(meta: WorkflowRunMetadata & { kind: 'completed' }): Promise<void>;
  async fail(error: string): Promise<void>;
  /** true if status changed externally; also performs the conditional unregister (2938). */
  async skipIfStatusChanged(logEvent: string): Promise<boolean>;
}
```

---

## 3. Item 15 — discriminated `WorkflowRun.metadata` threads through the outcome

Today `metadata` is `z.record(z.unknown())` (workflow-run.ts:107). The de-facto
variants already exist: `completeWorkflowRun` writes `{ node_counts, total_cost_usd? }`
(3034), `failWorkflowRun` writes `{ error }`, pause writes an `ApprovalContext`.
Item 15 makes the bag a tagged union and the aggregate the only writer:

```ts
export type WorkflowRunMetadata =
  | { kind: 'none' }
  | { kind: 'approval'; approval: ApprovalContext }
  | { kind: 'interactive_loop'; approval: ApprovalContext }
  | { kind: 'completed'; node_counts: NodeCounts; total_cost_usd?: number }
  | { kind: 'failed'; error: string };
```

The `{ control: 'pause', approval }` result (2.3) flows straight into
`aggregate.pause({ kind: 'approval', approval })`, which writes status **and**
discriminated metadata atomically — removing the current split where the approval
runner writes metadata and the scheduler/DB re-read handles status separately. This
is why 14 and 15 are entangled: the control-signal seam is where the discriminant
gets threaded, so they share one design rather than strictly sequencing.

**Compatibility:** reads of old untagged metadata must not throw. Keep
`isApprovalContext` (workflow-run.ts:140) as the read-side guard and add a
`parseWorkflowRunMetadata(raw): WorkflowRunMetadata` that maps legacy shapes to a
variant (default `{ kind: 'none' }`). Persisted shape changes only in this step.

---

## 4. Mapping the current executors

| Current (dag-executor.ts)    | Becomes                                             | Notes                                                       |
| ---------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| `executeNodeInternal` (515)  | `AiNodeRunner` + `resolveNodeModelAndOptions` (360) | Shared AI path; injected into loop + approval runners.      |
| `executeBashNode` (1201)     | `BashNodeRunner`                                    | Reads `envVars` from `rc.run.config`.                       |
| `executeScriptNode` (1378)   | `ScriptNodeRunner`                                  | Same.                                                       |
| `executeLoopNode` (1672)     | `LoopNodeRunner`                                    | Resolves its own `loopModel` (was inlined at 2710).         |
| `executeApprovalNode` (2259) | `ApprovalNodeRunner`                                | Returns `pause`; `on_reject` calls injected `AiNodeRunner`. |
| cancel branch (2726–2755)    | `CancelNodeRunner`                                  | Returns `cancel`; no direct `store` mutation.               |

**on_reject coupling resolved:** `executeApprovalNode` is the only executor that
calls a sibling (`executeNodeInternal` on the `on_reject` branch). With the registry,
`ApprovalNodeRunner` and `LoopNodeRunner` receive `AiNodeRunner` via constructor
injection — explicit dependency, no module-private cross-call.

**Retry stays AI-only (no behavior change).** The retry-with-backoff loop (2785) today
wraps only `executeNodeInternal`; bash/script/loop/approval/cancel are dispatched
before it and are never retried. Preserve exactly: the scheduler applies the retry
policy (`getEffectiveNodeRetryConfig`, 211) **only around the `ai` runner**.
Generalizing retry to all kinds is a deliberate future behavior change, explicitly
out of scope.

---

## 5. File layout

```
packages/workflows/src/dag/
  scheduler.ts        DagScheduler (the eval loop; owns layers/concurrency/session/retry/status checks)
  context.ts          DagRunContext (renamed from DagExecutionContext), NodeRunContext, WorkflowLevelOptions
  node-runner.ts      NodeRunner, NodeRunResult
  registry.ts         NodeKind, nodeKind(), NodeRunnerRegistry, buildNodeRunnerRegistry()
  gate.ts             NodeGate chain + NodeGateDecision + NodeSkipReason
  event-sink.ts       NodeEventSink
  run-aggregate.ts    WorkflowRunAggregate + WorkflowRunMetadata (item 15)
  runners/
    ai-node-runner.ts
    bash-node-runner.ts
    script-node-runner.ts
    loop-node-runner.ts
    approval-node-runner.ts
    cancel-node-runner.ts
```

`dag-executor.ts` stays as a **thin compatibility shim**: keep the exported
`executeDagWorkflow(...)` 16-param signature (called from `executor.ts:579`,
asserted by the 227 KB `dag-executor.test.ts`), have it build `ctx` (2467–2492) and
delegate to `new DagScheduler(...).run(ctx)`. Existing callers and tests stay
untouched until a later, separate cleanup. Pure utilities already exported and
unit-tested (`buildTopologicalLayers`, `checkTriggerRule`, `substituteNodeOutputRefs`,
`parseMcpFailureServerNames`) move to focused modules but keep their export identity.

---

## 6. Migration sequence (each step independently green)

1. **Result + runner interface, registry replaces the ladder.** Wrap each existing
   executor as a `NodeRunner` with zero logic change (cancel/approval still flip
   status internally for now; they return `control: 'continue'`). Scheduler stays in
   `dag-executor.ts`. Behavior identical. Largest mechanical step, biggest test
   safety net.
2. **Extract `NodeGate` + `NodeEventSink`.** Dedupe the 5 skip blocks and the
   log+persist+emit triples. Behavior identical.
3. **Introduce `WorkflowRunAggregate`.** Move scattered status writes +
   `skipIfStatusChanged` + conditional unregister behind it. Same guards (e.g.
   `cancelWorkflowRun`'s terminal-state guard already in `db/workflows.ts`).
4. **Flip cancel/approval to control signals.** Runners stop mutating status; return
   `cancel`/`pause`; scheduler calls the aggregate. Keep the between-layer re-read
   **only** for _external_ cancel/delete/pause (2890). Externally identical.
5. **Item 15.** Aggregate transition methods take discriminated `WorkflowRunMetadata`;
   widen the schema; add `parseWorkflowRunMetadata` read shim. Only step that touches
   a persisted shape.
6. **(Optional) collapse the shim.** Inline `executeDagWorkflow` into the scheduler
   and update `executor.ts` + tests. Defer; not required for the win.

---

## 7. Non-goals / explicit rejections

- **No Visitor / double-dispatch.** Six flat kinds need a registry, not a visitor.
- **No `evaluate()` / `execute()` on the node schema type.** The node is a VO consumed
  as data by loader/validator/router; bolting execution + `WorkflowDeps` onto it
  violates SRP and couples the schema layer to the runtime layer.
- **No per-run state in runner constructors.** Stateless singletons; run context is a
  method argument.
- **No retry-scope change**, no change to `$nodeId.output` substitution, topological
  layering, session-threading semantics, or the throttled cancel/activity checks.

---

## 8. What this buys (testability dividend)

The registry is injectable, so `DagScheduler` becomes testable with **fake runners** —
today the scheduler cannot be exercised without the real five executors (and their
SDK/subprocess collaborators). Per-runner test files mock shared deps via
`src/test-mock-module.ts` (`mockModuleScoped`, never a bare `mock.module`), and
coexist in the single-process `bun test` (item 16 / #18). New scheduler tests assert
layer ordering, control-signal handling (cancel breaks, pause keeps emitter
registered), gate skips, and retry scope against fakes — coverage that is currently
impossible.

**Verification per step:** `cd packages/workflows && bun test` (906 baseline, single
process) + full `bun run validate`. Each step holds the baseline green.
