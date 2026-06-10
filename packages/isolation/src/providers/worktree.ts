/**
 * Worktree Provider - Git worktree-based isolation
 *
 * Default isolation provider using git worktrees.
 */

import { createHash } from 'crypto';
import { access, rm } from 'fs/promises';
import { isAbsolute, join, normalize as normalizePath, resolve, sep } from 'path';

import { createLogger } from '@rith/paths';
import type { Logger } from '@rith/paths';
import {
  execFileAsync,
  findWorktreeByBranch,
  getCanonicalRepoPath,
  getWorktreeBase,
  listWorktrees,
  mkdirAsync,
  syncWorkspace,
  verifyWorktreeOwnership,
  worktreeExists,
  toRepoPath,
  toWorktreePath,
  toBranchName,
} from '@rith/git';
import type { WorktreeBaseOverride } from '@rith/git';
import { getRithWorkspacesPath } from '@rith/paths';
import type { RepoPath, WorktreeInfo } from '@rith/git';
import type {
  DestroyResult,
  IIsolationProvider,
  IsolatedEnvironment,
  IsolationRequest,
  RepoConfigLoader,
  WorktreeDestroyOptions,
  WorktreeEnvironment,
} from '../types';
import { isPRIsolationRequest } from '../types';
import type { WorktreeCreateConfig } from '../types';
import { initSubmodules } from './worktree-submodules';
import { copyConfiguredFiles } from './worktree-files';
import {
  createFromPR,
  createNewBranch,
  deleteBranchTracked,
  deleteRemoteBranchTracked,
} from './worktree-branches';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: Logger | undefined;
function getLog(): Logger {
  if (!cachedLog) cachedLog = createLogger('isolation.worktree');
  return cachedLog;
}

/**
 * Ceiling for a single git subprocess in worktree operations (create/fetch/checkout/remove/branch-delete).
 * Generous enough for repos with heavy post-checkout hooks (lint/install) while still catching genuine
 * hangs (e.g. credential prompts in non-TTY, stalled network fetches). See #1119, #1029.
 */
const GIT_OPERATION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Validate a user-supplied `worktree.path` from `.rith/config.yaml` and return
 * it as a safe relative path for `getWorktreeBase()`, or `undefined` to fall
 * through to default path resolution.
 *
 * Rules (Fail Fast — malformed values throw; empty/whitespace values are ignored):
 * - `undefined` / empty-after-trim → `undefined` (no override; default resolution applies)
 * - Absolute path                  → throw (users must configure globally, not per-repo)
 * - Contains `..` segment          → throw (escapes repo root)
 * - Resolved path escapes repoRoot → throw (covers symlink / nested `../` edge cases)
 *
 * The path is returned trimmed. The caller composes it via `join(repoRoot, result)`.
 */
function resolveRepoLocalOverride(
  rawPath: string | undefined,
  repoRoot: string
): string | undefined {
  if (rawPath === undefined) return undefined;
  const trimmed = rawPath.trim();
  if (!trimmed) return undefined;

  if (isAbsolute(trimmed)) {
    throw new Error(
      `.rith/config.yaml worktree.path must be relative to the repo root (got absolute: ${trimmed}). ` +
        'For an absolute location, set ~/.rith/config.yaml paths.worktrees instead.'
    );
  }

  const normalized = normalizePath(trimmed);
  // A plain `..` or anything that starts with `../` or contains `/../` escapes the repo.
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('..\\') ||
    normalized.includes('/../') ||
    normalized.includes('\\..\\')
  ) {
    throw new Error(
      `.rith/config.yaml worktree.path must stay within the repo (got: ${trimmed}). ` +
        'Remove any `..` segments.'
    );
  }

  // Double-check via resolved absolute paths — catches edge cases like a path that
  // normalizes clean but still escapes when joined (e.g. leading `./../` on some platforms).
  // Uses `path.sep` so the "is inside repoRoot" check works on Windows (\\) as well as POSIX (/).
  const resolved = resolve(repoRoot, normalized);
  const repoRootResolved = resolve(repoRoot);
  if (resolved !== repoRootResolved && !resolved.startsWith(repoRootResolved + sep)) {
    throw new Error(
      `.rith/config.yaml worktree.path resolves outside the repo root (got: ${trimmed} → ${resolved}).`
    );
  }

  return normalized;
}

export class WorktreeProvider implements IIsolationProvider {
  readonly providerType = 'worktree';

  constructor(private loadConfig: RepoConfigLoader = () => Promise.resolve(null)) {}

  /**
   * Create an isolated environment using git worktrees.
   *
   * Config is loaded exactly once here and threaded through the rest of the
   * `create()` call. A malformed `.rith/config.yaml` fails loudly at this
   * boundary rather than being swallowed — see CLAUDE.md "Fail Fast + Explicit
   * Errors". Downstream helpers assume they receive either a valid config
   * object or `null`, never a second chance to reload.
   */
  async create(request: IsolationRequest): Promise<IsolatedEnvironment> {
    let repoConfig: WorktreeCreateConfig | null;
    try {
      repoConfig = await this.loadConfig(request.canonicalRepoPath);
    } catch (error) {
      const err = error as Error;
      getLog().error({ err, repoPath: request.canonicalRepoPath }, 'repo_config_load_failed');
      throw new Error(`Failed to load config: ${err.message}`);
    }

    const branchName = toBranchName(this.generateBranchName(request));
    const worktreePath = this.getWorktreePath(request, branchName, repoConfig);
    // envId is, by contract, the worktree filesystem path (see `destroy()` docstring).
    // Assign directly from the resolved path to keep the invariant in sync with
    // the actual directory created below — computing it via a separate helper would
    // risk divergence if resolution rules change.
    const envId = worktreePath;

    // Check for existing worktree (adoption)
    const existing = await this.findExisting(request, branchName, worktreePath);
    if (existing) {
      return existing;
    }

    // Create new worktree (re-uses the already-loaded repoConfig — no double load).
    const { warnings } = await this.createWorktree(request, worktreePath, branchName, repoConfig);

    return {
      id: envId,
      provider: 'worktree',
      workingPath: worktreePath,
      branchName,
      status: 'active',
      createdAt: new Date(),
      metadata: { adopted: false, request },
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /**
   * Destroy an isolated environment
   *
   * @param envId - The worktree path (for WorktreeProvider, envId IS the filesystem path)
   * @param options - Cleanup options:
   *   - force: Force removal even with uncommitted changes
   *   - branchName: Delete the associated branch after worktree removal
   *   - canonicalRepoPath: Required for branch cleanup if worktree path doesn't exist
   *
   * Cleanup behavior:
   * - Worktree removal: Best-effort, continues if already removed
   * - Directory cleanup: Best-effort, logs but doesn't fail if directory persists
   * - Branch deletion: Best-effort, logs but doesn't fail
   *
   * **IMPORTANT: Branch cleanup limitation**
   * If `branchName` is provided but the worktree path no longer exists AND
   * `canonicalRepoPath` is not provided, branch deletion will be SKIPPED with a warning.
   * The result will have `branchDeleted: false` and a warning in `warnings`.
   * To ensure branch cleanup when the worktree may already be removed,
   * always provide `canonicalRepoPath`.
   *
   * Throws only for unexpected errors (permissions, git failures).
   */
  async destroy(envId: string, options?: WorktreeDestroyOptions): Promise<DestroyResult> {
    const worktreePath = envId;
    const result: DestroyResult = {
      worktreeRemoved: false,
      branchDeleted: null,
      remoteBranchDeleted: null,
      directoryClean: false,
      warnings: [],
    };

    // Check if worktree path exists before attempting removal (optimization to avoid spawning git)
    const pathExists = await this.directoryExists(worktreePath);
    if (!pathExists) {
      getLog().debug({ worktreePath }, 'worktree_path_already_removed');
      result.worktreeRemoved = true; // Already gone counts as removed
      result.directoryClean = true;
    }

    // Get canonical repo path - use provided path or derive from worktree
    let repoPath: string;
    if (options?.canonicalRepoPath) {
      repoPath = options.canonicalRepoPath;
    } else if (pathExists) {
      repoPath = await getCanonicalRepoPath(worktreePath);
    } else {
      // Path doesn't exist and no canonicalRepoPath provided - can't clean up branch
      // This is expected when worktree was already fully cleaned up externally
      if (options?.branchName) {
        const warning = `Cannot delete branch '${options.branchName}': worktree path gone and no canonicalRepoPath provided`;
        getLog().warn({ worktreePath, branchName: options.branchName }, 'branch_cleanup_skipped');
        result.warnings.push(warning);
      }
      return result;
    }

    // Only attempt worktree removal if path exists
    if (pathExists) {
      const gitArgs = ['-C', repoPath, 'worktree', 'remove'];
      if (options?.force) {
        gitArgs.push('--force');
      }
      gitArgs.push(worktreePath);

      try {
        await execFileAsync('git', gitArgs, { timeout: GIT_OPERATION_TIMEOUT_MS });
        result.worktreeRemoved = true;
      } catch (error) {
        if (!this.isWorktreeMissingError(error)) {
          throw error;
        }
        getLog().debug({ worktreePath }, 'worktree_already_removed');
        result.worktreeRemoved = true;
        // Continue to branch deletion below - branch may still exist
      }

      // Ensure directory is fully removed (git may leave untracked files like .rith/)
      const dirExists = await this.directoryExists(worktreePath);
      if (dirExists) {
        getLog().debug({ worktreePath }, 'cleaning_remaining_directory');
        try {
          await rm(worktreePath, { recursive: true, force: true });
          getLog().debug({ worktreePath }, 'remaining_directory_cleaned');
          result.directoryClean = true;
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          const warning = `Failed to clean remaining directory at ${worktreePath}: ${err.message}`;
          getLog().error({ err: error, worktreePath }, 'remaining_directory_cleanup_failed');
          result.warnings.push(warning);
          // directoryClean stays false
        }
      } else {
        result.directoryClean = true;
      }
    }

    // Prune stale worktree references — runs even when path is already gone,
    // because git may still have a stale ref for a manually-deleted worktree
    try {
      await execFileAsync('git', ['-C', repoPath, 'worktree', 'prune'], { timeout: 15000 });
    } catch (_error) {
      // Best-effort — pruning failure is not critical
      getLog().debug({ repoPath }, 'worktree_prune_failed');
    }

    // Post-removal verification: confirm worktree is actually gone from git
    if (result.worktreeRemoved) {
      const stillRegistered = await this.isWorktreeRegistered(repoPath, worktreePath);
      if (stillRegistered) {
        result.worktreeRemoved = false;
        const warning = `Worktree at ${worktreePath} was reported removed but is still registered in git`;
        getLog().warn({ worktreePath, repoPath }, 'worktree_removal_verification_failed');
        result.warnings.push(warning);
      }
    }

    // Delete associated branch if provided (best-effort cleanup)
    if (options?.branchName) {
      result.branchDeleted = await deleteBranchTracked(repoPath, options.branchName, result);

      // Delete remote branch if requested (e.g., after PR merge)
      if (options.deleteRemoteBranch) {
        result.remoteBranchDeleted = await deleteRemoteBranchTracked(
          repoPath,
          options.branchName,
          result
        );
      }
    }

    return result;
  }

  /**
   * Check if an error indicates the worktree path is missing.
   * Checks both message and stderr for robustness across git versions/locales.
   */
  private isWorktreeMissingError(error: unknown): boolean {
    const err = error as Error & { stderr?: string };
    const errorText = `${err.message} ${err.stderr ?? ''}`;
    return (
      errorText.includes('No such file or directory') ||
      errorText.includes('does not exist') ||
      errorText.includes('is not a working tree')
    );
  }

  /**
   * Check if a worktree path is still registered in `git worktree list`.
   * Used for post-removal verification.
   */
  private async isWorktreeRegistered(repoPath: string, worktreePath: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', repoPath, 'worktree', 'list', '--porcelain'],
        { timeout: 15000 }
      );
      // Porcelain output has "worktree <path>" lines with resolved absolute paths
      const normalizedTarget = resolve(worktreePath);
      return stdout.split('\n').some(line => {
        if (!line.startsWith('worktree ')) return false;
        const listed = line.slice('worktree '.length).trim();
        return resolve(listed) === normalizedTarget;
      });
    } catch (_error) {
      // If we can't verify, assume it's gone (don't block on verification failure)
      return false;
    }
  }

  /**
   * Get environment by ID (worktree path)
   *
   * Note: createdAt is set to current time since git worktrees don't store
   * creation timestamps. For accurate timestamps, store metadata in the
   * database when creating environments.
   *
   * Returns null if worktree doesn't exist. May throw if underlying git
   * operations fail with unexpected errors.
   */
  async get(envId: string): Promise<IsolatedEnvironment | null> {
    const worktreePath = envId;

    if (!(await worktreeExists(toWorktreePath(worktreePath)))) {
      return null;
    }

    // Get branch name from worktree
    let repoPath: RepoPath;
    let worktrees: WorktreeInfo[];
    try {
      repoPath = await getCanonicalRepoPath(worktreePath);
      worktrees = await listWorktrees(repoPath);
    } catch (error) {
      getLog().error({ err: error, worktreePath }, 'worktree_query_failed');
      throw error;
    }

    const wt = worktrees.find(w => w.path === worktreePath);

    // If worktree exists on disk but not in git's list, it's a corrupted state
    if (!wt) {
      getLog().warn({ worktreePath, repoPath }, 'worktree_not_registered');
      return null;
    }

    return {
      id: envId,
      provider: 'worktree',
      workingPath: worktreePath,
      branchName: toBranchName(wt.branch),
      status: 'active',
      createdAt: new Date(), // Cannot determine actual creation time
      metadata: { adopted: false },
    };
  }

  /**
   * List all environments for a codebase
   */
  async list(codebaseId: string): Promise<IsolatedEnvironment[]> {
    // codebaseId is the canonical repo path for worktrees
    const repoPath = toRepoPath(codebaseId);
    const worktrees = await listWorktrees(repoPath);

    // Filter out main repo (first worktree is typically the main checkout)
    return worktrees
      .filter(wt => wt.path !== (repoPath as string))
      .map(wt => ({
        id: wt.path,
        provider: 'worktree' as const,
        workingPath: wt.path,
        branchName: toBranchName(wt.branch),
        status: 'active' as const,
        createdAt: new Date(),
        metadata: { adopted: false },
      }));
  }

  /**
   * Adopt an existing worktree (for skill-app symbiosis)
   *
   * Returns null if:
   * - Path doesn't exist or isn't a valid worktree
   * - Path is not a git repository
   * - Worktree exists on disk but isn't registered with git (corrupted state)
   *
   * Throws for unexpected errors (permission denied, I/O failures).
   */
  async adopt(path: string): Promise<IsolatedEnvironment | null> {
    if (!(await worktreeExists(toWorktreePath(path)))) {
      return null;
    }

    let repoPath: RepoPath;
    let worktrees: WorktreeInfo[];
    try {
      repoPath = await getCanonicalRepoPath(path);
      worktrees = await listWorktrees(repoPath);
    } catch (error) {
      const err = error as Error;
      // "not a git repository" is an expected case — return null
      if (err.message.toLowerCase().includes('not a git repository')) {
        getLog().debug({ path }, 'worktree_adopt_not_git_repo');
        return null;
      }
      // Unexpected errors (permission denied, I/O) should propagate
      throw error;
    }

    const wt = worktrees.find(w => w.path === path);

    if (!wt) {
      // Worktree directory exists but isn't registered with git - possible corruption
      getLog().warn(
        { path, repoPath, registeredWorktreeCount: worktrees.length },
        'worktree_adopt_not_registered'
      );
      return null;
    }

    getLog().info({ path, branchName: wt.branch }, 'worktree_adopted');
    return {
      id: path,
      provider: 'worktree',
      workingPath: path,
      branchName: toBranchName(wt.branch),
      status: 'active',
      createdAt: new Date(),
      metadata: { adopted: true },
    };
  }

  /**
   * Check if environment exists and is healthy
   *
   * Delegates to `worktreeExists()` which checks both path and .git file access.
   *
   * @throws Error - May throw for permission denied or other I/O errors.
   *                 Only returns false for missing paths (ENOENT).
   */
  async healthCheck(envId: string): Promise<boolean> {
    return worktreeExists(toWorktreePath(envId));
  }

  /**
   * Generate semantic branch name based on workflow type
   *
   * For same-repo PRs: Use the actual PR branch name
   * For fork PRs: Use synthetic pr-N-review branch
   *
   * Thread identifiers are hashed via shortHash() (8 hex chars).
   * Task identifiers are slugified via slugify() (lowercase, max 50 chars).
   */
  generateBranchName(request: IsolationRequest): string {
    switch (request.workflowType) {
      case 'issue':
        return `rith/issue-${request.identifier}`;
      case 'pr':
        // Same-repo PRs use actual branch (already exists on remote), fork PRs use synthetic
        if (!request.isForkPR) {
          return request.prBranch;
        }
        return `rith/pr-${request.identifier}-review`;
      case 'review':
        return `rith/review-${request.identifier}`;
      case 'thread':
        // Use short hash for arbitrary thread IDs (Slack, Discord)
        return `rith/thread-${this.shortHash(request.identifier)}`;
      case 'task':
        return `rith/task-${this.slugify(request.identifier)}`;
    }
  }

  /**
   * Get worktree path for a request, honoring the per-repo override if set.
   *
   * Layouts (see `getWorktreeBase()` in `@rith/git` for resolution):
   *   - `repo-local`       → `<repoRoot>/<config.path>/{branch}`              (opt-in)
   *   - `workspace-scoped` → `~/.rith/workspaces/{owner}/{repo}/worktrees/{branch}`  (default)
   *
   * In both layouts the resolved base already carries full repo context, so the
   * caller simply appends the branch name — no owner/repo namespacing here.
   *
   * The per-repo `config.path` is validated via `resolveRepoLocalOverride()`;
   * unsafe values (absolute, `..` segments, escape-from-repoRoot) throw rather
   * than silently falling back to the default layout.
   */
  getWorktreePath(
    request: IsolationRequest,
    branchName: string,
    config?: WorktreeCreateConfig | null
  ): string {
    const override: WorktreeBaseOverride = {
      repoLocal: resolveRepoLocalOverride(config?.path, request.canonicalRepoPath),
    };
    const { base } = getWorktreeBase(request.canonicalRepoPath, request.codebaseName, override);
    return join(base, branchName);
  }

  /**
   * Find existing worktree for adoption
   */
  private async findExisting(
    request: IsolationRequest,
    branchName: string,
    worktreePath: string
  ): Promise<WorktreeEnvironment | null> {
    // Check if worktree already exists at expected path
    if (await worktreeExists(toWorktreePath(worktreePath))) {
      // Verify the existing worktree belongs to the same repo root before
      // adopting. Two clones of the same remote resolve to the same worktree
      // base dir, so a worktree created from clone A is visible from clone B.
      // Throws on cross-checkout or unverifiable state — surfacing the problem
      // is safer than falling through to createNewBranch (which would report
      // a confusing "branch already exists" cascade) or silently adopting.
      try {
        await verifyWorktreeOwnership(toWorktreePath(worktreePath), request.canonicalRepoPath);
      } catch (err) {
        getLog().warn(
          {
            worktreePath,
            branchName,
            codebaseId: request.codebaseId,
            canonicalRepoPath: request.canonicalRepoPath,
            err: (err as Error).message,
          },
          'worktree.adoption_refused_cross_checkout'
        );
        throw err;
      }

      getLog().info({ worktreePath, branchName }, 'worktree_adopted');
      return this.buildAdoptedEnvironment(worktreePath, branchName, request);
    }

    // For PRs: also check if skill created a worktree with the PR's branch name
    if (isPRIsolationRequest(request)) {
      const existingByBranch = await findWorktreeByBranch(
        request.canonicalRepoPath,
        request.prBranch
      );
      if (existingByBranch) {
        // Same cross-clone guard as the primary adoption path above — a
        // worktree matching the PR branch might still belong to a different
        // clone of the same remote.
        try {
          await verifyWorktreeOwnership(existingByBranch, request.canonicalRepoPath);
        } catch (err) {
          getLog().warn(
            {
              worktreePath: existingByBranch,
              branchName: request.prBranch,
              codebaseId: request.codebaseId,
              canonicalRepoPath: request.canonicalRepoPath,
              err: (err as Error).message,
            },
            'worktree.adoption_refused_cross_checkout'
          );
          throw err;
        }

        getLog().info(
          { worktreePath: existingByBranch, branchName: request.prBranch },
          'worktree_adopted'
        );
        return this.buildAdoptedEnvironment(existingByBranch, request.prBranch, request, 'branch');
      }
    }

    return null;
  }

  private buildAdoptedEnvironment(
    path: string,
    branchName: string,
    request: IsolationRequest,
    adoptedFrom?: 'branch'
  ): WorktreeEnvironment {
    return {
      id: path,
      provider: 'worktree',
      workingPath: path,
      branchName: toBranchName(branchName),
      status: 'active',
      createdAt: new Date(),
      metadata: { adopted: true, ...(adoptedFrom ? { adoptedFrom } : {}), request },
    };
  }

  /**
   * Create the actual worktree.
   * Returns warnings that should be surfaced to the user (non-fatal issues).
   *
   * `repoConfig` is the already-loaded config from `create()`. Receiving it here
   * keeps the work of each public entrypoint tied to exactly one config load —
   * see the "Fail Fast" comment on `create()`.
   */
  private async createWorktree(
    request: IsolationRequest,
    worktreePath: string,
    branchName: string,
    worktreeConfig: WorktreeCreateConfig | null
  ): Promise<{ warnings: string[] }> {
    const repoPath = request.canonicalRepoPath;

    // Sync uses only the configured base branch (or auto-detects via getDefaultBranch).
    // request.fromBranch is the start-point for worktree creation, not a sync target.
    const baseBranch = await this.syncWorkspaceBeforeCreate(repoPath, worktreeConfig?.baseBranch);

    const override: WorktreeBaseOverride = {
      repoLocal: resolveRepoLocalOverride(worktreeConfig?.path, repoPath),
    };
    const { base: worktreeBase } = getWorktreeBase(repoPath, request.codebaseName, override);
    // In both layouts the base already carries repo context — creating it
    // recursively is enough.
    await mkdirAsync(worktreeBase, { recursive: true });

    if (isPRIsolationRequest(request)) {
      // For PRs: fetch and checkout the PR branch (actual or synthetic)
      await createFromPR(request, worktreePath);
    } else {
      // For issues, tasks, threads: create new branch
      await createNewBranch(request, repoPath, worktreePath, branchName, baseBranch);
    }

    // Initialize submodules unless explicitly opted out. The check is free
    // when `.gitmodules` is absent (access-based short-circuit), so repos
    // without submodules pay nothing. Default-on matches git's own intent
    // with `clone --recurse-submodules` / `submodule.recurse`.
    if (worktreeConfig?.initSubmodules !== false) {
      await initSubmodules(worktreePath);
    }

    // Copy git-ignored files based on repo config
    const { configLoadFailed } = await copyConfiguredFiles(
      repoPath,
      worktreePath,
      worktreeConfig,
      this.loadConfig
    );

    const warnings: string[] = [];
    if (configLoadFailed) {
      warnings.push(
        'Config file could not be loaded — copyFiles configuration was not applied. Check your .rith/config.yaml for syntax errors.'
      );
    }
    return { warnings };
  }

  /**
   * Sync workspace with remote before creating a new worktree
   * Ensures new work starts from the latest code on the base branch.
   *
   * Branch resolution:
   * - If configuredBaseBranch is provided: Uses that branch. Fails with actionable
   *   error if the branch doesn't exist - no silent fallback to default.
   * - If configuredBaseBranch is omitted: Auto-detects the default branch via git.
   *
   * All sync failures are fatal — creating a worktree from an unknown
   * start-point risks branching from the wrong commit.
   *
   * Error classification (for user-facing messages):
   * - Permission denied → file permission hint
   * - Not a git repository → workspace integrity hint
   * - Configured base branch missing → config fix hint
   * - Network errors, timeouts → connectivity hint
   */
  private async syncWorkspaceBeforeCreate(
    repoPath: RepoPath,
    configuredBaseBranch?: string
  ): Promise<string> {
    try {
      getLog().debug(
        { repoPath, branch: configuredBaseBranch ?? 'auto-detect' },
        'workspace_sync_starting'
      );
      // Only hard-reset for Rith Engine-managed clones (under ~/.rith/workspaces/).
      // Locally-registered repos get fetch-only to avoid destroying uncommitted work.
      const isManagedClone = repoPath
        .replace(/\\/g, '/')
        .startsWith(getRithWorkspacesPath().replace(/\\/g, '/'));
      const { branch } = await syncWorkspace(
        repoPath,
        configuredBaseBranch ? toBranchName(configuredBaseBranch) : undefined,
        { resetAfterFetch: isManagedClone }
      );
      getLog().debug({ repoPath, branch }, 'workspace_synced');
      return branch;
    } catch (error) {
      const err = error as Error & { code?: string };
      const errorMessage = err.message.toLowerCase();

      // Fatal errors - throw to prevent confusing downstream failures
      if (err.code === 'EACCES' || errorMessage.includes('permission denied')) {
        throw new Error(
          `Permission denied accessing repository at ${repoPath}. ` +
            'Check file permissions and try again.'
        );
      } else if (errorMessage.includes('not a git repository')) {
        throw new Error(
          `${repoPath} is not a valid git repository. ` +
            'Ensure the workspace was cloned correctly.'
        );
      } else if (errorMessage.includes('configured base branch')) {
        // Configured branch errors are fatal - user needs to fix their config
        throw err;
      } else {
        // Network errors, timeouts — cannot guarantee correct start-point
        throw new Error(
          `Failed to fetch base branch from origin: ${err.message}. ` +
            'Check your network connection and try again.'
        );
      }
    }
  }

  /**
   * Check if a directory exists.
   * Returns true if directory exists, false if it doesn't exist (ENOENT).
   * Throws for other errors (permission denied, I/O errors, etc.)
   */
  private async directoryExists(path: string): Promise<boolean> {
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
   * Generate short hash for thread identifiers
   */
  private shortHash(input: string): string {
    const hash = createHash('sha256').update(input).digest('hex');
    return hash.substring(0, 8);
  }

  /**
   * Slugify string for branch names
   */
  private slugify(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }
}
