/**
 * MCP connection-failure classification for DAG nodes.
 *
 * Distinguishes workflow-configured MCP server failures (surface to the user)
 * from user-plugin failures (silent debug log) by parsing the SDK's failure
 * message and intersecting it with the names a node's `mcp:` config declares.
 */
import { readFile } from 'fs/promises';
import { isAbsolute, resolve as resolvePath } from 'path';
import { getLog } from './log';

export const MCP_FAILURE_PREFIX = 'MCP server connection failed: ';

/** A failed MCP server entry parsed from the SDK message. `segment` is the
 *  original substring (e.g. `"telegram (disconnected)"`) so callers can
 *  reconstruct a filtered message without losing the status detail. */
export interface McpFailureEntry {
  name: string;
  segment: string;
}

/**
 * Parse the SDK's "MCP server connection failed: a (status), b (status)"
 * message. Best-effort — malformed or prefix-free messages return `[]`.
 * Entries are ordered and deduped by name; the segment of the first
 * occurrence wins.
 */
export function parseMcpFailureServerNames(message: string): McpFailureEntry[] {
  if (!message.startsWith(MCP_FAILURE_PREFIX)) return [];
  const seen = new Set<string>();
  const entries: McpFailureEntry[] = [];
  for (const raw of message.slice(MCP_FAILURE_PREFIX.length).split(', ')) {
    const segment = raw.trim();
    const name = segment.split(' (')[0]?.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      entries.push({ name, segment });
    }
  }
  return entries;
}

/**
 * Load the set of MCP server names that a node's `mcp:` config file declares.
 *
 * Returns an empty set when no `mcp:` is configured or when the file can't be
 * read/parsed. Used to distinguish workflow-configured failures (surface to
 * user) from user-plugin failures (silent debug log). We intentionally do not
 * validate or env-expand here — the provider owns full loading and will
 * surface its own parse errors via the warning channel if the file is broken.
 *
 * Read failures are debug-logged so a transient I/O error (EMFILE/EBUSY) that
 * leaves us with an empty set — and silently reclassifies a real workflow-MCP
 * failure as plugin noise — is at least observable.
 */
export async function loadConfiguredMcpServerNames(
  nodeMcpPath: string | undefined,
  cwd: string
): Promise<Set<string>> {
  if (!nodeMcpPath) return new Set();
  const fullPath = isAbsolute(nodeMcpPath) ? nodeMcpPath : resolvePath(cwd, nodeMcpPath);
  try {
    const raw = await readFile(fullPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(Object.keys(parsed as Record<string, unknown>));
  } catch (err) {
    getLog().debug({ err, nodeMcpPath, fullPath }, 'dag.mcp_filter_config_read_failed');
    return new Set();
  }
}
