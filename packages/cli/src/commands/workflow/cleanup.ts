import * as workflowDb from '@rith/core/db/workflows';

import { getLog } from './shared';

/**
 * Clean up old workflow runs.
 */
export async function workflowCleanupCommand(days: number): Promise<void> {
  try {
    const { count } = await workflowDb.deleteOldWorkflowRuns(days);
    if (count === 0) {
      console.log(`No workflow runs older than ${days} days to clean up.`);
    } else {
      console.log(`Deleted ${count} workflow run(s) older than ${days} days.`);
    }
  } catch (error) {
    const err = error as Error;
    getLog().error({ err, days }, 'cli.workflow_cleanup_failed');
    throw new Error(`Failed to clean up workflow runs: ${err.message}`);
  }
}
