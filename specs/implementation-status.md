# Implementation Status — Spec Fixes

**Purpose:** Resumption log for the work driven by `architectural-review.md` and
`configuration-and-models.md`. Records what is DONE, the DECISIONS made (and why),
and what REMAINS — so future sessions continue from here instead of re-deriving.

**Base commit:** `3f5c920` (`main`). Shipped so far: items 1–6 in `d760f2e` (`#9`);
items 11–13 (architectural-review hardening) in `#10`; item 7 (Pi-only docs) in `#11`.
**Status as of:** 2026-06-05 — Tracks A (hardening) and B (docs) are merged to `main`.
Remaining: DX items 8–10 and deferred refactors 14–15, plus newly-identified issues
(see "New issues identified" below).

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
| 7   | Pi-only docs alignment (`docs-web`, 23 files)         | config §6    | ✅ Done (#11)       |
| 8   | `RITH_MODEL` env override (`applyEnvOverrides`)       | config §7    | ⬜ Not started      |
| 9   | `rith doctor` — does NOT exist yet; must be built     | config §7    | ⬜ Not started      |
| 10  | `rith setup` — does NOT exist yet; must be built      | config §7    | ⬜ Not started      |
| 11  | State-machine `cancelWorkflowRun` guard               | arch #3      | ✅ Done (#10)       |
| 12  | Per-run throttle maps (de-globalize)                  | arch #4      | ✅ Done (#10)       |
| 13  | Event-emitter guaranteed `unregisterRun` cleanup      | arch         | ✅ Done (#10)       |
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

---

## REMAINING

### From `configuration-and-models.md`

- **§6 docs — ✅ DONE (#11).** See the "Pi-only docs alignment" subsection above.
- **§7 Priority 3 DX (not started):**
  - **#8** Wire `applyEnvOverrides()` (currently a no-op in `config-loader.ts`) to support
    a `RITH_MODEL` env override of `pi.model`.
  - **#9 `rith doctor` — the command does NOT exist yet** (`cli.ts` has no `doctor` case;
    the docs describe one). Build it: validate config → parse model ref → check Pi
    catalog/credentials (`~/.pi/agent/auth.json`).
  - **#10 `rith setup` — the command does NOT exist yet** (same situation). Build it:
    detect `~/.pi/agent/auth.json` and guide the user.
  - Building #9/#10 also clears the CLI-command drift below.

### From `architectural-review.md`

Items 1–3 (the low-risk hardening trio) are **done** — see DONE above. Remaining:

- **Deferred (large, explicitly NOT low-risk):** extract a `DagExecutionContext` param
  object and split `dag-executor.ts` (~3150-line god file) into `BashNodeRunner` /
  `ScriptNodeRunner` / `LoopNodeRunner` / `ApprovalNodeRunner`; discriminate
  `WorkflowRun.metadata` by status; add an aggregate root for the run lifecycle.

---

## New issues identified (2026-06-05 — surfaced while shipping Tracks A & B)

Discovered during the docs alignment and code grounding. None block the merged work,
but they should be addressed.

### CLI-command drift — docs document commands that do not exist

`packages/cli/src/cli.ts` only dispatches `version`, `help`, `workflow`, `isolation`,
`validate`, `complete` (plus pre-switch `workflow search`). The docs still document
**non-existent** commands: `rith setup`, `rith doctor`, `rith chat`, `rith serve`,
`rith skill install`. Stale references remain in:

- `docs-web/.../reference/cli.md` — full `setup` + `doctor` sections, a `skill install`
  example, a `chat`/`serve` mention; the `doctor` text also says "Claude binary spawn".
- `docs-web/.../contributing/cli-internals.md` — `setup`/`chat` in the git-check bypass list.
- `docs-web/.../reference/security.md` — "`rith setup` never writes to `<cwd>/.env`".

This overlaps DX items #9/#10: **either build `rith doctor`/`rith setup` (closes the DX
gap AND the drift) or trim the command docs.** Decide before doing either.

### Root `CLAUDE.md` staleness (Pi-only)

Lines ~228 (`bun run cli skill install`) and ~231–232 ("Verify your Rith Engine setup
(Claude binary…)", `bun run cli doctor`) reference commands that don't exist and a
"Claude binary" Pi-only no longer uses.

### Vestigial Claude env allow-list (cleanup candidate)

`packages/paths/src/strip-cwd-env.ts` exempts `CLAUDE_CODE_OAUTH_TOKEN`,
`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX` from the nested-session env scrub.
Holdover from the Claude Agent SDK era — Pi auth reads `~/.pi/agent/auth.json` +
`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY` (`provider.ts:119-122`), not
`CLAUDE_CODE_*`. Only a user bash node shelling out to `claude`/Bedrock/Vertex would
consume them. Safe to keep; candidate to remove in the Pi-only cleanup.

### UNVERIFIED — Pi env-var table may overclaim

`getting-started/ai-assistants.md` lists API-key env mappings for `groq`, `mistral`,
`cerebras`, `xai`, `openrouter`, `huggingface`. The explore reported `PI_PROVIDER_ENV_VARS`
(`provider.ts:119-122`) maps only `anthropic`/`openai`/`google`. **Verify the full map
before trusting the extra rows** — if Rith doesn't wire them, they mislead.

### Possibly-stale troubleshooting refs (not found in product code)

`reference/troubleshooting.md` still mentions `RITH_CLAUDE_FIRST_EVENT_TIMEOUT_MS` and
`rith serve`; neither was located in the codebase. Confirm and remove if dead.

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
