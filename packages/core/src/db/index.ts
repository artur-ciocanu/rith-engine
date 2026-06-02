/**
 * Database module exports
 */

// Connection management
export { pool, getDatabase, getDialect, closeDatabase, resetDatabase } from './connection';
export type { IDatabase, SqlDialect, QueryResult } from './adapters/types';

// Re-export namespaced for convenience
export * as codebaseDb from './codebases';
export * as isolationEnvDb from './isolation-environments';
export * as workflowDb from './workflows';

// Also export individual functions for direct imports
export * from './codebases';
export * from './isolation-environments';
export * from './workflows';