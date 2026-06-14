/**
 * DAG Workflow Executor
 *
 * Executes a `nodes:`-based workflow in topological order.
 * Independent nodes within the same layer run concurrently via Promise.allSettled.
 * Captures all assistant output regardless of streaming mode for $node_id.output substitution.
 */
import type { IWorkflowPlatform, WorkflowConfig, WorkflowDeps } from './deps';
import type { DagNode, NodeOutput, WorkflowRun } from './schemas';
import { safeSendMessage, type PromptContext } from './executor-shared';
import type { DagRunContext, NodeRunContext, WorkflowLevelOptions } from './dag/context';
import { nodeKind, type NodeExecutionResult } from './dag/node-runner';
import { WorkflowRunAggregate } from './dag/run-aggregate';
import { getLog } from './dag/log';
import { nodeRunnerRegistry } from './dag/registry';
import { evaluateNodeGates, recordNodePreRunFailure } from './dag/gates';

export { substituteNodeOutputRefs } from './dag/substitution';
export { parseMcpFailureServerNames, loadConfiguredMcpServerNames } from './dag/mcp';
export { shouldContinueStreamingForStatus } from './dag/node-shared';
export { checkTriggerRule } from './dag/gates';

/**
 * Build topological layers from DAG nodes using Kahn's algorithm.
 * Layer 0: nodes with no dependencies.
 * Layer N: nodes whose dependencies are all in layers 0..N-1.
 *
 * Cycle detection: if the sum of all layer sizes < nodes.length, a cycle exists.
 * (Cycle detection at load time is the primary guard; this is a runtime safety check.)
 */
export function buildTopologicalLayers(nodes: readonly DagNode[]): DagNode[][] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, node.depends_on?.length ?? 0);
    for (const dep of node.depends_on ?? []) {
      const existing = dependents.get(dep) ?? [];
      existing.push(node.id);
      dependents.set(dep, existing);
    }
  }

  const layers: DagNode[][] = [];
  let ready = [...nodes].filter(n => (inDegree.get(n.id) ?? 0) === 0);

  while (ready.length > 0) {
    layers.push(ready);
    const nextIds: string[] = [];
    for (const node of ready) {
      for (const depId of dependents.get(node.id) ?? []) {
        const newDegree = (inDegree.get(depId) ?? 0) - 1;
        inDegree.set(depId, newDegree);
        if (newDegree === 0) nextIds.push(depId);
      }
    }
    ready = nextIds
      .map(id => nodes.find(n => n.id === id))
      .filter((n): n is DagNode => n !== undefined);
  }

  const totalPlaced = layers.reduce((sum, l) => sum + l.length, 0);
  if (totalPlaced < nodes.length) {
    // Should never happen — cycle detection runs at load time
    throw new Error(
      '[DagExecutor] Cycle detected at runtime — was cycle detection skipped at load?'
    );
  }

  return layers;
}

/**
 * Execute a complete DAG workflow.
 * Called from executeWorkflow() in executor.ts.
 */
export async function executeDagWorkflow(
  deps: WorkflowDeps,
  platform: IWorkflowPlatform,
  conversationId: string,
  cwd: string,
  workflow: { name: string; nodes: readonly DagNode[] } & WorkflowLevelOptions,
  workflowRun: WorkflowRun,
  workflowModel: string | undefined,
  artifactsDir: string,
  logDir: string,
  baseBranch: string,
  docsDir: string,
  config: WorkflowConfig,
  issueContext?: string,
  priorCompletedNodes?: Map<string, string>
): Promise<string | undefined> {
  const dagStartTime = Date.now();
  const workflowLevelOptions = {
    effort: workflow.effort,
    thinking: workflow.thinking,
    fallbackModel: workflow.fallbackModel,
    betas: workflow.betas,
    sandbox: workflow.sandbox,
  };
  const layers = buildTopologicalLayers(workflow.nodes);
  const nodeOutputs = new Map<string, NodeOutput>();

  // Pre-populate nodeOutputs from prior run so already-completed nodes are
  // treated as done for trigger-rule and $nodeId.output substitution purposes.
  // Nodes flagged `always_run: true` are excluded — they re-execute on resume
  // and downstream consumers must see the fresh output, not the cached one.
  if (priorCompletedNodes && priorCompletedNodes.size > 0) {
    const alwaysRunIds = new Set(workflow.nodes.filter(n => n.always_run).map(n => n.id));
    let prepopulatedCount = 0;
    for (const [nodeId, output] of priorCompletedNodes) {
      if (alwaysRunIds.has(nodeId)) continue;
      nodeOutputs.set(nodeId, { state: 'completed', output });
      prepopulatedCount++;
    }
    getLog().info(
      {
        workflowRunId: workflowRun.id,
        priorCompletedCount: priorCompletedNodes.size,
        prepopulatedCount,
        alwaysRunResumedCount: priorCompletedNodes.size - prepopulatedCount,
      },
      'dag.workflow_resume_prepopulated'
    );
  }

  // Per-run constants threaded to every DAG node runner (built once; see DagRunContext).
  const promptContext: PromptContext = {
    workflowId: workflowRun.id,
    userMessage: workflowRun.user_message,
    artifactsDir,
    baseBranch,
    docsDir,
    issueContext,
  };
  const ctx: DagRunContext = {
    deps,
    platform,
    conversationId,
    cwd,
    workflowRun,
    artifactsDir,
    logDir,
    baseBranch,
    promptContext,
    nodeOutputs,
    config,
    workflowModel,
    workflowLevelOptions,
    issueContext,
    runAggregate: new WorkflowRunAggregate(deps, platform, conversationId, workflowRun, logDir),
  };

  getLog().info(
    {
      workflowName: workflow.name,
      nodeCount: workflow.nodes.length,
      layerCount: layers.length,
      hasIssueContext: !!issueContext,
      issueContextLength: issueContext?.length ?? 0,
    },
    'dag_workflow_starting'
  );

  // Session threading: for sequential single-node layers, thread the session forward.
  // For parallel layers (>1 node), always fresh (can't share a session).
  let lastSequentialSessionId: string | undefined;
  // Note: accumulates cost for this invocation only. If this is a resume, nodes skipped
  // from the prior run are not included — total_cost_usd will reflect resumed-portion cost only.
  let totalCostUsd = 0;

  for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
    const layer = layers[layerIdx];
    const isParallelLayer = layer.length > 1;

    if (isParallelLayer) {
      lastSequentialSessionId = undefined; // reset — parallel nodes can't share sessions
    }

    // Execute all nodes in the layer concurrently
    const layerResults = await Promise.allSettled(
      layer.map(async (node): Promise<{ nodeId: string; output: NodeExecutionResult }> => {
        try {
          const gate = await evaluateNodeGates(ctx, node, priorCompletedNodes);
          if (gate.action === 'skip') {
            return { nodeId: node.id, output: gate.output };
          }

          // Dispatch to the runner for this node kind (replaces the former type-switch).
          // resumeSessionId/isParallelLayer are scheduler decisions the AI runner consumes;
          // other runners ignore them.
          const isFresh = isParallelLayer || node.context === 'fresh';
          const rc: NodeRunContext = {
            run: ctx,
            resumeSessionId: isFresh ? undefined : lastSequentialSessionId,
            isParallelLayer,
          };
          const runResult = await nodeRunnerRegistry[nodeKind(node)].run(rc, node);
          return { nodeId: node.id, output: runResult.output as NodeExecutionResult };
        } catch (error) {
          const err = error as Error;
          await recordNodePreRunFailure(ctx, node, err);
          return {
            nodeId: node.id,
            output: { state: 'failed' as const, output: '', error: err.message },
          };
        }
      })
    );

    // Process layer results — store all outputs, track failures
    let layerHadFailure = false;
    for (const result of layerResults) {
      if (result.status === 'fulfilled') {
        const { nodeId, output } = result.value;
        if (output.costUsd !== undefined) totalCostUsd += output.costUsd;
        nodeOutputs.set(nodeId, output);
        if (output.state === 'completed' && !isParallelLayer && output.sessionId !== undefined) {
          lastSequentialSessionId = output.sessionId;
        }
        if (output.state === 'failed') layerHadFailure = true;
      } else {
        // Should not happen — all errors are caught in the inner try-catch
        // Handle defensively: log the unexpected rejection
        getLog().error({ err: result.reason as Error, layerIdx }, 'dag_node_unexpected_rejection');
        layerHadFailure = true;
        await safeSendMessage(
          platform,
          conversationId,
          `An unexpected error occurred executing a node in layer ${String(layerIdx)}. Check server logs.`,
          { workflowId: workflowRun.id }
        );
      }
    }

    if (layerHadFailure) {
      getLog().warn({ layerIdx, nodeCount: layer.length }, 'dag_layer_had_failures');
    }

    // Check for non-running status between DAG layers (cancellation, deletion, pause)
    try {
      const dagStatus = await deps.store.getWorkflowRunStatus(workflowRun.id);
      if (dagStatus === null || dagStatus !== 'running') {
        const effectiveStatus = dagStatus ?? 'deleted';
        getLog().info(
          {
            workflowRunId: workflowRun.id,
            layerIdx,
            totalLayers: layers.length,
            status: effectiveStatus,
          },
          'dag.stop_detected_between_layers'
        );
        // Paused is intentional (approval gate) — the approval message was already sent
        if (effectiveStatus !== 'paused') {
          await safeSendMessage(
            platform,
            conversationId,
            `⚠️ **Workflow stopped** (${effectiveStatus}): DAG execution stopped after layer ${String(layerIdx + 1)}/${String(layers.length)}`,
            { workflowId: workflowRun.id }
          );
        }
        break;
      }
    } catch (statusErr) {
      // Non-fatal — status check failure should not crash the workflow
      getLog().warn(
        { err: statusErr as Error, workflowRunId: workflowRun.id },
        'dag.status_check_failed'
      );
    }
  }

  // Single-pass: compute node outcome counts and derive success/failure booleans
  const nodeCounts = { completed: 0, failed: 0, skipped: 0, total: workflow.nodes.length };
  for (const o of nodeOutputs.values()) {
    if (o.state === 'completed') nodeCounts.completed++;
    else if (o.state === 'failed') nodeCounts.failed++;
    else if (o.state === 'skipped') nodeCounts.skipped++;
  }
  const anyCompleted = nodeCounts.completed > 0;
  const anyFailed = nodeCounts.failed > 0;

  getLog().info(
    { nodeCount: workflow.nodes.length, anyCompleted, anyFailed },
    'dag_workflow_finished'
  );

  if (!anyCompleted) {
    if (await ctx.runAggregate.skipIfStatusChanged('dag.skip_fail_status_changed')) return;
    const failedNodes: string[] = [];
    for (const [nodeId, o] of nodeOutputs) {
      if (o.state === 'failed') failedNodes.push(nodeId);
    }
    const failMsg =
      failedNodes.length > 0
        ? `DAG workflow '${workflow.name}' failed: node${failedNodes.length > 1 ? 's' : ''} ${failedNodes.join(', ')} failed. ` +
          `${nodeCounts.skipped} downstream node${nodeCounts.skipped !== 1 ? 's were' : ' was'} skipped.`
        : `DAG workflow '${workflow.name}' completed with no successful nodes. ` +
          'Check node conditions, trigger rules, and upstream failures.';
    // Note: nodeCounts not stored for failed runs — failWorkflowRun only stores { error }.
    // Frontend guards with isValidNodeCounts so missing node_counts is safe.
    await ctx.runAggregate.fail(workflow.name, failMsg);
    // DO NOT throw — outer executor.ts catch would duplicate workflow_failed events
    return;
  }

  if (anyFailed) {
    if (await ctx.runAggregate.skipIfStatusChanged('dag.skip_fail_status_changed')) return;
    const failedNodes = [...nodeOutputs.entries()]
      .filter(([, o]) => o.state === 'failed')
      .map(([id, o]) => `'${id}': ${o.state === 'failed' ? o.error : 'unknown'}`)
      .join('; ');
    const failMsg = `DAG workflow '${workflow.name}' completed with failures: ${failedNodes}`;
    await ctx.runAggregate.fail(workflow.name, failMsg);
    // DO NOT throw — outer executor.ts catch would duplicate workflow_failed events
    return;
  }

  // Check if status was changed externally (e.g. cancelled) before marking complete.
  if (await ctx.runAggregate.skipIfStatusChanged('dag.skip_complete_status_changed')) return;

  await ctx.runAggregate.complete(workflow.name, nodeCounts, totalCostUsd, dagStartTime);

  // Return the first terminal node's output (nodes with no dependents) for the parent
  // conversation summary. For the common single-terminal case this is unambiguous; for
  // multi-terminal DAGs the first completed node in definition order is used.
  const allDependencies = new Set(workflow.nodes.flatMap(n => n.depends_on ?? []));
  const terminalOutput = workflow.nodes
    .filter(n => !allDependencies.has(n.id))
    .map(n => nodeOutputs.get(n.id))
    .find(o => o?.state === 'completed' && o.output.trim().length > 0)?.output;

  return terminalOutput;
}
