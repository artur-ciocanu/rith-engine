import { approveWorkflow } from '@rith/core/operations/workflow-operations';
import * as codebaseDb from '@rith/core/db/codebases';
import { getLog } from './shared';
import { workflowRunCommand } from './run';

/**
 * Approve a paused workflow run by ID.
 * After approval, auto-resumes the workflow in CLI mode.
 */
export async function workflowApproveCommand(runId: string, comment?: string): Promise<void> {
  const result = await approveWorkflow(runId, comment);

  // CLI auto-resumes after approval (unlike chat, which defers to next user message)
  if (!result.workingPath) {
    throw new Error(
      `Workflow run '${runId}' has no working path recorded.\n` +
        'Cannot determine where to resume.'
    );
  }
  console.log(`Approved workflow: ${result.workflowName}`);
  console.log(`Path: ${result.workingPath}`);
  console.log('');
  console.log('Resuming workflow...');

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
          'cli.workflow_approve_codebase_not_found'
        );
      }
    } catch (error) {
      const err = error as Error;
      getLog().warn(
        { err, errorType: err.constructor.name, runId, codebaseId: result.codebaseId },
        'cli.workflow_approve_codebase_lookup_failed'
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
      'cli.workflow_approve_resume_failed'
    );
    throw new Error(
      `Approved but failed to resume workflow '${result.workflowName}': ${err.message}\n` +
        `The approval was recorded. Run 'bun run cli workflow resume ${runId}' to retry.`
    );
  }
}
