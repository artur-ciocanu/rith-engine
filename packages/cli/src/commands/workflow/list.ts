import { loadWorkflows } from './shared';

interface WorkflowJsonEntry {
  name: string;
  description: string;
  model?: string;
  modelReasoningEffort?: string;
  webSearchMode?: string;
}

/**
 * List available workflows in the current directory
 */
export async function workflowListCommand(cwd: string, json?: boolean): Promise<void> {
  const { workflows: workflowEntries, errors } = await loadWorkflows(cwd);

  if (json) {
    const output = {
      workflows: workflowEntries.map(({ workflow: w }) => {
        const entry: WorkflowJsonEntry = {
          name: w.name,
          description: w.description,
        };
        if (w.model !== undefined) entry.model = w.model;
        if (w.modelReasoningEffort !== undefined)
          entry.modelReasoningEffort = w.modelReasoningEffort;
        if (w.webSearchMode !== undefined) entry.webSearchMode = w.webSearchMode;
        return entry;
      }),
      errors: errors.map(e => ({
        filename: e.filename,
        error: e.error,
        errorType: e.errorType,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Discovering workflows in: ${cwd}`);

  if (workflowEntries.length === 0 && errors.length === 0) {
    console.log('\nNo workflows found.');
    console.log('Workflows should be in .rith/workflows/ directory.');
    return;
  }

  if (workflowEntries.length > 0) {
    console.log(`\nFound ${workflowEntries.length} workflow(s):\n`);

    for (const { workflow } of workflowEntries) {
      console.log(`  ${workflow.name}`);
      console.log(`    ${workflow.description}`);
      console.log('');
    }
  }

  if (errors.length > 0) {
    console.log(`\n${errors.length} workflow(s) failed to load:\n`);
    for (const e of errors) {
      console.log(`  ${e.filename}: ${e.error}`);
    }
    console.log('');
  }
}
