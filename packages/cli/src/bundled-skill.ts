/**
 * Bundled Rith Engine skill files for binary distribution
 *
 * These static imports are resolved at compile time and embedded into the binary.
 * When running as a standalone binary (without Bun), these provide the skill files
 * without needing filesystem access to the source repo.
 *
 * Import syntax uses `with { type: 'text' }` to import file contents as strings.
 */

// =============================================================================
// Skill Files (21 total)
// =============================================================================

import skillMd from '../../../.claude/skills/rith/SKILL.md' with { type: 'text' };
import commandTemplate from '../../../.claude/skills/rith/examples/command-template.md' with { type: 'text' };
import dagWorkflow from '../../../.claude/skills/rith/examples/dag-workflow.yaml' with { type: 'text' };
import cliGuide from '../../../.claude/skills/rith/guides/cli.md' with { type: 'text' };
import configGuide from '../../../.claude/skills/rith/guides/config.md' with { type: 'text' };
import discordGuide from '../../../.claude/skills/rith/guides/discord.md' with { type: 'text' };
import githubGuide from '../../../.claude/skills/rith/guides/github.md' with { type: 'text' };
import serverGuide from '../../../.claude/skills/rith/guides/server.md' with { type: 'text' };
import setupGuide from '../../../.claude/skills/rith/guides/setup.md' with { type: 'text' };
import slackGuide from '../../../.claude/skills/rith/guides/slack.md' with { type: 'text' };
import telegramGuide from '../../../.claude/skills/rith/guides/telegram.md' with { type: 'text' };
import authoringCommands from '../../../.claude/skills/rith/references/authoring-commands.md' with { type: 'text' };
import cliCommands from '../../../.claude/skills/rith/references/cli-commands.md' with { type: 'text' };
import dagAdvanced from '../../../.claude/skills/rith/references/dag-advanced.md' with { type: 'text' };
import goodPractices from '../../../.claude/skills/rith/references/good-practices.md' with { type: 'text' };
import interactiveWorkflows from '../../../.claude/skills/rith/references/interactive-workflows.md' with { type: 'text' };
import parameterMatrix from '../../../.claude/skills/rith/references/parameter-matrix.md' with { type: 'text' };
import repoInit from '../../../.claude/skills/rith/references/repo-init.md' with { type: 'text' };
import troubleshooting from '../../../.claude/skills/rith/references/troubleshooting.md' with { type: 'text' };
import variables from '../../../.claude/skills/rith/references/variables.md' with { type: 'text' };
import workflowDag from '../../../.claude/skills/rith/references/workflow-dag.md' with { type: 'text' };

// =============================================================================
// Export
// =============================================================================

/**
 * Bundled skill files - relative path within .claude/skills/rith/ -> content
 */
export const BUNDLED_SKILL_FILES: Record<string, string> = {
  'SKILL.md': skillMd,
  'examples/command-template.md': commandTemplate,
  'examples/dag-workflow.yaml': dagWorkflow,
  'guides/cli.md': cliGuide,
  'guides/config.md': configGuide,
  'guides/discord.md': discordGuide,
  'guides/github.md': githubGuide,
  'guides/server.md': serverGuide,
  'guides/setup.md': setupGuide,
  'guides/slack.md': slackGuide,
  'guides/telegram.md': telegramGuide,
  'references/authoring-commands.md': authoringCommands,
  'references/cli-commands.md': cliCommands,
  'references/dag-advanced.md': dagAdvanced,
  'references/good-practices.md': goodPractices,
  'references/interactive-workflows.md': interactiveWorkflows,
  'references/parameter-matrix.md': parameterMatrix,
  'references/repo-init.md': repoInit,
  'references/troubleshooting.md': troubleshooting,
  'references/variables.md': variables,
  'references/workflow-dag.md': workflowDag,
};
