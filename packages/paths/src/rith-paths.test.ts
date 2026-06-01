import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import { mkdir, rm, writeFile, lstat, readlink } from 'fs/promises';

const isWindows = process.platform === 'win32';

import {
  isDocker,
  getRithHome,
  getRithWorkspacesPath,
  ensureRithWorkspacesPath,
  getRithWorktreesPath,
  getRithConfigPath,
  getHomeWorkflowsPath,
  getHomeCommandsPath,
  getHomeScriptsPath,
  getLegacyHomeWorkflowsPath,
  getCommandFolderSearchPaths,
  getWorkflowFolderSearchPaths,
  expandTilde,
  getAppRithBasePath,
  getDefaultCommandsPath,
  getDefaultWorkflowsPath,
  logRithPaths,
  validateAppDefaultsPaths,
  parseOwnerRepo,
  getProjectRoot,
  getProjectSourcePath,
  getProjectWorktreesPath,
  getProjectArtifactsPath,
  getProjectLogsPath,
  getRunArtifactsPath,
  getRunLogPath,
  resolveProjectRootFromCwd,
  ensureProjectStructure,
  createProjectSourceSymlink,
} from './rith-paths';

/** All env vars that path functions depend on */
const ENV_VARS = ['WORKSPACE_PATH', 'WORKTREE_BASE', 'RITH_HOME', 'RITH_DOCKER', 'HOME'];

/**
 * Save and restore environment variables around each test.
 * Call at the top of a describe block to register beforeEach/afterEach hooks.
 */
function useEnvSnapshot(): void {
  const snapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_VARS) {
      snapshot[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_VARS) {
      if (snapshot[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = snapshot[key];
      }
    }
  });
}

describe('rith-paths', () => {
  useEnvSnapshot();

  describe('expandTilde', () => {
    test('expands ~ to home directory', () => {
      expect(expandTilde('~/test')).toBe(join(homedir(), 'test'));
    });

    test('returns path unchanged if no tilde', () => {
      expect(expandTilde('/absolute/path')).toBe('/absolute/path');
    });
  });

  describe('isDocker', () => {
    test('returns true when WORKSPACE_PATH is /workspace', () => {
      process.env.WORKSPACE_PATH = '/workspace';
      expect(isDocker()).toBe(true);
    });

    test('returns true when HOME=/root and WORKSPACE_PATH set', () => {
      process.env.HOME = '/root';
      process.env.WORKSPACE_PATH = '/app/workspace';
      expect(isDocker()).toBe(true);
    });

    test('returns true when RITH_DOCKER=true', () => {
      delete process.env.WORKSPACE_PATH;
      process.env.RITH_DOCKER = 'true';
      expect(isDocker()).toBe(true);
    });

    test('returns false for local development', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_DOCKER;
      process.env.HOME = homedir();
      expect(isDocker()).toBe(false);
    });
  });

  describe('getRithHome', () => {
    test('returns /.rith in Docker', () => {
      process.env.WORKSPACE_PATH = '/workspace';
      expect(getRithHome()).toBe('/.rith');
    });

    test('returns RITH_HOME when set (local)', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_DOCKER;
      process.env.RITH_HOME = '/custom/rith';
      expect(getRithHome()).toBe('/custom/rith');
    });

    test('expands tilde in RITH_HOME', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_DOCKER;
      process.env.RITH_HOME = '~/my-rith';
      expect(getRithHome()).toBe(join(homedir(), 'my-rith'));
    });

    test('returns ~/.rith by default (local)', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      expect(getRithHome()).toBe(join(homedir(), '.rith'));
    });
  });

  describe('getRithWorkspacesPath', () => {
    test('returns ~/.rith/workspaces by default', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      expect(getRithWorkspacesPath()).toBe(join(homedir(), '.rith', 'workspaces'));
    });

    test('returns /.rith/workspaces in Docker', () => {
      process.env.RITH_DOCKER = 'true';
      expect(getRithWorkspacesPath()).toBe(join('/', '.rith', 'workspaces'));
    });

    test('uses RITH_HOME when set', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_DOCKER;
      process.env.RITH_HOME = '/custom/rith';
      expect(getRithWorkspacesPath()).toBe(join('/custom/rith', 'workspaces'));
    });
  });

  describe('getRithWorktreesPath', () => {
    test('returns ~/.rith/worktrees by default', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.WORKTREE_BASE;
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      expect(getRithWorktreesPath()).toBe(join(homedir(), '.rith', 'worktrees'));
    });

    test('returns /.rith/worktrees in Docker', () => {
      process.env.RITH_DOCKER = 'true';
      expect(getRithWorktreesPath()).toBe(join('/', '.rith', 'worktrees'));
    });

    test('uses RITH_HOME when set', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.WORKTREE_BASE;
      delete process.env.RITH_DOCKER;
      process.env.RITH_HOME = '/custom/rith';
      expect(getRithWorktreesPath()).toBe(join('/custom/rith', 'worktrees'));
    });
  });

  describe('getCommandFolderSearchPaths', () => {
    test('returns .rith/commands and defaults by default', () => {
      const paths = getCommandFolderSearchPaths();
      expect(paths).toEqual(['.rith/commands', '.rith/commands/defaults']);
    });

    test('includes configured folder when provided', () => {
      const paths = getCommandFolderSearchPaths('.claude/commands/rith');
      expect(paths).toEqual(['.rith/commands', '.rith/commands/defaults', '.claude/commands/rith']);
    });

    test('.rith/commands has highest priority', () => {
      const paths = getCommandFolderSearchPaths('.custom/commands');
      expect(paths[0]).toBe('.rith/commands');
    });

    test('.rith/commands/defaults has second priority', () => {
      const paths = getCommandFolderSearchPaths('.custom/commands');
      expect(paths[1]).toBe('.rith/commands/defaults');
    });

    test('does not duplicate .rith/commands if configured', () => {
      const paths = getCommandFolderSearchPaths('.rith/commands');
      expect(paths).toEqual(['.rith/commands', '.rith/commands/defaults']);
    });

    test('does not duplicate .rith/commands/defaults if configured', () => {
      const paths = getCommandFolderSearchPaths('.rith/commands/defaults');
      expect(paths).toEqual(['.rith/commands', '.rith/commands/defaults']);
    });
  });

  describe('getWorkflowFolderSearchPaths', () => {
    test('returns .rith/workflows', () => {
      const paths = getWorkflowFolderSearchPaths();
      expect(paths).toEqual(['.rith/workflows']);
    });
  });

  describe('getRithConfigPath', () => {
    test('returns path to config.yaml', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      expect(getRithConfigPath()).toBe(join(homedir(), '.rith', 'config.yaml'));
    });
  });

  describe('getHomeWorkflowsPath', () => {
    test('returns ~/.rith/workflows by default (direct child of ~/.rith/)', () => {
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      expect(getHomeWorkflowsPath()).toBe(join(homedir(), '.rith', 'workflows'));
    });

    test('returns /.rith/workflows in Docker', () => {
      process.env.RITH_DOCKER = 'true';
      expect(getHomeWorkflowsPath()).toBe(join('/', '.rith', 'workflows'));
    });

    test('uses RITH_HOME when set', () => {
      delete process.env.RITH_DOCKER;
      process.env.RITH_HOME = '/custom/rith';
      expect(getHomeWorkflowsPath()).toBe(join('/custom/rith', 'workflows'));
    });

    test('no double `.rith/` nesting — must sit next to workspaces/ and worktrees/', () => {
      // Regression guard: the old location was ~/.rith/.rith/workflows/.
      // New location must NOT reintroduce the double-nested path.
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      expect(getHomeWorkflowsPath()).not.toContain(join('.rith', '.rith'));
    });
  });

  describe('getHomeCommandsPath', () => {
    test('returns ~/.rith/commands by default', () => {
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      expect(getHomeCommandsPath()).toBe(join(homedir(), '.rith', 'commands'));
    });

    test('returns /.rith/commands in Docker', () => {
      process.env.RITH_DOCKER = 'true';
      expect(getHomeCommandsPath()).toBe(join('/', '.rith', 'commands'));
    });

    test('uses RITH_HOME when set', () => {
      delete process.env.RITH_DOCKER;
      process.env.RITH_HOME = '/custom/rith';
      expect(getHomeCommandsPath()).toBe(join('/custom/rith', 'commands'));
    });
  });

  describe('getHomeScriptsPath', () => {
    test('returns ~/.rith/scripts by default', () => {
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      expect(getHomeScriptsPath()).toBe(join(homedir(), '.rith', 'scripts'));
    });

    test('returns /.rith/scripts in Docker', () => {
      process.env.RITH_DOCKER = 'true';
      expect(getHomeScriptsPath()).toBe(join('/', '.rith', 'scripts'));
    });

    test('uses RITH_HOME when set', () => {
      delete process.env.RITH_DOCKER;
      process.env.RITH_HOME = '/custom/rith';
      expect(getHomeScriptsPath()).toBe(join('/custom/rith', 'scripts'));
    });
  });

  describe('getLegacyHomeWorkflowsPath', () => {
    // This helper only exists so discovery can DETECT files at the old location
    // and emit a deprecation warning. It is not a fallback read path.
    test('returns ~/.rith/.rith/workflows (the retired location)', () => {
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      expect(getLegacyHomeWorkflowsPath()).toBe(join(homedir(), '.rith', '.rith', 'workflows'));
    });

    test('honors RITH_HOME so migration detection works in custom setups', () => {
      delete process.env.RITH_DOCKER;
      process.env.RITH_HOME = '/custom/rith';
      expect(getLegacyHomeWorkflowsPath()).toBe(join('/custom/rith', '.rith', 'workflows'));
    });
  });

  describe('getAppRithBasePath', () => {
    test('returns repo root .rith path in local development', () => {
      delete process.env.RITH_DOCKER;
      delete process.env.WORKSPACE_PATH;
      const path = getAppRithBasePath();
      // Should end with .rith and NOT contain packages/core or packages/paths
      expect(path).toMatch(/\.rith$/);
      expect(path).not.toContain('packages/core');
      expect(path).not.toContain('packages/paths');
    });

    test('path exists and contains defaults directories', () => {
      delete process.env.RITH_DOCKER;
      delete process.env.WORKSPACE_PATH;
      const path = getAppRithBasePath();
      // The path should end with .rith and the directory should exist
      expect(path).toMatch(/\.rith$/);
      expect(existsSync(path)).toBe(true);
    });
  });

  describe('getDefaultCommandsPath', () => {
    test('returns commands/defaults under app rith base', () => {
      delete process.env.RITH_DOCKER;
      delete process.env.WORKSPACE_PATH;
      const path = getDefaultCommandsPath();
      expect(path).toContain('.rith');
      expect(path).toContain('commands');
      expect(path).toContain('defaults');
      expect(path).not.toContain('packages/core');
    });
  });

  describe('getDefaultWorkflowsPath', () => {
    test('returns workflows/defaults under app rith base', () => {
      delete process.env.RITH_DOCKER;
      delete process.env.WORKSPACE_PATH;
      const path = getDefaultWorkflowsPath();
      expect(path).toContain('.rith');
      expect(path).toContain('workflows');
      expect(path).toContain('defaults');
      expect(path).not.toContain('packages/core');
    });
  });

  // =========================================================================
  // Project-centric path functions
  // =========================================================================

  describe('parseOwnerRepo', () => {
    test('parses owner/repo format', () => {
      expect(parseOwnerRepo('acme/widget')).toEqual({ owner: 'acme', repo: 'widget' });
    });

    test('returns null for bare name', () => {
      expect(parseOwnerRepo('widget')).toBeNull();
    });

    test('returns null for empty string', () => {
      expect(parseOwnerRepo('')).toBeNull();
    });

    test('returns null for trailing slash', () => {
      expect(parseOwnerRepo('acme/')).toBeNull();
    });

    test('returns null for leading slash', () => {
      expect(parseOwnerRepo('/widget')).toBeNull();
    });

    test('rejects nested paths with more than one slash', () => {
      const result = parseOwnerRepo('acme/nested/widget');
      expect(result).toBeNull();
    });

    test('rejects path traversal in owner', () => {
      expect(parseOwnerRepo('../etc/passwd')).toBeNull();
    });

    test('rejects path traversal in repo', () => {
      expect(parseOwnerRepo('acme/../../etc')).toBeNull();
    });

    test('rejects dot and dotdot segments', () => {
      expect(parseOwnerRepo('./widget')).toBeNull();
      expect(parseOwnerRepo('acme/..')).toBeNull();
      expect(parseOwnerRepo('../widget')).toBeNull();
      expect(parseOwnerRepo('.')).toBeNull();
    });

    test('accepts valid GitHub-style names with dots, hyphens, underscores', () => {
      expect(parseOwnerRepo('my-org/my_repo.js')).toEqual({
        owner: 'my-org',
        repo: 'my_repo.js',
      });
    });

    test('rejects names with spaces', () => {
      expect(parseOwnerRepo('my org/repo')).toBeNull();
    });

    test('rejects names with special characters', () => {
      expect(parseOwnerRepo('acme/repo;rm -rf')).toBeNull();
      expect(parseOwnerRepo('acme/$HOME')).toBeNull();
    });
  });

  describe('getProjectRoot', () => {
    test('returns path under workspaces', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      const result = getProjectRoot('acme', 'widget');
      expect(result).toBe(join(homedir(), '.rith', 'workspaces', 'acme', 'widget'));
    });

    test('respects RITH_HOME', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_DOCKER;
      process.env.RITH_HOME = '/custom/rith';
      expect(getProjectRoot('acme', 'widget')).toBe(
        join('/custom/rith', 'workspaces', 'acme', 'widget')
      );
    });

    test('works in Docker', () => {
      process.env.RITH_DOCKER = 'true';
      expect(getProjectRoot('acme', 'widget')).toBe(
        join('/', '.rith', 'workspaces', 'acme', 'widget')
      );
    });
  });

  describe('getProjectSourcePath', () => {
    test('appends source/ to project root', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      expect(getProjectSourcePath('acme', 'widget')).toBe(
        join(homedir(), '.rith', 'workspaces', 'acme', 'widget', 'source')
      );
    });
  });

  describe('getProjectWorktreesPath', () => {
    test('appends worktrees/ to project root', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      expect(getProjectWorktreesPath('acme', 'widget')).toBe(
        join(homedir(), '.rith', 'workspaces', 'acme', 'widget', 'worktrees')
      );
    });
  });

  describe('getProjectArtifactsPath', () => {
    test('appends artifacts/ to project root', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      expect(getProjectArtifactsPath('acme', 'widget')).toBe(
        join(homedir(), '.rith', 'workspaces', 'acme', 'widget', 'artifacts')
      );
    });
  });

  describe('getProjectLogsPath', () => {
    test('appends logs/ to project root', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      expect(getProjectLogsPath('acme', 'widget')).toBe(
        join(homedir(), '.rith', 'workspaces', 'acme', 'widget', 'logs')
      );
    });
  });

  describe('getRunArtifactsPath', () => {
    test('returns artifacts/runs/{id}/ path', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      expect(getRunArtifactsPath('acme', 'widget', 'run-123')).toBe(
        join(homedir(), '.rith', 'workspaces', 'acme', 'widget', 'artifacts', 'runs', 'run-123')
      );
    });
  });

  describe('getRunLogPath', () => {
    test('returns logs/{id}.jsonl path', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      expect(getRunLogPath('acme', 'widget', 'run-123')).toBe(
        join(homedir(), '.rith', 'workspaces', 'acme', 'widget', 'logs', 'run-123.jsonl')
      );
    });
  });

  describe('resolveProjectRootFromCwd', () => {
    test('resolves project root from a path under workspaces', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      const workspacesPath = getRithWorkspacesPath();
      const cwd = join(workspacesPath, 'acme', 'widget', 'source');
      expect(resolveProjectRootFromCwd(cwd)).toBe(join(workspacesPath, 'acme', 'widget'));
    });

    test('resolves from worktrees subpath', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      const workspacesPath = getRithWorkspacesPath();
      const cwd = join(workspacesPath, 'acme', 'widget', 'worktrees', 'feature-auth');
      expect(resolveProjectRootFromCwd(cwd)).toBe(join(workspacesPath, 'acme', 'widget'));
    });

    test('returns null for path outside workspaces', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      expect(resolveProjectRootFromCwd('/home/user/projects/my-repo')).toBeNull();
    });

    test('returns null for path with only owner (no repo)', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_HOME;
      delete process.env.RITH_DOCKER;
      const workspacesPath = getRithWorkspacesPath();
      expect(resolveProjectRootFromCwd(join(workspacesPath, 'acme'))).toBeNull();
    });

    test('works with RITH_HOME override', () => {
      delete process.env.WORKSPACE_PATH;
      delete process.env.RITH_DOCKER;
      process.env.RITH_HOME = join('/', 'custom', 'rith');
      const cwd = join('/', 'custom', 'rith', 'workspaces', 'acme', 'widget', 'source');
      expect(resolveProjectRootFromCwd(cwd)).toBe(
        join('/', 'custom', 'rith', 'workspaces', 'acme', 'widget')
      );
    });
  });
});

describe('logRithPaths', () => {
  useEnvSnapshot();

  test('does not throw', () => {
    delete process.env.WORKSPACE_PATH;
    delete process.env.RITH_HOME;
    delete process.env.RITH_DOCKER;
    expect(() => logRithPaths()).not.toThrow();
  });
});

describe('validateAppDefaultsPaths', () => {
  test('does not throw for valid paths', async () => {
    await expect(validateAppDefaultsPaths()).resolves.toBeUndefined();
  });

  test('handles missing paths gracefully', async () => {
    const originalEnv = process.env.RITH_DOCKER;
    process.env.RITH_DOCKER = 'true';
    try {
      // In Docker mode, paths won't exist — should still not throw
      await expect(validateAppDefaultsPaths()).resolves.toBeUndefined();
    } finally {
      if (originalEnv === undefined) {
        delete process.env.RITH_DOCKER;
      } else {
        process.env.RITH_DOCKER = originalEnv;
      }
    }
  });
});

// =========================================================================
// Async filesystem tests (use temp directories for isolation)
// =========================================================================

describe('ensureProjectStructure', () => {
  let tempRithHome: string;
  useEnvSnapshot();

  beforeEach(async () => {
    delete process.env.WORKSPACE_PATH;
    delete process.env.RITH_DOCKER;
    tempRithHome = join(
      tmpdir(),
      `rith-paths-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    process.env.RITH_HOME = tempRithHome;
  });

  afterEach(async () => {
    await rm(tempRithHome, { recursive: true, force: true });
  });

  test('creates all four project subdirectories', async () => {
    await ensureProjectStructure('acme', 'widget');

    const sourcePath = getProjectSourcePath('acme', 'widget');
    const worktreesPath = getProjectWorktreesPath('acme', 'widget');
    const artifactsPath = getProjectArtifactsPath('acme', 'widget');
    const logsPath = getProjectLogsPath('acme', 'widget');

    // All directories should exist
    expect((await lstat(sourcePath)).isDirectory()).toBe(true);
    expect((await lstat(worktreesPath)).isDirectory()).toBe(true);
    expect((await lstat(artifactsPath)).isDirectory()).toBe(true);
    expect((await lstat(logsPath)).isDirectory()).toBe(true);
  });

  test('is idempotent - safe to call twice', async () => {
    await ensureProjectStructure('acme', 'widget');
    await ensureProjectStructure('acme', 'widget');

    const sourcePath = getProjectSourcePath('acme', 'widget');
    expect((await lstat(sourcePath)).isDirectory()).toBe(true);
  });
});

describe('ensureRithWorkspacesPath', () => {
  let tempRithHome: string;
  useEnvSnapshot();

  beforeEach(async () => {
    delete process.env.WORKSPACE_PATH;
    delete process.env.RITH_DOCKER;
    tempRithHome = join(
      tmpdir(),
      `rith-paths-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    process.env.RITH_HOME = tempRithHome;
  });

  afterEach(async () => {
    await rm(tempRithHome, { recursive: true, force: true });
  });

  test('creates the workspaces directory when missing', async () => {
    const expected = getRithWorkspacesPath();
    expect(existsSync(expected)).toBe(false);

    const returned = await ensureRithWorkspacesPath();

    expect(returned).toBe(expected);
    expect((await lstat(expected)).isDirectory()).toBe(true);
  });

  test('is idempotent - safe to call twice', async () => {
    await ensureRithWorkspacesPath();
    await ensureRithWorkspacesPath();

    const expected = getRithWorkspacesPath();
    expect((await lstat(expected)).isDirectory()).toBe(true);
  });
});

describe('createProjectSourceSymlink', () => {
  let tempRithHome: string;
  let tempTarget: string;
  useEnvSnapshot();

  beforeEach(async () => {
    delete process.env.WORKSPACE_PATH;
    delete process.env.RITH_DOCKER;
    tempRithHome = join(
      tmpdir(),
      `rith-symlink-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    process.env.RITH_HOME = tempRithHome;

    tempTarget = join(tmpdir(), `rith-target-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempTarget, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRithHome, { recursive: true, force: true });
    await rm(tempTarget, { recursive: true, force: true });
  });

  test.skipIf(isWindows)('creates a symlink pointing to the target', async () => {
    await ensureProjectStructure('acme', 'widget');
    await createProjectSourceSymlink('acme', 'widget', tempTarget);

    const linkPath = getProjectSourcePath('acme', 'widget');
    const stats = await lstat(linkPath);
    expect(stats.isSymbolicLink()).toBe(true);
    expect(await readlink(linkPath)).toBe(tempTarget);
  });

  test.skipIf(isWindows)('is a no-op if symlink already points to same target', async () => {
    await ensureProjectStructure('acme', 'widget');
    await createProjectSourceSymlink('acme', 'widget', tempTarget);
    // Call again - should not throw
    await createProjectSourceSymlink('acme', 'widget', tempTarget);

    const linkPath = getProjectSourcePath('acme', 'widget');
    expect(await readlink(linkPath)).toBe(tempTarget);
  });

  test.skipIf(isWindows)('throws when symlink points to a different target', async () => {
    await ensureProjectStructure('acme', 'widget');
    await createProjectSourceSymlink('acme', 'widget', tempTarget);

    const otherTarget = join(tmpdir(), 'other-target');
    await mkdir(otherTarget, { recursive: true });

    try {
      await expect(createProjectSourceSymlink('acme', 'widget', otherTarget)).rejects.toThrow(
        'already points to'
      );
    } finally {
      await rm(otherTarget, { recursive: true, force: true });
    }
  });

  test.skipIf(isWindows)(
    'is a no-op when real directory with contents exists (clone case)',
    async () => {
      await ensureProjectStructure('acme', 'widget');

      // Put a file in the source dir to simulate a clone
      const sourcePath = getProjectSourcePath('acme', 'widget');
      await writeFile(join(sourcePath, 'README.md'), '# Hello');

      // Should not overwrite the directory with a symlink
      await createProjectSourceSymlink('acme', 'widget', tempTarget);

      const stats = await lstat(sourcePath);
      expect(stats.isDirectory()).toBe(true);
      expect(stats.isSymbolicLink()).toBe(false);
    }
  );

  test.skipIf(isWindows)(
    'replaces empty directory with symlink (ensureProjectStructure case)',
    async () => {
      await ensureProjectStructure('acme', 'widget');

      // source/ is empty from ensureProjectStructure
      await createProjectSourceSymlink('acme', 'widget', tempTarget);

      const linkPath = getProjectSourcePath('acme', 'widget');
      const stats = await lstat(linkPath);
      expect(stats.isSymbolicLink()).toBe(true);
      expect(await readlink(linkPath)).toBe(tempTarget);
    }
  );

  test.skipIf(isWindows)('creates symlink when source path does not exist', async () => {
    // Only create the parent, not the source dir itself
    const projectRoot = getProjectRoot('acme', 'widget');
    await mkdir(projectRoot, { recursive: true });

    await createProjectSourceSymlink('acme', 'widget', tempTarget);

    const linkPath = getProjectSourcePath('acme', 'widget');
    const stats = await lstat(linkPath);
    expect(stats.isSymbolicLink()).toBe(true);
  });
});
