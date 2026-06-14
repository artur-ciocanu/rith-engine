import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { levenshtein, findSimilar, validateWorkflowResources } from './validator';
import type { WorkflowDefinition, DagNode } from './schemas';

// =============================================================================
// Test helpers
// =============================================================================

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'validator-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function makeWorkflow(name: string, nodes: DagNode[], provider?: string): WorkflowDefinition {
  return {
    name,
    description: 'test workflow',
    nodes,
    ...(provider && { provider }),
  } as WorkflowDefinition;
}

// =============================================================================
// levenshtein
// =============================================================================

describe('levenshtein', () => {
  test('identical strings → 0', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
  });

  test('single insertion', () => {
    expect(levenshtein('abc', 'abcd')).toBe(1);
  });

  test('single deletion', () => {
    expect(levenshtein('abcd', 'abc')).toBe(1);
  });

  test('single substitution', () => {
    expect(levenshtein('abc', 'axc')).toBe(1);
  });

  test('empty string → length of other', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  test('both empty → 0', () => {
    expect(levenshtein('', '')).toBe(0);
  });

  test('typical typo: "asist" vs "assist"', () => {
    expect(levenshtein('asist', 'assist')).toBe(1);
  });

  test('completely different strings', () => {
    expect(levenshtein('abc', 'xyz')).toBe(3);
  });
});

// =============================================================================
// findSimilar
// =============================================================================

describe('findSimilar', () => {
  test('returns closest candidates within threshold', () => {
    const result = findSimilar('asist', ['assist', 'assign', 'resist', 'totally-different']);
    expect(result).toContain('assist');
    expect(result.length).toBeLessThanOrEqual(3);
  });

  test('excludes exact match (distance = 0)', () => {
    expect(findSimilar('assist', ['assist', 'asist'])).not.toContain('assist');
  });

  test('returns empty array when nothing is close', () => {
    expect(findSimilar('xyz', ['totally-different', 'another-one'])).toEqual([]);
  });

  test('respects explicit maxDistance override', () => {
    const result = findSimilar('a', ['ab', 'abc', 'abcd'], 1);
    expect(result).toEqual(['ab']);
  });

  test('returns at most 3 suggestions', () => {
    const result = findSimilar('test', ['teat', 'tent', 'text', 'best', 'rest']);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  test('is case-insensitive for near-matches', () => {
    const result = findSimilar('ASIST', ['assist']);
    expect(result).toContain('assist');
  });
});

// =============================================================================
// validateWorkflowResources — MCP validation
// =============================================================================

describe('validateWorkflowResources — MCP validation', () => {
  test('error when MCP config file is missing', async () => {
    const workflow = makeWorkflow('test', [
      { id: 'step1', prompt: 'do stuff', mcp: 'missing.json' } as unknown as DagNode,
    ]);
    const issues = await validateWorkflowResources(workflow, tmpDir);
    expect(issues.some(i => i.field === 'mcp' && i.level === 'error')).toBe(true);
  });

  test('error when MCP config has invalid JSON', async () => {
    const mcpPath = join(tmpDir, 'bad.json');
    await writeFile(mcpPath, '{bad json');
    const workflow = makeWorkflow('test', [
      { id: 'step1', prompt: 'do stuff', mcp: mcpPath } as unknown as DagNode,
    ]);
    const issues = await validateWorkflowResources(workflow, tmpDir);
    const mcpErrors = issues.filter(i => i.field === 'mcp' && i.level === 'error');
    expect(mcpErrors).toHaveLength(1);
    expect(mcpErrors[0].message).toContain('invalid JSON');
  });

  test('error when MCP config is an array instead of object', async () => {
    const mcpPath = join(tmpDir, 'array.json');
    await writeFile(mcpPath, '[]');
    const workflow = makeWorkflow('test', [
      { id: 'step1', prompt: 'do stuff', mcp: mcpPath } as unknown as DagNode,
    ]);
    const issues = await validateWorkflowResources(workflow, tmpDir);
    const mcpErrors = issues.filter(i => i.field === 'mcp' && i.level === 'error');
    expect(mcpErrors).toHaveLength(1);
    expect(mcpErrors[0].message).toContain('JSON object');
  });

  test('no error when MCP config is a valid JSON object', async () => {
    const mcpPath = join(tmpDir, 'good.json');
    await writeFile(mcpPath, '{"server": {"command": "npx"}}');
    const workflow = makeWorkflow('test', [
      { id: 'step1', prompt: 'do stuff', mcp: mcpPath } as unknown as DagNode,
    ]);
    const issues = await validateWorkflowResources(workflow, tmpDir);
    const mcpErrors = issues.filter(i => i.field === 'mcp' && i.level === 'error');
    expect(mcpErrors).toHaveLength(0);
  });
});

// =============================================================================
// validateWorkflowResources — script nodes
// =============================================================================

describe('validateWorkflowResources — script nodes', () => {
  test('error when named bun script file does not exist', async () => {
    const workflow = makeWorkflow('test', [
      { id: 'step1', script: 'nonexistent-script', runtime: 'bun' } as unknown as DagNode,
    ]);
    const issues = await validateWorkflowResources(workflow, tmpDir);
    const errors = issues.filter(i => i.level === 'error' && i.field === 'script');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Named script 'nonexistent-script' not found");
    expect(errors[0].nodeId).toBe('step1');
  });

  test('error when named uv script file does not exist', async () => {
    const workflow = makeWorkflow('test', [
      { id: 'step1', script: 'missing-py-script', runtime: 'uv' } as unknown as DagNode,
    ]);
    const issues = await validateWorkflowResources(workflow, tmpDir);
    const errors = issues.filter(i => i.level === 'error' && i.field === 'script');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Named script 'missing-py-script' not found");
    expect(errors[0].hint).toContain('.py');
  });

  test('no error when named bun script file exists', async () => {
    const scriptsDir = join(tmpDir, '.rith', 'scripts');
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(join(scriptsDir, 'my-script.ts'), 'console.log("hi")');
    const workflow = makeWorkflow('test', [
      { id: 'step1', script: 'my-script', runtime: 'bun' } as unknown as DagNode,
    ]);
    const issues = await validateWorkflowResources(workflow, tmpDir);
    const scriptErrors = issues.filter(i => i.level === 'error' && i.field === 'script');
    expect(scriptErrors).toHaveLength(0);
  });

  test('no error for inline bun script (no file lookup needed)', async () => {
    const workflow = makeWorkflow('test', [
      {
        id: 'step1',
        script: 'console.log("inline")',
        runtime: 'bun',
      } as unknown as DagNode,
    ]);
    const issues = await validateWorkflowResources(workflow, tmpDir);
    const scriptErrors = issues.filter(i => i.level === 'error' && i.field === 'script');
    expect(scriptErrors).toHaveLength(0);
  });
});
