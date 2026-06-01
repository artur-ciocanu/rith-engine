import { describe, test, expect, beforeEach, afterEach, spyOn, mock, type Mock } from 'bun:test';
import * as git from '@rith/git';
import * as worktreeCopy from '@rith/isolation';
import * as configLoader from '../config/config-loader';
import * as fs from 'fs/promises';
import type { Stats } from 'fs';
import type { RepoConfig } from '../config/config-types';
import type { CopyFileEntry } from '@rith/isolation';
import { createMockLogger } from '../test/mocks/logger';

/** Normalize path separators to forward slashes for cross-platform comparison */
function normPath(p: string): string {
  return p.replace(/\\/g, '/');
}

const mockLogger = createMockLogger();
mock.module('@rith/paths', () => ({
  createLogger: mock(() => mockLogger),
  getRithHome: mock(() => '/home/test/.rith'),
  getRithConfigPath: mock(() => '/home/test/.rith/config.yaml'),
  getRithWorkspacesPath: mock(() => '/home/test/.rith/workspaces'),
  getRithWorktreesPath: mock(() => '/home/test/.rith/worktrees'),
  getDefaultCommandsPath: mock(() => '/app/.rith/commands/defaults'),
  getDefaultWorkflowsPath: mock(() => '/app/.rith/workflows/defaults'),
}));

import { syncRithToWorktree } from './worktree-sync';

describe('syncRithToWorktree', () => {
  let isWorktreePathSpy: Mock<(path: string) => Promise<boolean>>;
  let getCanonicalRepoPathSpy: Mock<(path: string) => Promise<string>>;
  let statSpy: Mock<(path: string) => Promise<Stats>>;
  let loadRepoConfigSpy: Mock<(path: string) => Promise<RepoConfig>>;
  let copyWorktreeFilesSpy: Mock<
    (canonicalPath: string, worktreePath: string, files: string[]) => Promise<CopyFileEntry[]>
  >;

  beforeEach(() => {
    isWorktreePathSpy = spyOn(git, 'isWorktreePath');
    getCanonicalRepoPathSpy = spyOn(git, 'getCanonicalRepoPath');
    statSpy = spyOn(fs, 'stat');
    loadRepoConfigSpy = spyOn(configLoader, 'loadRepoConfig');
    copyWorktreeFilesSpy = spyOn(worktreeCopy, 'copyWorktreeFiles');
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();
  });

  afterEach(() => {
    isWorktreePathSpy.mockRestore();
    getCanonicalRepoPathSpy.mockRestore();
    statSpy.mockRestore();
    loadRepoConfigSpy.mockRestore();
    copyWorktreeFilesSpy.mockRestore();
  });

  test('returns false for non-worktree paths', async () => {
    isWorktreePathSpy.mockResolvedValue(false);

    const result = await syncRithToWorktree('/regular/repo');

    expect(result).toBe(false);
    expect(isWorktreePathSpy).toHaveBeenCalledWith('/regular/repo');
    expect(getCanonicalRepoPathSpy).not.toHaveBeenCalled();
  });

  test('returns false when canonical repo has no .rith', async () => {
    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');
    statSpy.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await syncRithToWorktree('/worktree/path');

    expect(result).toBe(false);
    expect(normPath(statSpy.mock.calls[0][0] as string)).toBe('/canonical/repo/.rith');
    expect(copyWorktreeFilesSpy).not.toHaveBeenCalled();
    // Should not log warning for ENOENT (expected case)
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  test('logs warning and returns false for non-ENOENT canonical stat error', async () => {
    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');
    statSpy.mockRejectedValue(Object.assign(new Error('Permission denied'), { code: 'EACCES' }));

    const result = await syncRithToWorktree('/worktree/path');

    expect(result).toBe(false);
    expect(copyWorktreeFilesSpy).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'canonical',
        path: expect.stringMatching(/canonical[/\\]repo[/\\]\.rith/),
        code: 'EACCES',
      }),
      'stat_failed'
    );
  });

  test('returns false when worktree .rith is up-to-date', async () => {
    const canonicalMtime = new Date('2024-01-01T10:00:00Z');
    const worktreeMtime = new Date('2024-01-01T12:00:00Z'); // Newer

    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');

    statSpy.mockImplementation((path: string) => {
      const p = normPath(path);
      if (p === '/canonical/repo/.rith') {
        return Promise.resolve({ mtime: canonicalMtime } as Stats);
      }
      if (p === '/worktree/path/.rith') {
        return Promise.resolve({ mtime: worktreeMtime } as Stats);
      }
      return Promise.reject(new Error('Unexpected path'));
    });

    const result = await syncRithToWorktree('/worktree/path');

    expect(result).toBe(false);
    expect(copyWorktreeFilesSpy).not.toHaveBeenCalled();
  });

  test('syncs when canonical .rith is newer', async () => {
    const canonicalMtime = new Date('2024-01-01T12:00:00Z'); // Newer
    const worktreeMtime = new Date('2024-01-01T10:00:00Z');

    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');

    statSpy.mockImplementation((path: string) => {
      const p = normPath(path);
      if (p === '/canonical/repo/.rith') {
        return Promise.resolve({ mtime: canonicalMtime } as Stats);
      }
      if (p === '/worktree/path/.rith') {
        return Promise.resolve({ mtime: worktreeMtime } as Stats);
      }
      return Promise.reject(new Error('Unexpected path'));
    });

    loadRepoConfigSpy.mockResolvedValue({
      worktree: { copyFiles: ['.rith', '.env'] },
    });

    copyWorktreeFilesSpy.mockResolvedValue([{ source: '.rith', destination: '.rith' }]);

    const result = await syncRithToWorktree('/worktree/path');

    expect(result).toBe(true);
    expect(copyWorktreeFilesSpy).toHaveBeenCalledWith(
      expect.stringMatching(/canonical[/\\]repo$/),
      expect.stringMatching(/worktree[/\\]path$/),
      ['.rith', '.env']
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalRepo: expect.stringMatching(/canonical[/\\]repo$/),
        worktree: '/worktree/path',
        filesCopied: 1,
      }),
      'rith_synced_to_worktree'
    );
  });

  test('syncs when worktree has no .rith yet', async () => {
    const canonicalMtime = new Date('2024-01-01T12:00:00Z');

    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');

    statSpy.mockImplementation((path: string) => {
      const p = normPath(path);
      if (p === '/canonical/repo/.rith') {
        return Promise.resolve({ mtime: canonicalMtime } as Stats);
      }
      if (p === '/worktree/path/.rith') {
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      }
      return Promise.reject(new Error('Unexpected path'));
    });

    loadRepoConfigSpy.mockResolvedValue({
      worktree: { copyFiles: ['.rith'] },
    });

    copyWorktreeFilesSpy.mockResolvedValue([{ source: '.rith', destination: '.rith' }]);

    const result = await syncRithToWorktree('/worktree/path');

    expect(result).toBe(true);
    expect(copyWorktreeFilesSpy).toHaveBeenCalledWith(
      expect.stringMatching(/canonical[/\\]repo$/),
      '/worktree/path',
      ['.rith']
    );
  });

  test('logs warning and returns false for non-ENOENT worktree stat error', async () => {
    const canonicalMtime = new Date('2024-01-01T12:00:00Z');

    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');

    statSpy.mockImplementation((path: string) => {
      const p = normPath(path);
      if (p === '/canonical/repo/.rith') {
        return Promise.resolve({ mtime: canonicalMtime } as Stats);
      }
      if (p === '/worktree/path/.rith') {
        return Promise.reject(Object.assign(new Error('Permission denied'), { code: 'EACCES' }));
      }
      return Promise.reject(new Error('Unexpected path'));
    });

    const result = await syncRithToWorktree('/worktree/path');

    expect(result).toBe(false);
    expect(copyWorktreeFilesSpy).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'worktree',
        path: expect.stringMatching(/worktree[/\\]path[/\\]\.rith/),
        code: 'EACCES',
      }),
      'stat_failed'
    );
    // Should also log the outer catch error
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: '/worktree/path',
        code: 'EACCES',
      }),
      'rith_sync_failed'
    );
  });

  test('defaults to [".rith"] when config has no copyFiles', async () => {
    const canonicalMtime = new Date('2024-01-01T12:00:00Z');
    const worktreeMtime = new Date('2024-01-01T10:00:00Z');

    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');

    statSpy.mockImplementation((path: string) => {
      const p = normPath(path);
      if (p === '/canonical/repo/.rith') {
        return Promise.resolve({ mtime: canonicalMtime } as Stats);
      }
      if (p === '/worktree/path/.rith') {
        return Promise.resolve({ mtime: worktreeMtime } as Stats);
      }
      return Promise.reject(new Error('Unexpected path'));
    });

    loadRepoConfigSpy.mockResolvedValue({
      worktree: {}, // No copyFiles
    });

    copyWorktreeFilesSpy.mockResolvedValue([{ source: '.rith', destination: '.rith' }]);

    const result = await syncRithToWorktree('/worktree/path');

    expect(result).toBe(true);
    expect(copyWorktreeFilesSpy).toHaveBeenCalledWith(
      expect.stringMatching(/canonical[/\\]repo$/),
      '/worktree/path',
      ['.rith']
    );
  });

  test('defaults to [".rith"] when config loading fails and logs warning', async () => {
    const canonicalMtime = new Date('2024-01-01T12:00:00Z');
    const worktreeMtime = new Date('2024-01-01T10:00:00Z');

    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');

    statSpy.mockImplementation((path: string) => {
      const p = normPath(path);
      if (p === '/canonical/repo/.rith') {
        return Promise.resolve({ mtime: canonicalMtime } as Stats);
      }
      if (p === '/worktree/path/.rith') {
        return Promise.resolve({ mtime: worktreeMtime } as Stats);
      }
      return Promise.reject(new Error('Unexpected path'));
    });

    loadRepoConfigSpy.mockRejectedValue(new Error('Config not found'));

    copyWorktreeFilesSpy.mockResolvedValue([{ source: '.rith', destination: '.rith' }]);

    const result = await syncRithToWorktree('/worktree/path');

    expect(result).toBe(true);
    expect(copyWorktreeFilesSpy).toHaveBeenCalledWith(
      expect.stringMatching(/canonical[/\\]repo$/),
      '/worktree/path',
      ['.rith']
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalRepoPath: expect.stringMatching(/canonical[/\\]repo$/),
      }),
      'repo_config_load_failed_using_default'
    );
  });

  test('adds .rith to copyFiles list when not specified', async () => {
    const canonicalMtime = new Date('2024-01-01T12:00:00Z');
    const worktreeMtime = new Date('2024-01-01T10:00:00Z');

    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');

    statSpy.mockImplementation((path: string) => {
      const p = normPath(path);
      if (p === '/canonical/repo/.rith') {
        return Promise.resolve({ mtime: canonicalMtime } as Stats);
      }
      if (p === '/worktree/path/.rith') {
        return Promise.resolve({ mtime: worktreeMtime } as Stats);
      }
      return Promise.reject(new Error('Unexpected path'));
    });

    loadRepoConfigSpy.mockResolvedValue({
      worktree: { copyFiles: ['.env', '.vscode'] }, // No .rith
    });

    copyWorktreeFilesSpy.mockResolvedValue([{ source: '.rith', destination: '.rith' }]);

    const result = await syncRithToWorktree('/worktree/path');

    expect(result).toBe(true);
    // .rith is prepended to preserve user's copyFiles while ensuring .rith is synced
    expect(copyWorktreeFilesSpy).toHaveBeenCalledWith(
      expect.stringMatching(/canonical[/\\]repo$/),
      '/worktree/path',
      ['.rith', '.env', '.vscode']
    );
  });

  test('handles sync errors gracefully without throwing', async () => {
    const canonicalMtime = new Date('2024-01-01T12:00:00Z');
    const worktreeMtime = new Date('2024-01-01T10:00:00Z');

    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockResolvedValue('/canonical/repo');

    statSpy.mockImplementation((path: string) => {
      const p = normPath(path);
      if (p === '/canonical/repo/.rith') {
        return Promise.resolve({ mtime: canonicalMtime } as Stats);
      }
      if (p === '/worktree/path/.rith') {
        return Promise.resolve({ mtime: worktreeMtime } as Stats);
      }
      return Promise.reject(new Error('Unexpected path'));
    });

    loadRepoConfigSpy.mockResolvedValue({
      worktree: { copyFiles: ['.rith'] },
    });

    copyWorktreeFilesSpy.mockRejectedValue(new Error('Permission denied'));

    const result = await syncRithToWorktree('/worktree/path');

    expect(result).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: '/worktree/path',
        errorName: 'Error',
        code: 'UNKNOWN',
      }),
      'rith_sync_failed'
    );
  });

  test('handles getCanonicalRepoPath errors gracefully', async () => {
    isWorktreePathSpy.mockResolvedValue(true);
    getCanonicalRepoPathSpy.mockRejectedValue(new Error('Failed to read .git file'));

    const result = await syncRithToWorktree('/worktree/path');

    expect(result).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: '/worktree/path',
        errorName: 'Error',
        code: 'UNKNOWN',
      }),
      'rith_sync_failed'
    );
  });
});
