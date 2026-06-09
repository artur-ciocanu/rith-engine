/**
 * WorkflowRunAggregate — the single mutator of a workflow run's lifecycle status.
 *
 * Centralizes the status transitions that were scattered through the DAG executor
 * (cancel / fail / complete) plus the external-transition guard
 * (`skipIfStatusChanged`) and the conditional emitter unregister. Each terminal
 * transition persists the run, emits the matching observability event, and releases
 * the emitter — except `paused`, which stays registered so SSE survives an approval
 * gate.
 */
import type { IWorkflowPlatform, WorkflowDeps } from '../deps';
import type { ApprovalContext, WorkflowRun } from '../schemas';
import { getWorkflowEventEmitter } from '../event-emitter';
import { logWorkflowComplete, logWorkflowError } from '../logger';
import { safeSendMessage } from '../executor-shared';
import { getLog } from './log';

/** Node outcome tally written to run metadata on completion. */
export interface NodeCounts {
  completed: number;
  failed: number;
  skipped: number;
  total: number;
}

export class WorkflowRunAggregate {
  constructor(
    private readonly deps: WorkflowDeps,
    private readonly platform: IWorkflowPlatform,
    private readonly conversationId: string,
    private readonly run: WorkflowRun,
    private readonly logDir: string
  ) {}

  /**
   * True if the run was transitioned externally (status no longer 'running'), in
   * which case the caller must NOT write a terminal status. Logs the reason and,
   * for any non-paused state, unregisters the emitter; `paused` keeps SSE connected
   * while an approval gate awaits the user.
   */
  async skipIfStatusChanged(logEvent: string): Promise<boolean> {
    const status = await this.deps.store.getWorkflowRunStatus(this.run.id);
    if (status === 'running') return false;
    getLog().info({ workflowRunId: this.run.id, status: status ?? 'deleted' }, logEvent);
    if (status !== 'paused') {
      getWorkflowEventEmitter().unregisterRun(this.run.id);
    }
    return true;
  }

  /**
   * Cancel the run: persist the cancellation event, write status, emit. The caller
   * owns the user-facing message — it differs by cancel site (cancel node vs the
   * approval on-reject max-attempts path).
   */
  async cancel(nodeId: string, reason: string): Promise<void> {
    const { deps, run } = this;
    deps.store
      .createWorkflowEvent({
        workflow_run_id: run.id,
        event_type: 'workflow_cancelled',
        step_name: nodeId,
        data: { reason },
      })
      .catch((err: Error) => {
        getLog().error(
          { err, workflowRunId: run.id, eventType: 'workflow_cancelled' },
          'workflow.event_persist_failed'
        );
      });
    await deps.store.cancelWorkflowRun(run.id);
    getWorkflowEventEmitter().emit({
      type: 'workflow_cancelled',
      runId: run.id,
      nodeId,
      reason,
    });
  }

  /**
   * Pause the run at an approval / interactive-loop gate. Writes status + the
   * approval context atomically; the emitter stays registered so SSE survives the
   * gate. Callers own the gate message and observability events (they differ by
   * gate type).
   */
  async pause(approvalContext: ApprovalContext): Promise<void> {
    await this.deps.store.pauseWorkflowRun(this.run.id, approvalContext);
  }

  /** Fail the run: persist status, write the error log, emit, unregister, notify. */
  async fail(workflowName: string, failMsg: string): Promise<void> {
    const { deps, run, logDir } = this;
    await deps.store.failWorkflowRun(run.id, failMsg).catch((dbErr: Error) => {
      getLog().error({ err: dbErr, workflowRunId: run.id }, 'dag_db_fail_failed');
    });
    await logWorkflowError(logDir, run.id, failMsg).catch((logErr: Error) => {
      getLog().error({ err: logErr, workflowRunId: run.id }, 'dag.workflow_error_log_write_failed');
    });
    const emitter = getWorkflowEventEmitter();
    emitter.emit({ type: 'workflow_failed', runId: run.id, workflowName, error: failMsg });
    emitter.unregisterRun(run.id);
    await safeSendMessage(this.platform, this.conversationId, `\u274c ${failMsg}`, {
      workflowId: run.id,
    });
  }

  /**
   * Complete the run: persist status + node counts (and total cost when nonzero),
   * write the completion log, emit completion, persist the event, and unregister.
   */
  async complete(
    workflowName: string,
    nodeCounts: NodeCounts,
    totalCostUsd: number,
    dagStartTime: number
  ): Promise<void> {
    const { deps, run, logDir } = this;
    try {
      await deps.store.completeWorkflowRun(run.id, {
        node_counts: nodeCounts,
        // totalCostUsd starts at 0; only write metadata when at least one node reported cost
        ...(totalCostUsd > 0 ? { total_cost_usd: totalCostUsd } : {}),
      });
    } catch (dbErr) {
      getLog().error({ err: dbErr as Error, workflowRunId: run.id }, 'dag_db_complete_failed');
      await safeSendMessage(
        this.platform,
        this.conversationId,
        'Warning: workflow completed but the run status could not be saved. The workflow result may appear inconsistent.',
        { workflowId: run.id }
      );
    }
    await logWorkflowComplete(logDir, run.id);
    const duration = Date.now() - dagStartTime;
    const emitter = getWorkflowEventEmitter();
    emitter.emit({ type: 'workflow_completed', runId: run.id, workflowName, duration });
    deps.store
      .createWorkflowEvent({
        workflow_run_id: run.id,
        event_type: 'workflow_completed',
        data: { duration_ms: duration },
      })
      .catch((err: Error) => {
        getLog().error(
          { err, workflowRunId: run.id, eventType: 'workflow_completed' },
          'workflow_event_persist_failed'
        );
      });
    emitter.unregisterRun(run.id);
  }
}
