/**
 * SQLite Database Layer (Phase 8)
 *
 * Persistent storage for sessions, messages, and tasks.
 * Uses better-sqlite3 for synchronous, fast SQLite operations.
 *
 * Timestamps are Unix epoch milliseconds (Date.now()).
 */

import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { getConfigDir } from '../lib/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Database instance (singleton)
let db: any | null = null;

/**
 * Get database file path
 */
export function getDatabasePath(): string {
  if (process.env.PUZLDAI_DB_PATH) {
    return process.env.PUZLDAI_DB_PATH;
  }
  return join(getConfigDir(), 'puzldai.db');
}

/**
 * Initialize database connection and schema
 */
export function initDatabase(): any {
  if (db) return db;

  // Ensure config directory exists
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  const dbPath = getDatabasePath();
  const isBun = typeof (globalThis as any).Bun !== 'undefined';

  if (isBun) {
    const { Database } = require('bun:sqlite') as { Database: any };
    db = new Database(dbPath);

    // bun:sqlite API compatibility with better-sqlite3
    if (!db.prepare && db.query) {
      db.prepare = db.query.bind(db);
    }
    if (!db.pragma) {
      db.pragma = (pragma: string) => db.exec(`PRAGMA ${pragma}`);
    }
    if (!db.transaction) {
      db.transaction = (fn: () => unknown) => {
        return () => {
          db.exec('BEGIN');
          try {
            const result = fn();
            db.exec('COMMIT');
            return result;
          } catch (err) {
            db.exec('ROLLBACK');
            throw err;
          }
        };
      };
    }
  } else {
    const BetterSqlite3 = require('better-sqlite3') as any;
    const Ctor = BetterSqlite3?.default ?? BetterSqlite3;
    db = new Ctor(dbPath);
  }

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Create schema
  createSchema(db);

  return db;
}

/**
 * Get database instance (initializes if needed)
 */
export function getDatabase(): any {
  if (!db) {
    return initDatabase();
  }
  return db;
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    try {
      const { resetStatements: resetAuthStatements } = require('../api/auth/persistence');
      resetAuthStatements();
    } catch {
      // Ignore failures to reset auth statements during shutdown.
    }
    db = null;
  }
}

/**
 * Create database schema
 */
function createSchema(database: any): void {
  // Metadata table (for schema versioning)
  database.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Sessions table
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      summary TEXT DEFAULT '',
      summary_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      message_count INTEGER DEFAULT 0,
      template_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Messages table
  database.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      tokens INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      metadata TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  // Tasks table (for logging executed tasks)
  database.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      prompt TEXT NOT NULL,
      agent TEXT NOT NULL,
      model TEXT,
      response TEXT,
      error TEXT,
      tokens_in INTEGER,
      tokens_out INTEGER,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
    )
  `);

  // Create indexes for common queries
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent);
    CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
  `);

  // Set initial schema version
  database.prepare(
    "INSERT OR IGNORE INTO metadata (key, value) VALUES ('schema_version', '1')"
  ).run();

  // Run migrations
  runMigrations(database);
}

/**
 * Run all migrations
 */
function runMigrations(database: any): void {
  const currentVersion = parseInt(
    (database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as { value: string })?.value || '1',
    10
  );

  // Migration 2: Add observations table (Phase 10)
  if (currentVersion < 2) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        timestamp INTEGER NOT NULL,

        -- Input
        prompt TEXT NOT NULL,
        injected_context TEXT,
        agent TEXT NOT NULL,
        model TEXT,

        -- Output
        response TEXT,
        explanation TEXT,
        proposed_files TEXT,

        -- Review decisions
        accepted_files TEXT,
        rejected_files TEXT,

        -- User modifications
        user_edits TEXT,
        final_files TEXT,

        -- Metadata
        duration_ms INTEGER,
        tokens_in INTEGER,
        tokens_out INTEGER,

        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);
      CREATE INDEX IF NOT EXISTS idx_observations_agent ON observations(agent);
      CREATE INDEX IF NOT EXISTS idx_observations_timestamp ON observations(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_observations_model ON observations(model);
    `);

    database.prepare("UPDATE metadata SET value = '2' WHERE key = 'schema_version'").run();
  }

  // Migration 3: Add unified sessions and messages tables (Multi-Model Context)
  if (currentVersion < 3) {
    database.exec(`
      -- Unified sessions (agent-agnostic)
      CREATE TABLE IF NOT EXISTS unified_sessions (
        id TEXT PRIMARY KEY,
        name TEXT,
        summary TEXT DEFAULT '',
        summary_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        message_count INTEGER DEFAULT 0,
        agents_used TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Unified messages with typed content parts
      CREATE TABLE IF NOT EXISTS unified_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
        content TEXT NOT NULL,
        agent TEXT,
        model TEXT,
        tokens_input INTEGER DEFAULT 0,
        tokens_output INTEGER DEFAULT 0,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES unified_sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_unified_messages_session
        ON unified_messages(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_unified_sessions_updated
        ON unified_sessions(updated_at DESC);
    `);

    database.prepare("UPDATE metadata SET value = '3' WHERE key = 'schema_version'").run();
  }

  // Migration 4: Add diff_tracking table for individual diff decisions
  if (currentVersion < 4) {
    database.exec(`
      -- Track individual diff decisions for detailed analysis
      CREATE TABLE IF NOT EXISTS diff_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        observation_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        operation TEXT NOT NULL CHECK(operation IN ('create', 'update', 'delete')),
        decision TEXT NOT NULL CHECK(decision IN ('accepted', 'rejected', 'user_edited')),
        diff_content TEXT,
        hash_before TEXT,
        hash_after TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_diff_tracking_observation
        ON diff_tracking(observation_id);
      CREATE INDEX IF NOT EXISTS idx_diff_tracking_decision
        ON diff_tracking(decision);
      CREATE INDEX IF NOT EXISTS idx_diff_tracking_timestamp
        ON diff_tracking(created_at DESC);
    `);

    database.prepare("UPDATE metadata SET value = '4' WHERE key = 'schema_version'").run();
  }

  // Migration 5: Add api_tasks table for API task persistence
  if (currentVersion < 5) {
    database.exec(`
      -- API tasks table for persisting task state across server restarts
      CREATE TABLE IF NOT EXISTS api_tasks (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        agent TEXT,
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed')),
        result TEXT,
        error TEXT,
        model TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        updated_at INTEGER NOT NULL
      );

      -- Indexes for efficient querying
      CREATE INDEX IF NOT EXISTS idx_api_tasks_status ON api_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_api_tasks_started ON api_tasks(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_api_tasks_updated ON api_tasks(updated_at DESC);
    `);

    database.prepare("UPDATE metadata SET value = '5' WHERE key = 'schema_version'").run();
  }

  // Migration 6: Add queue_position to api_tasks for crash recovery
  if (currentVersion < 6) {
    database.exec(`
      -- Add queue_position column for tracking task order in queue
      ALTER TABLE api_tasks ADD COLUMN queue_position INTEGER DEFAULT 0;

      -- Create index for efficient queue position queries
      CREATE INDEX IF NOT EXISTS idx_api_tasks_queue_position ON api_tasks(queue_position);
    `);

    // Fix #1: Set proper queue positions for existing queued tasks
    database.exec(`
      -- Update queue_position for existing queued tasks based on start time
      UPDATE api_tasks
      SET queue_position = (
        SELECT COUNT(*) + 1
        FROM api_tasks AS t2
        WHERE t2.status = 'queued'
          AND t2.started_at <= api_tasks.started_at
          AND t2.id != api_tasks.id
      )
      WHERE status = 'queued' AND queue_position = 0;
    `);

    database.prepare("UPDATE metadata SET value = '6' WHERE key = 'schema_version'").run();
  }

  // Migration 7: Add game_sessions table for puzzle game persistence
  if (currentVersion < 7) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS game_sessions (
        id TEXT PRIMARY KEY,
        game_name TEXT NOT NULL,
        state_json TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_game_sessions_game_name ON game_sessions(game_name);
      CREATE INDEX IF NOT EXISTS idx_game_sessions_updated_at ON game_sessions(updated_at DESC);

      -- Enforce single active session per game, allow unlimited inactive sessions
      CREATE UNIQUE INDEX IF NOT EXISTS idx_game_sessions_unique_active
      ON game_sessions(game_name)
      WHERE is_active = 1;
    `);

    database.prepare("UPDATE metadata SET value = '7' WHERE key = 'schema_version'").run();
  }

  // Migration 8: Add user_preferences table for persistent settings
  if (currentVersion < 8) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_user_preferences_updated ON user_preferences(updated_at DESC);
    `);

    database.prepare("UPDATE metadata SET value = '8' WHERE key = 'schema_version'").run();
  }

  // Migration 9: Add users and refresh_tokens tables for authentication
  if (currentVersion < 9) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
    `);

    database.prepare("UPDATE metadata SET value = '9' WHERE key = 'schema_version'").run();
  }

  // Migration 10: Add campaign persistence tables
  if (currentVersion < 10) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS campaign_projects (
        id TEXT PRIMARY KEY,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        git_branch TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS campaign_tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        dependencies TEXT,
        step_hints TEXT,
        assigned_files TEXT,
        attempts INTEGER DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES campaign_projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS campaign_execution_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        attempt_num INTEGER NOT NULL,
        stdout TEXT,
        stderr TEXT,
        git_diff TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES campaign_tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_campaign_projects_status ON campaign_projects(status);
      CREATE INDEX IF NOT EXISTS idx_campaign_tasks_project ON campaign_tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_campaign_tasks_status ON campaign_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_campaign_logs_task ON campaign_execution_logs(task_id);
    `);

    database.prepare("UPDATE metadata SET value = '10' WHERE key = 'schema_version'").run();
  }

  // Migration 11: Add enhanced campaign domain and criteria tracking tables
  if (currentVersion < 11) {
    database.exec(`
      -- Domain progress tracking for parallel campaign execution
      CREATE TABLE IF NOT EXISTS campaign_domains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        progress_percent REAL DEFAULT 0.0,
        tasks_total INTEGER DEFAULT 0,
        tasks_completed INTEGER DEFAULT 0,
        tasks_failed INTEGER DEFAULT 0,
        tasks_in_progress INTEGER DEFAULT 0,
        file_patterns TEXT,
        git_branch TEXT,
        started_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES campaign_projects(id) ON DELETE CASCADE,
        UNIQUE(project_id, name)
      );

      -- Entry/exit criteria validation results
      CREATE TABLE IF NOT EXISTS campaign_criteria_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        criteria_type TEXT NOT NULL CHECK(criteria_type IN ('entry', 'exit')),
        criterion_description TEXT NOT NULL,
        check_command TEXT,
        passed INTEGER NOT NULL CHECK(passed IN (0, 1)),
        error_message TEXT,
        execution_ms INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES campaign_tasks(id) ON DELETE CASCADE
      );

      -- Domain metrics for analytics
      CREATE TABLE IF NOT EXISTS campaign_domain_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain_id INTEGER NOT NULL,
        metric_name TEXT NOT NULL,
        metric_value REAL NOT NULL,
        recorded_at INTEGER NOT NULL,
        FOREIGN KEY (domain_id) REFERENCES campaign_domains(id) ON DELETE CASCADE
      );

      -- Indexes for efficient queries
      CREATE INDEX IF NOT EXISTS idx_campaign_domains_project ON campaign_domains(project_id);
      CREATE INDEX IF NOT EXISTS idx_campaign_domains_status ON campaign_domains(status);
      CREATE INDEX IF NOT EXISTS idx_campaign_criteria_task ON campaign_criteria_results(task_id);
      CREATE INDEX IF NOT EXISTS idx_campaign_criteria_type ON campaign_criteria_results(criteria_type);
      CREATE INDEX IF NOT EXISTS idx_campaign_criteria_passed ON campaign_criteria_results(passed);
      CREATE INDEX IF NOT EXISTS idx_campaign_domain_metrics_domain ON campaign_domain_metrics(domain_id);
      CREATE INDEX IF NOT EXISTS idx_campaign_domain_metrics_name ON campaign_domain_metrics(metric_name);
    `);

    // Add domain column to campaign_tasks if not exists
    try {
      database.exec(`ALTER TABLE campaign_tasks ADD COLUMN domain TEXT;`);
    } catch {
      // Column may already exist
    }

    // Add timing columns to campaign_tasks
    try {
      database.exec(`ALTER TABLE campaign_tasks ADD COLUMN started_at INTEGER;`);
      database.exec(`ALTER TABLE campaign_tasks ADD COLUMN completed_at INTEGER;`);
      database.exec(`ALTER TABLE campaign_tasks ADD COLUMN duration_ms INTEGER;`);
    } catch {
      // Columns may already exist
    }

    database.prepare("UPDATE metadata SET value = '11' WHERE key = 'schema_version'").run();
  }
}

/**
 * Get current schema version
 */
export function getSchemaVersion(): number {
  const database = getDatabase();
  const row = database.prepare(
    "SELECT value FROM metadata WHERE key = 'schema_version'"
  ).get() as { value: string } | undefined;

  return row ? parseInt(row.value, 10) : 0;
}

/**
 * Run a migration (for future schema changes)
 */
export function runMigration(version: number, sql: string): void {
  const database = getDatabase();
  const currentVersion = getSchemaVersion();

  if (currentVersion < version) {
    database.exec(sql);
    database.prepare(
      "INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', ?)"
    ).run(version.toString());
  }
}

/**
 * Check if database is initialized
 */
export function isDatabaseInitialized(): boolean {
  return db !== null;
}
