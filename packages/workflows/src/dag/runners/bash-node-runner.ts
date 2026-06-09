/**
 * Bash node runner — executes a shell script via `bash -c`, capturing stdout as
 * the node output. No AI session is created; bash nodes are free/deterministic.
 */
import { execFileAsync } from '@rith/git';
import {
  substituteWorkflowVariables,
  formatSubprocessFailure,
  safeSendMessage,
  type SendMessageContext,
} from '../../executor-shared';
import { logNodeStart, logNodeComplete, logNodeError } from '../../logger';
import { getWorkflowEventEmitter } from '../../event-emitter';
import type { DagNode, BashNode, NodeOutput } from '../../schemas';
import type { DagRunContext, NodeRunContext } from '../context';
import type { NodeRunner, NodeRunResult } from '../node-runner';
import { getLog } from '../log';
import { substituteNodeOutputRefs } from '../substitution';
import { SUBPROCESS_DEFAULT_TIMEOUT } from '../node-shared';

/**
 * Execute a bash (shell script) DAG node.
 * Runs the script via `bash -c`, captures stdout as node output.
 * No AI session is created — bash nodes are free/deterministic.
 */
export async function executeBashNode(
  ctx: DagRunContext,
  node: BashNode,
  envVars?: Record<string, string>
): Promise<NodeOutput> {
  const {
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
    issueContext,
  } = ctx;
  const nodeStartTime = Date.now();
  const nodeContext: SendMessageContext = { workflowId: workflowRun.id, nodeName: node.id };

  getLog().info({ nodeId: node.id, type: 'bash' }, 'dag_node_started');
  await logNodeStart(logDir, workflowRun.id, node.id, '<bash>');

  deps.store
    .createWorkflowEvent({
      workflow_run_id: workflowRun.id,
      event_type: 'node_started',
      step_name: node.id,
      data: { type: 'bash' },
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
    nodeName: node.id,
  });

  // Variable substitution on script
  const { prompt: substitutedScript } = substituteWorkflowVariables(
    promptContext,
    node.bash,
    undefined,
    undefined,
    undefined,
    { shellSafe: true }
  );
  const finalScript = substituteNodeOutputRefs(substitutedScript, nodeOutputs, true, logDir);

  const timeout = node.timeout ?? SUBPROCESS_DEFAULT_TIMEOUT;
  const subprocessEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ARTIFACTS_DIR: artifactsDir,
    LOG_DIR: logDir,
    BASE_BRANCH: baseBranch,
    USER_MESSAGE: workflowRun.user_message,
    ARGUMENTS: workflowRun.user_message,
    LOOP_USER_INPUT: '',
    LOOP_PREV_OUTPUT: '',
    REJECTION_REASON: '',
    CONTEXT: issueContext ?? '',
    EXTERNAL_CONTEXT: issueContext ?? '',
    ISSUE_CONTEXT: issueContext ?? '',
    ...(envVars ?? {}),
  };

  try {
    const { stdout, stderr } = await execFileAsync('bash', ['-c', finalScript], {
      cwd,
      timeout,
      env: subprocessEnv,
    });

    // Trim trailing newline from stdout (common shell behavior)
    const output = stdout.replace(/\n$/, '');

    if (stderr.trim()) {
      getLog().warn({ nodeId: node.id, stderr: stderr.trim() }, 'bash_node_stderr');
      await safeSendMessage(
        platform,
        conversationId,
        `Bash node '${node.id}' stderr:\n\`\`\`\n${stderr.trim()}\n\`\`\``,
        nodeContext
      );
    }

    const duration = Date.now() - nodeStartTime;
    getLog().info({ nodeId: node.id, durationMs: duration }, 'dag_node_completed');
    await logNodeComplete(logDir, workflowRun.id, node.id, '<bash>', { durationMs: duration });

    deps.store
      .createWorkflowEvent({
        workflow_run_id: workflowRun.id,
        event_type: 'node_completed',
        step_name: node.id,
        data: { duration_ms: duration, type: 'bash', node_output: output },
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
      nodeName: node.id,
      duration,
    });

    return { state: 'completed', output };
  } catch (error) {
    const err = error as Error & { killed?: boolean; code?: number | string; stderr?: string };
    const isTimeout = err.killed === true || (err.message ?? '').includes('timed out');
    const label = `Bash node '${node.id}'`;
    // Always run the formatter so logs get sanitized fields regardless of which
    // user-facing branch we end up in — the timeout message also contains the
    // full `Command failed: bash -c <body>` line and would otherwise leak.
    const formatted = formatSubprocessFailure(err, label);
    let errorMsg: string;
    if (isTimeout) {
      errorMsg = `${label} timed out after ${String(timeout)}ms`;
    } else if (err.message?.includes('ENOENT')) {
      errorMsg = `${label} failed: bash executable not found in PATH`;
    } else if (err.message?.includes('EACCES')) {
      errorMsg = `${label} failed: permission denied (check cwd permissions)`;
    } else {
      errorMsg = formatted.userMessage;
    }

    getLog().error(
      { ...formatted.logFields, nodeId: node.id, nodeType: 'bash', isTimeout },
      'dag_node_failed'
    );
    await logNodeError(logDir, workflowRun.id, node.id, errorMsg);

    deps.store
      .createWorkflowEvent({
        workflow_run_id: workflowRun.id,
        event_type: 'node_failed',
        step_name: node.id,
        data: { error: errorMsg, type: 'bash' },
      })
      .catch((dbErr: Error) => {
        getLog().error(
          { err: dbErr, workflowRunId: workflowRun.id, eventType: 'node_failed' },
          'workflow_event_persist_failed'
        );
      });

    emitter.emit({
      type: 'node_failed',
      runId: workflowRun.id,
      nodeId: node.id,
      nodeName: node.id,
      error: errorMsg,
    });

    return { state: 'failed', output: '', error: errorMsg };
  }
}

export class BashNodeRunner implements NodeRunner {
  async run(rc: NodeRunContext, node: DagNode): Promise<NodeRunResult> {
    const output = await executeBashNode(rc.run, node as BashNode, rc.run.config.envVars);
    return { control: 'continue', output };
  }
}
