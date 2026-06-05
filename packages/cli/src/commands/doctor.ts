/**
 * Doctor command - Verifies the local Rith Engine setup.
 *
 * Pi-only, CLI-only port of the upstream Archon doctor. Drops the
 * Claude-binary, Slack, and Telegram checks (no longer part of this fork) and
 * un-gates the Pi check — Pi is Rith's sole AI provider, so there is no
 * `DEFAULT_AI_ASSISTANT` toggle to condition on.
 *
 * Also invoked from the end of `rith setup`; the wizard discards the return
 * value so a doctor failure does not abort setup (the env file was already
 * written successfully).
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execFileAsync } from '@rith/git';
import { getRithHome, createLogger, isTelemetryDisabled } from '@rith/paths';
import type { Logger } from '@rith/paths';
import { pool, getDatabaseType } from '@rith/core';
import { BUNDLED_COMMANDS, BUNDLED_WORKFLOWS } from '@rith/workflows/defaults';

// Env vars that indicate a Pi backend API key is configured. Mirrors
// `PI_PROVIDER_ENV_VARS` in packages/providers/src/pi/provider.ts — the keys
// Pi's getEnvApiKey() recognizes at request time.
const PI_API_KEY_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'CEREBRAS_API_KEY',
  'XAI_API_KEY',
  'OPENROUTER_API_KEY',
  'HUGGINGFACE_API_KEY',
] as const;

let cachedLog: Logger | undefined;
function getLog(): Logger {
  if (!cachedLog) cachedLog = createLogger('cli.doctor');
  return cachedLog;
}

export interface CheckResult {
  label: string;
  status: 'pass' | 'fail' | 'skip';
  message: string;
}

export async function checkGhAuth(env: NodeJS.ProcessEnv): Promise<CheckResult> {
  const label = 'gh CLI';
  // Skip for users without GitHub configured — gh auth is irrelevant to a
  // local-only setup, so reporting fail would be noise.
  if (!env.GITHUB_TOKEN && !env.GH_TOKEN) {
    return { label, status: 'skip', message: 'GitHub not configured (no GITHUB_TOKEN)' };
  }
  try {
    await execFileAsync('gh', ['auth', 'status'], { timeout: 10_000 });
    return { label, status: 'pass', message: 'authenticated' };
  } catch (err) {
    return {
      label,
      status: 'fail',
      message: `gh auth status failed: ${(err as Error).message}. Run \`gh auth login\`.`,
    };
  }
}

/**
 * Thin wrapper around `existsSync` so tests can spy on it by name without
 * fighting ESM named-import rebinding limitations.
 */
export function probeAuthJsonExists(path: string): boolean {
  return existsSync(path);
}

export async function checkPi(env: NodeJS.ProcessEnv): Promise<CheckResult> {
  const label = 'Pi provider';
  // Pi is Rith's sole AI provider — always checked (no DEFAULT_AI_ASSISTANT gate).
  // Pi reads OAuth credentials from ~/.pi/agent/auth.json (written by `pi /login`)
  // or an API-key env var; either path is sufficient.
  const authJsonPath = join(homedir(), '.pi', 'agent', 'auth.json');
  if (probeAuthJsonExists(authJsonPath)) {
    return { label, status: 'pass', message: '~/.pi/agent/auth.json found' };
  }

  const foundKey = PI_API_KEY_VARS.find(v => (env[v] ?? '').trim().length > 0);
  if (foundKey) {
    return { label, status: 'pass', message: `${foundKey} is set` };
  }

  return {
    label,
    status: 'fail',
    message:
      'No Pi auth found. Run `pi /login` or set an API key env var (e.g. ANTHROPIC_API_KEY).',
  };
}

export interface DatabaseDeps {
  pool: { query: (sql: string) => Promise<unknown> };
  getDatabaseType: () => string;
}

// Static defaults — `@rith/core` is already in the CLI module graph (cli.ts
// imports closeDatabase), so lazy-loading buys nothing. Injected in tests to
// drive the reachable / not-reachable branches.
const defaultDatabaseDeps: DatabaseDeps = { pool, getDatabaseType };

export async function checkDatabase(
  deps: DatabaseDeps = defaultDatabaseDeps
): Promise<CheckResult> {
  const label = 'Database';
  try {
    const dbType = deps.getDatabaseType();
    await deps.pool.query('SELECT 1');
    return { label, status: 'pass', message: `reachable (${dbType})` };
  } catch (err) {
    getLog().error({ err }, 'doctor.db_query_failed');
    return { label, status: 'fail', message: `not reachable: ${(err as Error).message}` };
  }
}

export async function checkWorkspaceWritable(): Promise<CheckResult> {
  const label = 'Workspace';
  const home = getRithHome();
  const probe = join(home, `.doctor-probe-${process.pid}-${Date.now()}`);
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(probe, 'ok');
  } catch (err) {
    return { label, status: 'fail', message: `${home} not writable: ${(err as Error).message}` };
  }
  try {
    rmSync(probe, { force: true });
  } catch (err) {
    // Deletion failure is cosmetic — the write succeeded, so the dir is
    // writable. Log so repeated failures leave a diagnostic trace instead of
    // silently accumulating .doctor-probe-* files in RITH_HOME.
    getLog().warn({ probe, err }, 'doctor.workspace_probe_delete_failed');
  }
  return { label, status: 'pass', message: `${home} is writable` };
}

export async function checkBundledDefaults(): Promise<CheckResult> {
  const label = 'Bundled defaults';
  const commands = Object.keys(BUNDLED_COMMANDS).length;
  const workflows = Object.keys(BUNDLED_WORKFLOWS).length;
  return {
    label,
    status: 'pass',
    message: `${workflows} workflow(s), ${commands} command(s) loaded`,
  };
}

export async function checkTelemetry(): Promise<CheckResult> {
  const label = 'Telemetry';
  if (!isTelemetryDisabled()) {
    return { label, status: 'pass', message: 'anonymous (opt out: DO_NOT_TRACK=1)' };
  }
  // Mirror the disable conditions in @rith/paths isTelemetryDisabled() so the
  // reported reason matches what actually suppressed telemetry.
  let reason: string;
  if (process.env.RITH_TELEMETRY_DISABLED === '1') {
    reason = 'RITH_TELEMETRY_DISABLED=1';
  } else if (process.env.DO_NOT_TRACK === '1') {
    reason = 'DO_NOT_TRACK=1';
  } else {
    reason = 'no PostHog key';
  }
  return { label, status: 'skip', message: `disabled (${reason})` };
}

function renderResult(r: CheckResult): string {
  const icon = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '○';
  return `${icon} ${r.label}: ${r.message}`;
}

export async function doctorCommand(
  // Injected so tests can drive the exit-code contract and the
  // Promise.allSettled rejection branch with synthetic checks.
  checks?: (() => Promise<CheckResult>)[]
): Promise<number> {
  console.log('rith doctor — verifying your setup\n');
  getLog().info('doctor.run_started');
  const env = process.env;

  const promises = checks
    ? checks.map(fn => fn())
    : [
        checkPi(env),
        checkGhAuth(env),
        checkDatabase(),
        checkWorkspaceWritable(),
        checkBundledDefaults(),
        checkTelemetry(),
      ];

  // Promise.allSettled so one unexpected rejection doesn't skip remaining checks.
  const settled = await Promise.allSettled(promises);

  let failures = 0;
  for (const s of settled) {
    if (s.status === 'rejected') {
      failures++;
      const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
      console.log(`✗ unknown: check threw: ${msg}`);
      getLog().error({ reason: s.reason }, 'doctor.check_threw_unexpectedly');
      continue;
    }
    if (s.value.status === 'fail') failures++;
    console.log(renderResult(s.value));
  }

  console.log('');
  if (failures === 0) {
    console.log('All checks passed.');
    getLog().info('doctor.run_completed');
    return 0;
  }
  console.log(`${failures} check(s) failed. Run \`rith setup\` to reconfigure.`);
  getLog().warn({ failures }, 'doctor.run_failed');
  return 1;
}
