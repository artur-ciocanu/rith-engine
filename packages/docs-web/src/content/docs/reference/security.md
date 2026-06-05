---
title: Security
description: Security model, permissions, authorization, and data privacy in Rith Engine.
category: reference
audience: [user, operator]
sidebar:
  order: 8
---

This page covers Rith Engine's security model: how AI permissions work, how platform access is controlled, how webhooks are verified, and what data is and is not logged.

## Permission Model

Rith Engine runs the Pi Coding Agent without interactive permission prompts. This means the AI agent can read, write, and execute files without per-action confirmation.

**Why this is used:**
- Rith Engine is designed for automated, unattended workflows triggered from the CLI and CI pipelines where there is no human at a terminal to approve each action.
- Requiring interactive permission prompts would block every workflow and make remote operation impossible.

**What this means in practice:**
- The AI assistant has full read/write access to the working directory (the cloned repository or worktree).
- It can run shell commands, modify files, and use all of Pi's built-in tools.
- There is no per-action confirmation step.

**Mitigations:**
- Each conversation runs in an isolated git worktree by default, limiting the blast radius of any changes.
- Workflows support per-node tool restrictions (see below) to constrain what the AI can do at each step.
- The system is designed as a single-developer tool -- there is no multi-tenant isolation.

:::caution
Because `bypassPermissions` grants full file and shell access, only run Rith Engine in environments where the AI agent is trusted with the repository contents. Do not expose Rith Engine to untrusted users without adapter-level authorization (see below).
:::

## Tool Restrictions

Workflow nodes support `allowed_tools` and `denied_tools` to restrict which tools the AI can use at each step. This is useful for creating sandboxed steps that can only read code (not modify it) or preventing specific tool usage.

```yaml
nodes:
  - id: review
    prompt: "Review the code for security issues"
    allowed_tools: [Read, Grep, Glob]  # Can only read, not write

  - id: implement
    prompt: "Fix the issues found"
    denied_tools: [WebSearch, WebFetch]  # No internet access
```

**How it works:**
- `allowed_tools` is a whitelist -- only listed tools are available. An empty list (`[]`) disables all tools.
- `denied_tools` is a blacklist -- listed tools are blocked, all others are available.
- These are mutually exclusive per node. If both are set, `allowed_tools` takes precedence.
- Tool restrictions are enforced by Pi. Pi's built-in tools are `read, bash, edit, write, grep, find, ls`; an empty `allowed_tools` (`[]`) disables all of them, and unknown tool names (e.g. Claude's `WebFetch`) are ignored with a warning.

## Data Privacy and Logging

Rith Engine uses structured logging (Pino) with explicit rules about what is and is not recorded.

**Never logged:**
- API keys or tokens (masked to first 8 characters + `...` when referenced)
- User message content (the text users send to the AI)
- Personally identifiable information (PII)

**Logged (with context):**
- Conversation IDs, session IDs, workflow run IDs
- Event names (e.g., `session.create_started`, `workflow.step_completed`)
- Error messages and types (for debugging)
- Unauthorized access attempts (with masked user IDs, e.g., `abc***`)

**Log levels:**
- Default: `info` (operational events only)
- Set `LOG_LEVEL=debug` for detailed execution traces
- CLI: `--quiet` (errors only) or `--verbose` (debug)

## Adapter Authorization

Each platform adapter supports an optional user whitelist via environment variables. When a whitelist is configured, only listed users can interact with the bot. When the whitelist is empty or unset, the adapter operates in open access mode.

| Platform | Whitelist Variable | Format |
| --- | --- | --- |
| GitHub | `GITHUB_ALLOWED_USERS` | Comma-separated GitHub usernames (case-insensitive) |
| Gitea | `GITEA_ALLOWED_USERS` | Comma-separated Gitea usernames (case-insensitive) |
**Authorization behavior:**
- Whitelist is parsed once at adapter startup (from the environment variable).
- Every incoming message or webhook is checked before processing.
- Unauthorized users are silently rejected -- no error response is sent back.
- Unauthorized attempts are logged with masked user identifiers for auditing.

## Webhook Security

The GitHub and Gitea adapters verify webhook signatures to ensure payloads originate from the configured platform and have not been tampered with.

**GitHub:**
- Uses the `X-Hub-Signature-256` header
- HMAC SHA-256 computed over the raw request body using `WEBHOOK_SECRET`
- Timing-safe comparison prevents timing attacks
- Invalid signatures are rejected and logged

**Gitea:**
- Uses the `X-Gitea-Signature` header (raw hex, no `sha256=` prefix)
- Same HMAC SHA-256 verification and timing-safe comparison
- Invalid signatures are rejected and logged

**Setup:**
1. Generate a random secret: `openssl rand -hex 32`
2. Set it in both the platform webhook configuration and Rith Engine's environment (`WEBHOOK_SECRET` for GitHub, `GITEA_WEBHOOK_SECRET` for Gitea)
3. The secrets must match exactly

## Secrets Handling

**Environment files:**
- All secrets (API keys, tokens, webhook secrets) belong in rith-owned `.env` files (`~/.rith/.env` or `<cwd>/.rith/.env`), never in source control.
- Never put rith secrets in `<cwd>/.env` — that file is stripped at boot (see below) and `rith setup` never writes to it. Put them in `~/.rith/.env` (home scope) or `<cwd>/.rith/.env` (project scope).
- Rith Engine's `.gitignore` excludes `.env` files. `<cwd>/.rith/.env` should also be gitignored (project-local secrets).

**Subprocess env isolation:**
- At startup, `stripCwdEnv()` removes **all** keys that Bun auto-loaded from the CWD `.env` files (`.env`, `.env.local`, `.env.development`, `.env.production`), plus nested Claude Code session markers (`CLAUDECODE`, `CLAUDE_CODE_*` except auth vars) and debugger vars (`NODE_OPTIONS`, `VSCODE_INSPECTOR_OPTIONS`). This runs before any module reads `process.env`.
- Then `loadRithEnv(cwd)` loads rith-owned env from `~/.rith/.env` (user scope) and `<cwd>/.rith/.env` (repo scope, wins over user) with `override: true`. Both are trusted sources — the user controls them and all keys are intentional.
- Per-codebase env vars configured via `codebase_env_vars` or `.rith/config.yaml` `env:` are merged on top at workflow execution time.
- `<cwd>/.env` is the **only** untrusted source. It belongs to the target project, not to Rith Engine. Directory ownership (`.rith/`) is the security boundary — not the filename.

### Target repo `.env` isolation

Rith Engine prevents target repo `.env` from leaking into subprocesses through structural protection:

1. **Boot cleanup:** `stripCwdEnv()` removes Bun-auto-loaded CWD `.env` keys from `process.env` before any application code runs. **This is the primary guard** — every subprocess Rith Engine spawns inherits from the already-cleaned `process.env`.
2. **Claude Code subprocess:** when the SDK is configured to spawn a Bun-runnable JS entry point (legacy npm-installed `cli.js`/`cli.mjs`/`cli.cjs`), Rith Engine also passes `executableArgs: ['--no-env-file']` so Bun skips its env autoload inside the spawned process. SDK 0.2.x ships per-platform native binaries instead — those don't auto-load `.env` from cwd, so the flag is unnecessary and is omitted.
3. **Bun script nodes:** `bun --no-env-file` prevents script node subprocesses from loading target repo `.env`.
4. **Bash nodes:** Not affected — bash does not auto-load `.env` files.

Rith Engine's own env sources (`~/.rith/.env`, dev `.env`) are loaded after the CWD strip and pass through to subprocesses normally.

**If you need env vars available during workflow execution**, use managed env injection:
- `.rith/config.yaml` `env:` section (per-repo, checked into version control)
- Per-codebase env vars stored in the Rith Engine DB (managed via CLI)

**CORS:**

**Docker deployments:**
- Pi authenticates via `~/.pi/agent/auth.json` (mount it into the container) or the API-key env vars `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`.
- Escape `$` as `$$` in Docker Compose `.env` files to prevent variable substitution of bcrypt hashes.
