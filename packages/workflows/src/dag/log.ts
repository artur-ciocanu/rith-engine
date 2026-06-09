/**
 * Shared logger accessor for DAG execution modules.
 *
 * Per-call (not cached) so test mocks of `createLogger` always intercept. The
 * child logger is a cheap `rootLogger.child`, so per-call cost is negligible.
 * The module name `'workflow.dag-executor'` is shared across every DAG module
 * to keep log output byte-identical to the pre-split executor.
 */
import { createLogger, type Logger } from '@rith/paths';

export function getLog(): Logger {
  return createLogger('workflow.dag-executor');
}
