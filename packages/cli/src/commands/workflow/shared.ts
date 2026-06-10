/**
 * Shared utilities used across workflow command files.
 */
import { createLogger, type Logger } from '@rith/paths';
import { discoverWorkflowsWithConfig } from '@rith/workflows/workflow-discovery';
import { loadConfig } from '@rith/core';
import type { WorkflowLoadResult } from '@rith/workflows/schemas/workflow';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: Logger | undefined;
export function getLog(): Logger {
  if (!cachedLog) cachedLog = createLogger('cli.workflow');
  return cachedLog;
}

export function extractStaleWorkspaceEntry(message: string): string | null {
  const prefix = 'Source symlink at ';
  const delimiter = ' already points to ';
  if (!message.startsWith(prefix)) return null;

  const remainder = message.slice(prefix.length);
  const delimiterIndex = remainder.indexOf(delimiter);
  if (delimiterIndex === -1) return null;

  const sourcePath = remainder.slice(0, delimiterIndex).trim();
  const lastSeparator = Math.max(sourcePath.lastIndexOf('/'), sourcePath.lastIndexOf('\\'));
  return lastSeparator === -1 ? null : sourcePath.slice(0, lastSeparator);
}

export async function loadWorkflows(cwd: string): Promise<WorkflowLoadResult> {
  try {
    // Home-scoped workflows at ~/.rith/workflows/ are discovered automatically —
    // no option needed since the discovery helper reads them unconditionally.
    return await discoverWorkflowsWithConfig(cwd, loadConfig);
  } catch (error) {
    const err = error as Error;
    throw new Error(
      `Error loading workflows: ${err.message}\nHint: Check permissions on .rith/workflows/ directory.`
    );
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 100) / 10;
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = Math.round(secs % 60);
  return `${mins}m${remSecs}s`;
}
