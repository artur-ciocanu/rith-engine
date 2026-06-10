import { getWorkflowStatus } from '@rith/core/operations/workflow-operations';
import type { WorkflowRun } from '@rith/workflows/schemas/workflow-run';
import * as workflowEventsDb from '@rith/core/db/workflow-events';
import type { WorkflowEventRow } from '@rith/core/db/workflow-events';
import { getLog, formatDuration } from './shared';

/**
 * Format a date as a human-friendly relative age string.
 */
function formatAge(startedAt: Date | string): string {
  // SQLite returns UTC strings without Z suffix — append it so Date parses as UTC
  const date =
    startedAt instanceof Date
      ? startedAt
      : new Date(startedAt.endsWith('Z') ? startedAt : startedAt + 'Z');
  if (Number.isNaN(date.getTime())) return 'unknown';
  const ms = Date.now() - date.getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

interface NodeSummary {
  nodeId: string;
  state: 'running' | 'completed' | 'failed' | 'skipped';
  durationMs?: number;
  outputPreview?: string;
  error?: string;
}

/**
 * Derive per-node summaries from a run's workflow events.
 * Processes node_started / node_completed / node_failed / node_skipped* events.
 */
function buildNodeSummaries(events: WorkflowEventRow[]): NodeSummary[] {
  const startTimes = new Map<string, number>();
  const summaries = new Map<string, NodeSummary>();

  for (const event of events) {
    const nodeId = event.step_name;
    if (!nodeId) continue;

    switch (event.event_type) {
      case 'node_started': {
        startTimes.set(nodeId, new Date(event.created_at).getTime());
        if (!summaries.has(nodeId)) {
          summaries.set(nodeId, { nodeId, state: 'running' });
        }
        break;
      }
      case 'node_completed': {
        const started = startTimes.get(nodeId);
        const endTime = new Date(event.created_at).getTime();
        const rawOutput = event.data.node_output;
        const output = typeof rawOutput === 'string' ? rawOutput : undefined;
        summaries.set(nodeId, {
          nodeId,
          state: 'completed',
          durationMs: started !== undefined ? endTime - started : undefined,
          outputPreview:
            output !== undefined
              ? output.slice(0, 200) + (output.length > 200 ? '...' : '')
              : undefined,
        });
        break;
      }
      case 'node_failed': {
        const started = startTimes.get(nodeId);
        const endTime = new Date(event.created_at).getTime();
        summaries.set(nodeId, {
          nodeId,
          state: 'failed',
          durationMs: started !== undefined ? endTime - started : undefined,
          error: typeof event.data.error === 'string' ? event.data.error : 'Unknown error',
        });
        break;
      }
      case 'node_skipped':
      case 'node_skipped_prior_success': {
        summaries.set(nodeId, { nodeId, state: 'skipped' });
        break;
      }
    }
  }

  return [...summaries.values()];
}

/**
 * Show status of all running workflow runs.
 */
export async function workflowStatusCommand(json?: boolean, verbose?: boolean): Promise<void> {
  let runs: WorkflowRun[];
  try {
    const result = await getWorkflowStatus();
    runs = result.runs;
  } catch (error) {
    const err = error as Error;
    getLog().error({ err }, 'cli.workflow_status_failed');
    throw new Error(`Failed to list workflow runs: ${err.message}`);
  }

  if (json) {
    let runsOutput: unknown[] = runs;
    if (verbose) {
      const eventsPerRun = await Promise.all(
        runs.map(run =>
          workflowEventsDb.listWorkflowEvents(run.id).catch(() => [] as WorkflowEventRow[])
        )
      );
      runsOutput = runs.map((run, i) => ({ ...run, events: eventsPerRun[i] }));
    }
    console.log(JSON.stringify({ runs: runsOutput }, null, 2));
    return;
  }

  if (runs.length === 0) {
    console.log('No active workflows.');
    return;
  }

  console.log(`\nActive workflows (${runs.length}):\n`);
  for (const run of runs) {
    const age = formatAge(run.started_at);
    console.log(`  ID:     ${run.id}`);
    console.log(`  Name:   ${run.workflow_name}`);
    console.log(`  Path:   ${run.working_path ?? '(none)'}`);
    console.log(`  Status: ${run.status}`);
    console.log(`  Age:    ${age}`);

    if (verbose) {
      let events: WorkflowEventRow[];
      try {
        events = await workflowEventsDb.listWorkflowEvents(run.id);
      } catch {
        events = [];
      }
      const nodes = buildNodeSummaries(events);
      if (nodes.length > 0) {
        console.log('  Nodes:');
        for (const node of nodes) {
          const iconMap: Record<string, string> = {
            completed: '✓',
            failed: '✗',
            skipped: '-',
            running: '◌',
          };
          const icon = iconMap[node.state] ?? '◌';
          const duration =
            node.durationMs !== undefined ? ` (${formatDuration(node.durationMs)})` : '';
          const stateLabel = node.state === 'running' ? ' (running)' : '';
          console.log(`    ${icon} ${node.nodeId}${duration}${stateLabel}`);
          if (node.outputPreview !== undefined) {
            console.log(`        Output: ${node.outputPreview}`);
          }
          if (node.error !== undefined) {
            console.log(`        Error:  ${node.error}`);
          }
        }
      }
    }

    console.log('');
  }
}
