/**
 * CLI adapter for stdout output
 * Implements IWorkflowPlatform for workflow execution via command line
 */
import type { IWorkflowPlatform, WorkflowMessageMetadata } from '@rith/workflows/deps';

/** Configuration options for CLIAdapter */
export interface CLIAdapterOptions {
  /** Streaming mode - 'stream' for real-time output, 'batch' for accumulated output */
  streamingMode?: 'stream' | 'batch';
  /** When true, sendMessage writes to stderr instead of stdout (for --json mode). */
  suppressStdout?: boolean;
}

export class CLIAdapter implements IWorkflowPlatform {
  private readonly streamingMode: 'stream' | 'batch';
  private readonly suppressStdout: boolean;

  constructor(options?: CLIAdapterOptions) {
    this.streamingMode = options?.streamingMode ?? 'batch';
    this.suppressStdout = options?.suppressStdout ?? false;
  }

  async sendMessage(
    _conversationId: string,
    message: string,
    _metadata?: WorkflowMessageMetadata
  ): Promise<void> {
    if (this.suppressStdout) {
      console.error(message);
    } else {
      console.log(message);
    }
  }

  getStreamingMode(): 'stream' | 'batch' {
    return this.streamingMode;
  }

  getPlatformType(): string {
    return 'cli';
  }
}
