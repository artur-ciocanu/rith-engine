import { rejectWorkflow } from '@rith/core/operations/workflow-operations';
import * as codebaseDb from '@rith/core/db/codebases';
import { getLog } from './shared';
import { workflowRunCommand } from './run';

/**
 * Reject a paused workflow run by ID.
 * If the workflow has an on_reject prompt, auto-resumes with the rejection feedback;
 * otherwise marks the run as cancelled.
 */
export async function workflowRejectCommand(runId: string, reason?: string): Promise<void> {
  const result = await rejectWorkflow(runId, reason);

  if (result.cancelled) {
    const suffix = result.maxAttemptsReached ? ' (max attempts reached)' : '';
    console.log(`Rejected and cancelled${suffix}: ${result.workflowName}`);
    return;
  }

  // Not cancelled = has onRejectPrompt, CLI auto-resumes with rejection feedback
  if (!result.workingPath) {
    throw new Error(
      `Workflow run '${runId}' has no working path recorded.\n` +
        'Cannot determine where to resume.'
    );
  }
  console.log(`Rejected workflow: ${result.workflowName}`);
  console.log('Resuming with on_reject prompt...');

  // In CLI mode, the conversation ID is the platform conversation ID directly.
  const platformConversationId: string | undefined = result.conversationId;

  // Use the codebase's source path for workflow YAML discovery so the file is
  // found even when working_path is a worktree or workspace clone that does
  // not contain the user's local (often untracked) workflow YAML.
  let discoveryCwd: string | undefined;
  if (result.codebaseId) {
    try {
      const codebase = await codebaseDb.getCodebase(result.codebaseId);
      if (codebase) {
        discoveryCwd = codebase.default_cwd;
      } else {
        getLog().warn(
          { runId, codebaseId: result.codebaseId },
          'cli.workflow_reject_codebase_not_found'
        );
      }
    } catch (error) {
      const err = error as Error;
      getLog().warn(
        { err, errorType: err.constructor.name, runId, codebaseId: result.codebaseId },
        'cli.workflow_reject_codebase_lookup_failed'
      );
    }
  }
  if (discoveryCwd) console.log(`Discovery path: ${discoveryCwd}`);

  try {
    await workflowRunCommand(result.workingPath, result.workflowName, result.userMessage ?? '', {
      resume: true,
      codebaseId: result.codebaseId ?? undefined,
      conversationId: platformConversationId,
      discoveryCwd,
    });
  } catch (error) {
    const err = error as Error;
    getLog().error(
      { err, runId, workflowName: result.workflowName },
      'cli.workflow_reject_resume_failed'
    );
    throw new Error(
      `Rejected but failed to resume workflow '${result.workflowName}': ${err.message}\n` +
        `The rejection was recorded. Run 'bun run cli workflow resume ${runId}' to retry.`
    );
  }
}
