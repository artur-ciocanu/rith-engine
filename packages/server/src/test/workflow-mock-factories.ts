import type { Mock } from 'bun:test';
import { mock } from 'bun:test';
import type { WorkflowLoadResult } from '@rith/workflows/schemas/workflow';
import type { ParseResult } from '@rith/workflows/loader';

/**
 * Register all 4 @rith/workflows mock.module() calls at once.
 * Must be called before importing the module under test.
 */
export function mockAllWorkflowModules(): void {
  mock.module('@rith/workflows/workflow-discovery', makeDiscoverWorkflowsMock);
  mock.module('@rith/workflows/loader', makeLoaderMock);
  mock.module('@rith/workflows/command-validation', makeCommandValidationMock);
  mock.module('@rith/workflows/defaults', makeDefaultsMock);
}

export function makeDiscoverWorkflowsMock(): {
  discoverWorkflowsWithConfig: Mock<() => Promise<WorkflowLoadResult>>;
} {
  return {
    discoverWorkflowsWithConfig: mock(
      async (): Promise<WorkflowLoadResult> => ({ workflows: [], errors: [] })
    ),
  };
}

export function makeLoaderMock(): {
  parseWorkflow: Mock<() => ParseResult>;
} {
  return {
    parseWorkflow: mock(
      (): ParseResult => ({
        workflow: null,
        error: { filename: '', error: 'stub', errorType: 'parse_error' },
      })
    ),
  };
}

/**
 * Stub that always returns true. Tests relying on actual name validation
 * (path traversal, dot-prefix) should use their own inline mock instead.
 */
export function makeCommandValidationMock(): {
  isValidCommandName: Mock<() => boolean>;
} {
  return {
    isValidCommandName: mock(() => true),
  };
}

export function makeDefaultsMock(): {
  BUNDLED_WORKFLOWS: Record<string, string>;
  BUNDLED_COMMANDS: Record<string, string>;
  isBinaryBuild: Mock<() => boolean>;
} {
  return {
    BUNDLED_WORKFLOWS: {},
    BUNDLED_COMMANDS: {},
    isBinaryBuild: mock(() => false),
  };
}
