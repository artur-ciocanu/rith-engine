// Rith Engine path resolution utilities
export {
  expandTilde,
  isDocker,
  getRithHome,
  getRithWorkspacesPath,
  ensureRithWorkspacesPath,
  getRithWorktreesPath,
  getRithConfigPath,
  getRithEnvPath,
  getRepoRithEnvPath,
  getHomeWorkflowsPath,
  getHomeCommandsPath,
  getHomeScriptsPath,
  getLegacyHomeWorkflowsPath,
  getCommandFolderSearchPaths,
  getWorkflowFolderSearchPaths,
  getAppRithBasePath,
  getDefaultCommandsPath,
  getDefaultWorkflowsPath,
  logRithPaths,
  validateAppDefaultsPaths,
  parseOwnerRepo,
  getProjectRoot,
  getProjectSourcePath,
  getProjectWorktreesPath,
  getProjectArtifactsPath,
  getProjectLogsPath,
  getRunArtifactsPath,
  getRunLogPath,
  resolveProjectRootFromCwd,
  ensureProjectStructure,
  createProjectSourceSymlink,
  findMarkdownFilesRecursive,
  getWebDistDir,
} from './rith-paths';

// Env loader
export { loadRithEnv, isVerboseBoot } from './env-loader';

// Logger
export { createLogger, setLogLevel, getLogLevel, rootLogger } from './logger';
export type { Logger } from './logger';

// Build-time constants (rewritten by scripts/build-binaries.sh)
export { BUNDLED_IS_BINARY, BUNDLED_VERSION, BUNDLED_GIT_COMMIT } from './bundled-build';

// Update check
export {
  checkForUpdate,
  getCachedUpdateCheck,
  isNewerVersion,
  parseLatestRelease,
} from './update-check';
export type { UpdateCheckResult } from './update-check';

// Anonymous telemetry
export { captureWorkflowInvoked, shutdownTelemetry, isTelemetryDisabled } from './telemetry';
export type { WorkflowInvokedProperties } from './telemetry';
