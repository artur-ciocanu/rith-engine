/**
 * AI node runner — executes command and inline-prompt DAG nodes via Pi.
 *
 * Owns the retrying `AiNodeRunner` wrapper, the non-retrying `executeNodeInternal`
 * core (also called directly by the approval runner's on_reject path), per-node
 * model/options resolution, and the transient-error retry policy.
 */
import {
  buildPromptWithContext,
  loadCommandPrompt,
  classifyError,
  detectCreditExhaustion,
  safeSendMessage,
  type SendMessageContext,
} from '../../executor-shared';
import { logNodeStart, logNodeComplete, logNodeError, logAssistant, logTool } from '../../logger';
import { getWorkflowEventEmitter } from '../../event-emitter';
import { formatToolCall } from '../../utils/tool-formatter';
import { withIdleTimeout, STEP_IDLE_TIMEOUT_MS } from '../../utils/idle-timeout';
import type { DagNode, CommandNode, PromptNode } from '../../schemas';
import type { SendQueryOptions, NodeConfig, TokenUsage } from '@rith/pi/types';
import type { WorkflowConfig, WorkflowMessageMetadata } from '../../deps';
import type { DagRunContext, NodeRunContext, WorkflowLevelOptions } from '../context';
import type { NodeRunner, NodeRunResult, NodeExecutionResult } from '../node-runner';
import { getLog } from '../log';
import { substituteNodeOutputRefs } from '../substitution';
import {
  MCP_FAILURE_PREFIX,
  parseMcpFailureServerNames,
  loadConfiguredMcpServerNames,
} from '../mcp';
import { shouldContinueStreamingForStatus } from '../node-shared';

/** Throttle interval for the during-streaming cancel check (reads — no write contention in WAL mode). */
const CANCEL_CHECK_INTERVAL_MS = 10_000;

/** Throttle interval for activity heartbeat writes (only used for stale/zombie detection). */
const ACTIVITY_HEARTBEAT_INTERVAL_MS = 60_000;

/** Default DAG node retry for TRANSIENT errors */
const DEFAULT_NODE_MAX_RETRIES = 2;
const DEFAULT_NODE_RETRY_DELAY_MS = 3000;

/**
 * Get effective retry config for a DAG node.
 */
function getEffectiveNodeRetryConfig(node: DagNode): {
  maxRetries: number;
  delayMs: number;
  onError: 'transient' | 'all';
} {
  if ('retry' in node && node.retry) {
    return {
      maxRetries: node.retry.max_attempts,
      delayMs: node.retry.delay_ms ?? DEFAULT_NODE_RETRY_DELAY_MS,
      onError: node.retry.on_error ?? 'transient',
    };
  }
  return {
    maxRetries: DEFAULT_NODE_MAX_RETRIES,
    delayMs: DEFAULT_NODE_RETRY_DELAY_MS,
    onError: 'transient',
  };
}

/**
 * Check if a NodeOutput failure is transient by delegating to classifyError.
 * FATAL patterns (auth, permission, credits) take priority over TRANSIENT patterns,
 * matching the same precedence rules as classifyError(). This prevents an error
 * message that contains both a FATAL substring and a TRANSIENT substring (e.g.
 * "unauthorized: process exited with code 1") from being silently retried.
 */
function isTransientNodeError(errorMessage: string): boolean {
  return classifyError(new Error(errorMessage)) === 'TRANSIENT';
}

/**
 * Resolve per-node model and build SendQueryOptions.
 * Pi is the sole provider — no provider resolution needed.
 */
export async function resolveNodeModelAndOptions(
  node: DagNode,
  workflowModel: string | undefined,
  config: WorkflowConfig,
  workflowLevelOptions: WorkflowLevelOptions
): Promise<{
  model: string | undefined;
  options: SendQueryOptions | undefined;
}> {
  const providerAssistantConfig = config.pi;
  const model: string | undefined = node.model ?? workflowModel ?? providerAssistantConfig?.model;

  // Surface agents + skills ID collision — user-defined 'dag-node-skills'
  // silently overrides Rith Engine's skills wrapper.
  if (
    node.agents?.['dag-node-skills'] !== undefined &&
    node.skills !== undefined &&
    node.skills.length > 0
  ) {
    getLog().warn({ nodeId: node.id }, 'dag.agents_skills_id_collision');
  }

  // Build universal base options
  const baseOptions: SendQueryOptions = {};
  if (model) baseOptions.model = model;
  if (config.envVars && Object.keys(config.envVars).length > 0) {
    baseOptions.env = config.envVars;
  }
  if (node.systemPrompt !== undefined) baseOptions.systemPrompt = node.systemPrompt;
  if (node.maxBudgetUsd !== undefined) baseOptions.maxBudgetUsd = node.maxBudgetUsd;
  const fb = node.fallbackModel ?? workflowLevelOptions.fallbackModel;
  if (fb) baseOptions.fallbackModel = fb;
  if (node.output_format) {
    baseOptions.outputFormat = { type: 'json_schema', schema: node.output_format };
  }

  // Build raw nodeConfig — provider translates internally
  const nodeConfig: NodeConfig = {
    nodeId: node.id,
    mcp: node.mcp,
    skills: node.skills,
    agents: node.agents,
    allowed_tools: node.allowed_tools,
    denied_tools: node.denied_tools,
    effort: node.effort ?? workflowLevelOptions.effort,
    thinking: node.thinking ?? workflowLevelOptions.thinking,
    sandbox: node.sandbox ?? workflowLevelOptions.sandbox,
    betas: node.betas ?? workflowLevelOptions.betas,
    output_format: node.output_format,
    maxBudgetUsd: node.maxBudgetUsd,
    systemPrompt: node.systemPrompt,
    fallbackModel: fb,
  };

  // Pass assistantConfig from config — provider parses internally
  const assistantConfig = config.pi ?? {};

  const options: SendQueryOptions = {
    ...baseOptions,
    nodeConfig,
    assistantConfig,
  };

  return { model, options };
}

/**
 * Execute a single DAG node. Returns NodeExecutionResult regardless of success/failure.
 * Always accumulates assistant text output (for $node_id.output substitution).
 * Parallel nodes and context: 'fresh' nodes always receive fresh sessions (caller ensures resumeSessionId is undefined).
 */
export async function executeNodeInternal(
  ctx: DagRunContext,
  node: CommandNode | PromptNode,
  nodeOptions: SendQueryOptions | undefined,
  resumeSessionId: string | undefined
): Promise<NodeExecutionResult> {
  const {
    deps,
    platform,
    conversationId,
    cwd,
    workflowRun,
    logDir,
    nodeOutputs,
    configuredCommandFolder,
    promptContext,
  } = ctx;
  const nodeStartTime = Date.now();
  const nodeContext: SendMessageContext = { workflowId: workflowRun.id, nodeName: node.id };

  const configuredMcpNames = await loadConfiguredMcpServerNames(node.mcp, cwd);

  getLog().info({ nodeId: node.id, provider: 'pi' }, 'dag_node_started');
  await logNodeStart(logDir, workflowRun.id, node.id, node.command ?? '<inline>');

  deps.store
    .createWorkflowEvent({
      workflow_run_id: workflowRun.id,
      event_type: 'node_started',
      step_name: node.id,
      data: { command: node.command ?? null, provider: 'pi' },
    })
    .catch((err: Error) => {
      getLog().error(
        { err, workflowRunId: workflowRun.id, eventType: 'node_started' },
        'workflow_event_persist_failed'
      );
    });

  const emitter = getWorkflowEventEmitter();
  emitter.emit({
    type: 'node_started',
    runId: workflowRun.id,
    nodeId: node.id,
    nodeName: node.command ?? node.id,
  });

  // Load prompt
  let rawPrompt: string;
  if (node.command !== undefined) {
    const promptResult = await loadCommandPrompt(deps, cwd, node.command, configuredCommandFolder);
    if (!promptResult.success) {
      const errMsg = promptResult.message;
      getLog().error({ nodeId: node.id, error: errMsg }, 'dag_node_command_load_failed');
      await logNodeError(logDir, workflowRun.id, node.id, errMsg);
      deps.store
        .createWorkflowEvent({
          workflow_run_id: workflowRun.id,
          event_type: 'node_failed',
          step_name: node.id,
          data: { error: errMsg },
        })
        .catch((err: Error) => {
          getLog().error(
            { err, workflowRunId: workflowRun.id, eventType: 'node_failed' },
            'workflow_event_persist_failed'
          );
        });
      emitter.emit({
        type: 'node_failed',
        runId: workflowRun.id,
        nodeId: node.id,
        nodeName: node.command,
        error: errMsg,
      });
      return { state: 'failed', output: '', error: errMsg };
    }
    rawPrompt = promptResult.content;
  } else {
    // node is PromptNode — prompt: string is guaranteed by the discriminated union
    rawPrompt = node.prompt;
  }

  // Standard variable substitution
  let substitutedPrompt: string;
  try {
    substitutedPrompt = buildPromptWithContext(
      promptContext,
      rawPrompt,
      `dag node '${node.id}' prompt`
    );
  } catch (error) {
    const err = error as Error;
    getLog().error({ nodeId: node.id, error: err.message }, 'dag.node_prompt_substitution_failed');
    await safeSendMessage(
      platform,
      conversationId,
      `Node '${node.id}' failed: ${err.message}`,
      nodeContext
    );
    return { state: 'failed', output: '', error: err.message };
  }

  // Substitute upstream node output references
  const finalPrompt = substituteNodeOutputRefs(substitutedPrompt, nodeOutputs);

  const aiClient = deps.getAgent();
  const streamingMode = platform.getStreamingMode();

  let nodeOutputText = ''; // Always accumulate regardless of streaming mode
  let structuredOutput: unknown;
  let newSessionId: string | undefined;
  let nodeTokens: TokenUsage | undefined;
  let nodeCostUsd: number | undefined;
  let nodeStopReason: string | undefined;
  let nodeNumTurns: number | undefined;
  let nodeModelUsage: Record<string, unknown> | undefined;
  const batchMessages: string[] = [];

  // Create per-node abort controller for idle timeout cleanup
  const nodeAbortController = new AbortController();
  // Fork when resuming — leaves the source session untouched so retries are safe.
  const shouldForkSession = resumeSessionId !== undefined;
  const nodeOptionsWithAbort: SendQueryOptions | undefined = {
    ...nodeOptions,
    abortSignal: nodeAbortController.signal,
    ...(shouldForkSession ? { forkSession: true } : {}),
  };
  let nodeIdleTimedOut = false;
  const effectiveIdleTimeout = node.idle_timeout ?? STEP_IDLE_TIMEOUT_MS;
  let lastToolStartedAt: { toolName: string; startedAt: number } | null = null;
  // Throttle timestamps for the during-streaming cancel check and the activity
  // heartbeat. Function-local (not module-level) so concurrent runs in the same
  // process never share throttle state.
  let lastCancelCheckAt = 0;
  let lastActivityUpdateAt = 0;

  try {
    for await (const msg of withIdleTimeout(
      aiClient.sendQuery(finalPrompt, cwd, resumeSessionId, nodeOptionsWithAbort),
      effectiveIdleTimeout,
      () => {
        nodeIdleTimedOut = true;
        getLog().warn(
          { nodeId: node.id, timeoutMs: effectiveIdleTimeout },
          'dag_node_idle_timeout_reached'
        );
        nodeAbortController.abort();
      }
    )) {
      const tickNow = Date.now();

      // Cancel/pause check — read-only, no write contention in WAL mode (every 10s).
      //
      // `paused` is tolerated here: an approval node can transition the run to
      // paused while this concurrent node is mid-stream (same topological layer).
      // The streaming node should be allowed to finish its own output — the
      // paused gate owns workflow progression, not individual node lifecycles.
      // Only truly terminal / unknown states (null, cancelled, failed, completed)
      // abort the in-flight stream.
      if (tickNow - lastCancelCheckAt > CANCEL_CHECK_INTERVAL_MS) {
        lastCancelCheckAt = tickNow;
        try {
          const streamStatus = await deps.store.getWorkflowRunStatus(workflowRun.id);
          if (!shouldContinueStreamingForStatus(streamStatus)) {
            getLog().info(
              { workflowRunId: workflowRun.id, nodeId: node.id, status: streamStatus ?? 'deleted' },
              'dag.stop_detected_during_streaming'
            );
            nodeAbortController.abort();
            break;
          }
        } catch (cancelCheckErr) {
          getLog().warn(
            { err: cancelCheckErr as Error, workflowRunId: workflowRun.id, nodeId: node.id },
            'dag.status_check_failed'
          );
        }
      }

      // Activity heartbeat — write, throttled to every 60s (only for stale/zombie detection)
      if (tickNow - lastActivityUpdateAt > ACTIVITY_HEARTBEAT_INTERVAL_MS) {
        lastActivityUpdateAt = tickNow;
        try {
          await deps.store.updateWorkflowActivity(workflowRun.id);
        } catch (e) {
          getLog().warn(
            { err: e as Error, workflowRunId: workflowRun.id },
            'dag.activity_update_failed'
          );
        }
      }

      if (msg.type === 'assistant' && msg.content) {
        nodeOutputText += msg.content; // ALWAYS capture for $node_id.output
        if (streamingMode === 'stream' || msg.flush) {
          // `flush` chunks (e.g. Pi notify() emitting a plannotator review URL)
          // must reach the user before the node blocks. Drain any queued batch
          // content first so order is preserved.
          if (streamingMode === 'batch' && batchMessages.length > 0) {
            await safeSendMessage(
              platform,
              conversationId,
              batchMessages.join('\n\n'),
              nodeContext
            );
            batchMessages.length = 0;
          }
          await safeSendMessage(platform, conversationId, msg.content, nodeContext);
        } else {
          batchMessages.push(msg.content);
        }
        await logAssistant(logDir, workflowRun.id, msg.content);
      } else if (msg.type === 'tool' && msg.toolName) {
        const now = Date.now();

        // Emit tool_completed for the previous tool (fire-and-forget)
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
              data: {
                tool_name: prevTool.toolName,
                duration_ms: now - prevTool.startedAt,
              },
            })
            .catch((err: Error) => {
              getLog().error(
                { err, workflowRunId: workflowRun.id, eventType: 'tool_completed' },
                'workflow_event_persist_failed'
              );
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

        if (streamingMode === 'stream') {
          const toolMsg = formatToolCall(msg.toolName, msg.toolInput);
          await safeSendMessage(platform, conversationId, toolMsg, nodeContext, {
            category: 'tool_call_formatted',
          } as WorkflowMessageMetadata);

          // Send structured event to adapters that support it (Web UI)
          if (platform.sendStructuredEvent) {
            await platform.sendStructuredEvent(conversationId, msg);
          }
        }
        await logTool(logDir, workflowRun.id, msg.toolName, msg.toolInput ?? {});

        // Persist tool_called event for ALL adapters (fire-and-forget)
        deps.store
          .createWorkflowEvent({
            workflow_run_id: workflowRun.id,
            event_type: 'tool_called',
            step_name: node.id,
            data: {
              tool_name: msg.toolName,
              tool_input: msg.toolInput ?? {},
            },
          })
          .catch((err: Error) => {
            getLog().error(
              { err, workflowRunId: workflowRun.id, eventType: 'tool_called' },
              'workflow_event_persist_failed'
            );
          });
      } else if (msg.type === 'tool_result' && msg.toolName) {
        if (streamingMode === 'stream' && platform.sendStructuredEvent) {
          await platform.sendStructuredEvent(conversationId, msg);
        }
      } else if (msg.type === 'result') {
        // Emit tool_completed for the last tool in the node
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
              getLog().error(
                { err, workflowRunId: workflowRun.id, eventType: 'tool_completed' },
                'workflow_event_persist_failed'
              );
            });
          lastToolStartedAt = null;
        }
        if (msg.sessionId) newSessionId = msg.sessionId;
        if (msg.tokens) nodeTokens = msg.tokens;
        if (msg.cost !== undefined) nodeCostUsd = msg.cost;
        if (msg.stopReason !== undefined) nodeStopReason = msg.stopReason;
        if (msg.numTurns !== undefined) nodeNumTurns = msg.numTurns;
        if (msg.modelUsage) nodeModelUsage = msg.modelUsage;
        if (msg.structuredOutput !== undefined) structuredOutput = msg.structuredOutput;
        // Fail the node if the SDK reports a cost cap exceeded error
        if (msg.isError && msg.errorSubtype === 'error_max_budget_usd') {
          const cap = nodeOptions?.maxBudgetUsd;
          getLog().warn(
            { nodeId: node.id, maxBudgetUsd: cap, durationMs: Date.now() - nodeStartTime },
            'dag.node_budget_cap_exceeded'
          );
          throw new Error(
            `Node '${node.id}' exceeded cost cap${cap !== undefined ? ` of $${cap.toFixed(2)}` : ''}.`
          );
        }
        // Fail loudly on any other SDK error result. Previously we broke out of
        // the stream silently, producing empty/partial output without signaling
        // failure — which let failed iterations masquerade as successes.
        // Exception: errorSubtype === 'success' is the Claude SDK's marker for a
        // clean stop_sequence termination. The Claude provider already filters
        // this out, but the guard here keeps a third-party PiAgent that
        // forwards the SDK pair raw from producing a "SDK returned success"
        // false failure.
        if (msg.isError && msg.errorSubtype !== 'success') {
          const subtype = msg.errorSubtype ?? 'unknown';
          const errorsDetail = msg.errors?.length ? ` — ${msg.errors.join('; ')}` : '';
          getLog().error(
            {
              nodeId: node.id,
              errorSubtype: subtype,
              errors: msg.errors,
              sessionId: msg.sessionId,
              stopReason: msg.stopReason,
              durationMs: Date.now() - nodeStartTime,
            },
            'dag.node_sdk_error_result'
          );
          throw new Error(`Node '${node.id}' failed: SDK returned ${subtype}${errorsDetail}`);
        }
        break; // Result is the "I'm done" signal — don't wait for subprocess to exit
      } else if (msg.type === 'system' && msg.content) {
        // Providers yield system chunks for user-actionable issues (missing env
        // vars, Haiku+MCP, structured output failures, etc.). MCP-failure
        // chunks need filtering: user-level plugin MCPs inherited from
        // `~/.claude/` (e.g. `telegram`) routinely fail to connect inside the
        // headless subprocess and aren't actionable for the workflow author.
        // Other warnings (⚠️) are always actionable and surface verbatim.
        if (msg.content.startsWith(MCP_FAILURE_PREFIX)) {
          const failedEntries = parseMcpFailureServerNames(msg.content);
          const workflowFailures = failedEntries.filter(e => configuredMcpNames.has(e.name));
          const pluginFailures = failedEntries.filter(e => !configuredMcpNames.has(e.name));

          if (workflowFailures.length > 0) {
            const filteredMsg = `${MCP_FAILURE_PREFIX}${workflowFailures.map(e => e.segment).join(', ')}`;
            getLog().warn(
              { nodeId: node.id, systemContent: filteredMsg },
              'dag.provider_warning_forwarded'
            );
            const delivered = await safeSendMessage(
              platform,
              conversationId,
              filteredMsg,
              nodeContext
            );
            if (!delivered) {
              getLog().error(
                { nodeId: node.id, workflowRunId: workflowRun.id },
                'dag.provider_warning_delivery_failed'
              );
            }
          }
          if (pluginFailures.length > 0) {
            getLog().debug(
              { nodeId: node.id, pluginFailures: pluginFailures.map(e => e.name) },
              'dag.mcp_plugin_connection_suppressed'
            );
          }
        } else if (msg.content.startsWith('⚠️')) {
          getLog().warn(
            { nodeId: node.id, systemContent: msg.content },
            'dag.provider_warning_forwarded'
          );
          const delivered = await safeSendMessage(
            platform,
            conversationId,
            msg.content,
            nodeContext
          );
          if (!delivered) {
            getLog().error(
              { nodeId: node.id, workflowRunId: workflowRun.id },
              'dag.provider_warning_delivery_failed'
            );
          }
        } else {
          getLog().debug(
            { nodeId: node.id, systemContent: msg.content },
            'dag.system_message_unhandled'
          );
        }
      }
      // rate_limit chunks: already log.warn'd in claude.ts; not surfaced to SSE per design
    }

    // When output_format is set and the provider returned structured_output,
    // use it instead of the concatenated assistant text (which includes prose).
    // Each provider normalizes its own structured output onto the result chunk —
    // no provider-specific branching here.
    if (nodeOptions?.outputFormat) {
      if (structuredOutput !== undefined) {
        try {
          nodeOutputText =
            typeof structuredOutput === 'string'
              ? structuredOutput
              : JSON.stringify(structuredOutput);
        } catch (serializeErr) {
          const err = serializeErr as Error;
          throw new Error(
            `Node '${node.id}': failed to serialize structured_output to JSON: ${err.message}`
          );
        }
        getLog().debug({ nodeId: node.id, streamingMode }, 'dag.structured_output_override');
      } else {
        // Provider did not populate structuredOutput — warn the user.
        // If the provider detected invalid output, it already yielded a system warning.
        getLog().warn(
          { nodeId: node.id, workflowRunId: workflowRun.id },
          'dag.structured_output_missing'
        );
        await safeSendMessage(
          platform,
          conversationId,
          `Warning: Node '${node.id}' requested output_format but the provider did not return structured output. Downstream conditions may not evaluate correctly.`,
          nodeContext
        );
      }
    }

    // If the node completed via idle timeout, log it
    if (nodeIdleTimedOut) {
      getLog().warn(
        { nodeId: node.id, timeoutMs: effectiveIdleTimeout },
        'dag_node_completed_via_idle_timeout'
      );
      await safeSendMessage(
        platform,
        conversationId,
        `⚠️ Node \`${node.id}\` completed via idle timeout (no output for ${String(effectiveIdleTimeout / 60000)} min). The AI likely finished but the subprocess didn't exit cleanly.`,
        nodeContext
      );
    }

    // If cancelled during streaming (not idle timeout), return as failed with cancel reason
    if (nodeAbortController.signal.aborted && !nodeIdleTimedOut) {
      const duration = Date.now() - nodeStartTime;
      getLog().info(
        { nodeId: node.id, durationMs: duration },
        'dag_node_cancelled_during_streaming'
      );

      deps.store
        .createWorkflowEvent({
          workflow_run_id: workflowRun.id,
          event_type: 'node_failed',
          step_name: node.id,
          data: { error: 'Cancelled by user', duration_ms: duration },
        })
        .catch((err: Error) => {
          getLog().error(
            { err, workflowRunId: workflowRun.id, eventType: 'node_failed' },
            'workflow_event_persist_failed'
          );
        });

      emitter.emit({
        type: 'node_failed',
        runId: workflowRun.id,
        nodeId: node.id,
        nodeName: node.command ?? node.id,
        error: 'Cancelled by user',
      });

      return { state: 'failed', output: nodeOutputText, error: 'Cancelled by user' };
    }

    if (streamingMode === 'batch' && batchMessages.length > 0) {
      const batchContent =
        structuredOutput !== undefined && nodeOptions?.outputFormat
          ? nodeOutputText
          : batchMessages.join('\n\n');
      await safeSendMessage(platform, conversationId, batchContent, nodeContext);
    }

    // Detect credit exhaustion: SDK returns it as assistant text, not a thrown error.
    const creditError = detectCreditExhaustion(nodeOutputText);

    if (creditError) {
      const duration = Date.now() - nodeStartTime;
      getLog().warn({ nodeId: node.id, durationMs: duration }, 'dag.node_credit_exhausted');
      await logNodeError(logDir, workflowRun.id, node.id, creditError);

      deps.store
        .createWorkflowEvent({
          workflow_run_id: workflowRun.id,
          event_type: 'node_failed',
          step_name: node.id,
          data: { error: creditError },
        })
        .catch((err: Error) => {
          getLog().error(
            { err, workflowRunId: workflowRun.id, eventType: 'node_failed' },
            'workflow_event_persist_failed'
          );
        });

      emitter.emit({
        type: 'node_failed',
        runId: workflowRun.id,
        nodeId: node.id,
        nodeName: node.command ?? node.id,
        error: creditError,
      });

      return { state: 'failed', output: nodeOutputText, error: creditError };
    }

    // Empty assistant output is a failure for AI nodes — a provider stream
    // that closed cleanly with zero content typically means a silent
    // rejection or interruption that didn't produce a result.isError chunk.
    // Bash/script/approval nodes don't reach this path; they have their
    // own dispatch and never stream through this loop.
    //
    // Idle-timeout exits are exempt: the timeout warning at line 1017 has
    // already told the user the node "completed via idle timeout"; flipping
    // that to a failure here would directly contradict the on-screen message.
    if (nodeOutputText.trim() === '' && structuredOutput === undefined && !nodeIdleTimedOut) {
      const duration = Date.now() - nodeStartTime;
      const emptyError = `Node '${node.id}' produced no assistant output. The provider stream closed without yielding content — likely a silent provider rejection or stream interruption.`;
      getLog().error({ nodeId: node.id, durationMs: duration }, 'dag.node_empty_output');
      await logNodeError(logDir, workflowRun.id, node.id, emptyError);

      deps.store
        .createWorkflowEvent({
          workflow_run_id: workflowRun.id,
          event_type: 'node_failed',
          step_name: node.id,
          data: { error: emptyError, duration_ms: duration },
        })
        .catch((err: Error) => {
          getLog().error(
            { err, workflowRunId: workflowRun.id, eventType: 'node_failed' },
            'workflow_event_persist_failed'
          );
        });

      emitter.emit({
        type: 'node_failed',
        runId: workflowRun.id,
        nodeId: node.id,
        nodeName: node.command ?? node.id,
        error: emptyError,
      });

      return { state: 'failed', output: '', error: emptyError };
    }

    const duration = Date.now() - nodeStartTime;
    getLog().info({ nodeId: node.id, durationMs: duration }, 'dag_node_completed');
    await logNodeComplete(logDir, workflowRun.id, node.id, node.command ?? '<inline>', {
      durationMs: duration,
      tokens: nodeTokens,
    });

    deps.store
      .createWorkflowEvent({
        workflow_run_id: workflowRun.id,
        event_type: 'node_completed',
        step_name: node.id,
        data: {
          duration_ms: duration,
          node_output: nodeOutputText,
          ...(nodeCostUsd !== undefined ? { cost_usd: nodeCostUsd } : {}),
          ...(nodeStopReason ? { stop_reason: nodeStopReason } : {}),
          ...(nodeNumTurns !== undefined ? { num_turns: nodeNumTurns } : {}),
          ...(nodeModelUsage ? { model_usage: nodeModelUsage } : {}),
        },
      })
      .catch((err: Error) => {
        getLog().error(
          { err, workflowRunId: workflowRun.id, eventType: 'node_completed' },
          'workflow_event_persist_failed'
        );
      });

    emitter.emit({
      type: 'node_completed',
      runId: workflowRun.id,
      nodeId: node.id,
      nodeName: node.command ?? node.id,
      duration,
      ...(nodeCostUsd !== undefined ? { costUsd: nodeCostUsd } : {}),
      ...(nodeStopReason ? { stopReason: nodeStopReason } : {}),
      ...(nodeNumTurns !== undefined ? { numTurns: nodeNumTurns } : {}),
    });

    return {
      state: 'completed',
      output: nodeOutputText,
      sessionId: newSessionId,
      costUsd: nodeCostUsd,
      ...(structuredOutput !== undefined ? { structuredOutput } : {}),
    };
  } catch (error) {
    const err = error as Error;

    // If the abort was triggered by user cancel (not idle timeout), classify as cancel
    if (nodeAbortController.signal.aborted && !nodeIdleTimedOut) {
      getLog().info({ nodeId: node.id }, 'dag_node_cancelled_via_abort');
      return {
        state: 'failed',
        output: nodeOutputText,
        error: 'Cancelled by user',
        costUsd: nodeCostUsd,
      };
    }

    getLog().error({ err, nodeId: node.id }, 'dag_node_failed');
    await logNodeError(logDir, workflowRun.id, node.id, err.message);

    deps.store
      .createWorkflowEvent({
        workflow_run_id: workflowRun.id,
        event_type: 'node_failed',
        step_name: node.id,
        data: { error: err.message },
      })
      .catch((err: Error) => {
        getLog().error(
          { err, workflowRunId: workflowRun.id, eventType: 'node_failed' },
          'workflow_event_persist_failed'
        );
      });

    emitter.emit({
      type: 'node_failed',
      runId: workflowRun.id,
      nodeId: node.id,
      nodeName: node.command ?? node.id,
      error: err.message,
    });

    return { state: 'failed', output: '', error: err.message, costUsd: nodeCostUsd };
  }
}

export class AiNodeRunner implements NodeRunner {
  async run(rc: NodeRunContext, node: DagNode): Promise<NodeRunResult> {
    const ctx = rc.run;
    const aiNode = node as CommandNode | PromptNode;

    // Resolve per-node model/options.
    const { options: nodeOptions } = await resolveNodeModelAndOptions(
      aiNode,
      ctx.workflowModel,
      ctx.config,
      ctx.workflowLevelOptions
    );

    // Execute with retry for transient failures.
    const retryConfig = getEffectiveNodeRetryConfig(aiNode);
    let output: NodeExecutionResult = {
      state: 'failed',
      output: '',
      error: 'Node did not execute',
    };

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      output = await executeNodeInternal(ctx, aiNode, nodeOptions, rc.resumeSessionId);

      if (output.state !== 'failed') break;

      // FATAL errors (auth, permissions, credit balance) are never retried even when on_error:all.
      const isFatal = output.error ? classifyError(new Error(output.error)) === 'FATAL' : false;
      const isTransient = output.error ? isTransientNodeError(output.error) : false;
      const shouldRetry =
        !isFatal &&
        (retryConfig.onError === 'all' || (retryConfig.onError === 'transient' && isTransient));

      if (!shouldRetry || attempt >= retryConfig.maxRetries) break;

      const delayMs = retryConfig.delayMs * Math.pow(2, attempt);
      getLog().warn(
        {
          nodeId: aiNode.id,
          attempt: attempt + 1,
          maxRetries: retryConfig.maxRetries,
          delayMs,
          error: output.error,
        },
        'dag_node_transient_retry'
      );

      const errorKind = isTransient ? 'transient error' : 'error';
      await safeSendMessage(
        ctx.platform,
        ctx.conversationId,
        `⚠️ Node \`${aiNode.id}\` failed with ${errorKind} (attempt ${String(attempt + 1)}/${String(retryConfig.maxRetries + 1)}). Retrying in ${String(Math.round(delayMs / 1000))}s...`,
        { workflowId: ctx.workflowRun.id, nodeName: aiNode.id }
      );

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    return { control: 'continue', output, costUsd: output.costUsd };
  }
}
