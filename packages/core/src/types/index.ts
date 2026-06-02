/**
 * Core type definitions for the Rith Engine workflow platform.
 */

// MessageChunk + TokenUsage are used by IPlatformAdapter below.
import type { MessageChunk, TokenUsage } from '@rith/providers/types';

export interface AttachedFile {
  /** Absolute path on disk where the file was saved by the server */
  path: string;
  name: string;
  mimeType: string;
  size: number;
}


export interface Codebase {
  id: string;
  name: string;
  repository_url: string | null;
  default_cwd: string;
  commands: Record<string, { path: string; description: string }>;
  created_at: Date;
  updated_at: Date;
}


/**
 * Generic platform adapter interface
 * Allows supporting multiple platforms (Telegram, Slack, GitHub, etc.)
 */
export interface MessageMetadata {
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

export interface IPlatformAdapter {
  /**
   * Send a message to the platform
   */
  sendMessage(conversationId: string, message: string, metadata?: MessageMetadata): Promise<void>;

  /**
   * Ensure responses go to a thread, creating one if needed.
   * Returns the thread's conversation ID to use for subsequent messages.
   *
   * @param originalConversationId - The conversation ID from the triggering message
   * @param messageContext - Platform-specific context (e.g., Discord Message, Slack event)
   * @returns Thread conversation ID (may be same as original if already in thread)
   */
  ensureThread(originalConversationId: string, messageContext?: unknown): Promise<string>;

  /**
   * Get the configured streaming mode
   */
  getStreamingMode(): 'stream' | 'batch';

  /**
   * Get the platform type identifier (e.g., 'telegram', 'github', 'slack')
   */
  getPlatformType(): string;

  /**
   * Start the platform adapter (e.g., begin polling, start webhook server)
   */
  start(): Promise<void>;

  /**
   * Stop the platform adapter gracefully
   */
  stop(): void;

  /**
   * Optional: Send a structured event (MessageChunk) to the platform.
   * Only implemented by adapters that can display rich structured data (e.g., Web UI).
   * Other adapters (Telegram, Slack) continue using sendMessage() for formatted text.
   */
  sendStructuredEvent?(conversationId: string, event: MessageChunk): Promise<void>;

  /** Retract previously streamed text (used when workflow routing intercepts) */
  emitRetract?(conversationId: string): Promise<void>;

  /**
   * Optional: Append a small footer summarising cost / token usage / stop reason
   * after a direct-chat assistant turn. Implemented by adapters that surface
   * usage info in-band (e.g. Slack posts an italic context line). No-op for
   * adapters that don't care; orchestrator skips the call when both `cost`
   * and `tokens` are absent.
   */
  sendResultFooter?(
    conversationId: string,
    info: { cost?: number; tokens?: TokenUsage; stopReason?: string }
  ): Promise<void>;
}


// Re-export workflow schema types for config-types.ts compatibility
import type { ModelReasoningEffort, WebSearchMode } from '@rith/workflows/schemas/workflow';
export type { ModelReasoningEffort, WebSearchMode };
import type {
  EffortLevel,
  ThinkingConfig,
  SandboxSettings,
} from '@rith/workflows/schemas/dag-node';
export type { EffortLevel, ThinkingConfig, SandboxSettings };
