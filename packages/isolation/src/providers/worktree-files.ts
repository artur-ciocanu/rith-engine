/**
 * Worktree file-copy logic.
 *
 * Extracted from worktree.ts — copies git-ignored files (e.g. `.rith/`)
 * from the main repo into a freshly created worktree.
 */

import { createLogger } from '@rith/paths';
import type { Logger } from '@rith/paths';
import { copyWorktreeFiles } from '../worktree-copy';
import type { RepoConfigLoader } from '../types';

let cachedLog: Logger | undefined;
function getLog(): Logger {
  if (!cachedLog) cachedLog = createLogger('isolation.worktree');
  return cachedLog;
}

/**
 * Copy git-ignored files to worktree based on repo config.
 * Returns `configLoadFailed: true` when no config was provided and the
 * internal fallback load of the config fails — so the caller can surface
 * a warning without blocking worktree creation.
 */
export async function copyConfiguredFiles(
  canonicalRepoPath: string,
  worktreePath: string,
  worktreeConfig: { baseBranch?: string; copyFiles?: string[] } | null | undefined,
  loadConfig: RepoConfigLoader
): Promise<{ configLoadFailed: boolean }> {
  // Default files to always copy
  const defaultCopyFiles = ['.rith'];

  // Load user config - log errors and set configLoadFailed, but don't fail worktree creation
  let userCopyFiles: string[] = [];
  let configLoadFailed = false;
  if (worktreeConfig) {
    userCopyFiles = worktreeConfig.copyFiles ?? [];
  } else {
    // Config not provided - try loading it
    try {
      const loadedConfig = await loadConfig(canonicalRepoPath);
      userCopyFiles = loadedConfig?.copyFiles ?? [];
    } catch (error) {
      // Config errors are more serious - log as error, not warning
      const err = error instanceof Error ? error : new Error(String(error));
      getLog().error(
        { err, errorType: err.constructor.name, canonicalRepoPath },
        'repo_config_load_failed'
      );
      configLoadFailed = true;
      // Continue with default files only — worktree is still usable
    }
  }

  // Merge defaults with user config (Set deduplicates)
  const copyFiles = [...new Set([...defaultCopyFiles, ...userCopyFiles])];

  if (copyFiles.length === 0) {
    return { configLoadFailed };
  }

  // Copy files - errors are handled inside copyWorktreeFiles, but wrap in
  // try/catch for defense against unexpected errors
  try {
    const copied = await copyWorktreeFiles(canonicalRepoPath, worktreePath, copyFiles);
    if (copied.length > 0) {
      getLog().debug({ worktreePath, copiedCount: copied.length }, 'worktree_files_copied');
    }

    // Log summary if some files were configured but not all were copied
    const attemptedCount = copyFiles.length;
    const copiedCount = copied.length;
    if (copiedCount < attemptedCount) {
      getLog().warn({ worktreePath, copiedCount, attemptedCount }, 'worktree_file_copy_partial');
    }
  } catch (error) {
    // Should not happen as copyWorktreeFiles handles errors internally,
    // but guard against unexpected errors
    getLog().error({ err: error, worktreePath }, 'worktree_file_copy_failed');
  }

  return { configLoadFailed };
}
