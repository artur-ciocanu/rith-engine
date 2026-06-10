/**
 * Workflow run command — resolves a workflow by name and executes it,
 * with optional worktree isolation, resume, and progress rendering.
 */
import { registerRepository, loadRepoConfig } from '@rith/core';
import { configureIsolation, getIsolationProvider } from '@rith/isolation';
import { getRithHome } from '@rith/paths';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createWorkflowDeps } from '@rith/core/workflows/store-adapter';
import { resolveWorkflowName } from '@rith/workflows/router';
import { executeWorkflow, hydrateResumableRun } from '@rith/workflows/executor';
import { getWorkflowEventEmitter } from '@rith/workflows/event-emitter';
import * as codebaseDb from '@rith/core/db/codebases';
import * as isolationDb from '@rith/core/db/isolation-environments';
import * as workflowDb from '@rith/core/db/workflows';
import * as git from '@rith/git';
import { CLIAdapter } from '../../adapters/cli-adapter';
import { getLog, extractStaleWorkspaceEntry, loadWorkflows, formatDuration } from './shared';

import type { WorkflowEmitterEvent } from '@rith/workflows/event-emitter';
import type { WorkflowRun } from '@rith/workflows/schemas/workflow-run';

/**
 * Options for workflow run command
 *
 * Default: creates worktree with auto-generated branch name (isolation by default).
 * --branch: explicit branch name for the worktree.
 * --no-worktree: opt out of isolation, run in live checkout.
 * --resume: reuse worktree from last failed run.
 * --from: override base branch (start-point for worktree).
 *
 * Mutually exclusive: --branch + --no-worktree, --resume + --branch.
 */
export interface WorkflowRunOptions {
  branchName?: string;
  fromBranch?: string;
  noWorktree?: boolean;
  resume?: boolean;
  codebaseId?: string; // Skips path-based codebase lookup when resume/approve/reject already resolved it
  /**
   * Override the directory used for workflow YAML discovery.
   * Pass `codebase.default_cwd` here so the source repo is searched even when
   * `working_path` is a worktree or workspace clone that lacks the file.
   */
  discoveryCwd?: string;
  quiet?: boolean;
  verbose?: boolean;
  /** Platform conversation ID (e.g. `cli-{ts}-{rand}`), NOT a DB UUID. */
  conversationId?: string;
  /**
   * Issue/PR context as JSON string or markdown. Passed as `issueContext` to
   * ExecuteWorkflowOptions and substituted into $CONTEXT / $ISSUE_CONTEXT /
   * $EXTERNAL_CONTEXT variables in workflow prompts.
   */
  issueContext?: string;
  /**
   * Workflow type hint for isolation: 'pr', 'issue', or 'task'.
   * When 'pr', sets isolationContext.isPrReview = true.
   */
  workflowType?: 'pr' | 'issue' | 'task';
  /** PR head SHA — metadata for PR-aware workflow nodes. */
  prSha?: string;
  /** PR source branch — metadata (distinct from --branch which creates a worktree). */
  prBranch?: string;
  /** Emit a single JSON result object to stdout; suppress all other stdout output. */
  json?: boolean;
}

/**
 * Generate a unique conversation ID for CLI usage
 */
function generateConversationId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `cli-${String(timestamp)}-${random}`;
}

/**
 * Wraps a codebase auto-registration failure for either the worktree-create or
 * resume path. Preserves the original error message and delegates hint detail
 * to `extractStaleWorkspaceEntry`; falls back to a workspace-root pointer when
 * the error shape is unrecognized.
 */
function buildRegistrationFailureError(action: string, error: Error): Error {
  const staleWorkspaceEntry = extractStaleWorkspaceEntry(error.message);
  let hint: string;
  if (staleWorkspaceEntry) {
    hint = `Hint: Remove the stale workspace entry at ${staleWorkspaceEntry} and retry, or use --no-worktree to skip isolation.`;
  } else {
    // Guard against a throwing getRithHome() (misconfigured env vars, etc.):
    // the registration error we're wrapping is the load-bearing one — we'd
    // rather lose the exact path in the hint than replace it with a secondary
    // home-resolution error that masks the root cause.
    try {
      const workspacesPath = join(getRithHome(), 'workspaces');
      hint = `Hint: Check your Rith Engine workspace registration under ${workspacesPath} and retry, or use --no-worktree to skip isolation.`;
    } catch {
      hint =
        'Hint: Check your Rith Engine workspace registration and retry, or use --no-worktree to skip isolation.';
    }
  }

  return new Error(
    `Cannot ${action}: repository registration failed.\nError: ${error.message}\n${hint}`
  );
}

/** Render a workflow event to stderr as a progress line. Called only when --quiet is not set. */
function renderWorkflowEvent(event: WorkflowEmitterEvent, verbose: boolean): void {
  switch (event.type) {
    case 'node_started':
      process.stderr.write(`[${event.nodeName}] Started\n`);
      break;
    case 'node_completed':
      process.stderr.write(`[${event.nodeName}] Completed (${formatDuration(event.duration)})\n`);
      break;
    case 'node_failed':
      process.stderr.write(`[${event.nodeName}] Failed: ${event.error}\n`);
      break;
    case 'node_skipped':
      process.stderr.write(`[${event.nodeName}] Skipped (${event.reason})\n`);
      break;
    case 'approval_pending':
      process.stderr.write(`[${event.nodeId}] Waiting for approval: ${event.message}\n`);
      break;
    case 'tool_started':
      if (verbose) {
        process.stderr.write(`[${event.stepName}] tool: ${event.toolName} (started)\n`);
      }
      break;
    case 'tool_completed':
      if (verbose) {
        process.stderr.write(
          `[${event.stepName}] tool: ${event.toolName} (${String(event.durationMs)}ms)\n`
        );
      }
      break;
    default:
      // Workflow-level, loop, artifact, and cancelled events are intentionally not rendered.
      break;
  }
}

/**
 * Run a named workflow: resolve it, set up isolation, and execute.
 */
export async function workflowRunCommand(
  cwd: string,
  workflowName: string,
  userMessage: string,
  options: WorkflowRunOptions = {}
): Promise<void> {
  const { workflows: workflowEntries, errors } = await loadWorkflows(options.discoveryCwd ?? cwd);

  if (workflowEntries.length === 0 && errors.length === 0) {
    throw new Error('No workflows found in .rith/workflows/');
  }

  const workflows = workflowEntries.map(ws => ws.workflow);

  const workflow = resolveWorkflowName(workflowName, workflows);

  if (!workflow) {
    // Check if the requested workflow had a load error
    const loadError = errors.find(
      e =>
        e.filename.replace(/\.ya?ml$/, '') === workflowName ||
        e.filename === `${workflowName}.yaml` ||
        e.filename === `${workflowName}.yml`
    );
    if (loadError) {
      throw new Error(
        `Workflow '${workflowName}' failed to load: ${loadError.error}\n\nFix the YAML file and try again.`
      );
    }
    const availableWorkflows = workflows.map(w => `  - ${w.name}`).join('\n');
    throw new Error(
      `Workflow '${workflowName}' not found.\n\nAvailable workflows:\n${availableWorkflows}`
    );
  }

  // Validate mutually exclusive flags (defensive — cli.ts checks these for UX, but
  // workflowRunCommand is the authoritative boundary for programmatic callers)
  if (options.branchName !== undefined && options.noWorktree) {
    throw new Error(
      '--branch and --no-worktree are mutually exclusive.\n' +
        '  --branch creates an isolated worktree (safe).\n' +
        '  --no-worktree runs directly in your repo (no isolation).\n' +
        'Use one or the other.'
    );
  }
  if (options.noWorktree && options.fromBranch !== undefined) {
    throw new Error(
      '--from/--from-branch has no effect with --no-worktree.\n' +
        'Remove --from or drop --no-worktree.'
    );
  }
  if (options.resume && options.branchName !== undefined) {
    throw new Error(
      '--resume and --branch are mutually exclusive.\n' +
        '  --resume reuses the existing worktree from the failed run.\n' +
        '  Remove --branch when using --resume.'
    );
  }

  // Reconcile workflow-level worktree policy with invocation flags.
  // The workflow YAML's `worktree.enabled` pins isolation regardless of caller —
  // a mismatch between policy and flags is a user error we surface loudly
  // rather than silently applying one side and ignoring the other.
  const pinnedEnabled = workflow.worktree?.enabled;
  if (pinnedEnabled === false) {
    if (options.branchName !== undefined) {
      throw new Error(
        `Workflow '${workflow.name}' sets worktree.enabled: false (runs in live checkout).\n` +
          '  --branch requires an isolated worktree.\n' +
          "  Drop --branch or change the workflow's worktree.enabled."
      );
    }
    if (options.fromBranch !== undefined) {
      throw new Error(
        `Workflow '${workflow.name}' sets worktree.enabled: false (runs in live checkout).\n` +
          '  --from/--from-branch only applies when a worktree is created.\n' +
          "  Drop --from or change the workflow's worktree.enabled."
      );
    }
    // --no-worktree is redundant but not contradictory — silently accept.
  } else if (pinnedEnabled === true) {
    if (options.noWorktree) {
      throw new Error(
        `Workflow '${workflow.name}' sets worktree.enabled: true (requires a worktree).\n` +
          '  --no-worktree conflicts with the workflow policy.\n' +
          "  Drop --no-worktree or change the workflow's worktree.enabled."
      );
    }
  }

  console.log(`Running workflow: ${workflowName}`);
  console.log(`Working directory: ${cwd}`);
  console.log('');

  // Create CLI adapter
  const adapter = new CLIAdapter({ suppressStdout: options.json });

  // Generate conversation ID
  const conversationId = options.conversationId ?? generateConversationId();

  // Use the conversation ID directly as the DB identifier.
  // The conversations table was removed; workflow_runs stores everything needed.
  const dbConversationId = conversationId;

  // Try to find a codebase for this directory
  let codebase = null;
  let codebaseLookupError: Error | null = null;
  let codebaseRegistrationError: Error | null = null;
  try {
    codebase = await codebaseDb.findCodebaseByDefaultCwd(cwd);
  } catch (error) {
    const err = error as Error;
    codebaseLookupError = err;
    getLog().warn({ err, cwd }, 'cli.codebase_lookup_failed');
  }

  // If the caller supplied a codebase ID (e.g., from a stored run record on resume),
  // use it directly to avoid path-based lookup that fails for worktree paths.
  if (!codebase && !codebaseLookupError && options.codebaseId) {
    try {
      codebase = await codebaseDb.getCodebase(options.codebaseId);
    } catch (error) {
      const err = error as Error;
      getLog().warn(
        { err, errorType: err.constructor.name, codebaseId: options.codebaseId },
        'cli.codebase_id_lookup_failed'
      );
      // Intentional: don't set codebaseLookupError — fall through to auto-registration
    }
  }

  // Auto-register unregistered repos (creates project structure for artifacts/logs)
  if (!codebase && !codebaseLookupError) {
    const repoRoot = await git.findRepoRoot(cwd);
    if (repoRoot) {
      try {
        const result = await registerRepository(repoRoot);
        codebase = await codebaseDb.getCodebase(result.codebaseId);
        if (!result.alreadyExisted) {
          getLog().info({ name: result.name }, 'cli.codebase_auto_registered');
        }
      } catch (error) {
        const err = error as Error;
        codebaseRegistrationError = err;
        getLog().warn(
          { err, errorType: err.constructor.name, repoRoot },
          'cli.codebase_auto_registration_failed'
        );
      }
    }
  }

  // Handle isolation (worktree creation)
  let workingCwd = cwd;
  let isolationEnvId: string | undefined;

  // Handle --resume: locate the prior failed run, reuse its worktree, and hand
  // the resumed-run handle to executeWorkflow below via opts. The executor no
  // longer performs implicit resume detection on its own.
  let resumable: WorkflowRun | null = null;
  if (options.resume) {
    if (!codebase) {
      if (codebaseLookupError) {
        throw new Error(
          'Cannot resume: Database lookup failed.\n' +
            `Error: ${codebaseLookupError.message}\n` +
            'Hint: Check your database connection before using --resume.'
        );
      }
      if (codebaseRegistrationError) {
        throw buildRegistrationFailureError('resume', codebaseRegistrationError);
      }
      throw new Error(
        'Cannot resume: Not in a git repository.\n' +
          'Either run from a git repo or use /clone first.'
      );
    }

    resumable = await workflowDb.findResumableRun(workflowName, cwd);

    if (!resumable) {
      throw new Error(`No resumable run found for workflow '${workflowName}' at path '${cwd}'.`);
    }

    getLog().info(
      {
        workflowRunId: resumable.id,
        workflowName,
        workingPath: resumable.working_path,
      },
      'workflow.resume_found_resumable'
    );

    // Reuse the working path from the resumable run (verify it still exists)
    if (resumable.working_path) {
      if (!existsSync(resumable.working_path)) {
        throw new Error(
          `Cannot resume: the working path from the run no longer exists: ${resumable.working_path}\n` +
            'The worktree may have been cleaned up. Start a fresh run with --branch instead.'
        );
      }
      workingCwd = resumable.working_path;
    }

    // Look up the isolation environment that owns this working path (if any)
    const allEnvs = await isolationDb.listByCodebase(codebase.id);
    const matchingEnv = allEnvs.find(e => e.working_path === workingCwd);
    if (matchingEnv) {
      isolationEnvId = matchingEnv.id;
      getLog().info(
        { envId: isolationEnvId, workingPath: workingCwd },
        'workflow.resume_env_found'
      );
    }

    console.log(`Resuming workflow run: ${resumable.id}`);
    console.log(`Working path: ${workingCwd}`);
    console.log('');
  }

  // Default to worktree isolation unless --no-worktree or --resume.
  // Workflow YAML `worktree.enabled` pins the decision — mismatches with CLI
  // flags are rejected above, so by this point the policy (if set) and flags
  // agree. `--resume` reuses an existing worktree and takes precedence over
  // the pinned policy to avoid disturbing a paused run.
  const flagWantsIsolation = !options.resume && !options.noWorktree;
  const wantsIsolation =
    !options.resume && pinnedEnabled !== undefined ? pinnedEnabled : flagWantsIsolation;

  if (wantsIsolation && codebase) {
    // Auto-generate branch identifier from workflow name + timestamp when --branch not provided
    const branchIdentifier = options.branchName ?? `${workflowName}-${Date.now()}`;

    // Configure isolation with repo config loader (same as orchestrator)
    configureIsolation(async (repoPath: string) => {
      const repoConfig = await loadRepoConfig(repoPath);
      return repoConfig?.worktree ?? null;
    });

    const provider = getIsolationProvider();

    // Check for existing worktree (only when explicit --branch)
    const existingEnv = options.branchName
      ? await isolationDb.findActiveByWorkflow(codebase.id, 'task', options.branchName)
      : undefined;

    if (existingEnv && (await provider.healthCheck(existingEnv.working_path))) {
      if (options.fromBranch) {
        getLog().warn(
          { path: existingEnv.working_path, fromBranch: options.fromBranch },
          'worktree.reuse_from_branch_ignored'
        );
        console.warn(
          `Warning: Reusing existing worktree at ${existingEnv.working_path}. ` +
            `--from ${options.fromBranch} was not applied (worktree already exists).`
        );
      }
      // Validate base branch before reuse (warning-only — non-blocking)
      try {
        const repoConfig = await loadRepoConfig(codebase.default_cwd);
        const rawBase = repoConfig?.worktree?.baseBranch;
        const configuredBase = rawBase
          ? git.toBranchName(rawBase)
          : await git.getDefaultBranch(git.toRepoPath(codebase.default_cwd));
        const isValidBase = await git.isAncestorOf(
          git.toWorktreePath(existingEnv.working_path),
          `origin/${configuredBase}`
        );
        if (!isValidBase) {
          getLog().warn(
            { path: existingEnv.working_path, configuredBase, branch: existingEnv.branch_name },
            'worktree.reuse_base_branch_mismatch'
          );
          console.warn(
            `Warning: Worktree '${existingEnv.branch_name}' is not based on '${configuredBase}'. ` +
              `Recreate with: bun run cli complete ${existingEnv.branch_name} --force`
          );
        }
      } catch (e) {
        getLog().debug({ err: e }, 'worktree.reuse_base_branch_check_skipped');
        // Non-blocking — skip warning if base branch cannot be determined
      }
      getLog().info({ path: existingEnv.working_path }, 'worktree_reused');
      workingCwd = existingEnv.working_path;
      isolationEnvId = existingEnv.id;
    } else {
      // Create new worktree
      getLog().info(
        { branch: branchIdentifier, fromBranch: options.fromBranch },
        'worktree_creating'
      );

      const isolatedEnv = await provider.create({
        workflowType: 'task',
        identifier: branchIdentifier,
        fromBranch: options.fromBranch?.trim()
          ? git.toBranchName(options.fromBranch.trim())
          : undefined,
        codebaseId: codebase.id,
        canonicalRepoPath: git.toRepoPath(codebase.default_cwd),
        description: `CLI workflow: ${workflowName}`,
      });

      // Track in database
      const envRecord = await isolationDb.create({
        codebase_id: codebase.id,
        workflow_type: 'task',
        workflow_id: branchIdentifier,
        provider: 'worktree',
        working_path: isolatedEnv.workingPath,
        branch_name: isolatedEnv.branchName,
        metadata: {},
      });

      workingCwd = isolatedEnv.workingPath;
      isolationEnvId = envRecord.id;
      getLog().info({ path: workingCwd }, 'worktree_created');
    }
  } else if (options.noWorktree) {
    getLog().info({ cwd }, 'workflow.running_without_isolation');
  } else if (wantsIsolation) {
    // Isolation was expected (default) but codebase is unavailable — fail fast
    if (codebaseLookupError) {
      throw new Error(
        'Cannot create worktree: database lookup failed.\n' +
          `Error: ${codebaseLookupError.message}\n` +
          'Hint: Check your database connection, or use --no-worktree to skip isolation.'
      );
    }
    if (codebaseRegistrationError) {
      throw buildRegistrationFailureError('create worktree', codebaseRegistrationError);
    }
    throw new Error(
      'Cannot create worktree: not in a git repository.\n' +
        'Run from within a git repo, or use --no-worktree to skip isolation.'
    );
  }

  // Register cleanup handlers for graceful termination
  let terminating = false;
  const cleanup = (signal: string): void => {
    if (terminating) return;
    terminating = true;
    getLog().info({ conversationId: dbConversationId, signal }, 'workflow.process_terminating');
    workflowDb
      .getActiveWorkflowRun(dbConversationId)
      .then(activeRun => {
        if (activeRun) {
          return workflowDb.failWorkflowRun(activeRun.id, `Process terminated (${signal})`);
        }
        return undefined;
      })
      .catch((err: unknown) => {
        const e = err as Error;
        getLog().error(
          { err: e, errorType: e.constructor.name },
          'workflow.termination_cleanup_failed'
        );
      })
      .finally(() => {
        process.exit(1);
      });
  };
  process.once('SIGTERM', () => {
    cleanup('SIGTERM');
  });
  process.once('SIGINT', () => {
    cleanup('SIGINT');
  });

  // Subscribe to workflow events for progress rendering on stderr.
  // subscribeForConversation is pure in-memory registration — cannot throw in practice.
  // If that changes, this should be moved inside the try block to prevent blocking executeWorkflow.
  const { quiet, verbose } = options;
  const unsubscribe = quiet
    ? undefined
    : getWorkflowEventEmitter().subscribeForConversation(conversationId, event => {
        renderWorkflowEvent(event, verbose ?? false);
      });

  // Notify Web UI that a workflow is dispatching.
  // Mirrors the orchestrator dispatch message structure (category/segment/workflowDispatch),
  // but omits the rocket emoji and "(background)" qualifier since the CLI runs synchronously.
  // In the CLI path there is no separate worker conversation — the CLI itself
  // is both the dispatcher and the executor, so workerConversationId === conversationId.
  try {
    await adapter.sendMessage(conversationId, `Dispatching workflow: **${workflow.name}**`, {
      category: 'workflow_dispatch_status',
      segment: 'new',
      workflowDispatch: { workerConversationId: conversationId, workflowName: workflow.name },
    });
  } catch (dispatchError) {
    getLog().warn(
      { err: dispatchError as Error, conversationId },
      'cli.workflow_dispatch_surface_failed'
    );
  }

  // When --resume, hand the already-found run (and its completed-node outputs)
  // to executeWorkflow. Otherwise this is a fresh run and prepared stays null.
  // The lookup-by-(workflowName, cwd) was already done above for worktree-path
  // resolution; reuse that result rather than querying twice.
  const deps = createWorkflowDeps();
  let prepared: Awaited<ReturnType<typeof hydrateResumableRun>> = null;
  if (options.resume && resumable) {
    try {
      prepared = await hydrateResumableRun(deps, resumable);
    } catch (error) {
      const err = error as Error;
      getLog().error(
        { err, workflowName, runId: resumable.id },
        'cli.workflow_hydrate_resume_failed'
      );
      throw new Error(
        `Cannot resume workflow '${workflowName}': failed to load prior run state — ${err.message}`
      );
    }
    if (!prepared) {
      throw new Error(
        `Cannot resume: the prior run for '${workflowName}' has no completed nodes and no interactive-loop state.`
      );
    }
  }

  // Execute workflow with workingCwd (may be worktree path)
  let result: Awaited<ReturnType<typeof executeWorkflow>>;
  try {
    // Build isolation context from CLI flags
    const isolationContext =
      options.workflowType || options.prSha || options.prBranch
        ? {
            branchName: options.branchName,
            isPrReview: options.workflowType === 'pr',
            prSha: options.prSha,
            prBranch: options.prBranch,
          }
        : undefined;
    const baseOpts = {
      codebaseId: codebase?.id,
      issueContext: options.issueContext,
      isolationContext,
    };
    const opts = prepared ? { ...baseOpts, ...prepared } : baseOpts;
    result = await executeWorkflow(
      deps,
      adapter,
      conversationId,
      workingCwd,
      workflow,
      userMessage,
      dbConversationId,
      opts
    );
  } finally {
    unsubscribe?.();
  }

  // Check result and exit appropriately
  if (options.json) {
    // --json mode: emit structured result to stdout, nothing else
    const jsonResult = {
      success: result.success,
      workflowRunId: result.workflowRunId,
      ...('summary' in result && result.summary ? { summary: result.summary } : {}),
      ...(!result.success ? { error: result.error } : {}),
      ...('paused' in result && result.paused ? { paused: true } : {}),
    };
    console.log(JSON.stringify(jsonResult));
    if (!result.success) {
      throw new Error(result.error);
    }
  } else if (result.success && 'paused' in result && result.paused) {
    console.log('\nWorkflow paused — waiting for approval.');
  } else if (result.success) {
    // Surface workflow result to Web UI as a result card (mirrors orchestrator.ts result message).
    // Paused workflows are handled in the branch above and intentionally do not get a result card.
    if ('summary' in result && result.summary) {
      try {
        await adapter.sendMessage(conversationId, result.summary, {
          category: 'workflow_result',
          segment: 'new',
          workflowResult: { workflowName: workflow.name, runId: result.workflowRunId },
        });
      } catch (surfaceError) {
        getLog().warn(
          { err: surfaceError as Error, conversationId },
          'cli.workflow_result_surface_failed'
        );
      }
    }
    console.log('\nWorkflow completed successfully.');
  } else {
    throw new Error(`Workflow failed: ${result.error}`);
  }
}
