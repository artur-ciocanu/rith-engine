import { WORKFLOW_EVENT_TYPES, type WorkflowEventType } from '@rith/workflows/store';
import { createWorkflowStore } from '@rith/core';

/**
 * Emit a workflow event directly to the database.
 * Non-throwing: mirrors the fire-and-forget contract of createWorkflowEvent.
 */
export function isValidEventType(value: string): value is WorkflowEventType {
  return (WORKFLOW_EVENT_TYPES as readonly string[]).includes(value);
}

export async function workflowEventEmitCommand(
  runId: string,
  eventType: WorkflowEventType,
  data?: Record<string, unknown>
): Promise<void> {
  const store = createWorkflowStore();
  await store.createWorkflowEvent({
    workflow_run_id: runId,
    event_type: eventType,
    data,
  });
  // createWorkflowEvent is non-throwing (fire-and-forget) — the event may not
  // have been persisted if the DB was unavailable. Check server logs if missing.
  console.log(`Event submitted (best-effort): ${eventType} for run ${runId}`);
}
