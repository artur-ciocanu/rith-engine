import { describe, test, expect, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { SqliteAdapter } from './sqlite';
import { unlinkSync } from 'fs';
import { join } from 'path';

let currentDbPath = '';

function createTestDb(): SqliteAdapter {
  currentDbPath = join(
    import.meta.dir,
    `.test-sqlite-adapter-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  return new SqliteAdapter(currentDbPath);
}

/** Insert a parent codebase row to satisfy FK constraints */
async function insertCodebase(db: SqliteAdapter, id: string): Promise<void> {
  await db.query(`INSERT INTO codebases (id, name, default_cwd) VALUES ($1, $2, $3)`, [
    id,
    `test-codebase-${id}`,
    '/tmp/test-cwd',
  ]);
}

describe('SqliteAdapter', () => {
  let db: SqliteAdapter;

  afterEach(async () => {
    if (db) {
      await db.close();
    }
    try {
      unlinkSync(currentDbPath);
    } catch {
      /* may not exist */
    }
    try {
      unlinkSync(currentDbPath + '-wal');
    } catch {
      /* may not exist */
    }
    try {
      unlinkSync(currentDbPath + '-shm');
    } catch {
      /* may not exist */
    }
  });

  describe('INSERT with RETURNING', () => {
    test('returns inserted row via native RETURNING', async () => {
      db = createTestDb();
      await insertCodebase(db, 'cb-1');

      const result = await db.query<{ id: string; status: string }>(
        `INSERT INTO isolation_environments
         (id, codebase_id, workflow_type, workflow_id, provider, working_path, branch_name, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        ['test-id', 'cb-1', 'issue', '1', 'worktree', '/tmp/test', 'issue-1', 'active']
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBe('test-id');
      expect(result.rows[0].status).toBe('active');
    });

    test('returns correct row on ON CONFLICT DO UPDATE', async () => {
      db = createTestDb();
      await insertCodebase(db, 'cb-1');

      // Insert initial row
      await db.query(
        `INSERT INTO isolation_environments
         (id, codebase_id, workflow_type, workflow_id, provider, working_path, branch_name, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        ['orig-id', 'cb-1', 'issue', '42', 'worktree', '/tmp/original', 'issue-42', 'active']
      );

      // Upsert with ON CONFLICT -- this is the scenario that was broken
      const result = await db.query<{ id: string; working_path: string; branch_name: string }>(
        `INSERT INTO isolation_environments
         (codebase_id, workflow_type, workflow_id, provider, working_path, branch_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (codebase_id, workflow_type, workflow_id) WHERE status = 'active'
         DO UPDATE SET
           working_path = EXCLUDED.working_path,
           branch_name = EXCLUDED.branch_name,
           status = 'active'
         RETURNING *`,
        ['cb-1', 'issue', '42', 'worktree', '/tmp/updated', 'issue-42-v2']
      );

      expect(result.rows).toHaveLength(1);
      // Must return the updated row, not a random/wrong row
      expect(result.rows[0].id).toBe('orig-id');
      expect(result.rows[0].working_path).toBe('/tmp/updated');
      expect(result.rows[0].branch_name).toBe('issue-42-v2');
    });
  });

  describe('placeholder conversion (#999 regression)', () => {
    test('$N inside SQL comments is treated as a placeholder — avoid $N in comments', async () => {
      db = createTestDb();
      await insertCodebase(db, 'cb-1');

      // A query with $1 and $2 as real params, but $3 only appears in a comment.
      // convertPlaceholders replaces ALL $N occurrences including inside comments,
      // producing 3 ? marks for only 2 params → SQLite error.
      const sql = `SELECT * FROM codebases WHERE id = $1 AND name = $2 -- $3 is not a real param`;
      await expect(db.query(sql, ['cb-1', 'test-codebase-cb-1'])).rejects.toThrow();
    });

    test('query succeeds when $N placeholders match param count', async () => {
      db = createTestDb();
      await insertCodebase(db, 'cb-1');

      const result = await db.query<{ id: string }>(
        `SELECT id FROM codebases WHERE id = $1 AND name = $2`,
        ['cb-1', 'test-codebase-cb-1']
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBe('cb-1');
    });
  });

  describe('UPDATE/DELETE with RETURNING', () => {
    test('throws error for UPDATE RETURNING', async () => {
      db = createTestDb();

      await expect(
        db.query(`UPDATE isolation_environments SET status = $1 WHERE id = $2 RETURNING *`, [
          'destroyed',
          'test-id',
        ])
      ).rejects.toThrow('does not support RETURNING clause on UPDATE/DELETE');
    });
  });

  describe('datetime() chronological vs lexical comparison', () => {
    // Documents the SQLite-specific bug fixed in getActiveWorkflowRunByPath.
    // `started_at` is TEXT in "YYYY-MM-DD HH:MM:SS" format. Comparing it
    // directly to an ISO param "YYYY-MM-DDTHH:MM:SS.mmmZ" with `<` is
    // LEXICAL: char 11 is space (0x20) in the column vs T (0x54) in the
    // param, so every column value lex-sorts before every ISO param,
    // making the comparison ALWAYS true regardless of actual time.
    //
    // Wrapping both sides in datetime() forces chronological comparison.

    test('lexical comparison gives wrong answer for SQLite stored format vs ISO param', async () => {
      db = createTestDb();
      // Column-format value (afternoon) is chronologically AFTER the ISO
      // param (morning), but lex compares char-11 (space < T) → wrong.
      const result = await db.query<{ broken: number }>(
        `SELECT ('2026-04-14 12:00:00' < $1) AS broken`,
        ['2026-04-14T10:00:00.000Z']
      );
      // Expected by chronology: FALSE. Lex says: TRUE.
      expect(result.rows[0].broken).toBe(1);
    });

    test('datetime() wrap on both sides gives chronological comparison', async () => {
      db = createTestDb();
      const result = await db.query<{ correct: number }>(
        `SELECT (datetime('2026-04-14 12:00:00') < datetime($1)) AS correct`,
        ['2026-04-14T10:00:00.000Z']
      );
      // 12:00 < 10:00 is FALSE — datetime() comparison agrees with reality.
      expect(result.rows[0].correct).toBe(0);
    });

    test('datetime() handles equality across formats', async () => {
      db = createTestDb();
      const result = await db.query<{ equal: number }>(
        `SELECT (datetime('2026-04-14 10:00:00') = datetime($1)) AS equal`,
        ['2026-04-14T10:00:00.000Z']
      );
      expect(result.rows[0].equal).toBe(1);
    });
  });

  describe('workflow run creation (dropped-conversation-FK regression)', () => {
    test('accepts an arbitrary conversation_id with no conversations table/row', async () => {
      db = createTestDb();
      // Mirrors workflowDb.createWorkflowRun's INSERT. conversation_id is a
      // free-form CLI session id, NOT a foreign key — a fresh DB must accept it
      // without any conversations row. Guards the P0 where the Archon FK made
      // every `rith run` fail with "FOREIGN KEY constraint failed".
      const result = await db.query<{ id: string; conversation_id: string; status: string }>(
        `INSERT INTO workflow_runs
         (workflow_name, conversation_id, codebase_id, user_message, metadata, working_path)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        ['rith-fix-github-issue', 'cli-7f3a9b2c', null, 'fix #42', '{}', '/repo']
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].conversation_id).toBe('cli-7f3a9b2c');
      expect(result.rows[0].status).toBe('pending');
    });

    test('has no legacy remote_agent_* or conversations tables', async () => {
      db = createTestDb();
      const result = await db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'remote_agent_%' OR name = 'conversations')"
      );
      expect(result.rows).toHaveLength(0);
    });
  });

  describe('legacy Archon schema migration', () => {
    test('migrates remote_agent_* + conversations to clean tables, preserving data', async () => {
      currentDbPath = join(import.meta.dir, `.test-legacy-${Date.now()}.db`);
      // Seed a legacy DB (old prefix + vestigial conversations FK + dropped columns).
      const seed = new Database(currentDbPath);
      seed.run('PRAGMA foreign_keys = ON');
      seed.run(
        `CREATE TABLE remote_agent_codebases (id TEXT PRIMARY KEY, name TEXT NOT NULL, repository_url TEXT, default_cwd TEXT NOT NULL, default_branch TEXT DEFAULT 'main', ai_assistant_type TEXT DEFAULT 'pi', commands TEXT DEFAULT '{}', created_at TEXT, updated_at TEXT)`
      );
      seed.run(
        `CREATE TABLE remote_agent_codebase_env_vars (id TEXT PRIMARY KEY, codebase_id TEXT NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT, updated_at TEXT, UNIQUE(codebase_id, key))`
      );
      seed.run(
        `CREATE TABLE remote_agent_conversations (id TEXT PRIMARY KEY, platform_type TEXT NOT NULL, platform_conversation_id TEXT NOT NULL)`
      );
      seed.run(
        `CREATE TABLE remote_agent_isolation_environments (id TEXT PRIMARY KEY, codebase_id TEXT NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE, workflow_type TEXT NOT NULL, workflow_id TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'worktree', working_path TEXT NOT NULL, branch_name TEXT NOT NULL, created_by_platform TEXT, metadata TEXT DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active', created_at TEXT, updated_at TEXT)`
      );
      seed.run(
        `CREATE TABLE remote_agent_workflow_runs (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES remote_agent_conversations(id) ON DELETE CASCADE, codebase_id TEXT REFERENCES remote_agent_codebases(id) ON DELETE SET NULL, workflow_name TEXT NOT NULL, user_message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', current_step_index INTEGER, metadata TEXT DEFAULT '{}', parent_conversation_id TEXT, started_at TEXT, completed_at TEXT, last_activity_at TEXT, working_path TEXT)`
      );
      seed.run(
        `CREATE TABLE remote_agent_workflow_events (id TEXT PRIMARY KEY, workflow_run_id TEXT NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE, event_type TEXT NOT NULL, step_index INTEGER, step_name TEXT, data TEXT DEFAULT '{}', created_at TEXT)`
      );
      seed.run(
        `INSERT INTO remote_agent_codebases (id, name, default_cwd) VALUES ('cb1', 'owner/repo', '/repo')`
      );
      seed.run(
        `INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id) VALUES ('conv1', 'cli', 'cli-1')`
      );
      seed.run(
        `INSERT INTO remote_agent_workflow_runs (id, conversation_id, codebase_id, workflow_name, user_message, status) VALUES ('wr1', 'conv1', 'cb1', 'wf', 'msg', 'completed')`
      );
      seed.close();

      // Opening via the adapter runs migrateLegacySchema().
      db = new SqliteAdapter(currentDbPath);

      const tables = (
        await db.query<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
      ).rows.map(r => r.name);
      expect(tables).toEqual([
        'codebase_env_vars',
        'codebases',
        'isolation_environments',
        'workflow_events',
        'workflow_runs',
      ]);

      // Kept data survives; conversation_id is preserved as a plain value.
      const cb = await db.query<{ id: string }>('SELECT id FROM codebases');
      expect(cb.rows).toEqual([{ id: 'cb1' }]);
      const wr = await db.query<{ id: string; conversation_id: string }>(
        'SELECT id, conversation_id FROM workflow_runs'
      );
      expect(wr.rows).toEqual([{ id: 'wr1', conversation_id: 'conv1' }]);

      const fk = await db.query('PRAGMA foreign_key_check');
      expect(fk.rows).toHaveLength(0);
    });
  });
});
