/**
 * Workflow dependency injection types.
 *
 * Defines narrow interfaces for what the workflow engine needs from external systems.
 * Callers in @rith/core satisfy these structurally — no adapter wrappers needed.
 *
 * Pi agent types are imported directly from @rith/pi/types (contract layer).
 * No more mirror copies — single source of truth for PiAgent, MessageChunk, etc.
 */
import type { IWorkflowStore } from './store';
import type {
  PiAgent,
  MessageChunk,
  TokenUsage,
  SendQueryOptions,
  NodeConfig,
} from '@rith/pi/types';

// Re-export Pi agent types so existing workflow engine consumers don't break
export type { PiAgent, MessageChunk, TokenUsage, SendQueryOptions, NodeConfig };

// Backwards compat alias — deprecated, prefer direct import from @rith/pi/types
export type WorkflowTokenUsage = TokenUsage;

// ---------------------------------------------------------------------------
// Platform-specific types (NOT mirrors — unique to workflow engine)
// ---------------------------------------------------------------------------

export interface WorkflowMessageMetadata {
  category?:
    | 'tool_call_formatted'
    | 'workflow_status'
    | 'workflow_dispatch_status'
    | 'isolation_context'
    | 'workflow_result';
  segment?: 'new' | 'auto';
  workflowDispatch?: { workerConversationId: string; workflowName: string };
  workflowResult?: { workflowName: string; runId: string };
}

// ---------------------------------------------------------------------------
// Platform interface for workflow execution
// ---------------------------------------------------------------------------

export interface IWorkflowPlatform {
  sendMessage(
    conversationId: string,
    message: string,
    metadata?: WorkflowMessageMetadata
  ): Promise<void>;
  getStreamingMode(): 'stream' | 'batch';
  getPlatformType(): string;
  sendStructuredEvent?(conversationId: string, event: MessageChunk): Promise<void>;
  emitRetract?(conversationId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Narrow config interface (subset of MergedConfig)
// ---------------------------------------------------------------------------

export interface WorkflowConfig {
  baseBranch?: string;
  docsPath?: string;
  envVars?: Record<string, string>;
  defaults?: {
    loadDefaultWorkflows?: boolean;
  };
  pi?: {
    model?: string;
    [key: string]: unknown;
  };
  commands?: {
    folder?: string;
  };
}

// ---------------------------------------------------------------------------
// Pi agent factory type
// ---------------------------------------------------------------------------

export type PiAgentFactory = () => PiAgent;

// ---------------------------------------------------------------------------
// WorkflowDeps — the single injection point
// ---------------------------------------------------------------------------

export interface WorkflowDeps {
  store: IWorkflowStore;
  getAgent: PiAgentFactory;
  loadConfig: (cwd: string) => Promise<WorkflowConfig>;
}
