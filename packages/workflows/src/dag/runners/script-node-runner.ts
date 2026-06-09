/**
 * Script node runner — executes TypeScript (via bun) or Python (via uv) DAG
 * nodes. Supports inline code snippets and named scripts discovered from
 * .rith/scripts/. stdout is captured and trimmed as the node output; stderr is
 * logged as a warning.
 */
import { execFileAsync } from '@rith/git';
import { discoverScriptsForCwd } from '../../script-discovery';
import {
  substituteWorkflowVariables,
  formatSubprocessFailure,
  safeSendMessage,
  isInlineScript,
  type SendMessageContext,
} from '../../executor-shared';
import { logNodeStart, logNodeComplete, logNodeError } from '../../logger';
import { getWorkflowEventEmitter } from '../../event-emitter';
import type { DagNode, ScriptNode, NodeOutput } from '../../schemas';
import type { DagRunContext, NodeRunContext } from '../context';
import type { NodeRunner, NodeRunResult } from '../node-runner';
import { getLog } from '../log';
import { substituteNodeOutputRefs } from '../substitution';
import { SUBPROCESS_DEFAULT_TIMEOUT } from '../node-shared';

/**
 * Execute a script (TypeScript via bun or Python via uv) DAG node.
 * Supports both inline code snippets and named scripts discovered from .rith/scripts/.
 * stdout is captured and trimmed as the node output; stderr is logged as a warning.
 */
export async function executeScriptNode(
  ctx: DagRunContext,
  node: ScriptNode,
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
    nodeOutputs,
    promptContext,
  } = ctx;
  const nodeStartTime = Date.now();
  const nodeContext: SendMessageContext = { workflowId: workflowRun.id, nodeName: node.id };

  getLog().info({ nodeId: node.id, type: 'script', runtime: node.runtime }, 'dag_node_started');
  await logNodeStart(logDir, workflowRun.id, node.id, '<script>');

  deps.store
    .createWorkflowEvent({
      workflow_run_id: workflowRun.id,
      event_type: 'node_started',
      step_name: node.id,
      data: { type: 'script', runtime: node.runtime },
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

  // Variable substitution on script field
  const { prompt: substitutedScript } = substituteWorkflowVariables(promptContext, node.script);
  const finalScript = substituteNodeOutputRefs(substitutedScript, nodeOutputs, false);

  const timeout = node.timeout ?? SUBPROCESS_DEFAULT_TIMEOUT;
  const subprocessEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ARTIFACTS_DIR: artifactsDir,
    LOG_DIR: logDir,
    BASE_BRANCH: baseBranch,
    ...(envVars ?? {}),
  };

  // Build the command and args based on runtime and inline vs named
  let cmd = '';
  let args: string[] = [];

  const nodeDeps = node.deps ?? [];

  try {
    if (isInlineScript(finalScript)) {
      // Inline code execution
      if (node.runtime === 'bun') {
        cmd = 'bun';
        // --no-env-file prevents Bun from auto-loading .env from the execution
        // cwd (the target repo). Without this, repo .env leaks into the script
        // subprocess despite Rith Engine's parent process cleanup.
        args = ['--no-env-file', '-e', finalScript];
      } else {
        // uv run --with dep1 --with dep2 python -c <code>
        cmd = 'uv';
        const withFlags = nodeDeps.flatMap(dep => ['--with', dep]);
        args = ['run', ...withFlags, 'python', '-c', finalScript];
      }
    } else {
      // Named script — look up across repo and home scopes.
      // Precedence: <cwd>/.rith/scripts/ > ~/.rith/scripts/ (repo wins).
      // Wrap discovery in its own try/catch so a permission error on ~/.rith/scripts/
      // isn't mis-attributed by the outer catch's "permission denied (check cwd
      // permissions)" branch — that branch is for execFileAsync EACCES.
      let scripts: Awaited<ReturnType<typeof discoverScriptsForCwd>>;
      try {
        scripts = await discoverScriptsForCwd(cwd);
      } catch (discoveryErr) {
        const err = discoveryErr as Error;
        const errorMsg = `Script node '${node.id}': failed to discover scripts — ${err.message}`;
        getLog().error({ err, nodeId: node.id, cwd }, 'script_discovery_failed');
        await safeSendMessage(platform, conversationId, errorMsg, nodeContext);
        await logNodeError(logDir, workflowRun.id, node.id, errorMsg);

        emitter.emit({
          type: 'node_failed',
          runId: workflowRun.id,
          nodeId: node.id,
          nodeName: node.id,
          error: errorMsg,
        });
        deps.store
          .createWorkflowEvent({
            workflow_run_id: workflowRun.id,
            event_type: 'node_failed',
            step_name: node.id,
            data: { error: errorMsg, type: 'script' },
          })
          .catch((dbErr: Error) => {
            getLog().error(
              { err: dbErr, workflowRunId: workflowRun.id, eventType: 'node_failed' },
              'workflow_event_persist_failed'
            );
          });

        return { state: 'failed', output: '', error: errorMsg };
      }
      const scriptDef = scripts.get(finalScript);

      if (!scriptDef) {
        const errorMsg = `Script node '${node.id}': named script '${finalScript}' not found in .rith/scripts/ or ~/.rith/scripts/`;
        getLog().error({ nodeId: node.id, scriptName: finalScript }, 'script_not_found');
        await safeSendMessage(platform, conversationId, errorMsg, nodeContext);
        await logNodeError(logDir, workflowRun.id, node.id, errorMsg);

        emitter.emit({
          type: 'node_failed',
          runId: workflowRun.id,
          nodeId: node.id,
          nodeName: node.id,
          error: errorMsg,
        });
        deps.store
          .createWorkflowEvent({
            workflow_run_id: workflowRun.id,
            event_type: 'node_failed',
            step_name: node.id,
            data: { error: errorMsg, type: 'script' },
          })
          .catch((dbErr: Error) => {
            getLog().error(
              { err: dbErr, workflowRunId: workflowRun.id, eventType: 'node_failed' },
              'workflow_event_persist_failed'
            );
          });

        return { state: 'failed', output: '', error: errorMsg };
      }

      // Use scriptDef.runtime (canonical source) instead of re-deriving from extension
      if (scriptDef.runtime === 'uv') {
        cmd = 'uv';
        const withFlags = nodeDeps.flatMap(dep => ['--with', dep]);
        args = ['run', ...withFlags, scriptDef.path];
      } else {
        cmd = 'bun';
        args = ['--no-env-file', 'run', scriptDef.path];
      }
    }

    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd,
      timeout,
      env: subprocessEnv,
    });

    // Trim trailing newline from stdout (common shell behavior)
    const output = stdout.replace(/\n$/, '');

    if (stderr.trim()) {
      getLog().warn({ nodeId: node.id, stderr: stderr.trim() }, 'script_node_stderr');
      await safeSendMessage(
        platform,
        conversationId,
        `Script node '${node.id}' stderr:\n\`\`\`\n${stderr.trim()}\n\`\`\``,
        nodeContext
      );
    }

    const duration = Date.now() - nodeStartTime;
    getLog().info({ nodeId: node.id, durationMs: duration }, 'dag_node_completed');
    await logNodeComplete(logDir, workflowRun.id, node.id, '<script>', { durationMs: duration });

    deps.store
      .createWorkflowEvent({
        workflow_run_id: workflowRun.id,
        event_type: 'node_completed',
        step_name: node.id,
        data: { duration_ms: duration, type: 'script', node_output: output },
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
    const label = `Script node '${node.id}'`;
    // Always run the formatter so logs get sanitized fields regardless of which
    // user-facing branch we end up in — the timeout message also contains the
    // full `Command failed: bun -e <body>` line and would otherwise leak.
    const formatted = formatSubprocessFailure(err, label);
    let errorMsg: string;
    if (isTimeout) {
      errorMsg = `${label} timed out after ${String(timeout)}ms`;
    } else if (err.message?.includes('ENOENT')) {
      errorMsg = `${label} failed: '${cmd}' executable not found in PATH`;
    } else if (err.message?.includes('EACCES')) {
      errorMsg = `${label} failed: permission denied (check cwd permissions)`;
    } else {
      errorMsg = formatted.userMessage;
    }

    getLog().error(
      { ...formatted.logFields, nodeId: node.id, nodeType: 'script', isTimeout },
      'dag_node_failed'
    );
    await logNodeError(logDir, workflowRun.id, node.id, errorMsg);

    deps.store
      .createWorkflowEvent({
        workflow_run_id: workflowRun.id,
        event_type: 'node_failed',
        step_name: node.id,
        data: { error: errorMsg, type: 'script' },
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

export class ScriptNodeRunner implements NodeRunner {
  async run(rc: NodeRunContext, node: DagNode): Promise<NodeRunResult> {
    const output = await executeScriptNode(rc.run, node as ScriptNode, rc.run.config.envVars);
    return { control: 'continue', output };
  }
}
