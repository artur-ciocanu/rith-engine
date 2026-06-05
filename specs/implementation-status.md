# Implementation Status — Spec Fixes

**Purpose:** Resumption log for the work driven by `architectural-review.md` and
`configuration-and-models.md`. Records what is DONE, the DECISIONS made (and why),
and what REMAINS — so future sessions continue from here instead of re-deriving.

**Base commit:** `043f823` (`refactor: remove provider field from workflow and node schemas (#8)`)
**Status as of:** 2026-06-04 — changes below are in the working tree (not yet committed).

---

## Progress at a glance

| #   | Item                                                  | Source       | Status              |
| --- | ----------------------------------------------------- | ------------ | ------------------- |
| 1   | Bundled workflow model refs (14 files)                | config §5/§7 | ✅ Done             |
| 2   | Provider "requires a model" error message             | config §7    | ✅ Done             |
| 3   | Config schema `provider:` → `pi:` block               | config §2    | ✅ Done             |
| 4   | Drop `env` + `interactive` config knobs               | user         | ✅ Done             |
| 5   | Extension `notify()` forwarding (kept, unconditional) | user         | ✅ Done             |
| 6   | Dead `w.provider` CLI display removed                 | arch/cleanup | ✅ Done             |
| 7   | Config docs rewrite (`ai-assistants.md`, etc.)        | config §6    | ⬜ Not started      |
| 8   | `RITH_MODEL` env override (`applyEnvOverrides`)       | config §7    | ⬜ Not started      |
| 9   | `rith doctor` config→Pi validation                    | config §7    | ⬜ Not started      |
| 10  | `rith setup` auth.json detection                      | config §7    | ⬜ Not started      |
| 11  | State-machine `WHERE status='running'` guards         | arch #3      | ⬜ Not started      |
| 12  | Per-run throttle maps (de-globalize)                  | arch #4      | ⬜ Not started      |
| 13  | Event-emitter `try/finally` cleanup                   | arch         | ⬜ Not started      |
| 14  | `DagExecutionContext` param object + god-file split   | arch #1/#2   | ⬜ Deferred (large) |
| 15  | Discriminate `WorkflowRun.metadata`; aggregate root   | arch         | ⬜ Deferred (large) |

## Decisions made (authoritative — do not re-litigate)

### Config schema: `pi:` block, not top-level `model:` (overrides the spec's proposal)

`configuration-and-models.md` proposed flattening to a top-level `model:` and
**deleting `ProviderDefaults` + all Pi runtime knobs**. We investigated the code and
**rejected the deletion**: `enableExtensions`, `interactive`, `extensionFlags`, `env`,
and `maxConcurrent` are live, tested features consumed by `PiProvider.sendQuery` via
`assistantConfig` (= Rith's config block). There is **no Pi-side config path** in this
repo for them — deleting them removes functionality, not duplication.

**Chosen shape — a `pi:` block holding model + execution-policy knobs:**

```yaml
pi:
  model: anthropic/claude-sonnet-4-5 # default model ref
  enableExtensions: false # trust gate over Pi's native ~/.pi discovery
  extensionFlags: { plan: true } # pi --<flag> pass-through
  maxConcurrent: 4 # Rith orchestration: cap concurrent session.prompt()
```

**Knobs KEPT** (Rith-side policy Pi cannot self-manage):

- `maxConcurrent` — semaphore across parallel DAG nodes; Pi has no notion of the DAG.
- `enableExtensions` — trust gate; Rith suppresses Pi's native discovery by default.
- `extensionFlags` — per-session flag values.

**Knobs DROPPED** (per user — CLI-first, low value):

- `interactive` (the **config knob**) — removed. It used to toggle whether a UI
  context was bound. Binding is now **unconditional** when `enableExtensions` is on
  (see below), so the toggle is gone but its _useful_ effect (notify forwarding) is the
  always-on default.
- `env` — provider-level env injection; overlaps shell env. (NOTE: repo-level
  `env:` / `envVars` for bash subprocesses is a **separate** channel and stays.)

**Extension `notify()` forwarding — KEPT (revised decision, 2026-06-04).**
First removed with `interactive`, then restored after confirming the loss was
problematic. SDK constraint (verified in `pi-coding-agent@0.67.5`
`dist/core/extensions/runner.js`): `hasUI() === (uiContext !== noOpUIContext)` — i.e.
forwarding `notify()` _requires_ binding a custom uiContext, which forces `hasUI=true`.
The two cannot be separated in this SDK version (print-mode binds none → hasUI=false,
notify dropped; rpc-mode binds one → hasUI=true, notify works). Decision: bind the
notify-forwarding `createRithUIContext` **unconditionally when `enableExtensions` is
true**. Consequence: `hasUI=true`, so `hasUI`-gated extension flows (e.g. plannotator
review URLs) engage again. This is harmless — the stub's interactive prompts resolve
falsy/non-blocking and TUI setters no-op; only genuine TUI features are absent.
No knob to disable forwarding-while-keeping-extensions (was the old `interactive: false`);
re-add a knob only if a concrete need appears.

Rationale in full: auth (`auth.json`) and the model catalog (`models.json`) are 100%
Pi-owned and Rith already never duplicates them. The kept knobs are orchestration/trust
policy, a different category from catalog/auth.

### Model refs

Bare names (`sonnet`, `opus`, `haiku`, `opus[1m]`) hard-fail under Pi. Mapping used:
`haiku → anthropic/claude-haiku-4-5`, `sonnet → anthropic/claude-sonnet-4-5`,
`opus`/`opus[1m]`/`claude-opus-4-6[1m]` → `anthropic/claude-opus-4-5`.
Only `anthropic/claude-haiku-4-5` is test-verified; others assume catalog presence
(run `pi models` to confirm). Per-node model tiering was preserved (not removed).

---

## DONE

### Priority 1 — runtime breakage (config spec §5, §7)

- **14 bundled workflows** in `.rith/workflows/defaults/` — 28 bare model names → Pi refs.
- **Regenerated** `packages/workflows/src/defaults/bundled-defaults.generated.ts`
  (`bun run generate:bundled`; `bun run check:bundled` green).
- **Error message** `packages/providers/src/pi/provider.ts` — dead `assistants.pi.model`
  → `pi.model`.

### Config migration: `provider` → `pi`, drop `env`+`interactive`

- `packages/providers/src/types.ts` — `ProviderDefaults` renamed `PiDefaults`; removed
  `interactive` and `env` fields (kept index signature + model/enableExtensions/
  extensionFlags/maxConcurrent).
- `packages/providers/src/pi/config.ts` — `parseProviderConfig` returns `PiDefaults`;
  dropped `interactive`/`env` parsing. (Function name unchanged.)
- `packages/providers/src/index.ts`, `packages/providers/src/pi/index.ts` — re-export rename.
- `packages/providers/src/pi/provider.ts` — removed the `env`→`process.env` injection
  block and stale `assistants.pi.*` comments. Removed the `interactive` config knob, but
  now binds the notify-forwarding `createRithUIContext` **unconditionally** when
  `enableExtensions` is true (`uiBridge = enableExtensions ? createRithUIBridge() : undefined`;
  `bindExtensions({ uiContext })`; `uiBridge` threaded into `bridgeSession`).
- `packages/providers/src/pi/event-bridge.ts` — `bridgeSession` keeps the optional
  `uiBridge?: BridgeNotifier` param + `setEmitter` wiring (removed then restored with the
  notify decision). (Also fixed 2 pre-existing missing semicolons on lines 5/197.)
- `packages/providers/src/pi/ui-context-stub.ts` + `.test.ts` — **kept** (initially
  deleted, then restored for notify forwarding). Only fixed a pre-existing missing
  semicolon. Still listed in `packages/providers/package.json` test script.
- `packages/providers/src/pi/resource-loader.ts` — updated the `hasUI` doc comment to
  reflect that the provider binds a notify-forwarding UI context (`hasUI` is true).
- `packages/core/src/config/config-types.ts` — `provider?`/deprecated `pi?` →
  single `pi?: PiDefaults` on Global/Repo; `MergedConfig.provider` → `pi`.
- `packages/core/src/config/config-loader.ts` — `getDefaults`, `mergeGlobalConfig`,
  `mergeRepoConfig`, `logConfig`, `updateGlobalConfig`, and `DEFAULT_CONFIG_CONTENT`
  template all use `pi`. Removed the deprecated-`pi`-alias spread.
- `packages/workflows/src/deps.ts` — `WorkflowConfig.provider` → `pi` (keeps the
  store-adapter compile-time `MergedConfig ⊆ WorkflowConfig` assertion valid).
- `packages/workflows/src/dag-executor.ts` (4 sites) + `packages/workflows/src/executor.ts`
  — `config.provider` → `config.pi`.
- `packages/cli/src/commands/workflow.ts` — removed dead `w.provider` display + the
  `provider?` field on `WorkflowJsonEntry` (referenced the already-removed workflow
  `provider` field; was a pre-existing type error).

### Tests updated

- `packages/providers/src/pi/config.test.ts` — removed interactive/env cases.
- `packages/providers/src/pi/provider.test.ts` — replaced the 4 `interactive`/UIContext
  tests with 2: (a) `enableExtensions` default binds a notify-forwarding uiContext
  (asserts `uiContext` defined + `notify` is a function), (b) `enableExtensions: false`
  skips `bindExtensions`. Removed 2 env-injection tests. `ui-context-stub.test.ts` kept.
- `packages/core/src/config/config-loader.test.ts` — assertions/inputs use `pi`.

### Verification (passing)

- `bun run type-check`: all touched packages clean (only the pre-existing `cli.ts:353`
  error remains — see below).
- Tests: providers 221 (lazy-load 1 + main 195 + shared 25), core `src/config/` 29,
  workflows executor+dag-executor+bundled 318.
- ESLint + Prettier clean on all edited files.

---

## REMAINING

### From `configuration-and-models.md`

- **§6 docs (not started):** `packages/docs-web/src/content/docs/` still describes the
  old world. Known stale refs:
  - `getting-started/ai-assistants.md` — `assistants.pi.*`, `~/.pi/agent/settings.json` precedence.
  - `getting-started/configuration.md` — `claude: { model: sonnet ... }` block.
  - `reference/configuration.md` and `guides/authoring-workflows.md` — `provider:`, bare
    model names, `opus[1m]`, `assistants.claude.model`.
    Update to the `pi:` block + Pi-format refs.
- **§7 Priority 3 DX (not started):**
  - Wire `applyEnvOverrides()` (currently a no-op in `config-loader.ts`) to support a
    `RITH_MODEL` env override of `pi.model`.
  - `rith doctor`: validate config → parse model ref → check Pi catalog/credentials.
  - `rith setup`: detect `~/.pi/agent/auth.json` and guide the user.

### From `architectural-review.md` (none started)

Recommended next, low-risk/high-value first:

1. **State-machine guards** — add `WHERE status = 'running'` to `pauseWorkflowRun`,
   `cancelWorkflowRun`, `completeWorkflowRun` in `packages/core/src/db/workflows.ts`.
2. **Per-run throttle maps** — move module-level `lastNodeCancelCheck` /
   `lastNodeActivityUpdate` (`dag-executor.ts`) into the `executeDagWorkflow` closure.
3. **Event-emitter cleanup** — `try/finally` (or `AbortSignal`) around `unregisterRun`.
   Large/deferred (explicitly NOT low-risk): extract `DagExecutionContext` param object and
   split `dag-executor.ts` (3170-line god file) into `BashNodeRunner`/`ScriptNodeRunner`/
   `LoopNodeRunner`/`ApprovalNodeRunner`; discriminate `WorkflowRun.metadata` by status;
   add aggregate root for the run lifecycle.

---

## Pre-existing issues (NOT introduced here — confirmed red on clean `043f823`)

Leave unless explicitly scoped in; they block a fully-green `bun run validate`:

- `packages/cli/src/cli.ts:353` — `workflowType` is `string | undefined`, not narrowed to
  `"issue" | "pr" | "task"` after the validation guard (guard uses `!==` literal checks
  which don't narrow `string`). One-line cast/narrow fixes it.
- Prettier drift (untouched files): `packages/providers/src/pi/capabilities.ts`,
  `options-translator.ts`, `options-translator.test.ts`, `event-bridge.test.ts`.
- `packages/core/src/workflows/store-adapter.test.ts` is **excluded** from core's `test`
  script (its `mock.module('@rith/providers', …)` omits `PiProvider`, so it only loads
  inside a batch). The migration's structural assertion there is covered by `tsc`.

## Useful commands

- Regenerate bundled workflows after editing `.rith/workflows/defaults/`:
  `bun run generate:bundled` then `bun run check:bundled`.
- Targeted tests: `cd packages/providers && bun run test`;
  `cd packages/core && bun test src/config/`;
  `cd packages/workflows && bun test src/executor.test.ts src/dag-executor.test.ts`.
