# Implementation Status — Spec Fixes

**Purpose:** Resumption log for the work driven by `architectural-review.md` and
`configuration-and-models.md`. Records what is DONE, the DECISIONS made (and why),
and what REMAINS — so future sessions continue from here instead of re-deriving.

**Base commit:** `349f46f` (`main`). Shipped so far: items 1–6 in `d760f2e` (`#9`);
items 11–13 (architectural-review hardening) in `#10`; item 7 (Pi-only docs) in `#11`;
DX items 8–10 (`RITH_MODEL` override, `rith doctor`, `rith setup`) in `#15`; the web-UI /
`serve` doc purge + a fully-green `bun run validate` (all pre-existing red tests fixed) in `#16`;
the workflows single-process mock isolation (item 16) in `#18`; the `@rith/providers` →
`@rith/pi` collapse (item 17) in `#20`; the `DagExecutionContext` param-object seam
(item 14, **step 1 of 2**) in `#21`; and a variable-substitution cohesion detour — a
`PromptContext` value object plus the **ctx-first** parameter convention — in `#22`
(`d9d177a`, current `main` HEAD).
**Status as of:** 2026-06-06 — items 1–13, DX 8–10, items 16–17, **item 14 step 1** (the
executor context seam), and the `#22` PromptContext / ctx-first cohesion pass are merged; docs
are Pi-only / CLI-only and `bun run validate` is green end-to-end on `main` (`check:bundled`,
`check:bundled-skill`, `type-check` ×7, `lint --max-warnings 0`, `format:check`, full test
suite — 0 failures).
**Remaining:** item 14 **step 2** (the dag-executor god-file split) and item 15 — the next
session starts there (see "REMAINING → From `architectural-review.md`" below). The hard part of
item 14 is de-risked: `#21` collapsed the five private node executors onto a single
`DagExecutionContext` param object and `#22` grouped the prompt-substitution cluster into
`PromptContext` and locked the **ctx-first** convention (the context object is always the first
parameter), so the runner-class split is module-mechanical extraction rather than re-threading.
Enabling prerequisites are also in place: item 16 (`#18`) made the workflows suite run in one
`bun test` process so the split won't fight test serialization, and item 17 (`#20`) flattened the
`@rith/pi` surface item 14 imports from. Item 14 still lands before item 15 (the
`DagExecutionContext` seam is where the `WorkflowRun` metadata discriminant gets threaded).

---

## Progress at a glance

| #   | Item                                                   | Source       | Status                                         |
| --- | ------------------------------------------------------ | ------------ | ---------------------------------------------- |
| 1   | Bundled workflow model refs (14 files)                 | config §5/§7 | ✅ Done                                        |
| 2   | Provider "requires a model" error message              | config §7    | ✅ Done                                        |
| 3   | Config schema `provider:` → `pi:` block                | config §2    | ✅ Done                                        |
| 4   | Drop `env` + `interactive` config knobs                | user         | ✅ Done                                        |
| 5   | Extension `notify()` forwarding (kept, unconditional)  | user         | ✅ Done                                        |
| 6   | Dead `w.provider` CLI display removed                  | arch/cleanup | ✅ Done                                        |
| 7   | Pi-only docs alignment (`docs-web`, 23 files)          | config §6    | ✅ Done (#11)                                  |
| 8   | `RITH_MODEL` env override (`applyEnvOverrides`)        | config §7    | ✅ Done                                        |
| 9   | `rith doctor` (Pi-only port)                           | config §7    | ✅ Done                                        |
| 10  | `rith setup` (Pi-trimmed port)                         | config §7    | ✅ Done                                        |
| 11  | State-machine `cancelWorkflowRun` guard                | arch #3      | ✅ Done (#10)                                  |
| 12  | Per-run throttle maps (de-globalize)                   | arch #4      | ✅ Done (#10)                                  |
| 13  | Event-emitter guaranteed `unregisterRun` cleanup       | arch         | ✅ Done (#10)                                  |
| 14  | `DagExecutionContext` param object + god-file split    | arch #1/#2   | 🟡 Seam+cohesion done (#21/#22); split remains |
| 15  | Discriminate `WorkflowRun.metadata`; aggregate root    | arch         | ⬜ Deferred (large)                            |
| 16  | Workflows single-process mock isolation                | test infra   | ✅ Done (#18)                                  |
| 17  | Collapse `@rith/providers` → `@rith/pi` (rename/reorg) | cleanup      | ✅ Done (#20)                                  |

### Refactor (precedes items 14/15): `@rith/providers` → `@rith/pi`

The single-AI-backend codebase no longer needs the multi-provider indirection
inherited from Archon. Pure rename/reorg, **zero behavior change**:

- Package `@rith/providers` → **`@rith/pi`**; dir `packages/providers` →
  `packages/pi`. Flattened `src/pi/*` → `src/*` (`provider.ts` → `agent.ts`);
  dropped the redundant `src/pi/index.ts` and the unused `./pi*` subpath exports.
  Subpath exports are now just `.`, `./types`, `./mcp/config`.
- Symbols: `IAgentProvider` → **`PiAgent`**, `PiProvider` → **`PiCodingAgent`**,
  `AgentProviderFactory` → **`PiAgentFactory`**, `WorkflowDeps.getAgentProvider`
  → **`getAgent`**, `ProviderCapabilities` → **`PiCapabilities`**,
  `parseProviderConfig` → **`parsePiConfig`**.
- **Deliberately kept** (correct domain language, not the killed abstraction):
  `@rith/isolation`'s worktree/container _provider_ strategy, and the model-ref
  backend `provider` field + `PI_PROVIDER_ENV_VARS` (the LLM vendor id).
- `PI_PROVIDER_ENV_VARS` now lives in `packages/pi/src/agent.ts`.
- Verified behind `type-check` ×7 + targeted pi/workflows/core suites + `rith
doctor` smoke. This de-clutters the dag-executor surface that items 14/15 touch
  but does not start that work.

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

### Architectural-review hardening (items 11–13)

- **#11 `cancelWorkflowRun` state-machine guard** — `packages/core/src/db/workflows.ts`.
  `pauseWorkflowRun` / `completeWorkflowRun` / `failWorkflowRun` already carried
  `AND status = 'running'`; only `cancelWorkflowRun` was unguarded. Added
  `WHERE id = $1 AND status NOT IN ('completed', 'failed', 'cancelled')` — cancel is valid
  from `pending`/`running`/`paused` (callers cancel paused approval gates), so the guard
  blocks only terminal→cancelled corruption. Kept idempotent: a no-match warns
  (`db.workflow_run_cancel_no_match`) rather than throwing, since callers treat cancel as
  best-effort (abandon/reject).
- **#12 per-run throttle de-globalization** — `packages/workflows/src/dag-executor.ts`.
  Removed module-level `lastNodeCancelCheck` / `lastNodeActivityUpdate` Maps. The throttle
  is only read/written inside `executeNodeInternal`'s streaming loop, so replaced them with
  two function-local `lastCancelCheckAt` / `lastActivityUpdateAt` timestamps (tighter than
  per-run; no cross-run contamination, no `nodeKey` plumbing, no `.delete()` cleanup).
- **#13 guaranteed emitter cleanup** — `packages/workflows/src/executor.ts`. `registerRun`
  lives in the executor, so the unregister now does too: the existing `finally` backstop
  reuses its single `getWorkflowRunStatus` read to `unregisterRun(runId)` on every exit
  path (normal/throw/backstop) **except `paused`** (keeps SSE connected for the approval
  gate). Dropped the now-redundant catch-path unregister. In-band terminal unregisters in
  `dag-executor.ts` remain as prompt-release (idempotent with the finally net).

Tests added: `cancelWorkflowRun` guard + idempotent no-throw (`core/src/db/workflows.test.ts`);
`finally emitter cleanup` paused-vs-terminal (`workflows/src/executor.test.ts`).
Verification: core `src/db/` 189 pass, full workflows suite 0 fail (dag-executor 234,
executor 33); type-check / eslint / prettier clean on edited files.

### Pi-only docs alignment (item 7) — #11

`packages/docs-web` realigned to the Pi-only build (Pi Coding Agent is the sole AI
provider). **23 files**, +279/−1414; `astro build` clean (63 pages), Prettier clean.

- Config: all `assistants.{claude,codex,copilot}` blocks → the `pi:` block; dropped the
  removed `interactive` knob and the `inherit` model alias.
- Models: bare names → Pi `<provider-id>/<model-id>` refs.
- `provider` field + registered-provider / `defaultAssistant` / "Unknown provider" prose
  removed everywhere.
- Auth/env: `pi /login` (`~/.pi/agent/auth.json`) or `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/
  `GEMINI_API_KEY`; removed `CLAUDE_*`/`CODEX_*`/`COPILOT_*`, `CLAUDE_BIN_PATH`,
  `claudeBinaryPath`, `settingSources`.
- Capabilities (per `PI_CAPABILITIES`): kept `effort`/`thinking`(string)/`allowed_tools`/
  `denied_tools`/`skills`/`output_format`(best-effort)/`systemPrompt` as supported on Pi;
  marked `mcp`/`agents`/`hooks`/`sandbox`/`fallbackModel`/`betas`/`maxBudgetUsd` as
  ignored. Stubbed the `hooks` and `mcp-servers` guides (kept in nav + inbound links).
- Mid-flight correction: `systemPrompt` is **supported** (Pi forwards it to
  `DefaultResourceLoader({ systemPrompt })`, `provider.ts:314-318`) — a subagent had
  wrongly marked it unsupported; fixed before merge.

### DX items 8–10 — `RITH_MODEL`, `rith doctor`, `rith setup` (this session)

**#8 `RITH_MODEL` override.** `packages/core/src/config/config-loader.ts` —
`applyEnvOverrides` (was a no-op) now sets `config.pi.model` from a trimmed `RITH_MODEL`
env var (blank ignored), applied last in `loadConfig` so it beats global+repo config.
Tests: 3 cases in `config-loader.test.ts` (override, set-when-absent, blank-ignored);
`RITH_MODEL` added to the suite's managed-env list. Documented in
`reference/configuration.md` (Pi env table).

**#9 `rith doctor` (Pi-only port).** New `packages/cli/src/commands/doctor.ts`.
Kept checks: `checkPi` (un-gated — probes `~/.pi/agent/auth.json` then the 9 mapped
API-key env vars), `checkGhAuth`, `checkDatabase`, `checkWorkspaceWritable`,
`checkBundledDefaults`, `checkTelemetry`. **Dropped** `checkClaudeBinary`/`checkSlack`/
`checkTelegram`. Deviations from the old REMAINING notes:

- **No `getTelemetryStatus` shim added.** `checkTelemetry` uses the existing
  `isTelemetryDisabled()` and re-derives the reason inline (`RITH_TELEMETRY_DISABLED`/
  `DO_NOT_TRACK`/no-key) — minimal, faithful to rith's actual disable logic.
- **`checkDatabase` uses a static `{ pool, getDatabaseType }` default with DI** (no
  `await import`), per the no-dynamic-import rule; the module-load-failure branch was
  dropped (`@rith/core` is already statically loaded by `cli.ts`).
  Wired into `cli.ts`: import, usage line, `noGitCommands`, `case 'doctor': return await
doctorCommand()`. Tests: `doctor.test.ts` (23 pass). Smoke: `bun run cli doctor` → exit 0.

**#10 `rith setup` (Pi-trimmed port).** New `packages/cli/src/commands/setup.ts` (~480
lines vs Archon's 2248). Reused `PI_BACKENDS`/`PI_DEFAULT_MODELS`/`collectPiConfig`/
`serializeEnv`/`writeScopedEnv`/`resolveScopedEnvPath`/`checkExistingConfig`/
`writeHomePiModelConfig`; **dropped** claude/codex auth, all bot platforms, `--spawn`
terminal spawning, skill install + project-config/docs-path bootstrap, and `checkPiModule`
(redundant + would need a dynamic import). Flow: pick Pi backend + optional key →
optional `GITHUB_TOKEN` → merge-write the rith-owned `.env` (home/project scope) →
write `pi.model` to `~/.rith/config.yaml` (top-level `pi:` block, not `assistants.pi`) →
offer `rith doctor`. Wired into `cli.ts` with `--scope home|project` validation + `--force`.
Tests: `setup.test.ts` (19 pass) cover serialize/generate/resolve/write-merge-force/
existing-detection/model-config-idempotency. Documented in `reference/cli.md`.

**CLI-command drift cleanup (this session).** Removed the `chat`/`serve`/`skill install`
sections + the stale Claude-auth boot step from `reference/cli.md`; aligned its `setup`/
`doctor` sections to the as-built commands; fixed `contributing/cli-internals.md` (file
tree + git-check bypass list); removed the dead `RITH_CLAUDE_FIRST_EVENT_TIMEOUT_MS` block
and the whole server-only "Port Conflicts"/"Stale Processes" region from
`reference/troubleshooting.md`; dropped dead `PORT`/`BOT_DISPLAY_NAME`/
`MAX_CONCURRENT_CONVERSATIONS`/`SESSION_RETENTION_DAYS` rows from
`reference/configuration.md` (all confirmed absent from product code); fixed the root
`CLAUDE.md` command examples (`skill install`→`setup`; Pi-only doctor description).
`security.md`'s "`rith setup` never writes to `<cwd>/.env`" is now accurate as-built.

**Verification:** doctor 23 + setup 19 + config-loader 32 tests pass; core type-check
clean; cli type-check clean except the pre-existing `cli.ts` `workflowType` narrowing
(now line ~376, shifted from :353); eslint clean; prettier clean; `astro build` green
(63 pages, no broken links). `cli`'s `bun run test` aggregate is still red due to the
**pre-existing** `workflow.test.ts` drift (asserts the removed `provider` field +
`/home/test/.rith` env) — confirmed failing with my `cli.ts` stashed.

### Item 16 — workflows single-process mock isolation (#18, this session)

**Problem.** Bun's `mock.module()` is process-global and irreversible: a `mock.module()`
call persists across every test file that runs later in the same `bun test` process. Every
workflows test installed _partial_ mocks of shared modules (`@rith/paths`, `./logger`,
`./event-emitter`, `./dag-executor`, `./defaults/bundled-defaults`, `./command-validation`,
`fs/promises`) that then leaked into unrelated later files (`bundled-defaults` seen as `{}`,
`event-emitter` losing `.subscribe`, `logger` writes becoming no-ops, etc.). To stay green,
`packages/workflows`'s `test` script ran **16 serialized `bun test` invocations**, one file
per process. Running the whole suite in one process produced **268 failures**.

**Fix (all in `packages/workflows`):**

- **New `src/test-mock-module.ts`** — `mockModuleScoped(specifier, realNamespace, override)`:
  snapshots the real module (from a same-file `import * as real …` captured _before_ the
  call), installs `override` **verbatim** (identical to a bare `mock.module(specifier,
() => override)`, so per-file behavior is unchanged), then reverts `specifier` to the real
  snapshot in `afterAll`. Bun evaluates test files sequentially, so the revert fully isolates
  each file. Relative specifiers (`./logger`, etc.) resolve against `src/` for both the helper
  and every caller, so resolution matches.
- **12 test files converted** to capture `import * as real…` and route every `mock.module()`
  through the helper: `condition-evaluator`, `dag-executor`, `event-emitter`,
  `executor-preamble`, `executor-shared`, `executor`, `load-command-prompt`, `loader`,
  `logger`, `runtime-check`, `script-discovery`, `script-node-deps` (`.test.ts`).
- **Logger-cache root cause (last 3 failures).** `loader.ts` and `workflow-discovery.ts`
  cached `createLogger()` in a process-global `let cachedLog`; an earlier file warmed the
  cache, so `loader.test.ts`'s per-file logger mock never received calls. Replaced the cache
  with a per-call `getLog()` that calls `createLogger()` each time — a cheap
  `rootLogger.child({ module })`; it also now reflects runtime log-level changes (a child
  caches the root level at creation time, so per-call creation is strictly more correct). These
  are the **only product-code changes** in the PR.
- **`packages/workflows/package.json`** — `test` collapsed from the 16-invocation chain to a
  single `bun test`.

**Verification:** `cd packages/workflows && bun test` → **906 pass / 0 fail** in one process
(~2.7s), down from 268 failures. Full `bun run validate` green end-to-end.

**Scope note / gotcha for next session:** this isolates mocks _within_ the workflows package.
The root `test` script still runs each package in its own process (`bun --filter '*' --parallel
test`), which remains correct — a repo-root single-process `bun test` across all 69 files still
fails on **cross-package** `mock.module` leakage (e.g. `PiProvider` not exported from
`@rith/providers`, `codebaseDb.*`/`workflowDb.*`/`isolationDb.*` undefined in core/cli). That is
the same class of leak, one level up, and is **out of scope** for #18. If a future change wants a
true single-process repo run, apply the same `mockModuleScoped` pattern to the offending
core/cli/providers tests.

---

## REMAINING

### From `configuration-and-models.md`

- **§6 docs — ✅ DONE (#11).** See the "Pi-only docs alignment" subsection above.
- **§7 Priority 3 DX — ✅ DONE (this session).** See the "DX items 8–10" subsection under
  DONE below for the as-built shape (which deviates from the notes that were here).

### Upstream port reference — Archon

This repo is a **Pi-only, CLI-only fork of Archon** (`@archon/*` → `@rith/*` rename).
Local checkout (if present): `/Users/ciocanu/personal/code/Archon`. Archon retains
multi-provider (claude/codex/pi), the `web`/`server`/`adapters` packages, and
Slack/Telegram/GitHub-bot platforms that the fork dropped. The CLI commands the rith docs
reference but `cli.ts` no longer dispatches — `doctor`, `setup`, `chat`, `serve`, `skill`,
`auth`, `continue` — all exist upstream under `Archon/packages/cli/src/commands/`. Archon
already supports Pi (`checkPi`, `PI_BACKENDS`, `PI_API_KEY_VARS`), so its Pi paths transfer
directly.

**Decision (2026-06-05):** port ONLY `doctor` (#9) and `setup` (#10), Pi-trimmed. **Skip**
`chat` (needs the dropped orchestrator `handleMessage`), `serve` (dropped `web`/`server`),
`auth github` (multi-user GitHub App; rith is solo `GITHUB_TOKEN`), and `skill install`
(Claude Code-app glue — installs into `.claude/skills/`; no Pi use case in a Pi-only
engine). For the skipped four, **delete their docs** rather than port (see CLI-command
drift below).

### From `architectural-review.md`

Items 1–3 (the low-risk hardening trio) are **done** — see DONE above. Remaining:

- **Deferred (large, explicitly NOT low-risk) — the only remaining work; the next session
  starts here.** Source: `architectural-review.md` items #1/#2 (item 14) and the
  metadata/aggregate-root notes (item 15). Land both behind the existing green
  `bun run validate`; they are pure refactors with heavy test surface, so keep each runner's
  observable behavior identical.
  - **Item 14, step 1 — ✅ Done (#21, refined in #22).** A single exported
    `DagExecutionContext` interface carries the per-run constants: `deps`, `platform`,
    `conversationId`, `cwd`, `workflowRun`, `artifactsDir`, `logDir`, `baseBranch`, `nodeOutputs`,
    `config`, `workflowModel`, `workflowLevelOptions`, `configuredCommandFolder`, `issueContext`,
    and `promptContext` (a `PromptContext` — see the cohesion detour below). The five module-private
    executors (`executeNodeInternal`, `executeBashNode`, `executeScriptNode`, `executeLoopNode`,
    `executeApprovalNode`) take `(ctx, …perNodeParams)` plus one destructure line each instead of
    12–16 positional args; `ctx` is built once inside `executeDagWorkflow`, whose own 16-param
    exported signature is **unchanged** (so `executor.ts` and most tests were untouched). Notes for
    step 2: `executeLoopNode` keeps a per-node `workflowModel` param (the resolved
    `node.model ?? workflowModel ?? config.pi?.model` loop model) and does **not** read
    `ctx.workflowModel`; each executor destructures only the fields it uses directly (bash/loop keep
    `artifactsDir`/`baseBranch`/`issueContext` flat only because they inject them as
    `ARTIFACTS_DIR`/`BASE_BRANCH`/`CONTEXT` env vars). Pure refactor, `bun run validate` green
    (workflows 906/906).
  - **Cohesion detour — ✅ Done (#22, `d9d177a`, current `main` HEAD).** Two related cleanups on
    top of the seam. (a) A `PromptContext` value object groups the run-constant inputs that
    travelled together through `substituteWorkflowVariables` / `buildPromptWithContext` at every
    call site — its fields are `workflowId`, `userMessage`, `artifactsDir`, `baseBranch`, `docsDir`,
    `issueContext`. It is built once on `DagExecutionContext.promptContext`, which is why `docsDir`
    is **no longer a flat ctx field** (it lives only in `promptContext`; `artifactsDir`/`baseBranch`
    stay duplicated flat because env injection still needs them). (b) The **ctx-first parameter
    convention** is now locked: the context object is always the first parameter — `fn(ctx, …)` for
    the DAG executors and `substituteWorkflowVariables(ctx, prompt, …)` /
    `buildPromptWithContext(ctx, template, logLabel)` for the prompt helpers. **Step 2 runners must
    follow ctx-first.**
  - **Item 14, step 2 — remaining (the next session starts here).** Split the
    `packages/workflows/src/dag-executor.ts` god file (~3100 lines) into focused runner modules:
    `BashNodeRunner` / `ScriptNodeRunner` / `LoopNodeRunner` / `ApprovalNodeRunner`. The `ctx`
    seam from step 1 is the handle — each runner takes `DagExecutionContext` + its per-node args
    (ctx-first), so extraction is module-mechanical, not a re-threading. `executeApprovalNode` is the
    only executor that calls a sibling (`executeNodeInternal` on its `on_reject` branch), so factor
    the shared internal-node path so the approval runner can still reach it. **Test surface is
    friendly** (item 16 / `#18`): `packages/workflows`'s suite runs in a single `bun test` process
    with `mockModuleScoped` isolation, so new per-runner test files coexist without re-introducing
    serialized invocations. When adding runner modules, mock any shared dep through
    `src/test-mock-module.ts`, never a bare `mock.module`. **Tooling note:** no LSP is configured for
    this repo — use `ast-grep` for structural find/codemods (and note `f($A, $B, $$$REST)` only
    matches 3+-arg calls; add a separate `f($A, $B)` pass for exactly-two-arg call sites).
    - **Update (2026-06-08) — structural core landed; see `specs/dag-executor-refactor.md`.**
      A DDD/GRASP/SOLID pass shipped behind a green `bun run validate` (workflows 906/0): a
      `NodeRunner` registry (`dag/node-runner.ts`) replaced the `isBashNode/isLoopNode/…`
      type-switch dispatch; the per-run context is now `DagRunContext` (renamed from
      `DagExecutionContext`) plus a `NodeRunContext` envelope (`dag/context.ts`); the
      prior-success/trigger/`when` gates and the log+persist+emit boilerplate were extracted
      (`evaluateNodeGates`, `recordNodeSkip`, `recordNodePreRunFailure`); and a
      `WorkflowRunAggregate` (`dag/run-aggregate.ts`) is the **single mutator** of run status —
      all four status writes (cancel node, approval pause, interactive-loop pause, on-reject
      cancel) route through it. Runner classes/gate/sink still live in `dag-executor.ts` (the
      `runners/` split is deferred — a `gate.ts` would cycle on `checkTriggerRule` until the
      scheduler also moves). **Deferred by decision:** the `NodeRunResult` control-signal flip
      (cancel/pause stay in-band; scheduler still breaks via the between-layer re-read) and
      item 15's tagged-union metadata — the flip changes concurrent-cancel timing, so it is
      not zero-behavior-change. Item 15's **aggregate-root half is effectively in place**
      (`WorkflowRunAggregate`); only the discriminated `WorkflowRun.metadata` remains.
  - **Item 15** — discriminate `WorkflowRun.metadata` by run status (replace the loose bag
    with a tagged union) and introduce an aggregate root for the run lifecycle.

---

## New issues identified (2026-06-05 — surfaced while shipping Tracks A & B)

Discovered during the docs alignment and code grounding. None block the merged work,
but they should be addressed.

### CLI-command drift — ✅ RESOLVED (this session)

The fork's `cli.ts` now dispatches `doctor` and `setup` (built this session); `chat`,
`serve`, `auth`, and `skill install` remain un-ported (no fork use case). All stale doc
references were reconciled: `reference/cli.md` (`chat`/`serve`/`skill install` sections
removed, `setup`/`doctor` aligned), `contributing/cli-internals.md` (file tree +
git-check bypass list), and the root `CLAUDE.md` examples. `security.md`'s
"`rith setup` never writes to `<cwd>/.env`" is now accurate as-built. See the
"CLI-command drift cleanup" note under DONE.

### Web-UI / `serve` doc purge — ✅ RESOLVED (#16)

The fork dropped the `web`/`server` packages, so there is **no HTTP server, no port binding,
and no worktree port allocation** in product code. All lingering web-UI/server prose was
removed in `#16`: deleted `deployment/{docker,cloud,e2e-testing}.md`; rewrote
`deployment/{index,local}.md` to CLI-only; stripped server/port/health/REST sections from
`reference/{rith-directories,configuration,database,troubleshooting}.md`,
`getting-started/configuration.md`, `guides/approval-nodes.md`, `contributing/dx-quirks.md`,
and `deployment/windows.md`; removed dead `getWebDistDir` from `packages/paths`. Verified
absent from the tree: `rith serve`, `web-dist`, `localhost:3090`, `PORT=4000`. Astro build:
60 pages, no broken links.

### Claude env allow-list — KEPT (decision, #16)

`packages/paths/src/strip-cwd-env.ts` exempts `CLAUDE_CODE_OAUTH_TOKEN`,
`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX` from the nested-session env scrub.
**Decision: keep them** — they are load-bearing for user bash nodes that shell out to
`claude`/Bedrock/Vertex (Pi auth itself reads `~/.pi/agent/auth.json` + the per-provider keys
in `provider.ts`, not `CLAUDE_CODE_*`). The stale "Agent SDK era" comment was refreshed in
`#16`; no further action.

### Pi env-var table — ✅ VERIFIED accurate (#16)

`getting-started/ai-assistants.md` lists API-key env mappings for all 9 backends. Confirmed
against `packages/pi/src/agent.ts:119-129`: `PI_PROVIDER_ENV_VARS` maps **all
nine** providers per request — anthropic, openai, google, groq, mistral, cerebras, xai,
openrouter, huggingface. The earlier "anthropic/openai/google only" worry was **stale**; the
docs table matches the runtime mapping, no edit needed.

### Stale troubleshooting refs — ✅ RESOLVED (#16)

`reference/troubleshooting.md` previously mentioned `RITH_CLAUDE_FIRST_EVENT_TIMEOUT_MS` and
`rith serve`; both are absent from the codebase and were removed from the docs in `#16`
(verified: no matches under `packages/`).

### Postgres schema bootstrap gap — OPEN (not blocking; noted #16)

`reference/database.md` references a non-existent `migrations/` dir. The Postgres adapter
(`packages/core/src/db/adapters/postgres.ts`) does **not** auto-create schema — only SQLite's
`initSchema()` / `createSchema()` does. So a fresh Postgres backend has no schema bootstrap
path. This is a real product gap (not a doc bug); it was surfaced, not fixed, in `#16`.
Decide: either add a Postgres bootstrap/migration path or document Postgres as
bring-your-own-schema.

### Cross-package `mock.module` leakage — OPEN (not blocking; surfaced #18)

Item 16 fixed the leak _within_ `packages/workflows`. The same class of leak still exists
_across_ packages: a repo-root single-process `bun test` (all ~69 files) fails (~87 failures)
because partial `mock.module` mocks in core/cli/pi tests leak (`PiCodingAgent` missing from
`@rith/pi`, `codebaseDb.*`/`workflowDb.*`/`isolationDb.*`/`adapter.*` undefined, etc.).
**Not a regression and not currently exercised** — the root `test` script runs each package in
its own process (`bun --filter '*' --parallel`), so this only bites a deliberate single-process
repo run. Fix (if ever wanted): apply the `mockModuleScoped` pattern from
`packages/workflows/src/test-mock-module.ts` to the offending core/cli/providers test files.

## Pre-existing test/lint issues — ✅ RESOLVED (#16)

All pre-existing red tests and lint/format drift that blocked a green `bun run validate` are
fixed (product code untouched; tests reconciled to current behavior, no weakening):

- `packages/cli/src/cli.ts` — `workflowType` narrowing fixed via a typed local
  (`validatedWorkflowType: 'issue' | 'pr' | 'task' | undefined`); satisfies tsc **and** eslint.
- `packages/cli/src/commands/workflow.test.ts` — drained corrupted `...Once` mock queues
  (`mockReset`); retargeted assertions to real behavior. 99 pass, deterministic.
- `packages/cli/src/commands/isolation.test.ts` — reconciled the 8 tests asserting the removed
  `cleanup-service` `removeEnvironment` API to the current `destroy()` + `updateStatus()` flow;
  18/18 pass.
- Prettier drift across touched packages normalized via `bun run format`.
- `packages/core/src/workflows/store-adapter.test.ts` is **excluded** from core's `test`
  script (which never runs `src/workflows/`); it mocks many `../db/*` modules plus `@rith/pi`
  (now exports `PiCodingAgent`), so it only loads cleanly inside a batch. The migration's
  structural assertion there is covered by `tsc`.

## Useful commands

- Regenerate bundled workflows after editing `.rith/workflows/defaults/`:
  `bun run generate:bundled` then `bun run check:bundled`.
- Targeted tests: `cd packages/pi && bun run test`;
  `cd packages/core && bun test src/config/`;
  `cd packages/workflows && bun test src/executor.test.ts src/dag-executor.test.ts`.
