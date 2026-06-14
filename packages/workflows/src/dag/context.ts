/**
 * Context objects for DAG execution.
 *
 * `DagRunContext` holds the per-run constants threaded to every node runner
 * (built once in `executeDagWorkflow`; fields are stable for the whole run).
 * `NodeRunContext` wraps it with the scheduler's per-node decisions (session
 * threading, layer parallelism), so runners receive `(rc, node)` uniformly.
 */
import type { IWorkflowPlatform, WorkflowConfig, WorkflowDeps } from '../deps';
import type {
  EffortLevel,
  NodeOutput,
  SandboxSettings,
  ThinkingConfig,
  WorkflowRun,
} from '../schemas';
import type { PromptContext } from '../executor-shared';
import type { WorkflowRunAggregate } from './run-aggregate';

/** Workflow-level Claude SDK options — per-node overrides take precedence via ?? */
export interface WorkflowLevelOptions {
  effort?: EffortLevel;
  thinking?: ThinkingConfig;
  fallbackModel?: string;
  betas?: string[];
  sandbox?: SandboxSettings;
}

/**
 * Per-run constants threaded to every DAG node runner. Built once in
 * `executeDagWorkflow`; fields are stable for the whole run. The `nodeOutputs`
 * Map reference is stable too — only its contents mutate as nodes complete.
 */
export interface DagRunContext {
  readonly deps: WorkflowDeps;
  readonly platform: IWorkflowPlatform;
  readonly conversationId: string;
  readonly cwd: string;
  readonly workflowRun: WorkflowRun;
  readonly artifactsDir: string;
  readonly logDir: string;
  readonly baseBranch: string;
  readonly promptContext: PromptContext;
  readonly nodeOutputs: Map<string, NodeOutput>;
  readonly config: WorkflowConfig;
  readonly workflowModel: string | undefined;
  readonly workflowLevelOptions: WorkflowLevelOptions;
  readonly issueContext: string | undefined;
  /** Single mutator of the run's lifecycle status (cancel / fail / complete / pause). */
  readonly runAggregate: WorkflowRunAggregate;
}

/**
 * Per-node context: the per-run constants (`run`) plus the scheduler's per-node
 * decisions. Runners that don't thread sessions ignore `resumeSessionId`.
 */
export interface NodeRunContext {
  readonly run: DagRunContext;
  readonly resumeSessionId: string | undefined;
  readonly isParallelLayer: boolean;
}
