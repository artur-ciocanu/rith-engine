/**
 * Workflow validation — Level 3 (resource resolution).
 *
 * Levels 1-2 (syntax + structure) are handled by parseWorkflow() in loader.ts.
 * This module adds Level 3: checking that referenced resources actually exist
 * on disk (MCP configs, skill directories, scripts).
 *
 * Lives in @rith/workflows (no @rith/core dependency) so both CLI and
 * REST API can use it.
 */

import { resolve, isAbsolute } from 'path';
import { access, readFile } from 'fs/promises';
import { createLogger } from '@rith/paths';
import { execFileAsync } from '@rith/git';
import { resolveSkillDirectories } from '@rith/pi';

/** Lazy-initialized logger */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('workflow.validator');
  return cachedLog;
}
import { isScriptNode } from './schemas';
import type { WorkflowDefinition } from './schemas';
import type { ScriptRuntime } from './script-discovery';
import { discoverScriptsForCwd } from './script-discovery';
import { isInlineScript } from './executor-shared';

// =============================================================================
// Types
// =============================================================================

/** A single validation issue with actionable hint */
export interface ValidationIssue {
  level: 'error' | 'warning';
  nodeId?: string;
  field: string;
  message: string;
  hint?: string;
  suggestions?: string[];
}

/** Result of validating a single workflow (Level 3) */
export interface WorkflowValidationResult {
  workflowName: string;
  filename?: string;
  valid: boolean;
  issues: ValidationIssue[];
}

/** Create a WorkflowValidationResult with `valid` derived from issues */
export function makeWorkflowResult(
  workflowName: string,
  issues: ValidationIssue[],
  filename?: string
): WorkflowValidationResult {
  return {
    workflowName,
    ...(filename !== undefined && { filename }),
    valid: issues.every(i => i.level !== 'error'),
    issues,
  };
}

// =============================================================================
// Levenshtein distance and fuzzy matching
// =============================================================================

/** Classic Levenshtein distance between two strings */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[m][n];
}

/** Find the closest matches from a list of candidates */
export function findSimilar(name: string, candidates: string[], maxDistance?: number): string[] {
  const threshold = maxDistance ?? Math.max(2, Math.floor(name.length * 0.3));
  const scored = candidates
    .map(c => ({ name: c, distance: levenshtein(name.toLowerCase(), c.toLowerCase()) }))
    .filter(s => s.distance <= threshold && s.distance > 0)
    .sort((a, b) => a.distance - b.distance);
  return scored.slice(0, 3).map(s => s.name);
}

// =============================================================================
// Runtime availability checking
// =============================================================================

/** Installation hints per runtime */
const RUNTIME_INSTALL_HINTS: Record<ScriptRuntime, string> = {
  bun: 'Install bun: https://bun.sh — or run: curl -fsSL https://bun.sh/install | bash',
  uv: 'Install uv: https://docs.astral.sh/uv/getting-started/installation/ — or run: curl -LsSf https://astral.sh/uv/install.sh | sh',
};

const runtimeCache = new Map<string, boolean>();

/** Clear the runtime availability cache (exposed for testing). */
export function clearRuntimeCache(): void {
  runtimeCache.clear();
}

/**
 * Check whether a runtime binary (bun or uv) is available on PATH.
 * Results are memoized per runtime name to avoid repeated subprocess spawns.
 */
export async function checkRuntimeAvailable(runtime: ScriptRuntime): Promise<boolean> {
  const cached = runtimeCache.get(runtime);
  if (cached !== undefined) return cached;
  try {
    await execFileAsync('which', [runtime]);
    runtimeCache.set(runtime, true);
    return true;
  } catch {
    runtimeCache.set(runtime, false);
    return false;
  }
}

/** Check if a file exists */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Workflow resource validation (Level 3)
// =============================================================================

/**
 * Validate a workflow's external resource references (Level 3).
 *
 * Checks that MCP configs, skill directories, and scripts actually exist.
 * Call this AFTER parseWorkflow() has passed (Levels 1-2 are prerequisites).
 */
export async function validateWorkflowResources(
  workflow: WorkflowDefinition,
  cwd: string
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  for (const node of workflow.nodes) {
    // --- MCP nodes: check config file exists and is valid JSON ---
    if ('mcp' in node && typeof node.mcp === 'string') {
      const mcpPath = isAbsolute(node.mcp) ? node.mcp : resolve(cwd, node.mcp);

      if (!(await fileExists(mcpPath))) {
        issues.push({
          level: 'error',
          nodeId: node.id,
          field: 'mcp',
          message: `MCP config file not found: '${node.mcp}'`,
          hint: `Create the file at ${mcpPath} with MCP server definitions (JSON format). Example:\n  {"server-name": {"command": "npx", "args": ["-y", "@package/name"], "env": {}}}`,
        });
      } else {
        // File exists — check it's valid JSON
        try {
          const content = await readFile(mcpPath, 'utf-8');
          const parsed = JSON.parse(content);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            issues.push({
              level: 'error',
              nodeId: node.id,
              field: 'mcp',
              message: `MCP config file '${node.mcp}' must be a JSON object (Record<string, ServerConfig>)`,
              hint: 'The file should contain a JSON object where each key is a server name',
            });
          }
        } catch (e) {
          const err = e as Error;
          issues.push({
            level: 'error',
            nodeId: node.id,
            field: 'mcp',
            message: `MCP config file '${node.mcp}' contains invalid JSON: ${err.message}`,
            hint: 'Fix the JSON syntax in the MCP config file',
          });
        }
      }
    }

    if ('skills' in node && Array.isArray(node.skills)) {
      const { missing } = resolveSkillDirectories(cwd, node.skills as string[]);
      for (const skillName of missing) {
        issues.push({
          level: 'warning',
          nodeId: node.id,
          field: 'skills',
          message: `Skill '${skillName}' not found in any search location (.rith/skills/, .claude/skills/, .agents/skills/)`,
          hint: `Create .rith/skills/${skillName}/SKILL.md or install the skill`,
        });
      }
    }

    // --- Script nodes: check named script file exists + runtime available ---
    if (isScriptNode(node)) {
      const script = node.script;

      // Named script: validate file exists in repo or home scope.
      // Precedence mirrors dag-executor: repo > home. Subfolders up to 1 level deep
      // are searched by discoverScriptsForCwd, matching the workflows/commands convention.
      if (!isInlineScript(script)) {
        const scripts = await discoverScriptsForCwd(cwd);
        const entry = scripts.get(script);
        const scriptExists =
          entry !== undefined &&
          (node.runtime === 'uv' ? entry.runtime === 'uv' : entry.runtime === 'bun');

        if (!scriptExists) {
          issues.push({
            level: 'error',
            nodeId: node.id,
            field: 'script',
            message: `Named script '${script}' not found in .rith/scripts/ or ~/.rith/scripts/`,
            hint: `Create .rith/scripts/${script}.${node.runtime === 'uv' ? 'py' : 'ts'} with your script code (or place at ~/.rith/scripts/ to share across repos)`,
          });
        }
      }

      // Runtime availability: warn if binary not on PATH
      const runtimeAvailable = await checkRuntimeAvailable(node.runtime);
      if (!runtimeAvailable) {
        issues.push({
          level: 'warning',
          nodeId: node.id,
          field: 'runtime',
          message: `Runtime '${node.runtime}' is not available on PATH`,
          hint: RUNTIME_INSTALL_HINTS[node.runtime],
        });
      }

      // Warn when deps is specified with bun (bun auto-installs, deps is a no-op)
      if (node.runtime === 'bun' && node.deps && node.deps.length > 0) {
        issues.push({
          level: 'warning',
          nodeId: node.id,
          field: 'deps',
          message: "'deps' is ignored for bun runtime (bun auto-installs packages at runtime)",
          hint: 'Remove deps or switch to runtime: uv if you need explicit dependency management',
        });
      }
    }
  }

  return issues;
}

// =============================================================================
// Script validation
// =============================================================================

/** Result of validating a single script */
export interface ScriptValidationResult {
  scriptName: string;
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Discover all script names from the repo and home scopes.
 * Returns a list of { name, path, runtime } entries. Repo-scoped scripts
 * silently override same-named home-scoped entries.
 */
export async function discoverAvailableScripts(
  cwd: string
): Promise<{ name: string; path: string; runtime: ScriptRuntime }[]> {
  try {
    const scripts = await discoverScriptsForCwd(cwd);
    return [...scripts.values()].map(s => ({ name: s.name, path: s.path, runtime: s.runtime }));
  } catch (error) {
    const err = error as Error;
    getLog().warn({ err, cwd }, 'script_discovery_failed');
    return [];
  }
}

/**
 * Validate a single named script: file exists and runtime is available.
 */
export async function validateScript(
  scriptName: string,
  cwd: string
): Promise<ScriptValidationResult> {
  const issues: ValidationIssue[] = [];

  // Look up across repo + home scopes (repo wins). discoverScriptsForCwd handles
  // both 1-depth subfolders and the repo/home precedence.
  const scripts = await discoverScriptsForCwd(cwd);
  const entry = scripts.get(scriptName);

  const foundPath = entry?.path ?? null;
  const detectedRuntime = entry?.runtime ?? null;

  if (!foundPath || !detectedRuntime) {
    issues.push({
      level: 'error',
      field: 'file',
      message: `Script '${scriptName}' not found in .rith/scripts/ or ~/.rith/scripts/`,
      hint: `Create .rith/scripts/${scriptName}.ts (bun) or .rith/scripts/${scriptName}.py (uv). Place at ~/.rith/scripts/ to share across repos.`,
    });
    return { scriptName, valid: false, issues };
  }

  // Check runtime availability
  const runtimeAvailable = await checkRuntimeAvailable(detectedRuntime);
  if (!runtimeAvailable) {
    issues.push({
      level: 'warning',
      field: 'runtime',
      message: `Runtime '${detectedRuntime}' is not available on PATH`,
      hint: RUNTIME_INSTALL_HINTS[detectedRuntime],
    });
  }

  return {
    scriptName,
    valid: issues.filter(i => i.level === 'error').length === 0,
    issues,
  };
}
