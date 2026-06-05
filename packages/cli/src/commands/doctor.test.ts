/**
 * Tests for `rith doctor` check functions.
 *
 * Pi-only fork: covers checkPi (un-gated), checkGhAuth, checkDatabase,
 * checkWorkspaceWritable, checkBundledDefaults, checkTelemetry, and the
 * doctorCommand exit-code contract. The dropped Claude-binary / Slack /
 * Telegram checks have no tests here.
 */
import { describe, it, expect, spyOn, afterEach, beforeEach } from 'bun:test';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import * as git from '@rith/git';
import {
  checkDatabase,
  checkGhAuth,
  checkPi,
  checkWorkspaceWritable,
  checkBundledDefaults,
  checkTelemetry,
  doctorCommand,
  type DatabaseDeps,
} from './doctor';
import * as doctorModule from './doctor';

describe('checkGhAuth', () => {
  let execSpy: ReturnType<typeof spyOn<typeof git, 'execFileAsync'>>;

  beforeEach(() => {
    execSpy = spyOn(git, 'execFileAsync');
  });

  afterEach(() => {
    execSpy.mockRestore();
  });

  it('returns skip when no GitHub token is set', async () => {
    const result = await checkGhAuth({});
    expect(result.status).toBe('skip');
    expect(result.message).toContain('GitHub not configured');
    expect(execSpy).not.toHaveBeenCalled();
  });

  it('runs gh auth check when only GH_TOKEN is set', async () => {
    execSpy.mockResolvedValue({ stdout: 'Logged in as @user', stderr: '' });
    const result = await checkGhAuth({ GH_TOKEN: 'ghp_y' });
    expect(result.status).toBe('pass');
    expect(execSpy).toHaveBeenCalledWith('gh', ['auth', 'status'], expect.any(Object));
  });

  it('returns pass when gh auth status succeeds', async () => {
    execSpy.mockResolvedValue({ stdout: 'Logged in as @user', stderr: '' });
    const result = await checkGhAuth({ GITHUB_TOKEN: 'ghp_x' });
    expect(result.status).toBe('pass');
    expect(execSpy).toHaveBeenCalledWith('gh', ['auth', 'status'], expect.any(Object));
  });

  it('returns fail when gh auth status throws', async () => {
    execSpy.mockRejectedValue(new Error('not logged in'));
    const result = await checkGhAuth({ GH_TOKEN: 'ghp_y' });
    expect(result.status).toBe('fail');
    expect(result.message).toContain('not logged in');
  });
});

describe('checkPi', () => {
  // Spy on the exported `probeAuthJsonExists` wrapper rather than fs.existsSync —
  // named imports from 'fs' cannot be intercepted via the namespace object.
  let authJsonSpy: ReturnType<typeof spyOn<typeof doctorModule, 'probeAuthJsonExists'>>;

  beforeEach(() => {
    authJsonSpy = spyOn(doctorModule, 'probeAuthJsonExists');
  });

  afterEach(() => {
    authJsonSpy.mockRestore();
  });

  it('returns pass when ~/.pi/agent/auth.json exists', async () => {
    authJsonSpy.mockReturnValue(true);
    const result = await checkPi({});
    expect(result.status).toBe('pass');
    expect(result.label).toBe('Pi provider');
    expect(result.message).toContain('auth.json');
  });

  it('returns pass when a Pi API key env var is set', async () => {
    authJsonSpy.mockReturnValue(false);
    const result = await checkPi({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(result.status).toBe('pass');
    expect(result.message).toContain('ANTHROPIC_API_KEY');
  });

  it('recognizes any of the mapped Pi backend API keys', async () => {
    authJsonSpy.mockReturnValue(false);
    const result = await checkPi({ OPENROUTER_API_KEY: 'or-key' });
    expect(result.status).toBe('pass');
    expect(result.message).toContain('OPENROUTER_API_KEY');
  });

  it('returns fail when no auth.json and no API key are present', async () => {
    authJsonSpy.mockReturnValue(false);
    const result = await checkPi({});
    expect(result.status).toBe('fail');
    expect(result.message).toContain('pi /login');
  });

  it('ignores blank API key values', async () => {
    authJsonSpy.mockReturnValue(false);
    const result = await checkPi({ ANTHROPIC_API_KEY: '   ' });
    expect(result.status).toBe('fail');
  });
});

describe('checkDatabase', () => {
  it('returns pass when query succeeds', async () => {
    const deps: DatabaseDeps = {
      pool: { query: async () => undefined },
      getDatabaseType: () => 'sqlite',
    };
    const result = await checkDatabase(deps);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('sqlite');
  });

  it('reports postgres dbType when configured', async () => {
    const deps: DatabaseDeps = {
      pool: { query: async () => undefined },
      getDatabaseType: () => 'postgresql',
    };
    const result = await checkDatabase(deps);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('postgresql');
  });

  it('returns fail with "not reachable" when query throws', async () => {
    const deps: DatabaseDeps = {
      pool: {
        query: async () => {
          throw new Error('connection refused');
        },
      },
      getDatabaseType: () => 'postgresql',
    };
    const result = await checkDatabase(deps);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('not reachable');
    expect(result.message).toContain('connection refused');
  });
});

describe('checkWorkspaceWritable', () => {
  const TMP = join(tmpdir(), 'rith-doctor-test-' + Date.now());
  let originalHome: string | undefined;

  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
    originalHome = process.env.RITH_HOME;
    process.env.RITH_HOME = TMP;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.RITH_HOME;
    } else {
      process.env.RITH_HOME = originalHome;
    }
    try {
      rmSync(TMP, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('returns pass when directory is writable', async () => {
    const result = await checkWorkspaceWritable();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('writable');
  });

  it('returns pass when directory does not exist (creates it)', async () => {
    rmSync(TMP, { recursive: true, force: true });
    const result = await checkWorkspaceWritable();
    expect(result.status).toBe('pass');
  });
});

describe('checkBundledDefaults', () => {
  it('returns pass with workflow and command counts', async () => {
    const result = await checkBundledDefaults();
    expect(result.status).toBe('pass');
    expect(result.label).toBe('Bundled defaults');
    expect(result.message).toMatch(/\d+ workflow/);
    expect(result.message).toMatch(/\d+ command/);
  });
});

describe('checkTelemetry', () => {
  const ENV_VARS = ['RITH_TELEMETRY_DISABLED', 'DO_NOT_TRACK', 'POSTHOG_API_KEY'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_VARS) saved[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('returns pass when telemetry is enabled (embedded key, no opt-out)', async () => {
    delete process.env.RITH_TELEMETRY_DISABLED;
    delete process.env.DO_NOT_TRACK;
    delete process.env.POSTHOG_API_KEY;
    const result = await checkTelemetry();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('anonymous');
  });

  it('returns skip with DO_NOT_TRACK reason when opted out', async () => {
    delete process.env.RITH_TELEMETRY_DISABLED;
    process.env.DO_NOT_TRACK = '1';
    const result = await checkTelemetry();
    expect(result.status).toBe('skip');
    expect(result.message).toContain('DO_NOT_TRACK');
  });

  it('returns skip with RITH_TELEMETRY_DISABLED reason when set', async () => {
    delete process.env.DO_NOT_TRACK;
    process.env.RITH_TELEMETRY_DISABLED = '1';
    const result = await checkTelemetry();
    expect(result.status).toBe('skip');
    expect(result.message).toContain('RITH_TELEMETRY_DISABLED');
  });
});

describe('doctorCommand', () => {
  let logSpy: ReturnType<typeof spyOn<Console, 'log'>>;

  beforeEach(() => {
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  const passing = (label: string) => async () =>
    ({ label, status: 'pass', message: 'ok' }) as const;
  const failing = (label: string) => async () =>
    ({ label, status: 'fail', message: 'broken' }) as const;
  const skipping = (label: string) => async () =>
    ({ label, status: 'skip', message: 'no token' }) as const;
  const throwing = (label: string) => async (): Promise<never> => {
    throw new Error(`${label} blew up`);
  };

  it('returns 0 when every check passes', async () => {
    const exit = await doctorCommand([passing('A'), passing('B')]);
    expect(exit).toBe(0);
  });

  it('returns 0 when checks are pass + skip (skip is not a failure)', async () => {
    const exit = await doctorCommand([passing('A'), skipping('B')]);
    expect(exit).toBe(0);
  });

  it('returns 1 when any check fails', async () => {
    const exit = await doctorCommand([passing('A'), failing('B')]);
    expect(exit).toBe(1);
  });

  it('counts a thrown check as a failure (allSettled rejection branch)', async () => {
    const exit = await doctorCommand([passing('A'), throwing('B')]);
    expect(exit).toBe(1);
  });

  it('continues after a thrown check (Promise.allSettled does not short-circuit)', async () => {
    const exit = await doctorCommand([throwing('A'), passing('B'), failing('C')]);
    expect(exit).toBe(1);
    const renderedLines = logSpy.mock.calls
      .map(args => String(args[0] ?? ''))
      .filter(s => s.startsWith('✓') || s.startsWith('✗') || s.startsWith('○'));
    expect(renderedLines.length).toBeGreaterThanOrEqual(2);
  });
});
