/**
 * Configuration loader for Rith Engine YAML config files.
 *
 * Pi is the sole provider — registry-based provider resolution has been removed.
 *
 * Loads, merges, and caches:
 *   1. Built-in defaults
 *   2. Global user config (~/.rith/config.yaml)
 *   3. Per-repo config (.rith/config.yaml)
 *   4. Environment variable overrides
 */

import { readFile as fsReadFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { getRithConfigPath, getRithWorkspacesPath, getRithWorktreesPath } from '@rith/paths';

// Wrapper functions for file I/O - allows mocking without polluting fs/promises globally
export async function readConfigFile(path: string): Promise<string> {
  return fsReadFile(path, 'utf-8');
}

export async function writeConfigFile(
  path: string,
  content: string,
  options?: { flag?: string }
): Promise<void> {
  await writeFile(path, content, { encoding: 'utf-8', ...options });
}
import type { GlobalConfig, RepoConfig, MergedConfig } from './config-types';

import { createLogger } from '@rith/paths';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('config');
  return cachedLog;
}

/**
 * Parse YAML using Bun's native YAML parser
 */
function parseYaml(content: string): unknown {
  return Bun.YAML.parse(content);
}

// Cache for loaded configs
let cachedGlobalConfig: GlobalConfig | null = null;

/**
 * Default config file content
 */
const DEFAULT_CONFIG_CONTENT = `# Rith Engine Global Configuration
# See: https://github.com/artur-ciocanu/rith-engine/blob/main/docs/configuration.md

# Pi assistant defaults
# pi:
#   model: default
`;

/**
 * Log config error with specific message based on error type
 */
function logConfigError(configPath: string, error: unknown): void {
  const err = error as { code?: string; message?: string };
  const message = err.message ?? String(error);

  if (err.code === 'EACCES' || err.code === 'EPERM') {
    getLog().error({ configPath, err: error, code: err.code }, 'config_permission_denied');
  } else if (error instanceof SyntaxError || message.includes('YAML')) {
    getLog().error({ configPath, err: error }, 'config_invalid_yaml');
  } else {
    getLog().error({ configPath, err: error }, 'config_load_error');
  }
}

/**
 * Create default config file if it doesn't exist
 */
async function createDefaultConfig(configPath: string): Promise<void> {
  try {
    await mkdir(dirname(configPath), { recursive: true });
    await writeConfigFile(configPath, DEFAULT_CONFIG_CONTENT, { flag: 'wx' }); // wx = fail if exists
    getLog().info({ configPath }, 'default_config_created');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'EEXIST') {
      // Only log if it's not a "file exists" error
      getLog().warn({ err, configPath }, 'default_config_create_failed');
    }
  }
}

/**
 * Load global config from ~/.rith/config.yaml
 * Creates default config if file doesn't exist
 */
export async function loadGlobalConfig(forceReload = false): Promise<GlobalConfig> {
  if (cachedGlobalConfig && !forceReload) {
    return cachedGlobalConfig;
  }

  const configPath = getRithConfigPath();

  try {
    const content = await readConfigFile(configPath);
    cachedGlobalConfig = parseYaml(content) as GlobalConfig;
    return cachedGlobalConfig ?? {};
  } catch (error) {
    const err = error as { code?: string };
    if (err.code === 'ENOENT') {
      // File doesn't exist - create default config
      await createDefaultConfig(configPath);
    } else {
      // Log specific error message based on error type
      logConfigError(configPath, error);
    }
    cachedGlobalConfig = {};
    return cachedGlobalConfig;
  }
}

/**
 * Load repository config from .rith/config.yaml
 * Returns empty object if no config found
 */
export async function loadRepoConfig(repoPath: string): Promise<RepoConfig> {
  const configPath = join(repoPath, '.rith', 'config.yaml');

  try {
    const content = await readConfigFile(configPath);
    return (parseYaml(content) as RepoConfig) ?? {};
  } catch (error) {
    const err = error as { code?: string };
    if (err.code === 'ENOENT') {
      // File doesn't exist - expected, use defaults
      return {};
    }
    // Log specific error message based on error type
    logConfigError(configPath, error);
    return {};
  }
}

/**
 * Get default configuration
 */
function getDefaults(): MergedConfig {
  return {
    pi: {},
    paths: {
      workspaces: getRithWorkspacesPath(),
      worktrees: getRithWorktreesPath(),
    },
    commands: {
      folder: undefined,
      autoLoad: true,
    },
    defaults: {
      copyDefaults: true,
      loadDefaultCommands: true,
      loadDefaultWorkflows: true,
    },
  };
}

/**
 * Apply environment variable overrides
 */
function applyEnvOverrides(config: MergedConfig): MergedConfig {
  // Path overrides (these come from rith-paths.ts which already checks env vars)
  // No need to re-apply here since getDefaults() uses those functions

  return config;
}

/**
 * Merge global config into defaults
 */
function mergeGlobalConfig(defaults: MergedConfig, global: GlobalConfig): MergedConfig {
  const result: MergedConfig = { ...defaults };

  result.pi = { ...defaults.pi, ...global.pi };

  // Path preferences
  if (global.paths) {
    if (global.paths.workspaces) result.paths.workspaces = global.paths.workspaces;
    if (global.paths.worktrees) result.paths.worktrees = global.paths.worktrees;
  }

  return result;
}

/**
 * Merge repo config into merged config
 */
function mergeRepoConfig(merged: MergedConfig, repo: RepoConfig): MergedConfig {
  const result: MergedConfig = { ...merged };

  result.pi = { ...merged.pi, ...repo.pi };

  // Commands config
  if (repo.commands) {
    result.commands = {
      ...result.commands,
      folder: repo.commands.folder ?? result.commands.folder,
      autoLoad: repo.commands.autoLoad ?? result.commands.autoLoad,
    };
  }

  // Defaults config
  if (repo.defaults) {
    result.defaults = {
      ...result.defaults,
      copyDefaults: repo.defaults.copyDefaults ?? result.defaults.copyDefaults,
      loadDefaultCommands: repo.defaults.loadDefaultCommands ?? result.defaults.loadDefaultCommands,
      loadDefaultWorkflows:
        repo.defaults.loadDefaultWorkflows ?? result.defaults.loadDefaultWorkflows,
    };
  }

  // Propagate base branch for $BASE_BRANCH substitution in workflow commands
  if (repo.worktree?.baseBranch?.trim()) {
    result.baseBranch = repo.worktree.baseBranch.trim();
  }

  // Propagate docs path for $DOCS_DIR substitution in workflow commands
  if (repo.docs?.path !== undefined) {
    const trimmed = repo.docs.path.trim();
    if (trimmed) {
      result.docsPath = trimmed;
    } else {
      getLog().warn({ rawValue: repo.docs.path }, 'config.docs_path_whitespace_ignored');
    }
  }

  // Propagate per-project env vars from repo config
  if (repo.env) {
    result.envVars = { ...result.envVars, ...repo.env };
  }

  return result;
}

/**
 * Load fully merged configuration
 *
 * @param repoPath - Optional repository path for repo-level config
 * @returns Merged configuration with all overrides applied
 */
export async function loadConfig(repoPath?: string): Promise<MergedConfig> {
  // 1. Start with defaults
  let config = getDefaults();

  // 2. Apply global config
  const globalConfig = await loadGlobalConfig();
  config = mergeGlobalConfig(config, globalConfig);

  // 3. Apply repo config if path provided
  if (repoPath) {
    const repoConfig = await loadRepoConfig(repoPath);
    config = mergeRepoConfig(config, repoConfig);
  }

  // 4. Apply environment overrides (highest precedence)
  config = applyEnvOverrides(config);

  return config;
}

/**
 * Clear cached global config (useful for testing)
 */
export function clearConfigCache(): void {
  cachedGlobalConfig = null;
}

/**
 * Log current configuration (for startup)
 */
export function logConfig(config: MergedConfig): void {
  getLog().info(
    {
      pi: config.pi,
    },
    'config_loaded'
  );
}

/**
 * Update global config (~/.rith/config.yaml) with partial updates.
 * Reads current config, deep-merges updates, and writes back to YAML.
 * Invalidates the cached config so next loadConfig() picks up changes.
 */
export async function updateGlobalConfig(updates: Partial<GlobalConfig>): Promise<void> {
  const configPath = getRithConfigPath();

  try {
    // Force reload to get fresh state
    const current = await loadGlobalConfig(true);

    // Deep-merge: only overwrite defined keys
    const merged: GlobalConfig = { ...current };

    if (updates.pi) {
      merged.pi = { ...(current.pi ?? {}), ...updates.pi };
    }

    // Serialize to YAML and write
    const yaml = Bun.YAML.stringify(merged);
    await mkdir(dirname(configPath), { recursive: true });
    await writeConfigFile(configPath, yaml);

    // Invalidate cache so next loadConfig() re-reads
    cachedGlobalConfig = null;

    getLog().info({ configPath }, 'config.update_completed');
  } catch (error) {
    const err = error as { code?: string; message?: string };

    if (err.code === 'EACCES' || err.code === 'EPERM') {
      getLog().error({ configPath, err: error, code: err.code }, 'config.update_permission_denied');
    } else {
      getLog().error({ configPath, err: error }, 'config.update_failed');
    }

    throw error;
  }
}
