# Rith Engine — Phase A: Broad Rename Plan

## Status: ✅ COMPLETE

Completed 2026-06-01. Initial commit `ac35bc9` on `main`, pushed to `artur-ciocanu/rith-engine`.
PR #1 (simplify-readme) open on branch `simplify-readme`.

---

## Repo Details

- **Location**: `~/personal/code/rith-engine`
- **Remote**: `git@github-personal:artur-ciocanu/rith-engine.git`
  (uses `github-personal` SSH host alias — configured in `~/.ssh/config` to use `~/.ssh/github_personal_ed25519`)
- **GitHub CLI**: use `gh-personal` (not `gh`) for PR/issue operations
- **Husky pre-commit**: has lint-staged with prettier + eslint. Use `--no-verify` if a test fixture file triggers prettier errors (`.rith/scripts/__tests__/fixtures/malicious/cred_leak.ts` is intentionally malformed).

---

## What Was Done

Fork of [Archon](https://github.com/coleam00/Archon) (MIT, Cole Medin).
Mechanical rename only — no logic changes, no package deletions.
All tests pass, type-check clean.

### Naming Conventions Applied

| From | To |
|---|---|
| Root package name `archon` | `rith-engine` |
| Workspace scope `@archon/*` | `@rith/*` |
| CLI binary name `archon` | `rith` |
| Dot-directory `~/.archon/`, `.archon/` | `~/.rith/`, `.rith/` |
| Env vars `ARCHON_HOME`, `ARCHON_DOCKER`, `ARCHON_DATA`, `ARCHON_USER_HOME` | `RITH_HOME`, `RITH_DOCKER`, `RITH_DATA`, `RITH_USER_HOME` |
| GitHub repo `coleam00/Archon` | `artur-ciocanu/rith-engine` |
| User-facing brand "Archon" | "Rith Engine" (long form) or "Rith" (short form) |
| CLI help header | "Rith Engine CLI" |
| Default workflows prefix `archon-*` | `rith-*` |
| Docker image/volumes/network | `rith-engine`, `rith_data`, `rith_user_home`, `rith-network` |
| Branch prefix `archon/task-*` | `rith/task-*` |
| Bot display name default | `'Rith Engine'` |
| Binary output names | `rith-darwin-arm64`, `rith-linux-x64`, etc. |
| Web tarball | `rith-web.tar.gz` |
| Skill install dir | `.claude/skills/rith/` |
| DB name `remote_coding_agent` | kept as-is (cosmetic, change later) |

### Files Deleted
- `homebrew/` (Archon's Homebrew tap)
- `.github/workflows/` (Archon CI)
- `graphify-out/` (analysis artifact)
- `assets/logo.png` (Archon logo, removed in PR #1)

### Files Created
- `ATTRIBUTION.md`

### Key Function Renames (packages/paths)
- `getArchonHome` → `getRithHome`
- `getArchonWorkspacesPath` → `getRithWorkspacesPath`
- `ensureArchonWorkspacesPath` → `ensureRithWorkspacesPath`
- `getArchonWorktreesPath` → `getRithWorktreesPath`
- `getArchonConfigPath` → `getRithConfigPath`
- `getArchonEnvPath` → `getRithEnvPath`
- `getRepoArchonEnvPath` → `getRepoRithEnvPath`
- `getAppArchonBasePath` → `getAppRithBasePath`
- `logArchonPaths` → `logRithPaths`
- `loadArchonEnv` → `loadRithEnv`
- `copyArchonSkill` → `copyRithSkill`
- `archon-paths.ts` → `rith-paths.ts`

### Test Fixes Required During Rename
Three issues arose from the mechanical rename:
1. **Grammar**: "an Archon" → "a Rith Engine" (article fix in YAML/comments)
2. **Orchestrator partial-match test**: "Archon" was both brand and repo name (exact match). "Rith" doesn't substring-match "rith-engine". Fixed tests to use "rith-engine" as partial match input.
3. **Bot mention tests**: `@archon` (single word) worked as mention, but default bot name became "Rith Engine" (two words). Fixed GitHub/Gitea adapter tests to use correct mention format.

### Verification Results
- `bun install` ✅
- `bun run type-check` ✅ (all 10 packages)
- `bun run test` ✅ (83 test suite runs, 0 failures)
- `grep -ri 'archon'` ✅ (zero matches in functional code; only ATTRIBUTION.md and LICENSE)

---

## Phase B — Pi-Only Refactor (NEXT)

Reference: `rith-fork-plan.md` in this repo (the original detailed plan, Phases 2-6)

### Goal
Strip to a pure CLI workflow executor with Pi as the sole AI provider.
Remove Claude/Codex/Copilot providers, registry ceremony, hooks,
settingSources, Claude-specific env stripping. Keep web, server, adapters
(they still work, just with Pi as sole provider).

### Key Changes (from rith-fork-plan.md Phases 2-6)
1. **Gut provider layer** (`packages/providers/`): delete Claude, Codex, Copilot, OpenCode providers. Delete registry. Flatten Pi as sole provider.
2. **Strip DSL**: remove `hooks:` from workflow schema, remove `provider:` field, simplify `model:` to Pi model refs.
3. **Remove `settingSources`** from config types, loader, tests.
4. **Simplify core**: delete orchestrator (or simplify), simplify config types, remove multi-provider config.
5. **Simplify CLI**: remove provider registration bootstrap, Claude auth defaults.
6. **Simplify workflow engine**: `WorkflowDeps.getAgentProvider` factory → direct Pi provider, remove capability warnings.

### Decision Points Still Open
- **`provider:` field**: delete or repurpose? (recommendation: delete)
- **SQLite vs Postgres**: keep both or SQLite-only?
- **Orchestrator**: keep simplified or delete entirely?
- **Skill system**: keep `.claude/skills/` search path or switch to `.rith/skills/`?
- **MCP support**: Pi doesn't natively support MCP — evaluate or drop
- **DB schema**: fresh `000_rith_schema.sql` or keep incremental migrations?
- **Sessions/conversations tables**: needed for Pi (stateless) or drop?
