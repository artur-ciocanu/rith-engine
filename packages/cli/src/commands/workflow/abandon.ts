import { abandonWorkflow } from '@rith/core/operations/workflow-operations';

/**
 * Abandon a running workflow run by ID.
 */
export async function workflowAbandonCommand(runId: string): Promise<void> {
  const run = await abandonWorkflow(runId);
  console.log(`Abandoned workflow run: ${runId}`);
  console.log(`Workflow: ${run.workflow_name}`);
}
