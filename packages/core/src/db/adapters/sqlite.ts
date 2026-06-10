/**
 * SQLite adapter using bun:sqlite
 */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { IDatabase, QueryResult, SqlDialect } from './types';
import { createLogger } from '@rith/paths';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('db.sqlite');
  return cachedLog;
}

export class SqliteAdapter implements IDatabase {
  private db: Database;
  readonly dialect = 'sqlite' as const;
  readonly sql: SqlDialect = sqliteDialect;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);

    // Enable WAL mode for better concurrent performance
    this.db.run('PRAGMA journal_mode = WAL');

    // Retry busy locks up to 5s to avoid SQLITE_BUSY during parallel workflows
    this.db.run('PRAGMA busy_timeout = 5000');

    // Enable foreign keys
    this.db.run('PRAGMA foreign_keys = ON');

    // Initialize schema if needed
    this.initSchema();
  }

  async query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    // Convert $1, $2, etc. to ? placeholders and reorder params to match
    const { sql: convertedSql, params: reorderedParams } = this.convertPlaceholders(
      sql,
      params ?? []
    );

    try {
      // Determine if this is a SELECT or mutation
      const trimmedSql = sql.trim().toUpperCase();
      const isSelect = trimmedSql.startsWith('SELECT') || trimmedSql.startsWith('WITH');

      // Cast params to SQLite's expected type
      const sqliteParams = reorderedParams as SQLQueryBindings[];

      if (isSelect) {
        const stmt = this.db.prepare(convertedSql);
        const rows = stmt.all(...sqliteParams) as T[];
        return { rows, rowCount: rows.length };
      } else {
        const upperSql = sql.toUpperCase();

        // Handle INSERT with RETURNING using native SQLite RETURNING (3.35+)
        // We must use .all() instead of .run() because .run() discards
        // RETURNING results, and its lastInsertRowid is unreliable when
        // ON CONFLICT DO UPDATE fires.
        if (upperSql.includes('RETURNING') && upperSql.includes('INSERT')) {
          const stmt = this.db.prepare(convertedSql);
          const rows = stmt.all(...sqliteParams) as T[];
          return { rows, rowCount: rows.length };
        }

        // UPDATE/DELETE with RETURNING not supported
        if (upperSql.includes('RETURNING')) {
          throw new Error(
            'SQLite adapter does not support RETURNING clause on UPDATE/DELETE statements. ' +
              `Query: ${convertedSql.substring(0, 100)}... ` +
              'Hint: Use a SELECT before the mutation if you need the row data.'
          );
        }

        // Standard INSERT/UPDATE/DELETE without RETURNING
        const stmt = this.db.prepare(convertedSql);
        const result = stmt.run(...sqliteParams);
        return { rows: [], rowCount: result.changes };
      }
    } catch (error) {
      const err = error as Error;
      getLog().error({ err, sql: convertedSql, params }, 'db.sqlite_query_failed');
      throw error;
    }
  }

  async withTransaction<T>(
    fn: (query: <U>(sql: string, params?: unknown[]) => Promise<QueryResult<U>>) => Promise<T>
  ): Promise<T> {
    await this.query('BEGIN');
    try {
      const result = await fn(this.query.bind(this));
      await this.query('COMMIT');
      return result;
    } catch (e) {
      try {
        await this.query('ROLLBACK');
      } catch (rollbackError) {
        getLog().error({ err: rollbackError as Error }, 'db.sqlite_transaction_rollback_failed');
      }
      throw e;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  /**
   * Convert PostgreSQL $1, $2 placeholders to SQLite ? placeholders.
   *
   * PostgreSQL uses explicit indices ($1, $2) so params can appear in any order
   * in SQL. SQLite uses positional ? — so params must be reordered to match the
   * left-to-right order of placeholders in the SQL string.
   *
   * Example: SQL has "$2 ... $1" with params [id, json] →
   *   converted SQL: "? ... ?" with reordered params [json, id]
   */
  private convertPlaceholders(sql: string, params: unknown[]): { sql: string; params: unknown[] } {
    // Collect $N placeholders in order of appearance
    const placeholderOrder: number[] = [];
    const convertedSql = sql
      .replace(/\$(\d+)/g, (_match, indexStr: string) => {
        placeholderOrder.push(Number(indexStr));
        return '?';
      })
      .replace(/::jsonb/g, '')
      .replace(/::INTERVAL/g, '');

    // Reorder params to match the positional order of ? in the SQL.
    // $N is 1-based, so $1 → params[0], $2 → params[1], etc.
    const reordered =
      placeholderOrder.length > 0 ? placeholderOrder.map(idx => params[idx - 1]) : params;

    return { sql: convertedSql, params: reordered };
  }

  /**
   * Initialize database schema.
   * Always runs createSchema() since all statements use IF NOT EXISTS,
   * ensuring new tables from migrations are created in existing databases.
   */
  private initSchema(): void {
    this.createSchema();
    this.migrateLegacySchema();
  }

  /**
   * Create all tables. Idempotent (CREATE TABLE IF NOT EXISTS), so a fresh
   * database comes up fully initialized. Changes to EXISTING tables are handled
   * by migrateLegacySchema().
   */
  private createSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS codebases (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        name TEXT NOT NULL,
        repository_url TEXT,
        default_cwd TEXT NOT NULL,
        default_branch TEXT DEFAULT 'main',
        commands TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS codebase_env_vars (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        codebase_id TEXT NOT NULL REFERENCES codebases(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(codebase_id, key)
      );

      CREATE TABLE IF NOT EXISTS isolation_environments (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        codebase_id TEXT NOT NULL REFERENCES codebases(id) ON DELETE CASCADE,
        workflow_type TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'worktree',
        working_path TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- Only active environments need uniqueness (partial unique index).
      CREATE UNIQUE INDEX IF NOT EXISTS unique_active_workflow
        ON isolation_environments (codebase_id, workflow_type, workflow_id)
        WHERE status = 'active';

      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        conversation_id TEXT NOT NULL,
        codebase_id TEXT REFERENCES codebases(id) ON DELETE SET NULL,
        workflow_name TEXT NOT NULL,
        user_message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        metadata TEXT DEFAULT '{}',
        started_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        last_activity_at TEXT DEFAULT (datetime('now')),
        working_path TEXT
      );

      CREATE TABLE IF NOT EXISTS workflow_events (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        step_index INTEGER,
        step_name TEXT,
        data TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_codebase_env_vars_codebase_id ON codebase_env_vars(codebase_id);
      CREATE INDEX IF NOT EXISTS idx_isolation_codebase ON isolation_environments(codebase_id);
      CREATE INDEX IF NOT EXISTS idx_isolation_workflow ON isolation_environments(workflow_type, workflow_id);
      CREATE INDEX IF NOT EXISTS idx_isolation_status ON isolation_environments(status);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_conversation ON workflow_runs(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_working_path ON workflow_runs(working_path);
      CREATE INDEX IF NOT EXISTS idx_workflow_events_run_id ON workflow_events(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_events_type ON workflow_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_last_activity
        ON workflow_runs(last_activity_at) WHERE status = 'running';
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_resumable
        ON workflow_runs(workflow_name, working_path) WHERE status IN ('failed', 'paused');
    `);
    getLog().info('db.sqlite_schema_initialized');
  }

  /**
   * One-time migration off the legacy Archon schema: the `remote_agent_*` table
   * prefix, the vestigial `conversations` table (+ its FK), and the chat /
   * multi-assistant columns (`ai_assistant_type`, `created_by_platform`,
   * `parent_conversation_id`, `current_step_index`). Copies the kept data into
   * the clean tables and drops the legacy ones. No-op once migrated.
   */
  private migrateLegacySchema(): void {
    const legacy = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='remote_agent_codebases'"
      )
      .get();
    if (!legacy) return;

    // foreign_keys must be toggled OUTSIDE a transaction (it is a no-op inside).
    this.db.run('PRAGMA foreign_keys = OFF');
    try {
      this.db.transaction(() => {
        this.db.run(
          `INSERT OR IGNORE INTO codebases (id, name, repository_url, default_cwd, default_branch, commands, created_at, updated_at)
           SELECT id, name, repository_url, default_cwd, default_branch, commands, created_at, updated_at FROM remote_agent_codebases`
        );
        this.db.run(
          `INSERT OR IGNORE INTO codebase_env_vars (id, codebase_id, key, value, created_at, updated_at)
           SELECT id, codebase_id, key, value, created_at, updated_at FROM remote_agent_codebase_env_vars`
        );
        this.db.run(
          `INSERT OR IGNORE INTO isolation_environments (id, codebase_id, workflow_type, workflow_id, provider, working_path, branch_name, metadata, status, created_at, updated_at)
           SELECT id, codebase_id, workflow_type, workflow_id, provider, working_path, branch_name, metadata, status, created_at, updated_at FROM remote_agent_isolation_environments`
        );
        this.db.run(
          `INSERT OR IGNORE INTO workflow_runs (id, conversation_id, codebase_id, workflow_name, user_message, status, metadata, started_at, completed_at, last_activity_at, working_path)
           SELECT id, conversation_id, codebase_id, workflow_name, user_message, status, metadata, started_at, completed_at, last_activity_at, working_path FROM remote_agent_workflow_runs`
        );
        this.db.run(
          `INSERT OR IGNORE INTO workflow_events (id, workflow_run_id, event_type, step_index, step_name, data, created_at)
           SELECT id, workflow_run_id, event_type, step_index, step_name, data, created_at FROM remote_agent_workflow_events`
        );
        this.db.run('DROP TABLE IF EXISTS remote_agent_workflow_events');
        this.db.run('DROP TABLE IF EXISTS remote_agent_workflow_runs');
        this.db.run('DROP TABLE IF EXISTS remote_agent_isolation_environments');
        this.db.run('DROP TABLE IF EXISTS remote_agent_codebase_env_vars');
        this.db.run('DROP TABLE IF EXISTS remote_agent_codebases');
        this.db.run('DROP TABLE IF EXISTS remote_agent_conversations');
      })();
      getLog().info('db.sqlite_legacy_schema_migrated');
    } finally {
      this.db.run('PRAGMA foreign_keys = ON');
    }
  }
}

/**
 * SQLite SQL dialect helpers
 */
export const sqliteDialect: SqlDialect = {
  generateUuid(): string {
    return crypto.randomUUID();
  },

  now(): string {
    return "datetime('now')";
  },

  jsonMerge(column: string, paramIndex: number): string {
    // SQLite json_patch: merges two JSON objects
    // Use $N placeholder (not raw ?) so convertPlaceholders can reorder params correctly
    return `json_patch(${column}, $${String(paramIndex)})`;
  },

  jsonArrayContains(column: string, path: string, paramIndex: number): string {
    // SQLite: exact JSON array membership via json_each (not substring matching)
    return `EXISTS (SELECT 1 FROM json_each(json_extract(${column}, '$.${path}')) WHERE value = CAST($${String(paramIndex)} AS TEXT))`;
  },

  nowMinusDays(paramIndex: number): string {
    return `datetime('now', '-' || $${String(paramIndex)} || ' days')`;
  },

  daysSince(column: string): string {
    return `(julianday('now') - julianday(${column}))`;
  },
};
