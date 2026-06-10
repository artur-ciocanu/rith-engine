import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { findRepoRoot } from '@rith/git';

// ─── Marketplace commands ────────────────────────────────────────────────────

interface MarketplaceEntryJson {
  slug: string;
  name: string;
  author: string;
  description: string;
  sourceUrl: string;
  sha: string;
  tags: string[];
  rithVersionCompat: string;
  featured?: boolean;
}

const DEFAULT_MARKETPLACE_URL = 'https://github.com/artur-ciocanu/rith-engine/workflows.json';

async function fetchMarketplace(): Promise<MarketplaceEntryJson[]> {
  const url = process.env.RITH_MARKETPLACE_URL ?? DEFAULT_MARKETPLACE_URL;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (error) {
    const err = error as Error;
    throw new Error(`Cannot reach marketplace at ${url}: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(`Marketplace fetch failed: HTTP ${String(res.status)} from ${url}`);
  }
  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) {
    throw new Error('Unexpected marketplace response format (expected array)');
  }
  for (const item of raw) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as Record<string, unknown>).slug !== 'string' ||
      typeof (item as Record<string, unknown>).sourceUrl !== 'string' ||
      !Array.isArray((item as Record<string, unknown>).tags)
    ) {
      throw new Error('Marketplace response contains invalid entries');
    }
  }
  return raw as MarketplaceEntryJson[];
}

export async function workflowSearchCommand(query?: string, json?: boolean): Promise<void> {
  const entries = await fetchMarketplace();

  const results = query
    ? entries.filter(e => {
        const q = query.toLowerCase();
        return (
          e.name.toLowerCase().includes(q) ||
          e.author.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.tags.some(t => t.toLowerCase().includes(q))
        );
      })
    : entries;

  if (json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log(query ? `No workflows matching "${query}".` : 'Marketplace is empty.');
    console.log('Browse at https://github.com/artur-ciocanu/rith-engine/workflows/');
    return;
  }

  console.log(
    `\nWorkflow Marketplace${query ? ` — results for "${query}"` : ''} (${String(results.length)})\n`
  );
  for (const e of results) {
    const tags = e.tags.join(', ');
    const desc = e.description.length > 80 ? e.description.slice(0, 77) + '...' : e.description;
    console.log(`  ${e.slug}`);
    console.log(`    Name:   ${e.name}`);
    console.log(`    Author: @${e.author}`);
    console.log(`    Tags:   ${tags}`);
    console.log(`    ${desc}`);
    console.log('');
  }
  console.log('Install: rith workflow install <slug>');
}

/** Detect whether a sourceUrl points to a directory (tree URL) or a single file (blob URL). */
function isDirectoryUrl(sourceUrl: string): boolean {
  return sourceUrl.includes('/tree/');
}

/**
 * Validate that a path component from an external source is safe to use in a filesystem path.
 * Rejects names containing path separators, traversal sequences, or non-portable characters.
 */
function isSafePathComponent(name: string): boolean {
  return name !== '.' && name !== '..' && /^[a-zA-Z0-9._-]+$/.test(name);
}

/** Parse owner/repo and path from a GitHub blob or tree URL. */
function parseGitHubUrl(sourceUrl: string): { owner: string; repo: string; path: string } {
  // https://github.com/owner/repo/blob/ref/path or https://github.com/owner/repo/tree/ref/path
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(blob|tree)\/[^/]+\/(.+)$/.exec(
    sourceUrl
  );
  if (!match) {
    throw new Error(`Cannot parse GitHub URL: ${sourceUrl}`);
  }
  return { owner: match[1], repo: match[2], path: match[4] };
}

interface GitHubContentItem {
  name: string;
  type: 'file' | 'dir';
  download_url: string | null;
  path: string;
}

/** Fetch directory listing from GitHub Contents API at a pinned SHA. */
async function fetchGitHubDirectory(
  owner: string,
  repo: string,
  path: string,
  sha: string
): Promise<GitHubContentItem[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${sha}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/vnd.github.v3+json' } });
  } catch (error) {
    const err = error as Error;
    throw new Error(`Cannot reach GitHub API: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(`GitHub API error: HTTP ${String(res.status)} from ${url}`);
  }
  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(`Expected directory listing from ${url}, got a single file`);
  }
  return data as GitHubContentItem[];
}

/** Download a file from raw.githubusercontent.com at a pinned SHA. */
async function downloadRawFile(
  owner: string,
  repo: string,
  filePath: string,
  sha: string
): Promise<string> {
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${filePath}`;
  let res: Response;
  try {
    res = await fetch(rawUrl);
  } catch (error) {
    const err = error as Error;
    throw new Error(`Cannot fetch ${rawUrl}: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(`Source fetch failed: HTTP ${String(res.status)} from ${rawUrl}`);
  }
  return res.text();
}

export async function workflowInstallCommand(
  slug: string,
  cwd: string,
  force?: boolean
): Promise<void> {
  const entries = await fetchMarketplace();
  const entry = entries.find(e => e.slug === slug);

  if (!entry) {
    console.error(`Error: Workflow '${slug}' not found in marketplace.`);
    console.error("Run 'rith workflow search' to browse available workflows.");
    throw new Error(`Workflow '${slug}' not found`);
  }

  if (!entry.sourceUrl.startsWith('https://github.com/')) {
    throw new Error(
      `Untrusted source URL for '${slug}': ${entry.sourceUrl}\nOnly github.com sources are permitted.`
    );
  }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Invalid slug '${slug}': must be lowercase alphanumeric with hyphens only.`);
  }

  const repoRoot = await findRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error('Not in a git repository. Run rith workflow install from within a git repo.');
  }

  const rithDir = join(repoRoot, '.rith');

  if (isDirectoryUrl(entry.sourceUrl)) {
    await installDirectory(entry, slug, rithDir, force);
  } else {
    await installSingleFile(entry, slug, rithDir, force);
  }

  console.log(`Run with: rith workflow run ${slug} "<message>"`);
}

async function installSingleFile(
  entry: MarketplaceEntryJson,
  slug: string,
  rithDir: string,
  force: boolean | undefined
): Promise<void> {
  const { owner, repo, path } = parseGitHubUrl(entry.sourceUrl);
  const content = await downloadRawFile(owner, repo, path, entry.sha);

  if (!content.trim()) {
    throw new Error(`Downloaded YAML is empty for '${slug}'`);
  }

  const workflowsDir = join(rithDir, 'workflows');
  const destPath = join(workflowsDir, `${slug}.yaml`);

  if (existsSync(destPath) && !force) {
    throw new Error(`Workflow '${slug}' already exists at ${destPath}.\nUse --force to overwrite.`);
  }

  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(destPath, content);
  console.log(`Installed '${entry.name}' to ${destPath}`);
}

async function installDirectory(
  entry: MarketplaceEntryJson,
  slug: string,
  rithDir: string,
  force: boolean | undefined
): Promise<void> {
  const { owner, repo, path } = parseGitHubUrl(entry.sourceUrl);
  const items = await fetchGitHubDirectory(owner, repo, path, entry.sha);

  // Identify the main workflow YAML (named <slug>.yaml or the only .yaml in root)
  const yamlFiles = items.filter(f => f.type === 'file' && f.name.endsWith('.yaml'));
  const mainYaml =
    yamlFiles.find(f => f.name === `${slug}.yaml`) ??
    (yamlFiles.length === 1 ? yamlFiles[0] : undefined);

  if (!mainYaml) {
    throw new Error(
      `Cannot identify main workflow YAML in directory. Expected '${slug}.yaml' or a single .yaml file.`
    );
  }

  const workflowsDir = join(rithDir, 'workflows');
  const destWorkflow = join(workflowsDir, `${slug}.yaml`);

  if (existsSync(destWorkflow) && !force) {
    throw new Error(
      `Workflow '${slug}' already exists at ${destWorkflow}.\nUse --force to overwrite.`
    );
  }

  // Install the main workflow YAML
  const mainContent = await downloadRawFile(owner, repo, mainYaml.path, entry.sha);
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(destWorkflow, mainContent);
  console.log(`  Workflow: ${destWorkflow}`);

  // Install supporting files by convention
  const subdirs = items.filter(f => f.type === 'dir');
  let installedCount = 1;

  for (const subdir of subdirs) {
    if (!isSafePathComponent(subdir.name)) {
      console.log(`  Skipped (unsafe directory name): ${subdir.name}`);
      continue;
    }

    const subItems = await fetchGitHubDirectory(owner, repo, subdir.path, entry.sha);
    const files = subItems.filter(f => f.type === 'file');

    let targetDir: string;
    if (subdir.name === 'commands') {
      targetDir = join(rithDir, 'commands');
    } else if (subdir.name === 'scripts') {
      targetDir = join(rithDir, 'scripts');
    } else {
      // Other subdirs (e.g. skills) go under .rith/<dirname>
      targetDir = join(rithDir, subdir.name);
    }

    mkdirSync(targetDir, { recursive: true });

    for (const file of files) {
      if (!isSafePathComponent(file.name)) {
        console.log(`  Skipped (unsafe filename): ${file.name}`);
        continue;
      }
      const destFile = join(targetDir, file.name);
      if (existsSync(destFile) && !force) {
        console.log(`  Skipped (exists): ${destFile}`);
        continue;
      }
      const content = await downloadRawFile(owner, repo, file.path, entry.sha);
      writeFileSync(destFile, content);
      console.log(`  Installed: ${destFile}`);
      installedCount++;
    }
  }

  // Also install any other root-level non-YAML files (e.g. README)
  const otherRootFiles = items.filter(f => f.type === 'file' && !f.name.endsWith('.yaml'));
  for (const file of otherRootFiles) {
    if (!isSafePathComponent(file.name)) {
      console.log(`  Skipped (unsafe filename): ${file.name}`);
      continue;
    }
    const destFile = join(workflowsDir, file.name);
    if (existsSync(destFile) && !force) continue;
    const content = await downloadRawFile(owner, repo, file.path, entry.sha);
    writeFileSync(destFile, content);
    installedCount++;
  }

  console.log(`Installed '${entry.name}' (${String(installedCount)} files)`);
}
