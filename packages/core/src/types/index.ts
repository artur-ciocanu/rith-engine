/**
 * Core type definitions for the Rith Engine workflow platform.
 */
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

// Re-export workflow schema types for config-types.ts compatibility
import type { ModelReasoningEffort, WebSearchMode } from '@rith/workflows/schemas/workflow';
export type { ModelReasoningEffort, WebSearchMode };
import type {
  EffortLevel,
  ThinkingConfig,
  SandboxSettings,
} from '@rith/workflows/schemas/dag-node';
export type { EffortLevel, ThinkingConfig, SandboxSettings };
