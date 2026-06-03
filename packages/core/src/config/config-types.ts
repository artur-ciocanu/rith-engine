/**
 * Configuration types for Rith Engine YAML config files.
 */

/**
 * Global configuration (non-secret user preferences)
 * Located at ~/.rith/config.yaml
 */

// Provider config defaults — canonical definitions live in @rith/providers/types.
// Imported and re-exported here so existing consumers don't break.
import type { ProviderDefaults } from '@rith/providers/types';

export type { ProviderDefaults };

export interface GlobalConfig {
  /**
   * Provider defaults (model, reasoning effort, etc.)
   */
  provider?: ProviderDefaults;

  /** @deprecated Use `provider:` in config.yaml. Kept for backward compatibility. */
  pi?: ProviderDefaults;

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
   * Provider defaults for this repository
   */
  provider?: ProviderDefaults;

  /** @deprecated Use `provider:` in config.yaml. Kept for backward compatibility. */
  pi?: ProviderDefaults;
}

/**
 * Merged configuration (global + repo + env vars)
 * Environment variables take precedence
 */
export interface MergedConfig {
  provider: ProviderDefaults;
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
