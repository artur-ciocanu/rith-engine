/**
 * Workflow dependency injection types.
 *
 * Defines narrow interfaces for what the workflow engine needs from external systems.
 * Callers in @rith/core satisfy these structurally — no adapter wrappers needed.
 *
 * Provider types are imported directly from @rith/providers/types (contract layer).
 * No more mirror copies — single source of truth for IAgentProvider, MessageChunk, etc.
 */
import type { IWorkflowStore } from './store';
import type {
  IAgentProvider,
  MessageChunk,
  TokenUsage,
  SendQueryOptions,
  NodeConfig,
  ProviderDefaultsMap,
  ProviderCapabilities,
} from '@rith/providers/types';

// Re-export provider types so existing workflow engine consumers don't break
export type {
  IAgentProvider,
  MessageChunk,
  TokenUsage,
  SendQueryOptions,
  NodeConfig,
  ProviderDefaultsMap,
  ProviderCapabilities,
};

// Backwards compat alias — deprecated, prefer direct import from @rith/providers/types
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
  /** Default assistant provider */
  assistant: string;
  baseBranch?: string;
  docsPath?: string;
  envVars?: Record<string, string>;
  commands: { folder?: string };
  defaults?: {
    loadDefaultWorkflows?: boolean;
    loadDefaultCommands?: boolean;
  };
  assistants: ProviderDefaultsMap & {
    pi: {
      model?: string;
      [key: string]: unknown;
    };
  };
}

// ---------------------------------------------------------------------------
// Agent provider factory type
// ---------------------------------------------------------------------------

export type AgentProviderFactory = () => IAgentProvider;

// ---------------------------------------------------------------------------
// WorkflowDeps — the single injection point
// ---------------------------------------------------------------------------

export interface WorkflowDeps {
  store: IWorkflowStore;
  getAgentProvider: AgentProviderFactory;
  loadConfig: (cwd: string) => Promise<WorkflowConfig>;
}
