/**
 * Setup command - Interactive CLI wizard for Rith Engine configuration.
 *
 * Pi-only, CLI-only port of the upstream Archon setup wizard. Drops the
 * multi-provider (Claude/Codex) auth flows and the Slack/Telegram/GitHub-bot
 * platforms — Rith Engine targets Pi as its sole AI provider and a solo
 * `GITHUB_TOKEN` for `gh`. The wizard:
 *   1. Picks a default Pi backend + (optional) API key.
 *   2. Optionally records a `GITHUB_TOKEN` for `gh`-driven workflows.
 *   3. Writes secrets to the rith-owned `.env` (home or project scope, merged).
 *   4. Writes the default model ref to `~/.rith/config.yaml`.
 *   5. Offers to run `rith doctor` to verify.
 *
 * The rith-owned `.env` is `~/.rith/.env` (home) or `<repo>/.rith/.env`
 * (project) — never `<repo>/.env`, which belongs to the user and is scrubbed
 * from the rith process at runtime.
 */
import {
  intro,
  outro,
  password,
  select,
  confirm,
  note,
  spinner,
  isCancel,
  cancel,
  log,
} from '@clack/prompts';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, chmodSync } from 'fs';
import { parse as parseDotenv } from 'dotenv';
import { join, dirname } from 'path';
import { getRithEnvPath, getRepoRithEnvPath, getRithHome, createLogger } from '@rith/paths';
import type { Logger } from '@rith/paths';
import { doctorCommand } from './doctor';

let cachedLog: Logger | undefined;
function getLog(): Logger {
  if (!cachedLog) cachedLog = createLogger('cli.setup');
  return cachedLog;
}

// =============================================================================
// Types & backend catalog
// =============================================================================

// Pi backends offered by the wizard. `envVar` names mirror PI_API_KEY_VARS in
// doctor.ts and PI_PROVIDER_ENV_VARS in packages/providers/src/pi/provider.ts.
const PI_BACKENDS = [
  {
    id: 'anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    label: 'Anthropic',
    hint: 'claude-haiku-4-5, claude-sonnet-4-5, etc.',
  },
  { id: 'openai', envVar: 'OPENAI_API_KEY', label: 'OpenAI', hint: 'gpt-4o, etc.' },
  {
    id: 'google',
    envVar: 'GEMINI_API_KEY',
    label: 'Google (Gemini)',
    hint: 'gemini-2.5-pro, etc.',
  },
  {
    id: 'openrouter',
    envVar: 'OPENROUTER_API_KEY',
    label: 'OpenRouter',
    hint: 'qwen/qwen3-coder, many others',
  },
  { id: 'groq', envVar: 'GROQ_API_KEY', label: 'Groq', hint: 'llama-3.3-70b-versatile, etc.' },
  { id: 'mistral', envVar: 'MISTRAL_API_KEY', label: 'Mistral', hint: 'mistral-large, etc.' },
  { id: 'xai', envVar: 'XAI_API_KEY', label: 'xAI (Grok)', hint: 'grok-3, etc.' },
  { id: 'cerebras', envVar: 'CEREBRAS_API_KEY', label: 'Cerebras', hint: 'llama3.1-70b, etc.' },
  {
    id: 'huggingface',
    envVar: 'HUGGINGFACE_API_KEY',
    label: 'Hugging Face',
    hint: 'inference API',
  },
] as const;

const PI_DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'anthropic/claude-haiku-4-5',
  openai: 'openai/gpt-4o',
  google: 'google/gemini-2.5-pro',
  openrouter: 'openrouter/qwen/qwen3-coder',
  groq: 'groq/llama-3.3-70b-versatile',
  mistral: 'mistral/mistral-large-latest',
  xai: 'xai/grok-3',
  cerebras: 'cerebras/llama3.1-70b',
  huggingface: 'huggingface/Qwen/Qwen2.5-72B-Instruct',
};

export interface PiSetupConfig {
  /** Model ref e.g. 'anthropic/claude-haiku-4-5' — written to ~/.rith/config.yaml. */
  model: string;
  /** API key value for the chosen backend, if provided. */
  apiKey?: string;
  /** Canonical env var name for the chosen backend, e.g. 'ANTHROPIC_API_KEY'. */
  apiKeyEnvVar?: string;
}

export interface SetupConfig {
  pi: PiSetupConfig;
  /** Optional GitHub token for `gh`-driven workflows. */
  githubToken?: string;
}

export interface ExistingConfig {
  hasPi: boolean;
  hasGithub: boolean;
}

export interface SetupOptions {
  repoPath: string;
  /** Which rith-owned file to target. Default: 'home'. */
  scope?: 'home' | 'project';
  /** Skip merge and overwrite the target wholesale (backup still written). Default: false. */
  force?: boolean;
}

// =============================================================================
// Existing-config detection
// =============================================================================

/** True when `content` has a non-empty value for `key`. */
function hasEnvValue(content: string, key: string): boolean {
  const regex = new RegExp(`^${key}=(.+)$`, 'm');
  const match = content.match(regex);
  return match !== null && match[1].trim().length > 0;
}

/**
 * Thin wrapper around `existsSync` so tests can spy on it by name without
 * fighting ESM named-import rebinding.
 */
export function probeFileExists(path: string): boolean {
  return existsSync(path);
}

/**
 * Inspect the rith-owned env file at the selected scope for already-configured
 * Pi and GitHub credentials. Returns null when the file is absent.
 */
export function checkExistingConfig(envPath: string): ExistingConfig | null {
  if (!probeFileExists(envPath)) {
    return null;
  }
  const content = readFileSync(envPath, 'utf-8');
  return {
    hasPi: PI_BACKENDS.some(b => hasEnvValue(content, b.envVar)),
    hasGithub: hasEnvValue(content, 'GITHUB_TOKEN') || hasEnvValue(content, 'GH_TOKEN'),
  };
}

// =============================================================================
// Interactive collection
// =============================================================================

/**
 * Collect the default Pi backend and an optional API key. One backend per run;
 * users with multiple backends re-run setup or hand-edit `.env`.
 */
async function collectPiConfig(): Promise<PiSetupConfig> {
  const backendChoice = await select({
    message: 'Which Pi backend will you use as the default?',
    options: PI_BACKENDS.map(b => ({ value: b.id, label: b.label, hint: b.hint })),
  });

  if (isCancel(backendChoice)) {
    cancel('Setup cancelled.');
    process.exit(0);
  }

  const backend = PI_BACKENDS.find(b => b.id === backendChoice);
  if (!backend) {
    // Unreachable: select() only returns one of the option values, but narrow
    // defensively so PI_DEFAULT_MODELS is never indexed with undefined.
    cancel('Unknown Pi backend selected.');
    process.exit(1);
  }
  const model = PI_DEFAULT_MODELS[backendChoice] ?? `${backendChoice}/default`;

  const apiKey = await password({
    message: `Enter ${backend.envVar} (press Enter to skip — you can set it later):`,
    // Empty input is allowed; users can configure the key later by hand.
    validate: () => undefined,
  });

  if (isCancel(apiKey)) {
    cancel('Setup cancelled.');
    process.exit(0);
  }

  const key = apiKey.trim();
  return {
    model,
    ...(key.length > 0 ? { apiKey: key, apiKeyEnvVar: backend.envVar } : {}),
  };
}

/** Collect an optional GitHub token for `gh`-driven workflows. */
async function collectGitHubToken(): Promise<string | undefined> {
  const wantsGithub = await confirm({
    message: 'Configure a GitHub token for `gh`-driven workflows? (optional)',
    initialValue: false,
  });
  if (isCancel(wantsGithub)) {
    cancel('Setup cancelled.');
    process.exit(0);
  }
  if (!wantsGithub) return undefined;

  const token = await password({
    message: 'Enter GITHUB_TOKEN (press Enter to skip):',
    validate: () => undefined,
  });
  if (isCancel(token)) {
    cancel('Setup cancelled.');
    process.exit(0);
  }
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// =============================================================================
// File generation & writing
// =============================================================================

/** Generate `.env` content from the collected configuration. */
export function generateEnvContent(config: SetupConfig): string {
  const lines: string[] = [];

  lines.push('# Rith Engine Configuration');
  lines.push('# Generated by `rith setup`');
  lines.push('');

  lines.push('# Database');
  lines.push('# Using SQLite (default) - no DATABASE_URL needed');
  lines.push('# Set DATABASE_URL=postgresql://... to use PostgreSQL instead.');
  lines.push('');

  lines.push('# Pi Authentication');
  if (config.pi.apiKey && config.pi.apiKeyEnvVar) {
    lines.push(`${config.pi.apiKeyEnvVar}=${config.pi.apiKey}`);
  } else {
    lines.push('# No API key entered — set your backend key manually, e.g.:');
    lines.push('# ANTHROPIC_API_KEY=sk-ant-...');
    lines.push('# Or authenticate via `pi /login` (writes ~/.pi/agent/auth.json).');
  }
  lines.push('');

  if (config.githubToken) {
    lines.push('# GitHub');
    lines.push(`GH_TOKEN=${config.githubToken}`);
    lines.push(`GITHUB_TOKEN=${config.githubToken}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Resolve the target path for the selected scope. Delegates to `@rith/paths`
 * so Docker (`/.rith`) and the `RITH_HOME` override behave identically to the
 * loader. Never resolves to `<repoPath>/.env` — that path belongs to the user.
 */
export function resolveScopedEnvPath(scope: 'home' | 'project', repoPath: string): string {
  if (scope === 'project') return getRepoRithEnvPath(repoPath);
  return getRithEnvPath();
}

/**
 * Write the default Pi model ref to `~/.rith/config.yaml` under the top-level
 * `pi:` block. Idempotent: if a `pi:` key already exists, leave it and tell the
 * user to edit `pi.model` by hand rather than risk duplicating the block.
 */
export function writeHomePiModelConfig(model: string): void {
  const home = getRithHome();
  mkdirSync(home, { recursive: true });
  const configPath = join(home, 'config.yaml');
  const existing = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '';

  // Regex (not includes) so substrings like `api:` don't false-positive.
  if (/^\s*pi\s*:/m.test(existing)) {
    log.info(`Pi config already present in ${configPath} — edit pi.model manually to change.`);
    return;
  }

  const escaped = model.replace(/"/g, '\\"');
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  writeFileSync(configPath, existing + separator + `\npi:\n  model: "${escaped}"\n`);
  log.info(`Pi model written to ${configPath}`);
}

/**
 * Serialize a key/value map back to `KEY=value` lines. Values containing
 * whitespace, `#`, quotes, or newlines are double-quoted with `\\`, `"`, `\n`,
 * `\r` escaped so round-tripping through dotenv.parse is stable.
 */
export function serializeEnv(entries: Record<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(entries)) {
    const needsQuoting = /[\s#"'\n\r]/.test(value) || value === '';
    if (needsQuoting) {
      const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
      lines.push(`${key}="${escaped}"`);
    } else {
      lines.push(`${key}=${value}`);
    }
  }
  return lines.join('\n') + (lines.length > 0 ? '\n' : '');
}

/** Filesystem-safe ISO timestamp (no `:` or `.`). */
function backupTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export interface WriteScopedEnvResult {
  targetPath: string;
  backupPath: string | null;
  /** Keys present in the existing file that were preserved against the proposed set. */
  preservedKeys: string[];
  /** True when `--force` overrode the merge. */
  forced: boolean;
}

/**
 * Write env content to exactly one rith-owned file, selected by scope.
 * Merge-only by default (existing non-empty values win, user-added keys
 * survive). Backs up the existing file (if any) before every rewrite, even
 * when `--force` is set. Files are chmod 0o600 (they hold secrets).
 */
export function writeScopedEnv(
  content: string,
  options: { scope: 'home' | 'project'; repoPath: string; force: boolean }
): WriteScopedEnvResult {
  const targetPath = resolveScopedEnvPath(options.scope, options.repoPath);
  const parentDir = dirname(targetPath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  const exists = existsSync(targetPath);
  let backupPath: string | null = null;
  if (exists) {
    backupPath = `${targetPath}.rith-backup-${backupTimestamp()}`;
    copyFileSync(targetPath, backupPath);
    // Backups carry secrets — match the 0o600 we set on the live file.
    chmodSync(backupPath, 0o600);
  }

  const preservedKeys: string[] = [];
  let finalContent: string;

  if (options.force || !exists) {
    finalContent = content;
    if (options.force && backupPath) {
      process.stderr.write(`[rith] --force: overwriting ${targetPath} (backup at ${backupPath})\n`);
    }
  } else {
    // Merge: existing non-empty values win; proposed-only keys are added;
    // existing-only keys (user customizations) are preserved verbatim.
    const existing = parseDotenv(readFileSync(targetPath, 'utf-8'));
    const proposed = parseDotenv(content);
    const merged: Record<string, string> = { ...existing };
    for (const [key, value] of Object.entries(proposed)) {
      const prior = existing[key];
      // Treat whitespace-only existing values as empty — otherwise a stray
      // `   ` would silently defeat the wizard's update for that key forever.
      const priorIsEmpty = prior === undefined || prior.trim() === '';
      if (!(key in existing) || priorIsEmpty) {
        merged[key] = value;
      } else {
        preservedKeys.push(key);
      }
    }
    finalContent = serializeEnv(merged);
  }

  writeFileSync(targetPath, finalContent, { mode: 0o600 });
  // writeFileSync preserves mode for existing files; chmod guarantees 0o600
  // even when overwriting a file that pre-existed with looser permissions.
  chmodSync(targetPath, 0o600);
  return { targetPath, backupPath, preservedKeys, forced: options.force && exists };
}

// =============================================================================
// Main setup command
// =============================================================================

export async function setupCommand(options: SetupOptions): Promise<void> {
  intro('Rith Engine Setup Wizard');

  const scope: 'home' | 'project' = options.scope ?? 'home';
  const force = options.force ?? false;
  const targetEnvPath = resolveScopedEnvPath(scope, options.repoPath);

  // Warn once that <repo>/.env is NOT managed by rith — it's scrubbed from the
  // rith process at runtime, so secrets there won't reach workflows.
  const legacyRepoEnv = join(options.repoPath, '.env');
  if (existsSync(legacyRepoEnv)) {
    log.info(
      `Note: ${legacyRepoEnv} exists but is not managed by rith.\n` +
        '      Values there are stripped from the rith process at runtime (safety guard).\n' +
        `      Put rith env vars in ${getRithEnvPath()} (home scope) or ` +
        `${getRepoRithEnvPath(options.repoPath)} (project scope).`
    );
  }

  const existing = checkExistingConfig(targetEnvPath);
  if (existing) {
    note(
      [
        `Pi: ${existing.hasPi ? 'Configured' : 'Not configured'}`,
        `GitHub: ${existing.hasGithub ? 'Configured' : 'Not configured'}`,
        '',
        force
          ? 'Mode: --force (existing file will be replaced; backup kept)'
          : 'Mode: merge (existing non-empty values are preserved)',
      ].join('\n'),
      `Existing configuration found (${scope} scope)`
    );
  }

  const pi = await collectPiConfig();
  const githubToken = await collectGitHubToken();
  const config: SetupConfig = { pi, ...(githubToken ? { githubToken } : {}) };

  const s = spinner();
  s.start('Writing configuration...');
  const envContent = generateEnvContent(config);
  let writeResult: WriteScopedEnvResult;
  try {
    writeResult = writeScopedEnv(envContent, { scope, repoPath: options.repoPath, force });
  } catch (error) {
    s.stop('Failed to write configuration');
    const err = error as NodeJS.ErrnoException;
    const code = err.code ? ` (${err.code})` : '';
    cancel(`Could not write ${targetEnvPath}${code}: ${err.message}`);
    process.exit(1);
  }
  s.stop('Configuration written');

  // The model ref is a structured preference, not a secret — it lives in
  // ~/.rith/config.yaml rather than the .env file.
  try {
    writeHomePiModelConfig(config.pi.model);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    const code = e.code ? ` (${e.code})` : '';
    log.warning(`Could not write Pi model config: ${e.message}${code}`);
    getLog().warn({ err: e }, 'setup.pi_model_config_write_failed');
  }

  if (writeResult.preservedKeys.length > 0) {
    log.info(
      `Preserved ${writeResult.preservedKeys.length} existing value(s) (use --force to overwrite): ${writeResult.preservedKeys.join(', ')}`
    );
  }
  if (writeResult.backupPath) {
    log.info(`Backup written to ${writeResult.backupPath}`);
  }

  note(
    [
      `Default model: ${config.pi.model}`,
      `Pi auth: ${config.pi.apiKey ? `${config.pi.apiKeyEnvVar} set` : 'not set (use `pi /login` or set a key)'}`,
      `GitHub: ${config.githubToken ? 'token set' : 'not configured'}`,
      '',
      `File written (${scope} scope):`,
      `  ${writeResult.targetPath}`,
      '',
      'Override the model per-run with RITH_MODEL=<provider>/<model> rith workflow run …',
    ].join('\n'),
    'Configuration Complete'
  );

  const runDoctor = await confirm({
    message: 'Run `rith doctor` now to verify your setup?',
    initialValue: true,
  });
  if (!isCancel(runDoctor) && runDoctor) {
    // doctorCommand prints its own report; the return value is discarded so a
    // failing check doesn't abort setup (the env file was already written).
    await doctorCommand();
  }

  outro('Setup complete!');
}
