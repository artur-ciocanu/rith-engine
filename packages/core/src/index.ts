/**
 * @rith/core - Shared business logic for Rith Engine
 *
 * This package contains:
 * - AI client adapters (Claude, Codex)
 * - Database operations (SQLite/PostgreSQL)
 * - Orchestration logic
 * - Workflow store adapter (bridges core DB to @rith/workflows IWorkflowStore)
 * - Utility functions
 */

// =============================================================================
// Types
// =============================================================================
export {
  type AttachedFile,
  type Codebase,
  type IPlatformAdapter,
  type MessageMetadata,
} from './types';

// =============================================================================
// Database
// =============================================================================
export {
  pool,
  getDatabase,
  getDialect,
  getDatabaseType,
  closeDatabase,
  resetDatabase,
} from './db/connection';
export type { IDatabase, SqlDialect } from './db/adapters/types';

// Namespaced db modules for explicit access
export * as codebaseDb from './db/codebases';
export * as isolationEnvDb from './db/isolation-environments';
export * as workflowDb from './db/workflows';

// =============================================================================
// Workflows
// =============================================================================

// Store adapter (bridges core DB to @rith/workflows IWorkflowStore)
export { createWorkflowStore } from './workflows/store-adapter';

// Workflow Events DB
export * as workflowEventDb from './db/workflow-events';

// =============================================================================
// Operations (shared business logic for CLI and command-handler)
// =============================================================================
export * as workflowOperations from './operations/workflow-operations';
export * as isolationOperations from './operations/isolation-operations';

// =============================================================================
// Handlers
// =============================================================================
export { cloneRepository, registerRepository, type RegisterResult } from './handlers/clone';

// =============================================================================
// Config
// =============================================================================
export {
  type GlobalConfig,
  type RepoConfig,
  type MergedConfig,
} from './config/config-types';

export {
  readConfigFile,
  loadGlobalConfig,
  loadRepoConfig,
  loadConfig,
  clearConfigCache,
  logConfig,
  updateGlobalConfig,
} from './config/config-loader';

// =============================================================================
// Utils
// =============================================================================

// Conversation lock
export { ConversationLockManager, type LockAcquisitionResult } from './utils/conversation-lock';

// Error formatting
export { classifyAndFormatError } from './utils/error-formatter';
export { toError } from './utils/error';

// Credential sanitization
export { sanitizeCredentials, sanitizeError } from './utils/credential-sanitizer';

// GitHub GraphQL
export { getLinkedIssueNumbers } from './utils/github-graphql';

// Path validation
export { isPathWithinWorkspace, validateAndResolvePath } from './utils/path-validation';

// Port allocation
export { getPort } from './utils/port-allocation';

// Worktree sync
export { syncRithToWorktree } from './utils/worktree-sync';
