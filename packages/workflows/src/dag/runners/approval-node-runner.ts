/**
 * Approval node runner — pauses the workflow for human review.
 *
 * On a rejection resume (when `on_reject` is configured) it runs the on_reject
 * prompt through the non-retrying `executeNodeInternal` with a fresh session,
 * then re-pauses at the gate. After `max_attempts` rejections it cancels.
 */
import { executeNodeInternal, resolveNodeModelAndOptions } from './ai-node-runner';
import { substituteWorkflowVariables, safeSendMessage } from '../../executor-shared';
import { getWorkflowEventEmitter } from '../../event-emitter';
import {
  isApprovalContext,
  type DagNode,
  type PromptNode,
  type NodeOutput,
  type ApprovalNode,
} from '../../schemas';
import type { DagRunContext, NodeRunContext } from '../context';
import type { NodeRunner, NodeRunResult } from '../node-runner';
import { getLog } from '../log';
import { substituteNodeOutputRefs } from '../substitution';

/**
 * Execute an approval node — pauses workflow for human review.
 * On rejection resume (when on_reject is configured): runs the on_reject prompt via AI,
 * then re-pauses at the approval gate. After max_attempts rejections, cancels normally.
 */
export async function executeApprovalNode(
  ctx: DagRunContext,
  node: ApprovalNode
): Promise<NodeOutput> {
  const {
    deps,
    platform,
    conversationId,
    workflowRun,
    nodeOutputs,
    config,
    workflowModel,
    workflowLevelOptions,
    promptContext,
  } = ctx;
  const msgContext = { workflowId: workflowRun.id, nodeName: node.id };

  // Detect rejection resume — check metadata for rejection_reason set by reject handlers
  const rawApproval = workflowRun.metadata?.approval;
  const approvalMeta = isApprovalContext(rawApproval) ? rawApproval : undefined;
  const rawRejection = workflowRun.metadata?.rejection_reason;
  const rejectionReason =
    approvalMeta?.type === 'approval' &&
    approvalMeta.nodeId === node.id &&
    typeof rawRejection === 'string' &&
    rawRejection !== ''
      ? rawRejection
      : '';

  // On rejection resume with on_reject configured: run the on_reject prompt via AI
  if (rejectionReason !== '' && node.approval.on_reject) {
    const maxAttempts = node.approval.on_reject.max_attempts ?? 3;
    const rejectionCount = workflowRun.metadata?.rejection_count ?? 0;

    // Check if max attempts exhausted
    if (rejectionCount >= maxAttempts) {
      await ctx.runAggregate.cancel(node.id, `max_attempts (${String(maxAttempts)}) exhausted`);
      const cancelMsg = `❌ Approval node \`${node.id}\` cancelled after ${String(maxAttempts)} rejections.`;
      await safeSendMessage(platform, conversationId, cancelMsg, msgContext);
      return { state: 'completed' as const, output: '' };
    }

    const { prompt: substitutedPrompt } = substituteWorkflowVariables(
      promptContext,
      node.approval.on_reject.prompt,
      undefined, // loopUserInput
      rejectionReason
    );

    // Build a synthetic PromptNode to reuse executeNodeInternal.
    // Use a distinct ID so the node_completed event written by executeNodeInternal
    // does not collide with the approval gate's own ID in getCompletedDagNodeOutputs.
    // If we used node.id here, a resumed run would find the event and treat the
    // approval gate as already completed, bypassing the human gate entirely.
    //
    // Note: executeNodeInternal also emits node_started/node_completed WorkflowEmitterEvents
    // with nodeId = `${node.id}:on_reject`. These flow through SSE into the web UI, where
    // WorkflowExecution.tsx builds its nodeMap from all node_* events unconditionally.
    // This means a transient `${node.id}:on_reject` phantom entry may appear in the UI's
    // execution view during an on_reject cycle. This is cosmetic-only — the approval gate
    // still re-presents correctly and the human gate contract is preserved. A follow-up can
    // filter synthetic `:on_reject` IDs from the UI's nodeMap if needed.
    const syntheticNode: PromptNode = {
      id: `${node.id}:on_reject`,
      prompt: substituteNodeOutputRefs(substitutedPrompt, nodeOutputs),
      ...(node.depends_on ? { depends_on: node.depends_on } : {}),
      ...(node.idle_timeout ? { idle_timeout: node.idle_timeout } : {}),
    };

    const { options: nodeOptions } = await resolveNodeModelAndOptions(
      syntheticNode,
      workflowModel,
      config,
      workflowLevelOptions
    );

    const output = await executeNodeInternal(
      ctx,
      syntheticNode,
      nodeOptions,
      undefined // fresh session
    );

    if (output.state === 'failed') {
      return output;
    }
    // Fall through to re-pause at the approval gate
  }

  // Standard approval gate — send message and pause.
  // Resolve $nodeId.output[.field] references so the human sees concrete values
  // (parity with prompt/bash/loop/cancel nodes, which all run the same substitution).
  const renderedMessage = substituteNodeOutputRefs(node.approval.message, nodeOutputs);
  const approvalMsg =
    `⏸ **Approval required**: ${renderedMessage}\n\n` +
    `Run ID: \`${workflowRun.id}\`\n` +
    `Approve: \`/workflow approve ${workflowRun.id}\` | Reject: \`/workflow reject ${workflowRun.id}\``;
  await safeSendMessage(platform, conversationId, approvalMsg, msgContext);

  deps.store
    .createWorkflowEvent({
      workflow_run_id: workflowRun.id,
      event_type: 'approval_requested',
      step_name: node.id,
      data: { message: renderedMessage },
    })
    .catch((err: Error) => {
      getLog().error(
        { err, workflowRunId: workflowRun.id, eventType: 'approval_requested' },
        'workflow.event_persist_failed'
      );
    });

  await ctx.runAggregate.pause({
    message: renderedMessage,
    nodeId: node.id,
    type: 'approval',
    captureResponse: node.approval.capture_response,
    onRejectPrompt: node.approval.on_reject?.prompt,
    onRejectMaxAttempts: node.approval.on_reject?.max_attempts,
  });

  getWorkflowEventEmitter().emit({
    type: 'approval_pending',
    runId: workflowRun.id,
    nodeId: node.id,
    message: renderedMessage,
  });

  // Return completed — the between-layer status check will see 'paused' and break.
  // On resume, the approve endpoint writes a real node_completed event with the user's response.
  return { state: 'completed' as const, output: '' };
}

export class ApprovalNodeRunner implements NodeRunner {
  async run(rc: NodeRunContext, node: DagNode): Promise<NodeRunResult> {
    const output = await executeApprovalNode(rc.run, node as ApprovalNode);
    return { control: 'continue', output };
  }
}
