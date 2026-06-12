import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';

export interface ResolvedSkills {
  /** Absolute paths to resolved skill directories. Each contains a SKILL.md. */
  paths: string[];
  /** Skill names that couldn't be resolved in any search location. */
  missing: string[];
}

/**
 * Skill-discovery search order for a named skill. Rith Engine's own
 * `.rith/skills/` locations are checked first (highest priority), followed
 * by the agentskills.io and Claude convention directories.
 *
 * Order (first match wins per name):
 *   1. `<cwd>/.rith/skills/<name>/`       — project-local, Rith Engine
 *   2. `~/.rith/skills/<name>/`           — user-global, Rith Engine (installed defaults)
 *   3. `<cwd>/.claude/skills/<name>/`     — project-local, Claude convention
 *   4. `~/.claude/skills/<name>/`         — user-global, Claude convention
 *   5. `<cwd>/.agents/skills/<name>/`     — project-local, agentskills.io standard
 *   6. `~/.agents/skills/<name>/`         — user-global, agentskills.io standard
 *
 * Ancestor traversal above cwd is deliberately not done — matches Pi's
 * cwd-bound scope and avoids ambiguity about which repo's skills win when
 * Rith Engine runs out of a subdirectory.
 */
function skillSearchRoots(cwd: string): string[] {
  // Prefer `HOME` env var when set — Bun's os.homedir() bypasses `HOME` and
  // reads from the system uid lookup, which is correct in production but
  // makes tests using staged temp homes impossible.
  const home = process.env.HOME ?? homedir();
  return [
    join(cwd, '.rith', 'skills'),
    join(home, '.rith', 'skills'),
    join(cwd, '.claude', 'skills'),
    join(home, '.claude', 'skills'),
    join(cwd, '.agents', 'skills'),
    join(home, '.agents', 'skills'),
  ];
}

/**
 * Resolve Rith Engine's name-based `skills:` nodeConfig references to absolute
 * directory paths. Each named skill is expected to be a directory containing
 * a `SKILL.md` file — the agentskills.io standard layout.
 *
 * Duplicate names are de-duped; empty/non-string entries are skipped.
 * Unresolved names are returned in `missing` for caller-side warning.
 */
export function resolveSkillDirectories(
  cwd: string,
  skillNames: string[] | undefined
): ResolvedSkills {
  if (!skillNames || skillNames.length === 0) {
    return { paths: [], missing: [] };
  }

  const roots = skillSearchRoots(cwd);
  const paths: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const rawName of skillNames) {
    if (typeof rawName !== 'string') continue;
    const name = rawName.trim();
    if (name.length === 0) continue;
    // Name-only contract: reject path traversal, nested paths, and absolute paths.
    if (isAbsolute(name) || basename(name) !== name || name === '.' || name === '..') {
      missing.push(rawName);
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);

    let found: string | undefined;
    for (const root of roots) {
      const candidate = join(root, name);
      if (existsSync(join(candidate, 'SKILL.md'))) {
        found = candidate;
        break;
      }
    }

    if (found) {
      paths.push(found);
    } else {
      missing.push(rawName);
    }
  }

  return { paths, missing };
}
