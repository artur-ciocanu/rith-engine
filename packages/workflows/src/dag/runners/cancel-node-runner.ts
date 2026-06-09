/**
 * Cancel node runner — terminates the workflow run with a reason string.
 *
 * Sends the cancellation message, then routes the status transition through the
 * run aggregate. The between-layer status re-read sees 'cancelled' and stops the
 * scheduler loop.
 */
import { safeSendMessage } from '../../executor-shared';
import type { DagNode, CancelNode, NodeOutput } from '../../schemas';
import type { DagRunContext, NodeRunContext } from '../context';
import type { NodeRunner, NodeRunResult } from '../node-runner';
import { substituteNodeOutputRefs } from '../substitution';

/**
 * Execute a cancel node — terminates the workflow run with a reason string.
 * Sends the cancellation message, then routes the status transition through the
 * run aggregate. The between-layer status re-read sees 'cancelled' and stops the loop.
 */
export async function executeCancelNode(ctx: DagRunContext, node: CancelNode): Promise<NodeOutput> {
  const reason = substituteNodeOutputRefs(node.cancel, ctx.nodeOutputs);
  await safeSendMessage(
    ctx.platform,
    ctx.conversationId,
    `\u274c **Workflow cancelled** (node \`${node.id}\`): ${reason}`,
    { workflowId: ctx.workflowRun.id, nodeName: node.id }
  );
  await ctx.runAggregate.cancel(node.id, reason);
  return { state: 'completed', output: reason };
}

export class CancelNodeRunner implements NodeRunner {
  async run(rc: NodeRunContext, node: DagNode): Promise<NodeRunResult> {
    const output = await executeCancelNode(rc.run, node as CancelNode);
    return { control: 'continue', output };
  }
}
