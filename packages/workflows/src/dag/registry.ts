/**
 * Node runner registry — maps each `NodeKind` to its stateless runner singleton,
 * replacing the former type-switch in `executeDagWorkflow`.
 *
 * Adding a node kind is a localized change: a new `dag/runners/*.ts`, the
 * `NodeKind` union + `nodeKind()` in `dag/node-runner.ts`, and one entry here.
 */
import type { NodeKind, NodeRunner } from './node-runner';
import { AiNodeRunner } from './runners/ai-node-runner';
import { BashNodeRunner } from './runners/bash-node-runner';
import { ScriptNodeRunner } from './runners/script-node-runner';
import { LoopNodeRunner } from './runners/loop-node-runner';
import { ApprovalNodeRunner } from './runners/approval-node-runner';
import { CancelNodeRunner } from './runners/cancel-node-runner';

/** Stateless singletons; add a node kind = one import + one entry here. */
export const nodeRunnerRegistry: Record<NodeKind, NodeRunner> = {
  ai: new AiNodeRunner(),
  bash: new BashNodeRunner(),
  script: new ScriptNodeRunner(),
  loop: new LoopNodeRunner(),
  approval: new ApprovalNodeRunner(),
  cancel: new CancelNodeRunner(),
};
