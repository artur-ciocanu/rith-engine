/**
 * Tests for `rith setup` pure + filesystem helpers.
 *
 * The interactive wizard (`setupCommand`) drives @clack prompts and is not
 * unit-tested here; the testable surface is the env generation/merge/write and
 * the config.yaml model writer.
 */
import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync, readFileSync, statSync, existsSync } from 'fs';
import { parse as parseDotenv } from 'dotenv';
import {
  serializeEnv,
  generateEnvContent,
  resolveScopedEnvPath,
  writeScopedEnv,
  checkExistingConfig,
  writeHomePiModelConfig,
  type SetupConfig,
} from './setup';

describe('serializeEnv', () => {
  it('writes plain KEY=value for simple values', () => {
    expect(serializeEnv({ FOO: 'bar', BAZ: 'qux' })).toBe('FOO=bar\nBAZ=qux\n');
  });

  it('quotes values with whitespace, hashes, or empties so they round-trip through dotenv', () => {
    const out = serializeEnv({ A: 'has space', B: 'has#hash', C: '' });
    const parsed = parseDotenv(out);
    expect(parsed.A).toBe('has space');
    expect(parsed.B).toBe('has#hash');
    expect(parsed.C).toBe('');
  });

  it('returns empty string for no entries', () => {
    expect(serializeEnv({})).toBe('');
  });
});

describe('generateEnvContent', () => {
  it('writes the backend env var when an API key is provided', () => {
    const config: SetupConfig = {
      pi: {
        model: 'anthropic/claude-haiku-4-5',
        apiKey: 'sk-ant-x',
        apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      },
    };
    const parsed = parseDotenv(generateEnvContent(config));
    expect(parsed.ANTHROPIC_API_KEY).toBe('sk-ant-x');
  });

  it('omits a key line when no API key is provided', () => {
    const config: SetupConfig = { pi: { model: 'anthropic/claude-haiku-4-5' } };
    const content = generateEnvContent(config);
    const parsed = parseDotenv(content);
    expect(parsed.ANTHROPIC_API_KEY).toBeUndefined();
    expect(content).toContain('# No API key entered');
  });

  it('writes both GH_TOKEN and GITHUB_TOKEN when a github token is provided', () => {
    const config: SetupConfig = {
      pi: { model: 'anthropic/claude-haiku-4-5' },
      githubToken: 'ghp_abc',
    };
    const parsed = parseDotenv(generateEnvContent(config));
    expect(parsed.GH_TOKEN).toBe('ghp_abc');
    expect(parsed.GITHUB_TOKEN).toBe('ghp_abc');
  });
});

describe('resolveScopedEnvPath', () => {
  const saved = process.env.RITH_HOME;
  beforeEach(() => {
    process.env.RITH_HOME = '/tmp/rith-home-test';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.RITH_HOME;
    else process.env.RITH_HOME = saved;
  });

  it('resolves home scope under RITH_HOME', () => {
    expect(resolveScopedEnvPath('home', '/repo')).toBe('/tmp/rith-home-test/.env');
  });

  it('resolves project scope under <repo>/.rith', () => {
    expect(resolveScopedEnvPath('project', '/repo')).toBe('/repo/.rith/.env');
  });
});

describe('writeScopedEnv', () => {
  let tmp: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    tmp = join(tmpdir(), `rith-setup-test-${process.pid}-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    savedHome = process.env.RITH_HOME;
    process.env.RITH_HOME = tmp;
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.RITH_HOME;
    else process.env.RITH_HOME = savedHome;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('writes a fresh home-scope file with 0o600 permissions', () => {
    const result = writeScopedEnv('FOO=bar\n', { scope: 'home', repoPath: tmp, force: false });
    expect(result.targetPath).toBe(join(tmp, '.env'));
    expect(result.backupPath).toBeNull();
    expect(parseDotenv(readFileSync(result.targetPath, 'utf-8')).FOO).toBe('bar');
    expect(statSync(result.targetPath).mode & 0o777).toBe(0o600);
  });

  it('merges: existing non-empty values win, new keys are added, and a backup is made', () => {
    const target = join(tmp, '.env');
    writeFileSync(target, 'EXISTING=keep\nSHARED=old\n');
    const result = writeScopedEnv('SHARED=new\nFRESH=added\n', {
      scope: 'home',
      repoPath: tmp,
      force: false,
    });
    const parsed = parseDotenv(readFileSync(target, 'utf-8'));
    expect(parsed.EXISTING).toBe('keep');
    expect(parsed.SHARED).toBe('old'); // existing non-empty wins
    expect(parsed.FRESH).toBe('added');
    expect(result.preservedKeys).toContain('SHARED');
    expect(result.backupPath).not.toBeNull();
    expect(result.forced).toBe(false);
  });

  it('overwrites existing values when forced (still writing a backup)', () => {
    const target = join(tmp, '.env');
    writeFileSync(target, 'SHARED=old\n');
    const result = writeScopedEnv('SHARED=new\n', { scope: 'home', repoPath: tmp, force: true });
    expect(parseDotenv(readFileSync(target, 'utf-8')).SHARED).toBe('new');
    expect(result.forced).toBe(true);
    expect(result.backupPath).not.toBeNull();
    expect(existsSync(result.backupPath as string)).toBe(true);
  });

  it('overwrites a whitespace-only existing value during merge', () => {
    const target = join(tmp, '.env');
    writeFileSync(target, 'BLANK="   "\n');
    writeScopedEnv('BLANK=real\n', { scope: 'home', repoPath: tmp, force: false });
    expect(parseDotenv(readFileSync(target, 'utf-8')).BLANK).toBe('real');
  });

  it('creates the parent directory for project scope', () => {
    const repo = join(tmp, 'repo');
    mkdirSync(repo, { recursive: true });
    const result = writeScopedEnv('FOO=bar\n', { scope: 'project', repoPath: repo, force: false });
    expect(result.targetPath).toBe(join(repo, '.rith', '.env'));
    expect(existsSync(result.targetPath)).toBe(true);
  });
});

describe('checkExistingConfig', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = join(tmpdir(), `rith-setup-existing-${process.pid}-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns null when the env file is absent', () => {
    expect(checkExistingConfig(join(tmp, '.env'))).toBeNull();
  });

  it('detects a configured Pi backend key', () => {
    const path = join(tmp, '.env');
    writeFileSync(path, 'ANTHROPIC_API_KEY=sk-ant-x\n');
    const result = checkExistingConfig(path);
    expect(result?.hasPi).toBe(true);
    expect(result?.hasGithub).toBe(false);
  });

  it('detects a configured GitHub token and ignores blank Pi keys', () => {
    const path = join(tmp, '.env');
    writeFileSync(path, 'GITHUB_TOKEN=ghp_x\nOPENAI_API_KEY=\n');
    const result = checkExistingConfig(path);
    expect(result?.hasGithub).toBe(true);
    expect(result?.hasPi).toBe(false);
  });
});

describe('writeHomePiModelConfig', () => {
  let tmp: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    tmp = join(tmpdir(), `rith-setup-cfg-${process.pid}-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    savedHome = process.env.RITH_HOME;
    process.env.RITH_HOME = tmp;
  });
  afterEach(() => {
    if (savedHome === undefined) delete process.env.RITH_HOME;
    else process.env.RITH_HOME = savedHome;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('appends a pi: block when config.yaml has no pi key', () => {
    const configPath = join(tmp, 'config.yaml');
    writeFileSync(configPath, '# existing\npaths:\n  workspaces: /x\n');
    writeHomePiModelConfig('anthropic/claude-opus-4-5');
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain('pi:');
    expect(content).toContain('model: "anthropic/claude-opus-4-5"');
    expect(content).toContain('paths:'); // preserved existing content
  });

  it('creates config.yaml when absent', () => {
    writeHomePiModelConfig('google/gemini-2.5-pro');
    const content = readFileSync(join(tmp, 'config.yaml'), 'utf-8');
    expect(content).toContain('model: "google/gemini-2.5-pro"');
  });

  it('is idempotent: does not duplicate an existing pi: block', () => {
    const configPath = join(tmp, 'config.yaml');
    writeFileSync(configPath, 'pi:\n  model: anthropic/claude-haiku-4-5\n');
    writeHomePiModelConfig('anthropic/claude-opus-4-5');
    const content = readFileSync(configPath, 'utf-8');
    // Unchanged — the original model stays, no second pi: block appended.
    expect(content).toBe('pi:\n  model: anthropic/claude-haiku-4-5\n');
    expect((content.match(/^pi:/gm) ?? []).length).toBe(1);
  });
});
