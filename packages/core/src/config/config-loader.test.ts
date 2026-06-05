import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { homedir } from 'os';
import { join } from 'path';
import { createMockLogger } from '../test/mocks/logger';

const mockLogger = createMockLogger();
const rithHome = join(homedir(), '.rith');
mock.module('@rith/paths', () => ({
  createLogger: mock(() => mockLogger),
  getRithHome: mock(() => rithHome),
  getRithConfigPath: mock(() => join(rithHome, 'config.yaml')),
  getRithWorkspacesPath: mock(() => join(rithHome, 'workspaces')),
  getRithWorktreesPath: mock(() => join(rithHome, 'worktrees')),
  getDefaultCommandsPath: mock(() => '/app/.rith/commands/defaults'),
  getDefaultWorkflowsPath: mock(() => '/app/.rith/workflows/defaults'),
}));

// Mock fs/promises so that readConfigFile/writeConfigFile (which call fsReadFile/writeFile
// internally) are intercepted regardless of Bun version mock.module semantics.
const mockFsReadFile = mock(() => Promise.resolve(''));
const mockFsWriteFile = mock(() => Promise.resolve());
const mockFsMkdir = mock(() => Promise.resolve(undefined));

mock.module('fs/promises', () => ({
  readFile: mockFsReadFile,
  writeFile: mockFsWriteFile,
  mkdir: mockFsMkdir,
}));

import {
  loadGlobalConfig,
  loadRepoConfig,
  loadConfig,
  clearConfigCache,
  updateGlobalConfig,
} from './config-loader';

describe('config-loader', () => {
  const originalEnv: Record<string, string | undefined> = {};
  const envVars = ['WORKSPACE_PATH', 'WORKTREE_BASE', 'RITH_HOME'];

  beforeEach(() => {
    clearConfigCache();
    mockFsReadFile.mockReset();
    mockFsWriteFile.mockReset();

    // Save original env vars
    envVars.forEach(key => {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    });
  });

  afterEach(() => {
    // Restore env vars
    envVars.forEach(key => {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    });

    // Clear mock state between tests
    mockFsReadFile.mockClear();
    mockFsWriteFile.mockClear();
  });

  describe('loadGlobalConfig', () => {
    test('returns empty object when file does not exist', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockFsReadFile.mockRejectedValue(error);

      const config = await loadGlobalConfig();
      expect(config).toEqual({});
    });

    test('parses valid YAML config', async () => {
      mockFsReadFile.mockResolvedValue(`
pi:
  model: google/gemini-2.5-pro
`);

      const config = await loadGlobalConfig();
      expect(config.pi?.model).toBe('google/gemini-2.5-pro');
    });

    test('caches config on subsequent calls', async () => {
      mockFsReadFile.mockResolvedValue('pi:\n  model: opus');

      await loadGlobalConfig();
      await loadGlobalConfig();

      // Should only read file once
      expect(mockFsReadFile).toHaveBeenCalledTimes(1);
    });

    test('reloads config when forceReload is true', async () => {
      mockFsReadFile.mockResolvedValue('pi:\n  model: opus');

      await loadGlobalConfig();
      await loadGlobalConfig(true);

      expect(mockFsReadFile).toHaveBeenCalledTimes(2);
    });

    test('logs error for invalid YAML syntax', async () => {
      mockLogger.error.mockClear();

      // Simulate YAML parse error (SyntaxError has no .code property)
      const syntaxError = new SyntaxError('YAML Parse error: Multiline implicit key');
      mockFsReadFile.mockRejectedValue(syntaxError);

      const config = await loadGlobalConfig();

      // Should fall back to empty config
      expect(config).toEqual({});

      // Should log error via structured logger
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: syntaxError }),
        'config_invalid_yaml'
      );
    });

    test('logs error for permission denied', async () => {
      mockLogger.error.mockClear();

      const permError = new Error('Permission denied') as NodeJS.ErrnoException;
      permError.code = 'EACCES';
      mockFsReadFile.mockRejectedValue(permError);

      const config = await loadGlobalConfig();

      // Should fall back to empty config
      expect(config).toEqual({});

      // Should log error via structured logger
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: permError, code: 'EACCES' }),
        'config_permission_denied'
      );
    });
  });

  describe('loadRepoConfig', () => {
    test('loads from .rith/config.yaml', async () => {
      mockFsReadFile.mockResolvedValue('pi:\n  model: google/gemini-2.5-pro');

      const config = await loadRepoConfig('/test/repo');
      expect(config.pi?.model).toBe('google/gemini-2.5-pro');
    });

    test('returns empty object when no config found', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockFsReadFile.mockRejectedValue(error);

      const config = await loadRepoConfig('/test/repo');
      expect(config).toEqual({});
    });

    test('logs error for invalid YAML syntax', async () => {
      mockLogger.error.mockClear();

      // Simulate YAML parse error (SyntaxError has no .code property)
      const syntaxError = new SyntaxError('YAML Parse error: Multiline implicit key');
      mockFsReadFile.mockRejectedValue(syntaxError);

      const config = await loadRepoConfig('/test/repo');

      // Should fall back to empty config
      expect(config).toEqual({});

      // Should log error via structured logger
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: syntaxError }),
        'config_invalid_yaml'
      );
    });

    test('logs error for permission denied', async () => {
      mockLogger.error.mockClear();

      const permError = new Error('Permission denied') as NodeJS.ErrnoException;
      permError.code = 'EACCES';
      mockFsReadFile.mockRejectedValue(permError);

      const config = await loadRepoConfig('/test/repo');

      // Should fall back to empty config
      expect(config).toEqual({});

      // Should log error via structured logger
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: permError, code: 'EACCES' }),
        'config_permission_denied'
      );
    });
  });

  describe('loadConfig', () => {
    test('returns defaults when no configs exist', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockFsReadFile.mockRejectedValue(error);

      const config = await loadConfig();

      expect(config.pi).toEqual({});
    });

    test('repo config overrides global provider config', async () => {
      const pathMatches = (path: string, pattern: string): boolean => {
        const normalizedPath = path.replace(/\\/g, '/');
        return normalizedPath.includes(pattern);
      };

      let globalConfigRead = false;
      mockFsReadFile.mockImplementation(async (path: string) => {
        if (pathMatches(path, '/repo/.rith/config.yaml')) {
          return 'pi:\n  model: gemini';
        }
        if (pathMatches(path, '.rith/config.yaml') && !globalConfigRead) {
          globalConfigRead = true;
          return 'pi:\n  model: opus';
        }
        const error = new Error('ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      });

      const config = await loadConfig('/test/repo');
      expect(config.pi.model).toBe('gemini');
    });

    test('merges provider config from global and repo', async () => {
      const pathMatches = (path: string, pattern: string): boolean => {
        const normalizedPath = path.replace(/\\/g, '/');
        return normalizedPath.includes(pattern);
      };

      let globalConfigRead = false;
      mockFsReadFile.mockImplementation(async (path: string) => {
        if (pathMatches(path, '/repo/.rith/config.yaml')) {
          return 'pi:\n  enableExtensions: true';
        }
        if (pathMatches(path, '.rith/config.yaml') && !globalConfigRead) {
          globalConfigRead = true;
          return 'pi:\n  model: opus';
        }
        const error = new Error('ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      });

      const config = await loadConfig('/test/repo');
      expect(config.pi.model).toBe('opus');
      expect(config.pi.enableExtensions).toBe(true);
    });

    test('propagates baseBranch from repo worktree config', async () => {
      const pathMatches = (path: string, pattern: string): boolean => {
        const normalizedPath = path.replace(/\\/g, '/');
        return normalizedPath.includes(pattern);
      };

      mockFsReadFile.mockImplementation(async (path: string) => {
        if (pathMatches(path, '/repo/.rith/config.yaml')) {
          return `
worktree:
  baseBranch: develop
`;
        }
        const error = new Error('ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      });

      const config = await loadConfig('/test/repo');
      expect(config.baseBranch).toBe('develop');
    });

    test('trims whitespace from baseBranch', async () => {
      const pathMatches = (path: string, pattern: string): boolean => {
        const normalizedPath = path.replace(/\\/g, '/');
        return normalizedPath.includes(pattern);
      };

      mockFsReadFile.mockImplementation(async (path: string) => {
        if (pathMatches(path, '/repo/.rith/config.yaml')) {
          return `
worktree:
  baseBranch: "  staging  "
`;
        }
        const error = new Error('ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      });

      const config = await loadConfig('/test/repo');
      expect(config.baseBranch).toBe('staging');
    });

    test('baseBranch is undefined when not configured', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockFsReadFile.mockRejectedValue(error);

      const config = await loadConfig('/test/repo');
      expect(config.baseBranch).toBeUndefined();
    });

    test('propagates docsPath from repo docs config', async () => {
      const pathMatches = (path: string, pattern: string): boolean => {
        const normalizedPath = path.replace(/\\/g, '/');
        return normalizedPath.includes(pattern);
      };

      mockFsReadFile.mockImplementation(async (path: string) => {
        if (pathMatches(path, '/repo/.rith/config.yaml')) {
          return `
docs:
  path: packages/docs-web/src/content/docs
`;
        }
        const error = new Error('ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      });

      const config = await loadConfig('/test/repo');
      expect(config.docsPath).toBe('packages/docs-web/src/content/docs');
    });

    test('trims whitespace from docsPath', async () => {
      const pathMatches = (path: string, pattern: string): boolean => {
        const normalizedPath = path.replace(/\\/g, '/');
        return normalizedPath.includes(pattern);
      };

      mockFsReadFile.mockImplementation(async (path: string) => {
        if (pathMatches(path, '/repo/.rith/config.yaml')) {
          return `
docs:
  path: "  custom/docs/  "
`;
        }
        const error = new Error('ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      });

      const config = await loadConfig('/test/repo');
      expect(config.docsPath).toBe('custom/docs/');
    });

    test('docsPath is undefined when docs config is absent', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockFsReadFile.mockRejectedValue(error);

      const config = await loadConfig('/test/repo');
      expect(config.docsPath).toBeUndefined();
    });

    test('propagates env vars from repo config', async () => {
      const pathMatches = (path: string, pattern: string): boolean =>
        path.replace(/\\/g, '/').includes(pattern);

      mockFsReadFile.mockImplementation(async (path: string) => {
        if (pathMatches(path, '/repo/.rith/config.yaml')) {
          return `
env:
  MY_TOKEN: abc123
  API_BASE: https://api.example.com
`;
        }
        const error = new Error('ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      });

      const config = await loadConfig('/test/repo');
      expect(config.envVars).toEqual({ MY_TOKEN: 'abc123', API_BASE: 'https://api.example.com' });
    });

    test('envVars is undefined when repo config has no env section', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockFsReadFile.mockRejectedValue(error);

      const config = await loadConfig('/test/repo');
      expect(config.envVars).toBeUndefined();
    });

    test('paths use rith defaults', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockFsReadFile.mockRejectedValue(error);

      const config = await loadConfig();

      expect(config.paths.workspaces).toBe(join(homedir(), '.rith', 'workspaces'));
      expect(config.paths.worktrees).toBe(join(homedir(), '.rith', 'worktrees'));
    });
  });

  describe('settingSources config', () => {
    test('merges settingSources from global provider config', async () => {
      mockFsReadFile.mockResolvedValue(`
pi:
  settingSources:
    - project
    - user
`);
      const config = await loadConfig();
      expect(config.pi.settingSources).toEqual(['project', 'user']);
    });

    test('defaults to undefined settingSources when not configured', async () => {
      mockFsReadFile.mockResolvedValue('');
      const config = await loadConfig();
      expect(config.pi.settingSources).toBeUndefined();
    });

    test('repo settingSources overrides global', async () => {
      const pathMatches = (path: string, pattern: string): boolean => {
        const normalizedPath = path.replace(/\\/g, '/');
        return normalizedPath.includes(pattern);
      };

      let globalConfigRead = false;
      mockFsReadFile.mockImplementation(async (path: string) => {
        if (pathMatches(path, '/repo/.rith/config.yaml')) {
          return 'pi:\n  settingSources:\n    - project';
        }
        if (pathMatches(path, '.rith/config.yaml') && !globalConfigRead) {
          globalConfigRead = true;
          return 'pi:\n  settingSources:\n    - project\n    - user';
        }
        const error = new Error('ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      });

      const config = await loadConfig('/test/repo');
      expect(config.pi.settingSources).toEqual(['project']);
    });
  });

  describe('updateGlobalConfig', () => {
    test('merges provider config into existing file', async () => {
      mockFsReadFile.mockResolvedValue(`
pi:
  model: sonnet
`);

      await updateGlobalConfig({
        pi: { model: 'opus' },
      });

      expect(mockFsWriteFile).toHaveBeenCalledTimes(1);
      const writtenContent = mockFsWriteFile.mock.calls[0]?.[1] as string;
      expect(writtenContent).toContain('opus');
    });

    test('preserves existing non-updated fields', async () => {
      mockFsReadFile.mockResolvedValue(`
pi:
  model: sonnet
  enableExtensions: true
`);

      await updateGlobalConfig({
        pi: { model: 'opus' },
      });

      expect(mockFsWriteFile).toHaveBeenCalledTimes(1);
      const writtenContent = mockFsWriteFile.mock.calls[0]?.[1] as string;
      expect(writtenContent).toContain('opus');
    });

    test('creates config when file does not exist', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockFsReadFile.mockRejectedValue(error);

      await updateGlobalConfig({
        pi: { model: 'gemini' },
      });

      expect(mockFsWriteFile).toHaveBeenCalledTimes(2); // 1st: default template, 2nd: merged update
      const writtenContent = mockFsWriteFile.mock.calls[1]?.[1] as string;
      expect(writtenContent).toContain('gemini');
    });

    test('throws on permission errors', async () => {
      mockFsReadFile.mockResolvedValue('');
      const permError = new Error('Permission denied') as NodeJS.ErrnoException;
      permError.code = 'EACCES';
      mockFsWriteFile.mockRejectedValue(permError);

      await expect(updateGlobalConfig({ pi: { model: 'test' } })).rejects.toThrow(
        'Permission denied'
      );
    });
  });
});
