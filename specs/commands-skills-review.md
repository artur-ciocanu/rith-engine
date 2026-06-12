# Review: Commands → Skills Migration (`feat/commands-workflows-overhaul`)

**Status:** Review complete — one genuine issue to fix, one design conclusion to record.
**Reviewed commit:** `c6a8770` ("feat: convert commands to agentskills.io skills, kill bundled-defaults codegen")
**Audience:** Implementer picking up the follow-up cleanup.

---

## TL;DR

- The skills migration is conceptually sound. The five-criteria framework in
  `specs/commands-workflows-overhaul.md` is good and was mostly applied well.
- **There is one genuine issue worth a focused PR: the _inlining_ half of the
  migration reintroduced large-scale copy-paste duplication that the old
  `command:` files were preventing — and the copies have already started to
  drift.** It is a maintainability/drift problem, not a runtime bug. Tests pass;
  workflows run.
- A design conclusion (below) settles whether `command:` should exist at all:
  in Rith's runtime, a node-referenced skill strictly dominates a command, so
  `command:` is a legacy escape hatch. Keep it in the schema, stop using it.

---

## Design conclusion: `command:` is subsumed by node-referenced `skills:`

This is the lens the fix should be implemented through.

**Runtime facts (verified in code):**

- `packages/workflows/src/dag/runners/ai-node-runner.ts` — a `command:` node calls
  `loadCommandPrompt()` and assigns the file's full text to `rawPrompt`; a
  `prompt:` node assigns `node.prompt`. Both then become the prompt verbatim.
  **`command:` and `prompt:` are runtime-identical** — a command is just an
  external, reusable prompt file.
- `packages/pi/src/resource-loader.ts` — `createNoopResourceLoader` always sets
  `noSkills: true`. Skills/prompts/themes stay suppressed even when extensions
  are enabled.
- `packages/pi/src/agent.ts` (~L405–410, L554–556) — the only skills Pi ever sees
  come from `additionalSkillPaths`, populated **solely** by
  `resolvePiSkills(cwd, nodeConfig?.skills)` — i.e. the names in that node's
  `skills:` array. There is **no global skill discovery, no catalog presented to
  the model, no model-initiated skill invocation** during workflow execution.

**Consequence:** a skill referenced by one node is loaded only at that node and
is invisible everywhere else — the same "private, non-discoverable, reusable"
property a command had, plus frontmatter, progressive disclosure (the SKILL.md
body is loaded on demand, not forced into context), and `references/`+`assets/`
overflow. Rith cleanly separates two kinds of discretion:

- **WHICH procedure runs** → decided deterministically by the workflow node
  (the rail). The model does not choose.
- **HOW MUCH of that procedure enters context** → progressive disclosure,
  decided by the model as it works.

A `command:` collapses both into "the entire text, always." Therefore:

- Target architecture for **all** workflows (production _and_ maintainer):
  `skills:` (reusable SOPs) + `prompt:` (thin glue) + `bash:` (enforcement).
- Keep `command:` in the schema/runtime (cheap, harmless escape hatch); do not
  add new usages.

---

## The genuine issue: inlining duplicated reusable SOPs across workflows

The plan classified three commands as "inline" / "extract + inline" instead of
"skill." On inspection that was the wrong call, and it produced the duplication.

### Evidence

- `rith-plan-to-pr.yaml` (1597 lines) and `rith-idea-to-pr.yaml` (1607 lines) are
  **~99% byte-identical**. `idea-to-pr` is `plan-to-pr` plus one upfront
  `create-plan` node (the only diff is `depends_on: [create-plan]`).
- The `review-scope` node block (~566 lines) is **byte-identical** between
  `plan-to-pr` and `idea-to-pr`, and exists as a **drifted ~457-line variant** in
  `rith-fix-github-issue.yaml` (different mission line, missing
  `PHASE_1_CHECKPOINT`, etc.). **Drift has already begun.**
- The three duplicated inlined blobs:
  - `review-scope` — ~566 lines (30 lines `bash:` enforcement + ~470 lines
    `prompt:` SOP). Present in `plan-to-pr`, `idea-to-pr`, `fix-github-issue`.
  - `plan-setup` — ~388 lines. Present in `plan-to-pr`, `idea-to-pr`.
  - `workflow-summary` — ~512 lines (output-template prompt). Present in
    `plan-to-pr`, `idea-to-pr`.
- Within the `review-scope` node, the `bash:` block already resolves the PR
  number and writes `$ARTIFACTS_DIR/.pr-number`, and then the `prompt:`
  re-instructs the model to resolve the PR number and write the same file —
  **dead instructions** (bash already guarantees the file).

Before this branch, those procedures were single `command:` files referenced by
N workflows (one source of truth). Inlining copy-pasted them N times.

### Why it matters (and why it's not a bug)

- No runtime/correctness problem — every copy is independently valid; no test
  catches divergence.
- The cost is paid in edit-time and silent drift: a fix to any of these
  procedures must be applied in 2–3 places and kept in sync by hand. One copy
  has already diverged. The cost compounds with every future edit.

### What is fixable now vs. not

1. **Content duplication (fix now):** the ~1,466 lines of inlined SOP text.
   Extract each into a node-referenced skill (keep the small `bash:` plumbing as
   a `bash:` node). One source of truth; workflows shrink dramatically.
2. **Topology duplication (do NOT fix here):** `idea-to-pr` restating
   `plan-to-pr`'s entire DAG (node IDs, `depends_on`, `when:`). Skills do not fix
   this — Rith has no workflow-include/composition primitive. Eliminating it
   needs a new feature; out of scope. Record as a known limitation.

---

## Tasks (in priority order)

> Implement through the design lens above: every inlined SOP becomes
> `bash:` (enforcement) + node-referenced `skill:` (the SOP) + `prompt:` (thin
> glue passing node-specific context like PR number / "execute tasks only").

### Task 1 — Extract `review-scope` → `rith-pr-review-scope` skill (highest payoff)

- Create `.rith/skills/rith-pr-review-scope/SKILL.md` from the ~470-line `prompt:`
  body of the `review-scope` node, with agentskills.io front matter
  (`name`, third-person `description` with a "Use when…" clause, `metadata`).
- Keep the ~30-line `bash:` plumbing (PR-number resolution, `mkdir`, stale
  cleanup) as a `bash:` node (it already exists; e.g. `review-scope-setup` in
  `fix-github-issue`).
- Reference the skill from all three consumers and reduce each node's `prompt:`
  to node-specific glue only:
  - `rith-plan-to-pr.yaml` `review-scope`
  - `rith-idea-to-pr.yaml` `review-scope`
  - `rith-fix-github-issue.yaml` `review-scope` (reconcile the drifted variant —
    pick the correct canonical content first)
- Delete the prompt's redundant PR-number re-derivation now that `bash:` owns it.

### Task 2 — Extract `workflow-summary` → skill

- Create `.rith/skills/rith-workflow-summary/SKILL.md` from the output-template
  `prompt:` (this is "task content" — an output template skill; valid per the
  plan's two-content-types section). If it is mostly a template, put the template
  under `assets/` and keep SKILL.md thin.
- Reference from `rith-plan-to-pr.yaml` and `rith-idea-to-pr.yaml`
  `workflow-summary` nodes; reduce each `prompt:` to glue.

### Task 3 — Extract `plan-setup` → skill (or split)

- The `plan-setup` node is workflow glue (locate plan file, ensure git state,
  write artifact). Prefer: keep the deterministic git/locate logic in `bash:`,
  and if there is genuine reusable methodology, put it in a skill; otherwise
  leave a thin shared `bash:` + glue `prompt:`.
- De-duplicate between `rith-plan-to-pr.yaml` and `rith-idea-to-pr.yaml`.

### Task 4 — Sweep for other inlined duplication

- `grep` the production workflows for any other large `prompt:` blocks repeated
  across files (the review-dimension nodes already correctly use `skills:` — do
  not touch those).

### Out of scope (record, do not implement)

- A workflow include/extends/composition mechanism to remove the
  `plan-to-pr` ↔ `idea-to-pr` topology duplication. Note as a follow-up if the
  team wants it.
- Removing the `command:` node type from schema/runtime. Leave it functional.
- CLAUDE.md / Claude-ism cleanup in skill bodies (already deferred in
  `specs/commands-workflows-overhaul.md` Appendix A).

---

## Acceptance criteria

- [ ] `review-scope`, `workflow-summary`, and `plan-setup` procedural content
      each live in exactly one place (a skill and/or a single `bash:` block),
      referenced — not inlined — by every consuming workflow.
- [ ] `rith-plan-to-pr.yaml`, `rith-idea-to-pr.yaml`, and
      `rith-fix-github-issue.yaml` contain no copy of those SOP bodies in their
      node `prompt:` fields (only node-specific glue remains).
- [ ] The three `review-scope` copies are reconciled to one canonical skill (the
      `fix-github-issue` drift is resolved deliberately, not preserved).
- [ ] The redundant PR-number re-derivation in the `review-scope` prompt is
      deleted.
- [ ] New skills have valid agentskills.io front matter (third-person
      `description` + "Use when…").
- [ ] `bun run validate` passes (type-check, lint, format, tests).
- [ ] `bun run cli validate workflows` passes for all touched workflows.

---

## Notes for the implementer

- Skills resolve via `resolveSkillDirectories()` /
  `packages/pi/src/skills.ts`; `.rith/skills/` (project) and `~/.rith/skills/`
  (home) are highest priority. A node references a skill by directory name:
  `skills: [rith-pr-review-scope]`.
- The skill body is loaded on demand (progressive disclosure); the node
  `prompt:` should carry only node-specific context, not the procedure.
- Keep `$ARTIFACTS_DIR`-based wiring in `bash:` nodes where it belongs; it is
  fine inside workflow nodes (the executor pre-creates it), even though it makes
  the skills not strictly standalone — that is acceptable for workflow task
  skills and is a separate concern from this cleanup.
