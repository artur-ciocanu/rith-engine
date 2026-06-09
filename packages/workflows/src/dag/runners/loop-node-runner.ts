/**
 * Loop node runner — runs a prompt repeatedly until a completion signal or the
 * max-iteration cap. Manages its own AI sessions (independent of the AI node
 * runner): fresh-context iterations get fresh sessions, otherwise the session is
 * threaded between iterations.
 */
import { execFileAsync } from '@rith/git';
import {
  substituteWorkflowVariables,
  stripCompletionTags,
  detectCompletionSignal,
  safeSendMessage,
} from '../../executor-shared';
import { logNodeComplete, logAssistant, logTool } from '../../logger';
import { getWorkflowEventEmitter } from '../../event-emitter';
import { formatToolCall } from '../../utils/tool-formatter';
import { withIdleTimeout, STEP_IDLE_TIMEOUT_MS } from '../../utils/idle-timeout';
import { isApprovalContext, type DagNode, type LoopNode } from '../../schemas';
import type { SendQueryOptions } from '@rith/pi/types';
import type { WorkflowConfig, WorkflowMessageMetadata } from '../../deps';
import type { DagRunContext, NodeRunContext, WorkflowLevelOptions } from '../context';
import type { NodeRunner, NodeRunResult, NodeExecutionResult } from '../node-runner';
import { getLog } from '../log';
import { substituteNodeOutputRefs } from '../substitution';
import { shouldContinueStreamingForStatus, SUBPROCESS_DEFAULT_TIMEOUT } from '../node-shared';

/**
 * Build SendQueryOptions from resolved model and config.
 * Uses the same nodeConfig + assistantConfig pattern as resolveNodeModelAndOptions.
 */
function buildLoopNodeOptions(
  model: string | undefined,
  config: WorkflowConfig,
  workflowLevelOptions?: WorkflowLevelOptions
): SendQueryOptions {
  const options: SendQueryOptions = {};
  if (model) options.model = model;
  if (config.envVars && Object.keys(config.envVars).length > 0) {
    options.env = config.envVars;
  }
  options.assistantConfig = config.pi ?? {};
  // Pass workflow-level options as nodeConfig so providers can apply them
  if (workflowLevelOptions) {
    options.nodeConfig = {
      effort: workflowLevelOptions.effort,
      thinking: workflowLevelOptions.thinking,
      sandbox: workflowLevelOptions.sandbox,
      betas: workflowLevelOptions.betas,
      fallbackModel: workflowLevelOptions.fallbackModel,
    };
  }
  return options;
}

/**
 * Execute a loop node — runs prompt repeatedly until completion signal or max iterations.
 *
 * Key behaviors:
 * - Returns NodeExecutionResult (not void) — DAG executor owns workflow lifecycle
 * - Receives upstream node outputs for $nodeId.output substitution
 * - Does not write current_step_index (DAG tracks per-node completion)
 */
export async function executeLoopNode(
  ctx: DagRunContext,
  node: LoopNode,
  workflowModel: string | undefined
): Promise<NodeExecutionResult> {
  const {
    deps,
    platform,
    conversationId,
    cwd,
    workflowRun,
    logDir,
    promptContext,
    nodeOutputs,
    config,
    workflowLevelOptions,
    issueContext,
  } = ctx;
  const loop = node.loop;
  const msgContext = { workflowId: workflowRun.id, nodeName: node.id };

  // Resolve AI client
  const aiClient = deps.getAgent();

  // Detect interactive loop resume — check if workflowRun.metadata has loop gate state for this node
  const rawApproval = workflowRun.metadata?.approval;
  const loopGateMeta = isApprovalContext(rawApproval) ? rawApproval : undefined;
  const isLoopResume = loopGateMeta?.type === 'interactive_loop' && loopGateMeta.nodeId === node.id;
  const startIteration = isLoopResume ? (loopGateMeta.iteration ?? 0) + 1 : 1;
  let currentSessionId: string | undefined = isLoopResume ? loopGateMeta.sessionId : undefined;
  const loopUserInput = isLoopResume
    ? ((workflowRun.metadata?.loop_user_input as string | undefined) ?? '')
    : '';

  let lastIterationOutput = '';
  let lastIterationStructuredOutput: unknown;
  let loopTotalCostUsd: number | undefined;
  let loopFinalStopReason: string | undefined;
  let loopTotalNumTurns: number | undefined;
  const resolvedOptions = buildLoopNodeOptions(workflowModel, config, workflowLevelOptions);

  // Helper to log event store errors consistently
  const logEventStoreError = (err: Error, iteration: number): void => {
    getLog().error({ err, nodeId: node.id, iteration }, 'loop_node.iteration_event_failed');
  };

  for (let i = startIteration; i <= loop.max_iterations; i++) {
    const iterationStart = Date.now();

    // Check for non-running status between iterations. `paused` is tolerated
    // here for the same reason as the streaming check: a sibling approval
    // node in the same topological layer may pause the run while this loop
    // is between iterations — the loop should continue its own iterations
    // regardless of unrelated pauses elsewhere in the DAG.
    const runStatus = await deps.store.getWorkflowRunStatus(workflowRun.id);
    if (!shouldContinueStreamingForStatus(runStatus)) {
      const effectiveStatus = runStatus ?? 'deleted';
      getLog().info(
        { workflowRunId: workflowRun.id, nodeId: node.id, iteration: i, status: effectiveStatus },
        'loop_node.stop_detected'
      );
      await safeSendMessage(
        platform,
        conversationId,
        `Loop node '${node.id}' stopped at iteration ${String(i)} (${effectiveStatus})`,
        msgContext
      );
      return { state: 'failed', output: '', error: `Workflow ${effectiveStatus}` };
    }

    // Emit iteration started
    getWorkflowEventEmitter().emit({
      type: 'loop_iteration_started',
      runId: workflowRun.id,
      nodeId: node.id,
      iteration: i,
      maxIterations: loop.max_iterations,
    });
    deps.store
      .createWorkflowEvent({
        workflow_run_id: workflowRun.id,
        event_type: 'loop_iteration_started',
        step_name: node.id,
        data: { iteration: i, maxIterations: loop.max_iterations, nodeId: node.id },
      })
      .catch((err: Error) => {
        logEventStoreError(err, i);
      });

    // Session threading
    const needsFreshSession = loop.fresh_context || i === 1;
    const resumeSessionId = needsFreshSession ? undefined : currentSessionId;

    // Stream AI response for this iteration
    let fullOutput = ''; // raw, for signal detection
    let cleanOutput = ''; // stripped, for platform display
    let iterationIdleTimedOut = false;
    const iterationAbortController = new AbortController();

    try {
      // Build prompt — substituteWorkflowVariables throws if $BASE_BRANCH referenced but empty
      // Pass loopUserInput on the first resumed iteration; '' on all others (non-interactive
      // or subsequent iterations) so $LOOP_USER_INPUT substitutes to empty string explicitly.
      // $LOOP_PREV_OUTPUT carries the previous iteration's cleaned output and is empty on
      // the first iteration (no prior output exists). Across an interactive resume, the
      // executor starts a fresh `lastIterationOutput` variable, so the first iteration of
      // the resume also receives an empty $LOOP_PREV_OUTPUT.
      const { prompt: substitutedPrompt } = substituteWorkflowVariables(
        promptContext,
        loop.prompt,
        i === startIteration ? loopUserInput : '',
        undefined, // rejectionReason
        i === startIteration ? '' : lastIterationOutput
      );
      const finalPrompt = substituteNodeOutputRefs(substitutedPrompt, nodeOutputs);

      const iterationOptions: SendQueryOptions | undefined = {
        ...resolvedOptions,
        abortSignal: iterationAbortController.signal,
      };

      const generator = aiClient.sendQuery(finalPrompt, cwd, resumeSessionId, iterationOptions);
      let lastToolStartedAt: { toolName: string; startedAt: number } | null = null;

      const effectiveIdleTimeout = node.idle_timeout ?? STEP_IDLE_TIMEOUT_MS;

      for await (const msg of withIdleTimeout(generator, effectiveIdleTimeout, () => {
        iterationIdleTimedOut = true;
        getLog().warn(
          { nodeId: node.id, iteration: i, timeoutMs: effectiveIdleTimeout },
          'loop_node.idle_timeout_reached'
        );
        iterationAbortController.abort();
      })) {
        if (msg.type === 'assistant') {
          fullOutput += msg.content;
          const cleaned = stripCompletionTags(msg.content, loop.until);
          cleanOutput += cleaned;
          if (platform.getStreamingMode() === 'stream' && cleaned) {
            await safeSendMessage(platform, conversationId, cleaned, msgContext);
          }
          await logAssistant(logDir, workflowRun.id, msg.content);
        } else if (msg.type === 'result') {
          // Emit tool_completed for the last tool in the iteration
          if (lastToolStartedAt) {
            const prevTool = lastToolStartedAt;
            getWorkflowEventEmitter().emit({
              type: 'tool_completed',
              runId: workflowRun.id,
              toolName: prevTool.toolName,
              stepName: node.id,
              durationMs: Date.now() - prevTool.startedAt,
            });
            deps.store
              .createWorkflowEvent({
                workflow_run_id: workflowRun.id,
                event_type: 'tool_completed',
                step_name: node.id,
                data: {
                  tool_name: prevTool.toolName,
                  duration_ms: Date.now() - prevTool.startedAt,
                },
              })
              .catch((err: Error) => {
                logEventStoreError(err, i);
              });
            lastToolStartedAt = null;
          }
          if (msg.sessionId) currentSessionId = msg.sessionId;
          if (msg.cost !== undefined) {
            loopTotalCostUsd = (loopTotalCostUsd ?? 0) + msg.cost;
          }
          if (msg.stopReason !== undefined) loopFinalStopReason = msg.stopReason;
          if (msg.numTurns !== undefined) {
            loopTotalNumTurns = (loopTotalNumTurns ?? 0) + msg.numTurns;
          }
          if (msg.structuredOutput !== undefined) {
            lastIterationStructuredOutput = msg.structuredOutput;
          }
          // Fail the iteration loudly on SDK error results. Previously we broke
          // silently, producing empty output and continuing to the next iteration —
          // which made `error_during_execution` on resumed interactive loops look
          // like a "5-second crash" that kept burning iterations.
          // Exception: errorSubtype === 'success' is the Claude SDK's marker for a
          // clean stop_sequence termination (the SDK sets is_error: true alongside
          // subtype: 'success' to encode "non-default termination, not a failure").
          // The Claude provider already filters this; the guard here defends
          // against a third-party PiAgent that forwards the SDK pair raw.
          if (msg.isError && msg.errorSubtype !== 'success') {
            const subtype = msg.errorSubtype ?? 'unknown';
            const errorsDetail = msg.errors?.length ? ` — ${msg.errors.join('; ')}` : '';
            getLog().error(
              {
                nodeId: node.id,
                iteration: i,
                errorSubtype: subtype,
                errors: msg.errors,
                sessionId: msg.sessionId,
                stopReason: msg.stopReason,
              },
              'loop_node.iteration_sdk_error'
            );
            throw new Error(
              `Loop '${node.id}' iteration ${String(i)} failed: SDK returned ${subtype}${errorsDetail}`
            );
          }
          break; // Result is the "I'm done" signal — don't wait for subprocess to exit
        } else if (msg.type === 'tool' && msg.toolName) {
          const now = Date.now();

          // Emit tool_completed for the previous tool
          if (lastToolStartedAt) {
            const prevTool = lastToolStartedAt;
            getWorkflowEventEmitter().emit({
              type: 'tool_completed',
              runId: workflowRun.id,
              toolName: prevTool.toolName,
              stepName: node.id,
              durationMs: now - prevTool.startedAt,
            });
            deps.store
              .createWorkflowEvent({
                workflow_run_id: workflowRun.id,
                event_type: 'tool_completed',
                step_name: node.id,
                data: { tool_name: prevTool.toolName, duration_ms: now - prevTool.startedAt },
              })
              .catch((err: Error) => {
                logEventStoreError(err, i);
              });
          }
          lastToolStartedAt = { toolName: msg.toolName, startedAt: now };

          // Emit tool_started for the current tool (fire-and-forget)
          getWorkflowEventEmitter().emit({
            type: 'tool_started',
            runId: workflowRun.id,
            toolName: msg.toolName,
            stepName: node.id,
          });

          if (platform.getStreamingMode() === 'stream') {
            const toolMsg = formatToolCall(msg.toolName, msg.toolInput);
            if (toolMsg) {
              await safeSendMessage(platform, conversationId, toolMsg, msgContext, {
                category: 'tool_call_formatted',
              } as WorkflowMessageMetadata);
            }
            if (platform.sendStructuredEvent) {
              await platform.sendStructuredEvent(conversationId, msg);
            }
          }

          const toolInput: Record<string, unknown> = msg.toolInput
            ? Object.fromEntries(
                Object.entries(msg.toolInput).map(([k, v]) =>
                  typeof v === 'string' && v.length > 500 ? [k, v.slice(0, 500) + '...'] : [k, v]
                )
              )
            : {};
          await logTool(logDir, workflowRun.id, msg.toolName, toolInput);

          // Persist tool_called event
          deps.store
            .createWorkflowEvent({
              workflow_run_id: workflowRun.id,
              event_type: 'tool_called',
              step_name: node.id,
              data: { tool_name: msg.toolName, tool_input: toolInput },
            })
            .catch((err: Error) => {
              logEventStoreError(err, i);
            });
        } else if (msg.type === 'tool_result' && platform.sendStructuredEvent) {
          await platform.sendStructuredEvent(conversationId, msg);
        }
        // rate_limit chunks: already log.warn'd in claude.ts; not surfaced to SSE per design
      }
    } catch (error) {
      const err = error as Error;
      const duration = Date.now() - iterationStart;
      getLog().error({ err, nodeId: node.id, iteration: i }, 'loop_node.iteration_failed');
      getWorkflowEventEmitter().emit({
        type: 'loop_iteration_failed',
        runId: workflowRun.id,
        nodeId: node.id,
        iteration: i,
        error: err.message,
      });
      deps.store
        .createWorkflowEvent({
          workflow_run_id: workflowRun.id,
          event_type: 'loop_iteration_failed',
          step_name: node.id,
          data: { iteration: i, error: err.message, duration, nodeId: node.id },
        })
        .catch((evtErr: Error) => {
          logEventStoreError(evtErr, i);
        });
      return {
        state: 'failed',
        output: '',
        error: `Loop iteration ${i} failed: ${err.message}`,
        costUsd: loopTotalCostUsd,
      };
    }

    // Notify on idle timeout
    if (iterationIdleTimedOut) {
      await safeSendMessage(
        platform,
        conversationId,
        `Loop node '${node.id}' iteration ${String(i)} completed via idle timeout (no output for ${String((node.idle_timeout ?? STEP_IDLE_TIMEOUT_MS) / 60000)} min)`,
        msgContext
      );
    }

    // Empty assistant output is an iteration failure for AI loops — same
    // contract as the single-shot AI-node guard in executeNodeInternal. A
    // provider stream that closed cleanly with zero content typically means
    // a silent rejection or interruption; left unchecked, an interactive
    // loop would pause with a blank gate or burn the full max_iterations
    // budget producing nothing. Idle-timeout exits are exempt — the
    // notification above has already told the user the iteration completed
    // via timeout, and flipping that to a failure would contradict it.
    if (!iterationIdleTimedOut && fullOutput.trim() === '') {
      const iterationDuration = Date.now() - iterationStart;
      const emptyError =
        'Loop iteration produced no assistant output. The provider stream closed without yielding content — likely a silent provider rejection or stream interruption.';
      getLog().error(
        { nodeId: node.id, iteration: i, durationMs: iterationDuration },
        'loop_node.iteration_empty_output'
      );
      getWorkflowEventEmitter().emit({
        type: 'loop_iteration_failed',
        runId: workflowRun.id,
        nodeId: node.id,
        iteration: i,
        error: emptyError,
      });
      deps.store
        .createWorkflowEvent({
          workflow_run_id: workflowRun.id,
          event_type: 'loop_iteration_failed',
          step_name: node.id,
          data: {
            iteration: i,
            error: emptyError,
            duration: iterationDuration,
            nodeId: node.id,
          },
        })
        .catch((evtErr: Error) => {
          logEventStoreError(evtErr, i);
        });
      return {
        state: 'failed',
        output: '',
        error: `Loop iteration ${i} failed: ${emptyError}`,
        costUsd: loopTotalCostUsd,
      };
    }

    // Batch mode: send accumulated output
    if (platform.getStreamingMode() === 'batch' && cleanOutput) {
      await safeSendMessage(platform, conversationId, cleanOutput, msgContext);
    }

    const prevIterationOutput = lastIterationOutput;
    lastIterationOutput = cleanOutput || fullOutput;

    // Check LLM completion signal — the AI decides whether the user approved.
    // For interactive loops, the AI emits the signal when the user explicitly approves
    // (e.g., "approved", "looks good"). The prompt instructs the AI on when to emit it.
    const signalDetected = detectCompletionSignal(fullOutput, loop.until);

    // Check deterministic bash condition (if configured)
    let bashComplete = false;
    if (loop.until_bash) {
      try {
        const { prompt: bashPrompt } = substituteWorkflowVariables(
          promptContext,
          loop.until_bash,
          undefined,
          undefined,
          undefined,
          { shellSafe: true }
        );
        const substitutedBash = substituteNodeOutputRefs(
          bashPrompt,
          nodeOutputs,
          true, // escapedForBash
          logDir
        );
        await execFileAsync('bash', ['-c', substitutedBash], {
          cwd,
          timeout: SUBPROCESS_DEFAULT_TIMEOUT,
          env: {
            ...process.env,
            USER_MESSAGE: workflowRun.user_message,
            ARGUMENTS: workflowRun.user_message,
            LOOP_USER_INPUT: i === startIteration ? (loopUserInput ?? '') : '',
            LOOP_PREV_OUTPUT: prevIterationOutput,
            REJECTION_REASON: '',
            CONTEXT: issueContext ?? '',
            EXTERNAL_CONTEXT: issueContext ?? '',
            ISSUE_CONTEXT: issueContext ?? '',
          },
        });
        bashComplete = true; // exit 0 = complete
      } catch (e) {
        const bashErr = e as NodeJS.ErrnoException;
        // ENOENT or other system errors are unexpected — log them
        if (bashErr.code === 'ENOENT') {
          getLog().warn(
            { err: bashErr, nodeId: node.id, iteration: i },
            'loop_node.until_bash_exec_error'
          );
        } else if (bashErr.code !== undefined) {
          // Log non-ENOENT system errors (syntax errors, permission issues, etc.)
          getLog().warn(
            { err: bashErr, nodeId: node.id, iteration: i },
            'loop_node.until_bash_unexpected_error'
          );
        }
        bashComplete = false; // non-zero exit = not complete
      }
    }

    const duration = Date.now() - iterationStart;
    const completionDetected = signalDetected || bashComplete;

    // Emit iteration completed
    getWorkflowEventEmitter().emit({
      type: 'loop_iteration_completed',
      runId: workflowRun.id,
      nodeId: node.id,
      iteration: i,
      duration,
      completionDetected,
    });
    deps.store
      .createWorkflowEvent({
        workflow_run_id: workflowRun.id,
        event_type: 'loop_iteration_completed',
        step_name: node.id,
        data: { iteration: i, duration, completionDetected, nodeId: node.id },
      })
      .catch((err: Error) => {
        logEventStoreError(err, i);
      });

    await logNodeComplete(logDir, workflowRun.id, `${node.id}-iteration-${String(i)}`, node.id, {
      durationMs: duration,
    });

    // Completion signal detected — exit the loop.
    // For interactive loops: only honor the signal when the AI had user input to evaluate
    // (i.e., this is a resume iteration with loopUserInput). On the first iteration of a
    // fresh interactive loop, the user hasn't seen anything yet — always gate first.
    // For non-interactive loops: the AI signals task completion at any point.
    const interactiveFirstRun = loop.interactive && !isLoopResume;
    if (completionDetected && !interactiveFirstRun) {
      await safeSendMessage(
        platform,
        conversationId,
        `Loop node '${node.id}' completed after ${String(i)} iteration${i > 1 ? 's' : ''}`,
        msgContext
      );
      // Write node_completed event so resume logic (getCompletedDagNodeOutputs) knows this
      // node is done. Without this, a resumed DAG would re-enter the loop node.
      deps.store
        .createWorkflowEvent({
          workflow_run_id: workflowRun.id,
          event_type: 'node_completed',
          step_name: node.id,
          data: {
            duration_ms: Date.now() - iterationStart,
            node_output: lastIterationOutput,
            ...(loopTotalCostUsd !== undefined ? { cost_usd: loopTotalCostUsd } : {}),
            ...(loopFinalStopReason ? { stop_reason: loopFinalStopReason } : {}),
            ...(loopTotalNumTurns !== undefined ? { num_turns: loopTotalNumTurns } : {}),
          },
        })
        .catch((err: Error) => {
          getLog().error(
            { err, workflowRunId: workflowRun.id, eventType: 'node_completed' },
            'workflow_event_persist_failed'
          );
        });
      getWorkflowEventEmitter().emit({
        type: 'node_completed',
        runId: workflowRun.id,
        nodeId: node.id,
        nodeName: node.id,
        duration: Date.now() - iterationStart,
        ...(loopTotalCostUsd !== undefined ? { costUsd: loopTotalCostUsd } : {}),
        ...(loopFinalStopReason ? { stopReason: loopFinalStopReason } : {}),
        ...(loopTotalNumTurns !== undefined ? { numTurns: loopTotalNumTurns } : {}),
      });
      return {
        state: 'completed',
        output: lastIterationOutput,
        sessionId: currentSessionId,
        costUsd: loopTotalCostUsd,
        ...(lastIterationStructuredOutput !== undefined
          ? { structuredOutput: lastIterationStructuredOutput }
          : {}),
      };
    }

    // Interactive loop gate — pause after every iteration where the AI did NOT emit the
    // completion signal. The user reviews the AI's output and provides feedback or approval.
    // On approval, the AI will emit the signal in the next iteration, exiting above.
    if (loop.interactive && loop.gate_message) {
      const gateMsg =
        `\u23f8 **Input required** (loop \`${node.id}\`, iteration ${String(i)}): ${loop.gate_message}\n\n` +
        `Run ID: \`${workflowRun.id}\`\n` +
        `Respond: \`/workflow approve ${workflowRun.id} <your feedback>\` | Cancel: \`/workflow reject ${workflowRun.id}\``;
      const gateSent = await safeSendMessage(platform, conversationId, gateMsg, {
        workflowId: workflowRun.id,
        nodeName: node.id,
      });
      if (!gateSent) {
        // Gate message failed to deliver — do not pause; fail the node so the user
        // sees a clear error rather than a silently orphaned paused run.
        getLog().error(
          { nodeId: node.id, workflowRunId: workflowRun.id, iteration: i },
          'loop_node.gate_message_send_failed'
        );
        return {
          state: 'failed',
          output: lastIterationOutput,
          error: `Loop gate message failed to deliver for node '${node.id}' — cannot pause safely`,
        };
      }
      deps.store
        .createWorkflowEvent({
          workflow_run_id: workflowRun.id,
          event_type: 'approval_requested',
          step_name: node.id,
          data: { message: loop.gate_message, iteration: i },
        })
        .catch((err: Error) => {
          logEventStoreError(err, i);
        });
      await ctx.runAggregate.pause({
        nodeId: node.id,
        message: loop.gate_message,
        type: 'interactive_loop',
        iteration: i,
        sessionId: currentSessionId,
      });
      getWorkflowEventEmitter().emit({
        type: 'approval_pending',
        runId: workflowRun.id,
        nodeId: node.id,
        message: loop.gate_message,
      });
      // Return completed — the between-layer status check sees 'paused' and halts cleanly.
      // This mirrors the approval-node pattern, preventing false "DAG nodes failed" warnings
      // in multi-node workflows. Resume correctness relies on the 'paused' DB status, not
      // on the node's output state.
      return { state: 'completed', output: lastIterationOutput, costUsd: loopTotalCostUsd };
    }
  }

  // Max iterations exceeded
  const errorMsg = `Loop node '${node.id}' exceeded max iterations (${String(loop.max_iterations)}) without completion signal '${loop.until}'`;
  getLog().warn(
    { nodeId: node.id, maxIterations: loop.max_iterations, signal: loop.until },
    'loop_node.max_iterations_reached'
  );
  await safeSendMessage(platform, conversationId, errorMsg, msgContext);
  return {
    state: 'failed',
    output: lastIterationOutput,
    error: errorMsg,
    costUsd: loopTotalCostUsd,
  };
}

export class LoopNodeRunner implements NodeRunner {
  async run(rc: NodeRunContext, node: DagNode): Promise<NodeRunResult> {
    const loopNode = node as LoopNode;
    const loopModel = loopNode.model ?? rc.run.workflowModel ?? rc.run.config.pi?.model;
    const output = await executeLoopNode(rc.run, loopNode, loopModel);
    return { control: 'continue', output, costUsd: output.costUsd };
  }
}
