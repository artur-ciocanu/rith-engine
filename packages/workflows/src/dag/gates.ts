/**
 * Pre-execution gates for DAG nodes.
 *
 * `checkTriggerRule` evaluates a node's trigger rule against its upstream
 * states; `evaluateNodeGates` runs the full gate sequence (prior-run resume
 * skip, trigger rule, then `when:` condition) and records each skip.
 * `recordNodePreRunFailure` handles failures raised around dispatch.
 */
import { evaluateCondition } from '../condition-evaluator';
import { safeSendMessage } from '../executor-shared';
import { logNodeSkip } from '../logger';
import { getWorkflowEventEmitter } from '../event-emitter';
import type { DagNode, NodeOutput, TriggerRule } from '../schemas';
import type { DagRunContext } from './context';
import { getLog } from './log';

/** Evaluate trigger rule for a node given its upstream states */
export function checkTriggerRule(
  node: DagNode,
  nodeOutputs: Map<string, NodeOutput>
): 'run' | 'skip' {
  const nodeDeps = node.depends_on ?? [];
  if (nodeDeps.length === 0) return 'run';

  const upstreams = nodeDeps.map(
    id =>
      nodeOutputs.get(id) ??
      ({
        state: 'failed',
        output: '',
        error: `upstream '${id}' missing from outputs`,
      } as NodeOutput)
  );
  const rule: TriggerRule = node.trigger_rule ?? 'all_success';

  switch (rule) {
    case 'all_success':
      return upstreams.every(u => u.state === 'completed') ? 'run' : 'skip';
    case 'one_success':
      return upstreams.some(u => u.state === 'completed') ? 'run' : 'skip';
    case 'none_failed_min_one_success': {
      const anyFailed = upstreams.some(u => u.state === 'failed');
      const anySucceeded = upstreams.some(u => u.state === 'completed');
      return !anyFailed && anySucceeded ? 'run' : 'skip';
    }
    case 'all_done':
      return upstreams.every(u => u.state !== 'pending' && u.state !== 'running') ? 'run' : 'skip';
  }
}

/** Reason a node was skipped — drives the skip event type, log, and emitted event. */
type NodeSkipReason =
  | 'prior_success'
  | 'trigger_rule'
  | 'when_condition'
  | 'when_condition_parse_error';

/**
 * Record a node skip: write the skip log file, persist a workflow event, and emit
 * the node_skipped observability event. Dedupes the per-reason boilerplate that was
 * copy-pasted across the gate checks. `prior_success` uses its own event type.
 */
async function recordNodeSkip(
  ctx: DagRunContext,
  node: DagNode,
  reason: NodeSkipReason,
  data?: Record<string, unknown>
): Promise<void> {
  const { deps, logDir, workflowRun } = ctx;
  await logNodeSkip(logDir, workflowRun.id, node.id, reason).catch((err: Error) => {
    getLog().warn({ err, nodeId: node.id }, 'dag.node_skip_log_write_failed');
  });
  const eventType = reason === 'prior_success' ? 'node_skipped_prior_success' : 'node_skipped';
  deps.store
    .createWorkflowEvent({
      workflow_run_id: workflowRun.id,
      event_type: eventType,
      step_name: node.id,
      data: { reason, ...data },
    })
    .catch((err: Error) => {
      getLog().error(
        { err, workflowRunId: workflowRun.id, eventType },
        'workflow_event_persist_failed'
      );
    });
  getWorkflowEventEmitter().emit({
    type: 'node_skipped',
    runId: workflowRun.id,
    nodeId: node.id,
    nodeName: node.id,
    reason,
  });
}

/**
 * Record a node failure raised before/around dispatch (the layer lambda's catch
 * path): persist a node_failed event, emit it, and notify the user.
 */
export async function recordNodePreRunFailure(
  ctx: DagRunContext,
  node: DagNode,
  err: Error
): Promise<void> {
  const { deps, platform, conversationId, workflowRun } = ctx;
  getLog().error({ err, nodeId: node.id }, 'dag_node_pre_execution_failed');
  deps.store
    .createWorkflowEvent({
      workflow_run_id: workflowRun.id,
      event_type: 'node_failed',
      step_name: node.id,
      data: { error: err.message },
    })
    .catch((dbErr: Error) => {
      getLog().error({ err: dbErr, nodeId: node.id }, 'workflow_event_persist_failed');
    });
  getWorkflowEventEmitter().emit({
    type: 'node_failed',
    runId: workflowRun.id,
    nodeId: node.id,
    nodeName: node.id,
    error: err.message,
  });
  await safeSendMessage(
    platform,
    conversationId,
    `Node '${node.id}' failed before execution: ${err.message}`,
    { workflowId: workflowRun.id, nodeName: node.id }
  );
}

/** A pre-execution gate decision: run the node, or skip it with a captured output. */
type NodeGateDecision = { action: 'run' } | { action: 'skip'; output: NodeOutput };

/**
 * Evaluate the pre-execution gates in order: prior-run resume skip, trigger rule,
 * then `when:` condition. Each gate records its own skip via the event sink; the
 * caller only forwards the captured output. `always_run` opts a prior-completed
 * node back into execution (emitting node_always_run_reset).
 */
export async function evaluateNodeGates(
  ctx: DagRunContext,
  node: DagNode,
  priorCompletedNodes: Map<string, string> | undefined
): Promise<NodeGateDecision> {
  const { deps, platform, conversationId, workflowRun, nodeOutputs } = ctx;

  // 0. Prior-run resume skip (unless always_run forces re-execution).
  if (priorCompletedNodes?.has(node.id)) {
    if (node.always_run) {
      getLog().info({ nodeId: node.id }, 'dag.node_always_run_resume_forced');
      deps.store
        .createWorkflowEvent({
          workflow_run_id: workflowRun.id,
          event_type: 'node_always_run_reset',
          step_name: node.id,
          data: { prior_output: priorCompletedNodes.get(node.id) ?? '' },
        })
        .catch((err: Error) => {
          getLog().error(
            { err, workflowRunId: workflowRun.id, eventType: 'node_always_run_reset' },
            'workflow_event_persist_failed'
          );
        });
      // falls through to re-execute the node
    } else {
      getLog().info({ nodeId: node.id }, 'dag.node_skipped_prior_success');
      await recordNodeSkip(ctx, node, 'prior_success', {
        node_output: priorCompletedNodes.get(node.id) ?? '',
      });
      return {
        action: 'skip',
        output: nodeOutputs.get(node.id) ?? { state: 'skipped', output: '' },
      };
    }
  }

  // 1. Trigger rule.
  if (checkTriggerRule(node, nodeOutputs) === 'skip') {
    getLog().info({ nodeId: node.id, reason: 'trigger_rule' }, 'dag_node_skipped');
    await recordNodeSkip(ctx, node, 'trigger_rule');
    return { action: 'skip', output: { state: 'skipped', output: '' } };
  }

  // 2. when: condition.
  if (node.when !== undefined) {
    const { result: conditionPasses, parsed: conditionParsed } = evaluateCondition(
      node.when,
      nodeOutputs
    );
    if (!conditionParsed) {
      const parseErrMsg = `\u26a0\ufe0f Node '${node.id}': unparseable \`when:\` expression "${node.when}" \u2014 node skipped (fail-closed). Check syntax: \`$nodeId.output == 'VALUE'\`, \`$nodeId.output > '5'\`, or compound \`$a.output == 'X' && $b.output != 'Y'\`.`;
      await safeSendMessage(platform, conversationId, parseErrMsg, {
        workflowId: workflowRun.id,
        nodeName: node.id,
      });
      getLog().error(
        { nodeId: node.id, when: node.when },
        'dag_node_skipped_condition_parse_error'
      );
      await recordNodeSkip(ctx, node, 'when_condition_parse_error', { expr: node.when });
      return { action: 'skip', output: { state: 'skipped', output: '' } };
    }
    if (!conditionPasses) {
      getLog().info({ nodeId: node.id, when: node.when }, 'dag_node_skipped_condition');
      await recordNodeSkip(ctx, node, 'when_condition', { expr: node.when });
      return { action: 'skip', output: { state: 'skipped', output: '' } };
    }
  }

  return { action: 'run' };
}
