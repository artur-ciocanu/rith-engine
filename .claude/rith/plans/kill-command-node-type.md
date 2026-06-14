# Plan: Kill the `command:` Node Type

## Overview

Remove the `command:` node type from Rith Engine. Standardize workflow nodes on
three content primitives: `bash:` (deterministic), `prompt:` (LLM), `skills:`
(reusable SOPs). The `command:` concept was a markdown-file-as-prompt indirection
layer that `skills:` now strictly dominates. After the commands→skills migration,
zero production workflows use `command:`. The runtime infrastructure (~500 lines)
survives with zero consumers.

---

## Requirements (EARS syntax)

### R1 — Schema (Ubiquitous)
The workflow schema SHALL NOT define a `CommandNode` type.
The `DagNode` union SHALL consist of `PromptNode | BashNode | ScriptNode |
LoopNode | CancelNode | ApprovalNode` — no `CommandNode`.
The `commandNodeSchema` Zod schema SHALL NOT exist.
The `isCommandNode` type guard SHALL NOT exist.

**Affected file:** `packages/workflows/src/schemas/dag-node.ts`
**Verification:** `grep -rn "CommandNode\|commandNodeSchema\|isCommandNode" packages/workflows/src/schemas/` returns zero matches.

### R2 — Schema exports (Ubiquitous)
The schema index SHALL NOT export `CommandNode` or `commandNodeSchema`.

**Affected file:** `packages/workflows/src/schemas/index.ts`
**Verification:** `grep -n "CommandNode\|commandNodeSchema" packages/workflows/src/schemas/index.ts` returns zero matches.

### R3 — Command loader (Ubiquitous)
The `loadCommandPrompt()` function SHALL NOT exist.
The `isValidCommandName()` function SHALL NOT exist.
The files `command-validation.ts` and `command-validation.test.ts` SHALL NOT exist.
The file `load-command-prompt.test.ts` SHALL NOT exist.

**Affected files:**
- DELETE `packages/workflows/src/command-validation.ts`
- DELETE `packages/workflows/src/command-validation.test.ts`
- DELETE `packages/workflows/src/load-command-prompt.test.ts`
- MODIFY `packages/workflows/src/executor-shared.ts` — remove `loadCommandPrompt()` function and `command-validation` import

**Verification:** `grep -rn "loadCommandPrompt\|isValidCommandName" packages/` returns zero matches. The three deleted files do not exist.

### R4 — Validator (Ubiquitous)
The validator SHALL NOT contain `discoverAvailableCommands()`,
`resolveCommand()`, `resolveCommandInDir()`, or `validateCommand()` functions.
The `validateWorkflowResources()` function SHALL NOT check for command file
existence.

**Affected files:**
- MODIFY `packages/workflows/src/validator.ts` — remove all command functions and command checks from `validateWorkflowResources()`
- MODIFY `packages/workflows/src/validator.test.ts` — remove all command discovery/validation test cases

**Verification:** `grep -rn "discoverAvailableCommands\|resolveCommand\|validateCommand" packages/workflows/src/validator` returns zero matches.

### R5 — AI node runner (Ubiquitous)
The AI node runner SHALL accept only `PromptNode` (not `CommandNode | PromptNode`).
The runner SHALL NOT contain an `if (node.command)` branch.
The runner SHALL NOT import `CommandNode` or call `loadCommandPrompt()`.

**Affected file:** `packages/workflows/src/dag/runners/ai-node-runner.ts`
**Verification:** `grep -n "CommandNode\|node\.command\|loadCommandPrompt" packages/workflows/src/dag/runners/ai-node-runner.ts` returns zero matches.

### R6 — Node dispatcher (Ubiquitous)
The node runner dispatcher SHALL NOT import `isCommandNode`.
The `nodeKind()` function SHALL NOT route command nodes.

**Affected file:** `packages/workflows/src/dag/runners/node-runner.ts`
**Verification:** `grep -n "isCommandNode\|command" packages/workflows/src/dag/runners/node-runner.ts` returns zero matches.

### R7 — DAG context and executor (Ubiquitous)
The `DagRunContext` type SHALL NOT contain `configuredCommandFolder`.
The `dag-executor.ts` SHALL NOT reference `configuredCommandFolder`.
Gate logging SHALL use `node.id`, not `node.command`.

**Affected files:**
- MODIFY `packages/workflows/src/dag/context.ts` — remove `configuredCommandFolder`
- MODIFY `packages/workflows/src/dag-executor.ts` — remove `configuredCommandFolder` handling
- MODIFY `packages/workflows/src/dag/gates.ts` — replace `node.command` with `node.id`

**Verification:** `grep -rn "configuredCommandFolder\|node\.command" packages/workflows/src/dag/` returns zero matches.

### R8 — DAG executor tests (Ubiquitous)
The `dag-executor.test.ts` SHALL NOT create command files or mock command
loading. Any test nodes that were `command:` type SHALL be rewritten as
`prompt:` type.

**Affected file:** `packages/workflows/src/dag-executor.test.ts`
**Verification:** `grep -n "command:" packages/workflows/src/dag-executor.test.ts` returns only comments or string literals inside prompt text, not node definitions.

### R9 — Config types (Ubiquitous)
The `WorkflowConfig` type SHALL NOT contain `commands.folder` or
`loadDefaultCommands`. When an existing `config.yaml` contains these keys,
the system SHALL silently ignore them (Zod strip mode — no validation error).

**Affected file:** `packages/workflows/src/deps.ts`
**Verification:** `grep -n "commands\.\|loadDefaultCommands" packages/workflows/src/deps.ts` returns zero matches.

### R10 — Path helpers (Ubiquitous)
`getCommandFolderSearchPaths()` and `getHomeCommandsPath()` SHALL NOT exist.
These SHALL NOT appear in `packages/paths/src/index.ts` exports.

**Affected files:**
- MODIFY `packages/paths/src/rith-paths.ts` — delete both functions
- MODIFY `packages/paths/src/index.ts` — remove exports

**Verification:** `grep -rn "getCommandFolderSearchPaths\|getHomeCommandsPath" packages/paths/` returns zero matches.

### R11 — CLI validate (Ubiquitous)
The CLI validate subcommand SHALL NOT reference command validation functions.

**Affected file:** `packages/cli/src/commands/validate.ts`
**Verification:** `grep -n "command" packages/cli/src/commands/validate.ts` returns only CLI subcommand references (the word "command" in the CLI sense), not the workflow node type.

### R12 — Schema tests (Ubiquitous)
Schema tests SHALL NOT contain `CommandNode` test cases.
The `DagNode` union tests SHALL reflect the updated union without `CommandNode`.

**Affected file:** `packages/workflows/src/schemas.test.ts`
**Verification:** `grep -n "CommandNode\|commandNode" packages/workflows/src/schemas.test.ts` returns zero matches.

### R13 — Loader (Ubiquitous)
The workflow loader and its tests SHALL NOT import or reference `CommandNode`.

**Affected files:**
- MODIFY `packages/workflows/src/loader.ts` — remove `CommandNode` imports if present
- MODIFY `packages/workflows/src/loader.test.ts` — remove command test cases

**Verification:** `grep -n "CommandNode\|command" packages/workflows/src/loader.ts` returns zero type-level matches.

### R14 — E2E test (Event-driven)
WHEN the e2e-pi-all-nodes-smoke test runs, THEN it SHALL use a `prompt:` node
with the echo content inlined instead of `command: e2e-echo-command`.

**Affected file:** `.rith/workflows/test-workflows/e2e-pi-all-nodes-smoke.yaml`

The `e2e-echo-command.md` file and `.rith/workflows/e2e/commands/` directory
SHALL NOT exist.

**Verification:** `grep -n "command:" .rith/workflows/test-workflows/e2e-pi-all-nodes-smoke.yaml` returns zero matches. `test -d .rith/workflows/e2e/commands && echo FAIL || echo PASS` returns PASS.

### R15 — Workflow builder docs (Ubiquitous)
The workflow builder's prompt in `rith-workflow-builder.yaml` SHALL NOT list
`command:` as a node type. The node type taxonomy SHALL show: bash, prompt,
skills, script, loop, approval.

**Affected file:** `.rith/workflows/defaults/rith-workflow-builder.yaml`
**Verification:** `grep -n "command" .rith/workflows/defaults/rith-workflow-builder.yaml` returns only the word "command" in natural-language sentences, not as a YAML node type definition.

### R16 — Documentation (Ubiquitous)
Documentation pages SHALL NOT teach the `command:` node type.
Pages dedicated entirely to commands SHALL be deleted or rewritten for skills.

**Affected files:**
- MODIFY or DELETE `packages/docs-web/src/content/docs/book/first-command.md`
- MODIFY or DELETE `packages/docs-web/src/content/docs/guides/authoring-commands.md`
- MODIFY `packages/docs-web/src/content/docs/book/dag-workflows.md` — replace command examples with prompt/skill examples
- MODIFY `packages/docs-web/src/content/docs/guides/authoring-workflows.md` — remove command node documentation
- MODIFY `packages/docs-web/src/content/docs/guides/global-workflows.md` — remove `~/.rith/commands/` sections
- MODIFY `packages/docs-web/src/content/docs/getting-started/concepts.md` — remove command concept

**Verification:** `grep -rn "command:" packages/docs-web/src/content/` returns only natural-language uses, not YAML node type references.

### R17 — CLAUDE.md (Ubiquitous)
`CLAUDE.md` SHALL NOT reference `.rith/commands/` directories, command loading
mechanics, or `loadDefaultCommands` config.

**Affected file:** `CLAUDE.md`
**Verification:** `grep -n "\.rith/commands\|loadDefaultCommands" CLAUDE.md` returns zero matches.

### R18 — YAML sweep (Ubiquitous)
No workflow YAML file anywhere under `.rith/workflows/` SHALL contain a
node-level `command:` key.

**Verification:** `grep -rn "^    command:" .rith/workflows/` returns zero matches.

### R19 — Backward compatibility (Unwanted)
WHEN an existing `config.yaml` contains `commands.folder` or
`defaults.loadDefaultCommands`, the system SHALL NOT throw a validation error.
These keys SHALL be silently ignored.

**Verification:** Create a temporary config.yaml with `commands: { folder: "old" }` and `defaults: { loadDefaultCommands: true }`. Loading the config SHALL succeed without error.

---

## Exclusions (SHALL NOT be touched)

- `.claude/commands/` — Claude Code slash commands. Completely separate system.
- `.github/prompts/` — GitHub Copilot prompt files. Separate system.
- `script:` node type — deterministic execution, not a prompt substitute.
- Skill body content (Claude-ism cleanup is a separate effort).

---

## Execution Order

Requirements can be grouped into 4 parallel work streams, then merged:

```
Stream A (Schema):        R1 → R2 → R12 → R13
Stream B (Runtime):       R3 → R5 → R6 → R7 → R8
Stream C (Loader/Valid):  R3 → R4 → R9 → R10 → R11
Stream D (Content/Docs):  R14 → R15 → R16 → R17

                    ↓ all streams complete ↓

                  R18 (sweep verification)
                  R19 (backward compat check)
                  bun run validate (zero failures)
```

Note: R1 (schema removal) is the keystone — Streams A, B, C depend on it.
Stream D is fully independent.

---

## Final Validation

```bash
# 1. No command infrastructure in source
grep -rn "CommandNode\|commandNodeSchema\|loadCommandPrompt\|isValidCommandName\|discoverAvailableCommands\|resolveCommand\|getCommandFolderSearchPaths\|getHomeCommandsPath\|configuredCommandFolder\|isCommandNode" packages/

# 2. No command: nodes in workflows
grep -rn "^    command:" .rith/workflows/

# 3. No command files or directories
test -d .rith/workflows/e2e/commands && echo FAIL || echo PASS
test -f packages/workflows/src/command-validation.ts && echo FAIL || echo PASS
test -f packages/workflows/src/load-command-prompt.test.ts && echo FAIL || echo PASS

# 4. Full validation suite
bun run validate
```

ALL checks SHALL return zero matches / PASS / exit code 0.

---

## Rollback

Reversible via `git revert`. No database changes. No config file migrations
required — R19 ensures old configs are silently tolerated.
