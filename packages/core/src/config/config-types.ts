/**
 * Configuration types for Rith Engine YAML config files.
 */

/**
 * Global configuration (non-secret user preferences)
 * Located at ~/.rith/config.yaml
 */

// Pi config defaults — canonical definition lives in @rith/pi/types.
// Imported and re-exported here so config consumers have one import site.
import type { PiDefaults } from '@rith/pi/types';

export type { PiDefaults };

export interface GlobalConfig {
  /**
   * Pi provider config: default model plus Rith→Pi execution policy
   * (enableExtensions, extensionFlags, maxConcurrent).
   */
  pi?: PiDefaults;

  /**
   * Directory preferences (usually not needed - defaults work well)
   */
  paths?: {
    /**
     * Override workspaces directory
     * @default '~/.rith/workspaces'
     */
    workspaces?: string;

    /**
     * Override worktrees directory
     * @default '~/.rith/worktrees'
     */
    worktrees?: string;
  };
}

/**
 * Repository configuration (project-specific settings)
 * Located at .rith/config.yaml in any repository
 */
export interface RepoConfig {
  /**
   * Custom commands configuration
   */
  commands?: {
    /**
     * Additional command folder to search (relative to repo root).
     * Searched after .rith/commands/ but before .claude/commands/
     */
    folder?: string;

    /**
     * Auto-load commands on startup
     * @default true
     */
    autoLoad?: boolean;
  };

  /**
   * Worktree configuration
   */
  worktree?: {
    /**
     * Base branch for worktree creation
     * @default 'main'
     */
    baseBranch?: string;

    /**
     * Automatically clean up stale worktrees
     * @default true
     */
    autoCleanup?: boolean;

    /**
     * Files/directories to copy from canonical repo to worktrees
     * @default ['.rith']
     */
    copyFiles?: string[];
  };

  /**
   * Documentation configuration
   */
  docs?: {
    /**
     * Path to documentation directory (relative to repo root)
     * @default 'docs/'
     */
    path?: string;
  };

  /**
   * Per-project environment variables.
   * These are injected into workflow commands.
   */
  env?: Record<string, string>;

  /**
   * Default behavior toggles
   */
  defaults?: {
    /**
     * Copy default configs when initializing
     * @default true
     */
    copyDefaults?: boolean;

    /**
     * Load default commands
     * @default true
     */
    loadDefaultCommands?: boolean;

    /**
     * Load default workflows
     * @default true
     */
    loadDefaultWorkflows?: boolean;
  };

  /**
   * Pi provider config for this repository.
   */
  pi?: PiDefaults;
}

/**
 * Merged configuration (global + repo + env vars)
 * Environment variables take precedence
 */
export interface MergedConfig {
  pi: PiDefaults;
  paths: {
    workspaces: string;
    worktrees: string;
  };
  commands: {
    /**
     * Additional command folder to search (relative to repo root)
     * Searched after .rith/commands/ but before .claude/commands/
     */
    folder?: string;
    autoLoad: boolean;
  };
  defaults: {
    copyDefaults: boolean;
    loadDefaultCommands: boolean;
    loadDefaultWorkflows: boolean;
  };
  /**
   * Base branch from repo config (worktree.baseBranch).
   * Used for $BASE_BRANCH substitution in workflow commands.
   * When undefined, workflows referencing $BASE_BRANCH will fail with an error.
   */
  baseBranch?: string;
  /**
   * Docs directory path from repo config (docs.path).
   * Used for $DOCS_DIR substitution in workflow commands.
   * @default 'docs/'
   */
  docsPath?: string;
  /**
   * Merged per-project env vars from .rith/config.yaml env: section.
   * Undefined when no env vars are configured.
   */
  envVars?: Record<string, string>;
}
