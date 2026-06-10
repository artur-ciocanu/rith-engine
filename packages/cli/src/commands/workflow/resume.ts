import { resumeWorkflow as resumeWorkflowOp } from '@rith/core/operations/workflow-operations';
import * as codebaseDb from '@rith/core/db/codebases';
import { getLog } from './shared';
import { workflowRunCommand } from './run';

/**
 * Resume a failed workflow run by ID.
 *
 * Re-executes the workflow with --resume semantics — the executor's
 * findResumableRun picks up the prior failed run and skips completed nodes.
 */
export async function workflowResumeCommand(runId: string): Promise<void> {
  const run = await resumeWorkflowOp(runId);
  if (!run.working_path) {
    throw new Error(
      `Workflow run '${runId}' has no working path recorded.\n` +
        'Cannot determine where to resume. The run may be too old.'
    );
  }
  console.log(`Resuming workflow: ${run.workflow_name}`);
  console.log(`Path: ${run.working_path}`);
  console.log('');

  // Use the codebase's source path for workflow YAML discovery so the file is
  // found even when working_path is a worktree or workspace clone that does
  // not contain the user's local (often untracked) workflow YAML.
  let discoveryCwd: string | undefined;
  if (run.codebase_id) {
    try {
      const codebase = await codebaseDb.getCodebase(run.codebase_id);
      if (codebase) {
        discoveryCwd = codebase.default_cwd;
      } else {
        getLog().warn(
          { runId, codebaseId: run.codebase_id },
          'cli.workflow_resume_codebase_not_found'
        );
      }
    } catch (error) {
      const err = error as Error;
      getLog().warn(
        { err, errorType: err.constructor.name, runId, codebaseId: run.codebase_id },
        'cli.workflow_resume_codebase_lookup_failed'
      );
    }
  }
  if (discoveryCwd) console.log(`Discovery path: ${discoveryCwd}`);

  // Re-execute via workflowRunCommand with --resume.
  // The executor's implicit findResumableRun detects the prior failed run
  // and skips already-completed nodes.
  try {
    await workflowRunCommand(run.working_path, run.workflow_name, run.user_message ?? '', {
      resume: true,
      codebaseId: run.codebase_id ?? undefined,
      discoveryCwd,
    });
  } catch (error) {
    const err = error as Error;
    getLog().error(
      { err, runId, workflowName: run.workflow_name },
      'cli.workflow_resume_run_failed'
    );
    throw new Error(`Failed to resume workflow '${run.workflow_name}': ${err.message}`);
  }
}
