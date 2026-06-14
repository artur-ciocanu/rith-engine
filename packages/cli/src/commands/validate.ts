/**
 * CLI commands for `rith validate workflows` and `rith validate scripts`.
 *
 * Thin layer over @rith/workflows validator: discovers, validates, formats output.
 */

import { discoverWorkflowsWithConfig } from '@rith/workflows/workflow-discovery';
import {
  validateWorkflowResources,
  validateScript,
  discoverAvailableScripts,
  findSimilar,
  makeWorkflowResult,
} from '@rith/workflows/validator';
import type {
  ValidationIssue,
  WorkflowValidationResult,
  ScriptValidationResult,
} from '@rith/workflows/validator';
import { loadConfig } from '@rith/core';

// =============================================================================
// Output formatting
// =============================================================================

function formatIssue(issue: ValidationIssue, indent = '    '): string {
  const prefix = issue.level === 'error' ? 'ERROR' : 'WARNING';
  const nodeStr = issue.nodeId ? ` Node '${issue.nodeId}':` : '';
  let line = `${indent}${prefix} [${issue.field}]${nodeStr} ${issue.message}`;
  if (issue.hint) {
    line += `\n${indent}  ${issue.hint}`;
  }
  return line;
}

function formatValidationResult(displayName: string, issues: ValidationIssue[]): string {
  const hasErrors = issues.some(i => i.level === 'error');
  const hasWarnings = issues.some(i => i.level === 'warning');
  const statusLabel = hasErrors ? 'ERRORS' : hasWarnings ? 'WARNINGS' : 'ok';

  let output = `  ${displayName.padEnd(40, ' ')} ${statusLabel}`;
  for (const issue of issues) {
    output += '\n' + formatIssue(issue);
  }
  return output;
}

function formatWorkflowResult(result: WorkflowValidationResult): string {
  return formatValidationResult(result.workflowName, result.issues);
}

// =============================================================================
// Workflow validation command
// =============================================================================

/**
 * Validate all workflows or a specific workflow.
 * Returns exit code: 0 = all valid, 1 = errors found.
 */
export async function validateWorkflowsCommand(
  cwd: string,
  name?: string,
  json?: boolean
): Promise<number> {
  const { workflows: workflowEntries, errors: loadErrors } = await discoverWorkflowsWithConfig(
    cwd,
    loadConfig
  );

  // Build results from load errors (Level 1-2 failures)
  const results: WorkflowValidationResult[] = [];

  for (const loadError of loadErrors) {
    results.push(
      makeWorkflowResult(
        loadError.filename.replace(/\.ya?ml$/, ''),
        [{ level: 'error', field: loadError.errorType, message: loadError.error }],
        loadError.filename
      )
    );
  }

  // Validate successfully parsed workflows (Level 3)
  for (const { workflow } of workflowEntries) {
    const issues = await validateWorkflowResources(workflow, cwd);
    results.push(makeWorkflowResult(workflow.name, issues));
  }

  // Filter to specific workflow if name provided
  let filteredResults = results;
  if (name) {
    filteredResults = results.filter(
      r => r.workflowName === name || r.workflowName.toLowerCase() === name.toLowerCase()
    );

    if (filteredResults.length === 0) {
      const allNames = results.map(r => r.workflowName);
      const similar = findSimilar(name, allNames);
      if (json) {
        console.log(
          JSON.stringify({
            error: `Workflow '${name}' not found`,
            suggestions: similar,
            available: allNames,
          })
        );
      } else {
        console.error(`Workflow '${name}' not found.`);
        if (similar.length > 0) {
          console.error(`Did you mean: ${similar.map(s => `'${s}'`).join(', ')}?`);
        }
        console.error(`Available workflows: ${allNames.join(', ')}`);
      }
      return 1;
    }
  }

  // Sort: errors first, then warnings, then ok
  filteredResults.sort((a, b) => {
    const aErrors = a.issues.filter(i => i.level === 'error').length;
    const bErrors = b.issues.filter(i => i.level === 'error').length;
    if (aErrors !== bErrors) return bErrors - aErrors;
    return a.workflowName.localeCompare(b.workflowName);
  });

  // Output
  const totalErrors = filteredResults.filter(r => !r.valid).length;
  const totalWarnings = filteredResults.filter(r =>
    r.issues.some(i => i.level === 'warning')
  ).length;

  if (json) {
    console.log(
      JSON.stringify({
        results: filteredResults,
        summary: {
          total: filteredResults.length,
          valid: filteredResults.length - totalErrors,
          errors: totalErrors,
          warnings: totalWarnings,
        },
      })
    );
  } else {
    console.log(`\nValidating workflows in ${cwd}\n`);
    for (const result of filteredResults) {
      console.log(formatWorkflowResult(result));
    }
    console.log(
      `\nResults: ${filteredResults.length - totalErrors} valid, ${totalErrors} with errors${totalWarnings > 0 ? `, ${totalWarnings} with warnings` : ''}`
    );
  }

  return totalErrors > 0 ? 1 : 0;
}

// =============================================================================
// Command and script validation command
// =============================================================================

function formatScriptResult(result: ScriptValidationResult): string {
  return formatValidationResult(`[script] ${result.scriptName}`, result.issues);
}

/**
 * Validate all commands or a specific command.
 * Also validates scripts from .rith/scripts/ alongside commands.
 * Returns exit code: 0 = all valid, 1 = errors found.
 */
export async function validateCommandsCommand(
  cwd: string,
  name?: string,
  jsonOutput?: boolean
): Promise<number> {
  // Validate all scripts
  const allScripts = await discoverAvailableScripts(cwd);

  if (name) {
    // Validate a single script by name
    const result = await validateScript(name, cwd);

    if (jsonOutput) {
      console.log(JSON.stringify(result));
    } else {
      const statusLabel = result.valid ? 'ok' : 'ERRORS';
      console.log(`\n  ${result.scriptName.padEnd(40, ' ')} ${statusLabel}`);
      for (const issue of result.issues) {
        console.log(formatIssue(issue));
      }
    }

    return result.valid ? 0 : 1;
  }

  const scriptResults = await Promise.all(allScripts.map(s => validateScript(s.name, cwd)));
  const totalErrors = scriptResults.filter(r => !r.valid).length;

  if (jsonOutput) {
    console.log(
      JSON.stringify({
        scripts: scriptResults,
        summary: {
          total: scriptResults.length,
          valid: scriptResults.length - totalErrors,
          errors: totalErrors,
        },
      })
    );
  } else {
    if (scriptResults.length === 0) {
      console.log('\nNo scripts found.');
      return 0;
    }

    console.log(`\nValidating scripts in ${cwd}\n`);
    for (const result of scriptResults) {
      console.log(formatScriptResult(result));
    }
    console.log(
      `\nResults: ${scriptResults.length - totalErrors} valid, ${totalErrors} with errors`
    );
  }

  return totalErrors > 0 ? 1 : 0;
}
