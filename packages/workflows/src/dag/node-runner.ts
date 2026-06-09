/**
 * Node runner strategy contract + node-kind dispatch.
 *
 * Each DAG node kind has exactly one `NodeRunner`. A registry maps `NodeKind` ->
 * `NodeRunner`, replacing the former type-switch in `executeDagWorkflow`. A runner
 * returns a `NodeRunResult`: the node's `NodeOutput` plus a control signal telling
 * the scheduler how to proceed.
 *
 * Migration note: until cancel/approval are promoted to real control signals (a
 * later step), every runner returns `control: 'continue'` and the cancel/pause
 * transitions still happen via the between-layer DB status re-read.
 */
import type { ApprovalContext, DagNode, NodeOutput } from '../schemas';
import { isApprovalNode, isBashNode, isCancelNode, isLoopNode, isScriptNode } from '../schemas';
import type { NodeRunContext } from './context';

/** Discriminator for runner selection. `ai` covers command + inline-prompt nodes. */
export type NodeKind = 'ai' | 'bash' | 'script' | 'loop' | 'approval' | 'cancel';

/** Map a DAG node to its runner kind via the existing type guards. */
export function nodeKind(node: DagNode): NodeKind {
  if (isBashNode(node)) return 'bash';
  if (isScriptNode(node)) return 'script';
  if (isLoopNode(node)) return 'loop';
  if (isApprovalNode(node)) return 'approval';
  if (isCancelNode(node)) return 'cancel';
  return 'ai';
}

/**
 * What a runner produces: the node's output plus a control signal.
 * - `continue` — normal flow; `output.state` may be completed | failed | skipped.
 *   `costUsd` carries the run cost the scheduler aggregates (AI/loop nodes only).
 * - `cancel` — the run should be cancelled with `reason`.
 * - `pause` — the run should pause at an approval gate carrying `approval`.
 */
export type NodeRunResult =
  | { control: 'continue'; output: NodeOutput; costUsd?: number }
  | { control: 'cancel'; reason: string; output: NodeOutput }
  | { control: 'pause'; approval: ApprovalContext; output: NodeOutput };

/** A node's `NodeOutput` plus the run cost the scheduler aggregates (AI/loop nodes only). */
export type NodeExecutionResult = NodeOutput & { costUsd?: number };

/** Strategy for executing one DAG node. Stateless; per-run state arrives via `rc`. */
export interface NodeRunner {
  run(rc: NodeRunContext, node: DagNode): Promise<NodeRunResult>;
}
