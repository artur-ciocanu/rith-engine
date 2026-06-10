/**
 * Worktree submodule initialization.
 *
 * Extracted from worktree.ts — handles `git submodule update --init --recursive`
 * for repos that use submodules.
 */

import { access } from 'fs/promises';
import { join } from 'path';

import { createLogger } from '@rith/paths';
import type { Logger } from '@rith/paths';
import { execFileAsync } from '@rith/git';

let cachedLog: Logger | undefined;
function getLog(): Logger {
  if (!cachedLog) cachedLog = createLogger('isolation.worktree');
  return cachedLog;
}

/**
 * Initialize git submodules in a worktree when the repo uses them.
 *
 * ENOENT on `.gitmodules` → skip (zero-cost for non-submodule repos).
 * Any other error (EACCES, EIO, git failure, timeout) → throw. Silent
 * success on a half-initialized worktree is the exact class of bug this
 * function exists to prevent; an unreadable `.gitmodules` is materially
 * the same as a failed git op. The thrown error is classified by
 * `classifyIsolationError` into an actionable message.
 */
export async function initSubmodules(worktreePath: string): Promise<void> {
  try {
    await access(join(worktreePath, '.gitmodules'));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return;
    }
    getLog().error({ err, worktreePath }, 'worktree.submodule_check_failed');
    throw new Error(
      `Submodule initialization failed: cannot read .gitmodules (${err.code ?? 'unknown error'})`
    );
  }

  try {
    await execFileAsync(
      'git',
      ['-C', worktreePath, 'submodule', 'update', '--init', '--recursive'],
      { timeout: 120000 }
    );
    getLog().info({ worktreePath }, 'worktree.submodule_init_completed');
  } catch (error) {
    const err = error as Error & { stderr?: string };
    getLog().error({ err, worktreePath }, 'worktree.submodule_init_failed');
    const detail = err.stderr?.trim() || err.message;
    throw new Error(`Submodule initialization failed: ${detail}`);
  }
}
