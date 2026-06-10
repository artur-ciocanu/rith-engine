/**
 * Worktree branch operations.
 *
 * Extracted from worktree.ts — handles PR checkout, new-branch creation,
 * branch deletion, and orphan-directory cleanup.
 */

import { rm } from 'fs/promises';
import { access } from 'fs/promises';

import { createLogger } from '@rith/paths';
import type { Logger } from '@rith/paths';
import {
  execFileAsync,
  removeWorktree,
  worktreeExists,
  toRepoPath,
  toWorktreePath,
} from '@rith/git';
import type { DestroyResult, IsolationRequest, PRIsolationRequest } from '../types';

/** Ceiling for a single git subprocess in branch operations. See worktree.ts. */
const GIT_OPERATION_TIMEOUT_MS = 5 * 60 * 1000;

let cachedLog: Logger | undefined;
function getLog(): Logger {
  if (!cachedLog) cachedLog = createLogger('isolation.worktree');
  return cachedLog;
}

// ---------------------------------------------------------------------------
// Orphan cleanup helpers (internal)
// ---------------------------------------------------------------------------

/**
 * Check if a directory exists.
 * Returns true if directory exists, false if it doesn't exist (ENOENT).
 * Throws for other errors (permission denied, I/O errors, etc.)
 */
async function directoryExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return false;
    }
    throw new Error(
      `Failed to check directory at ${path}: ${err.message} (code: ${err.code ?? 'unknown'})`
    );
  }
}

/**
 * Clean up an orphan directory if it exists but is not a valid worktree.
 * An orphan directory can occur when git worktree remove succeeds but leaves
 * untracked files (like .rith/) behind.
 */
async function cleanOrphanDirectoryIfExists(worktreePath: string): Promise<void> {
  const dirExists = await directoryExists(worktreePath);
  if (!dirExists) {
    return;
  }

  const isValidWorktree = await worktreeExists(toWorktreePath(worktreePath));
  if (isValidWorktree) {
    return; // Not an orphan - it's a valid worktree
  }

  // Orphan directory - remove it before creating worktree
  getLog().debug({ worktreePath }, 'orphan_directory_cleaning');
  try {
    await rm(worktreePath, { recursive: true, force: true });
    getLog().debug({ worktreePath }, 'isolation.orphan_directory_removed');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    // Provide context for the error - orphan cleanup is critical for worktree creation
    throw new Error(`Failed to clean orphan directory at ${worktreePath}: ${err.message}`);
  }
}

/**
 * Clean up a git-registered worktree that was left by a partial failure.
 * Best-effort: logs errors but doesn't throw (the original error is more important).
 */
async function cleanOrphanWorktreeIfExists(repoPath: string, worktreePath: string): Promise<void> {
  try {
    if (await worktreeExists(toWorktreePath(worktreePath))) {
      getLog().warn({ repoPath, worktreePath }, 'isolation.orphan_cleanup_started');
      await removeWorktree(toRepoPath(repoPath), toWorktreePath(worktreePath));
      getLog().info({ repoPath, worktreePath }, 'isolation.orphan_cleanup_completed');
    }
  } catch (cleanupError) {
    const err = cleanupError as Error;
    getLog().error(
      { repoPath, worktreePath, error: err.message, errorType: err.constructor.name, err },
      'isolation.orphan_cleanup_failed'
    );
    // Don't throw — the original creation error is more important
  }
}

// ---------------------------------------------------------------------------
// Branch creation helpers (internal)
// ---------------------------------------------------------------------------

/**
 * Execute a git command that creates a branch, with retry logic for stale branches.
 * If the branch already exists, delete it and retry the command.
 */
async function createBranchWithStaleRetry(
  repoPath: string,
  createCommand: () => Promise<{ stdout: string; stderr: string }>,
  branchName: string
): Promise<void> {
  try {
    await createCommand();
  } catch (error) {
    const err = error as Error & { stderr?: string };
    if (err.stderr?.includes('already exists')) {
      getLog().debug({ repoPath, branchName }, 'stale_branch_retry');
      await execFileAsync('git', ['-C', repoPath, 'branch', '-D', branchName], {
        timeout: GIT_OPERATION_TIMEOUT_MS,
      });
      await createCommand();
    } else {
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// PR branch creation (exported)
// ---------------------------------------------------------------------------

/**
 * Create worktree from PR
 *
 * For same-repo PRs: Use the actual branch name so changes push directly to PR
 * For fork PRs: Use synthetic branch (pr-N-review) since we can't push to forks
 *
 * When prSha is provided, the worktree is initially created at the specific
 * commit (detached HEAD), then a local tracking branch is created.
 */
export async function createFromPR(
  request: PRIsolationRequest,
  worktreePath: string
): Promise<void> {
  // Clean up any orphan directory before creating worktree
  await cleanOrphanDirectoryIfExists(worktreePath);

  const repoPath = request.canonicalRepoPath;
  const prNumber = request.identifier;

  try {
    if (!request.isForkPR) {
      // Same-repo PR: Use the actual branch so changes push directly to PR
      await createFromSameRepoPR(repoPath, worktreePath, request.prBranch);
    } else {
      // Fork PR: Use synthetic review branch
      await createFromForkPR(repoPath, worktreePath, prNumber, request.prSha);
    }
  } catch (error) {
    // Clean up orphaned git-registered worktree from partial failure
    // (e.g., worktree add succeeded but createBranchWithStaleRetry failed)
    await cleanOrphanWorktreeIfExists(repoPath, worktreePath);
    const err = error as Error;
    throw new Error(`Failed to create worktree for PR #${prNumber}: ${err.message}`);
  }
}

/**
 * Create worktree for same-repo PR using the actual branch
 */
export async function createFromSameRepoPR(
  repoPath: string,
  worktreePath: string,
  prBranch: string
): Promise<void> {
  // Fetch the PR's actual branch
  await execFileAsync('git', ['-C', repoPath, 'fetch', 'origin', prBranch], {
    timeout: GIT_OPERATION_TIMEOUT_MS,
  });

  // Try to create worktree with the branch
  try {
    // If branch doesn't exist locally, create it tracking remote
    await execFileAsync(
      'git',
      ['-C', repoPath, 'worktree', 'add', worktreePath, '-b', prBranch, `origin/${prBranch}`],
      { timeout: GIT_OPERATION_TIMEOUT_MS }
    );
  } catch (error) {
    const err = error as Error & { stderr?: string };
    // Branch already exists locally - use it directly
    if (err.stderr?.includes('already exists')) {
      await execFileAsync('git', ['-C', repoPath, 'worktree', 'add', worktreePath, prBranch], {
        timeout: GIT_OPERATION_TIMEOUT_MS,
      });
    } else {
      throw error;
    }
  }

  // Set up tracking for push/pull (non-fatal - worktree is usable without it)
  try {
    await execFileAsync(
      'git',
      ['-C', worktreePath, 'branch', '--set-upstream-to', `origin/${prBranch}`],
      { timeout: GIT_OPERATION_TIMEOUT_MS }
    );
  } catch (trackingError) {
    getLog().warn({ err: trackingError, worktreePath, prBranch }, 'upstream_tracking_failed');
    // Continue - the worktree was created successfully, tracking is just convenience
  }
}

/**
 * Create worktree for fork PR using synthetic review branch
 *
 * Handles stale branches: If a branch already exists from a previous worktree
 * that was deleted, we delete the stale branch and retry.
 */
async function createFromForkPR(
  repoPath: string,
  worktreePath: string,
  prNumber: string,
  prSha?: string
): Promise<void> {
  const reviewBranch = `pr-${prNumber}-review`;

  if (prSha) {
    // SHA provided: create at specific commit for reproducible reviews
    await execFileAsync('git', ['-C', repoPath, 'fetch', 'origin', `pull/${prNumber}/head`], {
      timeout: GIT_OPERATION_TIMEOUT_MS,
    });

    await execFileAsync('git', ['-C', repoPath, 'worktree', 'add', worktreePath, prSha], {
      timeout: GIT_OPERATION_TIMEOUT_MS,
    });

    // Create a local tracking branch so it's not detached HEAD
    await createBranchWithStaleRetry(
      repoPath,
      () =>
        execFileAsync('git', ['-C', worktreePath, 'checkout', '-b', reviewBranch, prSha], {
          timeout: GIT_OPERATION_TIMEOUT_MS,
        }),
      reviewBranch
    );
  } else {
    // No SHA: fetch and create review branch
    await createBranchWithStaleRetry(
      repoPath,
      () =>
        execFileAsync(
          'git',
          ['-C', repoPath, 'fetch', 'origin', `pull/${prNumber}/head:${reviewBranch}`],
          { timeout: GIT_OPERATION_TIMEOUT_MS }
        ),
      reviewBranch
    );

    await execFileAsync('git', ['-C', repoPath, 'worktree', 'add', worktreePath, reviewBranch], {
      timeout: GIT_OPERATION_TIMEOUT_MS,
    });
  }
}

// ---------------------------------------------------------------------------
// New-branch creation (exported)
// ---------------------------------------------------------------------------

/**
 * Create worktree with new branch
 */
export async function createNewBranch(
  request: IsolationRequest,
  repoPath: string,
  worktreePath: string,
  branchName: string,
  baseBranch: string
): Promise<void> {
  // Clean up any orphan directory before creating worktree
  await cleanOrphanDirectoryIfExists(worktreePath);

  // Determine start-point: explicit fromBranch overrides base branch
  const startPoint =
    request.workflowType === 'task' && request.fromBranch
      ? request.fromBranch
      : `origin/${baseBranch}`;

  try {
    // Try to create with new branch
    await execFileAsync(
      'git',
      ['-C', repoPath, 'worktree', 'add', worktreePath, '-b', branchName, startPoint],
      {
        timeout: GIT_OPERATION_TIMEOUT_MS,
      }
    );
  } catch (error) {
    const err = error as Error & { stderr?: string };
    // Branch already exists - reset to intended start-point and use it
    if (err.stderr?.includes('already exists')) {
      const taskFromBranch = request.workflowType === 'task' ? request.fromBranch : undefined;
      if (taskFromBranch) {
        // Branch already exists but caller specified an explicit start point.
        // Adopting the existing branch would silently ignore the start point.
        throw new Error(
          `Branch "${branchName}" already exists. Cannot create it from "${taskFromBranch}". ` +
            'Either choose a different --branch name or omit --from.'
        );
      }

      // Branch exists but no explicit start-point override — reset it to the
      // intended start-point before checking out, so we don't inherit stale
      // commits from a previous run or external tool.
      getLog().warn(
        { branchName, startPoint, repoPath },
        'worktree.branch_exists_resetting_to_start_point'
      );
      await execFileAsync('git', ['-C', repoPath, 'branch', '-f', branchName, startPoint], {
        timeout: 10000,
      });
      await execFileAsync('git', ['-C', repoPath, 'worktree', 'add', worktreePath, branchName], {
        timeout: GIT_OPERATION_TIMEOUT_MS,
      });
    } else {
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Branch deletion (exported)
// ---------------------------------------------------------------------------

/**
 * Delete a branch and track the result. Never throws - branch deletion is best-effort.
 * Returns true if branch was deleted or already gone, false if deletion failed.
 */
export async function deleteBranchTracked(
  repoPath: string,
  branchName: string,
  result: DestroyResult
): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', repoPath, 'branch', '-D', branchName], {
      timeout: GIT_OPERATION_TIMEOUT_MS,
    });
    getLog().debug({ repoPath, branchName }, 'branch_deleted');
    return true;
  } catch (error) {
    const err = error as Error & { stderr?: string };
    const errorText = `${err.message} ${err.stderr ?? ''}`;

    if (errorText.includes('not found') || errorText.includes('did not match any')) {
      getLog().debug({ repoPath, branchName }, 'branch_already_deleted');
      return true; // Already gone counts as success
    } else if (errorText.includes('checked out at')) {
      const warning = `Cannot delete branch '${branchName}': branch is checked out elsewhere`;
      getLog().warn({ repoPath, branchName }, 'branch_checked_out_elsewhere');
      result.warnings.push(warning);
      return false;
    } else {
      const warning = `Unexpected error deleting branch '${branchName}': ${err.message}`;
      getLog().error({ err: error, repoPath, branchName }, 'branch_delete_failed');
      result.warnings.push(warning);
      return false;
    }
  }
}

/**
 * Delete a remote branch and track the result. Never throws - remote branch deletion is best-effort.
 * Returns true if branch was deleted or already gone, false if deletion failed.
 */
export async function deleteRemoteBranchTracked(
  repoPath: string,
  branchName: string,
  result: DestroyResult
): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', repoPath, 'push', 'origin', '--delete', branchName], {
      timeout: GIT_OPERATION_TIMEOUT_MS,
    });
    getLog().debug({ repoPath, branchName }, 'remote_branch_deleted');
    return true;
  } catch (error) {
    const err = error as Error & { stderr?: string };
    const errorText = `${err.message} ${err.stderr ?? ''}`;

    if (
      errorText.includes('remote ref does not exist') ||
      errorText.includes("couldn't find remote ref")
    ) {
      getLog().debug({ repoPath, branchName }, 'remote_branch_already_deleted');
      return true; // Already gone counts as success
    } else {
      const warning = `Failed to delete remote branch '${branchName}': ${err.message}`;
      getLog().error({ err: error, repoPath, branchName }, 'remote_branch_delete_failed');
      result.warnings.push(warning);
      return false;
    }
  }
}
