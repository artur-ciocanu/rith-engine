#!/usr/bin/env bun
/**
 * Rith Engine CLI - Run AI workflows from the command line
 *
 * Usage:
 *   rith workflow list              List available workflows
 *   rith workflow run <name> [msg]  Run a workflow
 *   rith version                    Show version info
 */
// Must be the very first import — strips Bun-auto-loaded CWD .env keys before
// any module reads process.env at init time (e.g. @rith/paths/logger reads LOG_LEVEL).
import '@rith/paths/strip-cwd-env-boot';
// Then load rith-owned env from ~/.rith/.env (user scope) and
// <cwd>/.rith/.env (repo scope, wins over user). Both with override: true.
// See packages/paths/src/env-loader.ts and the three-path model (#1302 / #1303).
import { loadRithEnv } from '@rith/paths/env-loader';
loadRithEnv(process.cwd());

import { parseArgs } from 'util';
import { resolve } from 'path';
import { existsSync } from 'fs';

// CLAUDECODE=1 warning is emitted inside stripCwdEnv() (boot import above)
// BEFORE the marker is deleted from process.env. No duplicate warning here.

// Import commands after dotenv is loaded
import { versionCommand } from './commands/version';
import {
  workflowListCommand,
  workflowRunCommand,
  workflowStatusCommand,
  workflowResumeCommand,
  workflowAbandonCommand,
  workflowApproveCommand,
  workflowRejectCommand,
  workflowCleanupCommand,
  workflowEventEmitCommand,
  workflowSearchCommand,
  workflowInstallCommand,
  isValidEventType,
} from './commands/workflow';
import { WORKFLOW_EVENT_TYPES } from '@rith/workflows/store';
import {
  isolationListCommand,
  isolationCleanupCommand,
  isolationCleanupMergedCommand,
  isolationCompleteCommand,
} from './commands/isolation';
import { validateWorkflowsCommand, validateCommandsCommand } from './commands/validate';
import { doctorCommand } from './commands/doctor';
import { setupCommand } from './commands/setup';
import { closeDatabase } from '@rith/core';
import { setLogLevel, createLogger, shutdownTelemetry } from '@rith/paths';
import * as git from '@rith/git';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('cli');
  return cachedLog;
}

/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`
Rith Engine CLI - Run AI workflows from the command line

Usage:
  rith <command> [subcommand] [options] [arguments]

Commands:
  workflow list              List available workflows in current directory
  workflow run <name> [msg]  Run a workflow with optional message
  workflow status            Show status of running workflows
  workflow search [query]    Search the workflow marketplace
  workflow install <slug>    Install a workflow from the marketplace
  isolation list             List all active worktrees/environments
  isolation cleanup [days]   Remove stale environments (default: 7 days)
  isolation cleanup --merged Remove environments with branches merged into main
  complete <branch> [...]    Complete branch lifecycle (remove worktree + branches)
  validate workflows [name]  Validate workflow definitions and their references
  validate commands [name]   Validate command files
  version, --version, -V     Show version info (also -v when used alone)
  doctor                     Verify your Rith Engine setup (auth, db, workspace)
  setup                      Interactive wizard: configure Pi auth + default model
  help                       Show this help message

Options:
  --cwd <path>               Override working directory (default: current directory)
  --branch, -b <name>        Create worktree for branch (or reuse existing)
  --from, --from-branch <name> Create new branch from specific start point
  --no-worktree              Run on branch directly without worktree isolation
  --resume                   Resume the most recent failed run of the workflow (mutually exclusive with --branch)
  --quiet, -q                Reduce log verbosity to warnings and errors only
  --verbose, -v              Show debug-level output
  --json                     Output machine-readable JSON result to stdout
  --force                    Overwrite existing file (for workflow install / setup)
  --scope <home|project>     Setup target: ~/.rith/.env (home, default) or <repo>/.rith/.env (project)
  --issue-context <json|@file> Issue/PR context (JSON string or @filepath) for $ISSUE_CONTEXT variable
  --workflow-type <type>     Workflow type: pr, issue, or task (sets isolation hints)
  --pr-sha <sha>             PR head commit SHA (metadata for PR-aware workflows)
  --pr-branch <branch>       PR source branch (metadata, distinct from --branch)

Examples:
  rith workflow list
  rith workflow run investigate-issue "Fix the login bug"
  rith workflow run plan --cwd /path/to/repo "Add dark mode"
  rith workflow run implement --branch feature-auth "Implement auth"
  rith workflow run quick-fix --no-worktree "Fix typo"
  rith workflow run review --workflow-type pr --pr-branch feat/x --issue-context @ctx.json "Review PR"
  rith workflow run review --json "Check this" | jq .success
  rith workflow search "pr review"
  rith workflow install rith-piv-loop
`);
}

/**
 * Safely close the database connection
 */
async function closeDb(): Promise<void> {
  try {
    await closeDatabase();
  } catch (error) {
    const err = error as Error;
    // Log with details but don't throw - we want the original error to be visible
    getLog().warn({ err }, 'db_close_failed');
  }
}

/**
 * Main CLI entry point
 * Returns exit code (0 = success, non-zero = failure)
 */
/**
 * Detect a request for version output. Treats `--version`, `-V`, and the
 * single-dash typo `-version` as version flags anywhere in argv. `-v` keeps
 * its role as the short alias for `--verbose`, except when used alone — then
 * it falls back to version output to match the convention used by node, npm,
 * bun, and most other CLIs.
 */
function isVersionRequest(args: string[]): boolean {
  if (args.length === 1 && args[0] === '-v') return true;
  return args.some(arg => arg === '--version' || arg === '-V' || arg === '-version');
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  // Handle no arguments - show help and exit successfully
  if (args.length === 0) {
    printUsage();
    return 0;
  }

  // Version flag aliases bypass option parsing and the git-repo check so
  // `rith --version` works the same as `rith version` from any directory.
  if (isVersionRequest(args)) {
    try {
      await versionCommand();
      return 0;
    } finally {
      await shutdownTelemetry();
      await closeDb();
    }
  }

  // Parse global options
  let parsedArgs: { values: Record<string, unknown>; positionals: string[] };

  try {
    parsedArgs = parseArgs({
      args,
      options: {
        cwd: { type: 'string', default: process.cwd() },
        help: { type: 'boolean', short: 'h' },
        branch: { type: 'string', short: 'b' },
        from: { type: 'string' },
        'from-branch': { type: 'string' },
        'no-worktree': { type: 'boolean' },
        resume: { type: 'boolean' },
        quiet: { type: 'boolean', short: 'q' },
        verbose: { type: 'boolean', short: 'v' },
        json: { type: 'boolean' },
        'run-id': { type: 'string' },
        type: { type: 'string' },
        data: { type: 'string' },
        comment: { type: 'string' },
        reason: { type: 'string' },
        force: { type: 'boolean' },
        'issue-context': { type: 'string' },
        'workflow-type': { type: 'string' },
        'pr-sha': { type: 'string' },
        'pr-branch': { type: 'string' },
        scope: { type: 'string' },
      },
      allowPositionals: true,
      strict: false, // Allow unknown flags to pass through
    });
  } catch (error) {
    const err = error as Error;
    console.error(`Error parsing arguments: ${err.message}`);
    printUsage();
    return 1;
  }

  const { values, positionals } = parsedArgs;
  const cwdValue = values.cwd;
  const cwd = resolve(typeof cwdValue === 'string' ? cwdValue : process.cwd());
  const branchName = values.branch as string | undefined;
  const fromBranch =
    (values.from as string | undefined) ?? (values['from-branch'] as string | undefined);
  const noWorktree = values['no-worktree'] as boolean | undefined;
  const resumeFlag = values.resume as boolean | undefined;
  const jsonFlag = values.json as boolean | undefined;
  const issueContext = values['issue-context'] as string | undefined;
  const workflowType = values['workflow-type'] as string | undefined;
  const prSha = values['pr-sha'] as string | undefined;
  const prBranch = values['pr-branch'] as string | undefined;
  // Handle help flag
  if (values.help) {
    printUsage();
    return 0;
  }

  // Get command and subcommand
  const command = positionals[0];
  const subcommand = positionals[1];

  const noGitCommands = ['version', 'help', 'doctor', 'setup'];
  const requiresGitRepo = !noGitCommands.includes(command ?? '');

  try {
    if (values.quiet) {
      setLogLevel('warn');
    } else if (values.verbose) {
      setLogLevel('debug');
    }

    // Note: orphaned run cleanup moved to `workflow cleanup` command only.
    // Running it on every CLI startup killed parallel workflow runs (all
    // 'running' status rows were marked failed by each new process).

    // Marketplace search doesn't need a git repo — handle before git validation
    if (command === 'workflow' && subcommand === 'search') {
      const query = positionals[2];
      try {
        await workflowSearchCommand(query, jsonFlag);
      } catch (error) {
        const err = error as Error;
        console.error(`Error: ${err.message}`);
        return 1;
      }
      return 0;
    }

    // Validate working directory exists
    let effectiveCwd = cwd;
    if (requiresGitRepo) {
      if (!existsSync(cwd)) {
        console.error(`Error: Directory does not exist: ${cwd}`);
        return 1;
      }

      // Validate git repository and resolve to root
      const repoRoot = await git.findRepoRoot(cwd);
      if (!repoRoot) {
        console.error('Error: Not in a git repository.');
        console.error('The Rith Engine CLI must be run from within a git repository.');
        console.error('Either navigate to a git repo or use --cwd to specify one.');
        return 1;
      }
      // Use repo root as working directory (handles subdirectory case)
      effectiveCwd = repoRoot;
    }

    switch (command) {
      case 'version':
        await versionCommand();
        break;

      case 'help':
        printUsage();
        break;

      case 'doctor':
        return await doctorCommand();

      case 'setup': {
        const scopeValue = values.scope as string | undefined;
        if (scopeValue !== undefined && scopeValue !== 'home' && scopeValue !== 'project') {
          console.error(`Error: --scope must be 'home' or 'project' (got '${scopeValue}')`);
          return 1;
        }
        await setupCommand({
          repoPath: effectiveCwd,
          scope: scopeValue,
          force: values.force as boolean | undefined,
        });
        break;
      }

      case 'workflow':
        switch (subcommand) {
          case 'list':
            await workflowListCommand(effectiveCwd, jsonFlag);
            break;

          case 'run': {
            const workflowName = positionals[2];
            if (!workflowName) {
              console.error('Usage: rith workflow run <name> [message]');
              return 1;
            }
            const userMessage = positionals.slice(3).join(' ') || '';
            if (branchName !== undefined && noWorktree) {
              console.error(
                'Error: --branch and --no-worktree are mutually exclusive.\n' +
                  '  --branch creates an isolated worktree (safe).\n' +
                  '  --no-worktree runs directly in your repo (no isolation).\n' +
                  'Use one or the other.'
              );
              return 1;
            }
            if (noWorktree && fromBranch !== undefined) {
              console.error(
                'Error: --from/--from-branch has no effect with --no-worktree.\n' +
                  'Remove --from or drop --no-worktree.'
              );
              return 1;
            }
            if (resumeFlag && branchName !== undefined) {
              console.error(
                'Error: --resume and --branch are mutually exclusive.\n' +
                  '  --resume reuses the existing worktree from the failed run.\n' +
                  '  Remove --branch when using --resume.'
              );
              return 1;
            }
            // Resolve --issue-context: inline JSON or @filepath
            let resolvedIssueContext: string | undefined;
            if (issueContext !== undefined) {
              if (issueContext.startsWith('@')) {
                const { readFile } = await import('fs/promises');
                resolvedIssueContext = await readFile(issueContext.slice(1), 'utf-8');
              } else {
                resolvedIssueContext = issueContext;
              }
            }
            // Validate --workflow-type
            if (
              workflowType !== undefined &&
              workflowType !== 'pr' &&
              workflowType !== 'issue' &&
              workflowType !== 'task'
            ) {
              console.error(
                `Error: --workflow-type must be 'pr', 'issue', or 'task' (got '${workflowType}')`
              );
              return 1;
            }
            // Guard above returns on invalid input, so this is the narrowed union.
            const validatedWorkflowType: 'issue' | 'pr' | 'task' | undefined = workflowType;
            const options = {
              branchName,
              fromBranch,
              noWorktree,
              resume: resumeFlag,
              quiet: values.quiet as boolean | undefined,
              verbose: values.verbose as boolean | undefined,
              issueContext: resolvedIssueContext,
              workflowType: validatedWorkflowType,
              prSha,
              prBranch,
              json: jsonFlag,
            };
            await workflowRunCommand(effectiveCwd, workflowName, userMessage, options);
            break;
          }

          case 'status':
            await workflowStatusCommand(jsonFlag, values.verbose as boolean | undefined);
            break;

          case 'resume': {
            const resumeRunId = positionals[2];
            if (!resumeRunId) {
              console.error('Usage: rith workflow resume <run-id>');
              return 1;
            }
            await workflowResumeCommand(resumeRunId);
            break;
          }

          case 'abandon': {
            const abandonRunId = positionals[2];
            if (!abandonRunId) {
              console.error('Usage: rith workflow abandon <run-id>');
              return 1;
            }
            await workflowAbandonCommand(abandonRunId);
            break;
          }

          case 'approve': {
            const approveRunId = positionals[2];
            if (!approveRunId) {
              console.error('Usage: rith workflow approve <run-id> [comment]');
              return 1;
            }
            // Accept comment as positional args (everything after run ID) or --comment flag
            const approveComment =
              (values.comment as string | undefined) || positionals.slice(3).join(' ') || undefined;
            await workflowApproveCommand(approveRunId, approveComment);
            break;
          }

          case 'reject': {
            const rejectRunId = positionals[2];
            if (!rejectRunId) {
              console.error('Usage: rith workflow reject <run-id> [reason]');
              return 1;
            }
            const rejectReason =
              (values.reason as string | undefined) || positionals.slice(3).join(' ') || undefined;
            await workflowRejectCommand(rejectRunId, rejectReason);
            break;
          }

          case 'cleanup': {
            const days = positionals[2] ? Number(positionals[2]) : 7;
            if (Number.isNaN(days) || days < 0) {
              console.error('Usage: rith workflow cleanup [days]');
              console.error('  days: delete terminal runs older than N days (default: 7)');
              return 1;
            }
            await workflowCleanupCommand(days);
            break;
          }

          case 'event': {
            const action = positionals[2];
            if (action !== 'emit') {
              if (action === undefined) {
                console.error('Missing workflow event subcommand');
              } else {
                console.error(`Unknown workflow event subcommand: ${action}`);
              }
              console.error('Available: emit');
              return 1;
            }
            const runId = values['run-id'] as string | undefined;
            const eventType = values.type as string | undefined;
            if (!runId) {
              console.error('Usage: rith workflow event emit --run-id <uuid> --type <event-type>');
              console.error('Error: --run-id is required');
              return 1;
            }
            if (!eventType) {
              console.error('Usage: rith workflow event emit --run-id <uuid> --type <event-type>');
              console.error('Error: --type is required');
              return 1;
            }
            if (!isValidEventType(eventType)) {
              console.error(`Error: unknown event type: ${eventType}`);
              console.error(`Valid types: ${WORKFLOW_EVENT_TYPES.join(', ')}`);
              return 1;
            }
            let eventData: Record<string, unknown> | undefined;
            const rawData = values.data as string | undefined;
            if (rawData) {
              try {
                eventData = JSON.parse(rawData) as Record<string, unknown>;
              } catch {
                console.warn(
                  `Warning: --data is not valid JSON — event will be emitted without data payload: ${rawData}`
                );
              }
            }
            await workflowEventEmitCommand(runId, eventType, eventData);
            break;
          }

          case 'install': {
            const installSlug = positionals[2];
            if (!installSlug) {
              console.error('Usage: rith workflow install <slug> [--force]');
              return 1;
            }
            const forceFlag = values.force as boolean | undefined;
            await workflowInstallCommand(installSlug, effectiveCwd, forceFlag);
            break;
          }

          default:
            if (subcommand === undefined) {
              console.error('Missing workflow subcommand');
            } else {
              console.error(`Unknown workflow subcommand: ${subcommand}`);
            }
            console.error(
              'Available: list, run, status, resume, abandon, approve, reject, cleanup, event, search, install'
            );
            return 1;
        }
        break;

      case 'isolation':
        switch (subcommand) {
          case 'list':
            await isolationListCommand();
            break;

          case 'cleanup': {
            // Check for --merged flag in remaining args
            const mergedFlag = args.includes('--merged') || positionals.includes('--merged');
            if (mergedFlag) {
              const includeClosed = args.includes('--include-closed');
              await isolationCleanupMergedCommand({ includeClosed });
            } else {
              const days = parseInt(positionals[2] ?? '7', 10);
              await isolationCleanupCommand(days);
            }
            break;
          }

          default:
            if (subcommand === undefined) {
              console.error('Missing isolation subcommand');
            } else {
              console.error(`Unknown isolation subcommand: ${subcommand}`);
            }
            console.error('Available: list, cleanup');
            return 1;
        }
        break;

      case 'validate':
        switch (subcommand) {
          case 'workflows': {
            const validateName = positionals[2];
            return await validateWorkflowsCommand(effectiveCwd, validateName, jsonFlag);
          }

          case 'commands': {
            const validateName = positionals[2];
            return await validateCommandsCommand(effectiveCwd, validateName, jsonFlag);
          }

          default:
            if (subcommand === undefined) {
              console.error('Missing validate target');
            } else {
              console.error(`Unknown validate target: ${subcommand}`);
            }
            console.error('Available: workflows, commands');
            return 1;
        }

      case 'complete': {
        const branches = positionals.slice(1);
        if (branches.length === 0) {
          console.error('Usage: rith complete <branch-name> [branch2 ...]');
          return 1;
        }
        const forceFlag = args.includes('--force');
        await isolationCompleteCommand(branches, { force: forceFlag, deleteRemote: true });
        break;
      }

      default:
        if (command === undefined) {
          console.error('Missing command');
        } else {
          console.error(`Unknown command: ${command}`);
        }
        printUsage();
        return 1;
    }
    return 0;
  } catch (error) {
    const err = error as Error;
    console.error(`Error: ${err.message}`);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    return 1;
  } finally {
    // Flush queued telemetry events before the CLI process exits.
    // Short-lived CLI commands lose buffered events if shutdown() is skipped.
    await shutdownTelemetry();
    // Always close database connection
    await closeDb();
  }
}

// Run main and exit with the returned code
main()
  .then(exitCode => {
    process.exit(exitCode);
  })
  .catch((error: unknown) => {
    const err = error as Error;
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
