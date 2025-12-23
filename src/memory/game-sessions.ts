import Database from 'better-sqlite3';
import path from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync } from 'fs';
import type { GameState } from '../adapters/base-game-adapter';

/**
 * Game session persistence manager
 * Stores game state in SQLite for resumable gameplay
 */

export interface GameSession {
  id: string;
  gameName: string;
  state: GameState;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

export class GameSessionManager {
  private db: Database.Database;
  private dbPath: string;

  constructor(dataDir?: string) {
    const dir = dataDir || path.join(homedir(), '.puzldai');

    // Ensure directory exists
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.dbPath = path.join(dir, 'game-sessions.db');
    this.db = new Database(this.dbPath);
    this.initialize();
  }

  private initialize(): void {
    // Check if we need to migrate from old schema
    this.migrateSchema();

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS game_sessions (
        id TEXT PRIMARY KEY,
        game_name TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_active INTEGER DEFAULT 1
      )
    `);

    // Partial unique index - only enforce uniqueness for active sessions
    // This allows multiple inactive sessions per game, but only one active session
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_game_sessions_unique_active
      ON game_sessions(game_name) WHERE is_active = 1
    `);

    // Index for faster queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_game_sessions_game_active
      ON game_sessions(game_name, is_active, updated_at)
    `);
  }

  /**
   * Migrate from old schema with UNIQUE constraint to new schema with partial index
   */
  private migrateSchema(): void {
    // Check if old table exists with UNIQUE constraint
    const tableInfo = this.db.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type = 'table' AND name = 'game_sessions'
    `).get() as { sql?: string } | undefined;

    if (!tableInfo?.sql) {
      // Table doesn't exist yet, no migration needed
      return;
    }

    // Check if the old UNIQUE constraint exists
    if (tableInfo.sql.includes('UNIQUE(game_name, is_active)')) {
      console.log('Migrating game_sessions schema to support multiple inactive sessions...');

      // Create temporary table with new schema
      this.db.exec(`
        CREATE TABLE game_sessions_new (
          id TEXT PRIMARY KEY,
          game_name TEXT NOT NULL,
          state TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          is_active INTEGER DEFAULT 1
        )
      `);

      // Copy data from old table
      this.db.exec(`
        INSERT INTO game_sessions_new (id, game_name, state, created_at, updated_at, is_active)
        SELECT id, game_name, state, created_at, updated_at, is_active
        FROM game_sessions
      `);

      // Drop old table
      this.db.exec(`DROP TABLE game_sessions`);

      // Rename new table
      this.db.exec(`ALTER TABLE game_sessions_new RENAME TO game_sessions`);

      console.log('Schema migration completed successfully.');
    }
  }

  /**
   * Create a new game session
   */
  createSession(gameName: string, state: GameState): string {
    const id = `game_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date().toISOString();

    // End any existing active sessions for this game
    this.db.prepare(`
      UPDATE game_sessions
      SET is_active = 0
      WHERE game_name = ? AND is_active = 1
    `).run(gameName);

    // Create new session
    this.db.prepare(`
      INSERT INTO game_sessions (id, game_name, state, created_at, updated_at, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(id, gameName, JSON.stringify(state), now, now);

    return id;
  }

  /**
   * Update an existing session's state
   */
  updateSession(id: string, state: GameState): void {
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE game_sessions
      SET state = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(state), now, id);
  }

  /**
   * Get a specific session by ID
   */
  getSession(id: string): GameSession | null {
    const row = this.db.prepare(`
      SELECT * FROM game_sessions WHERE id = ?
    `).get(id) as any;

    if (!row) return null;

    return this.mapRow(row);
  }

  /**
   * Get the active session for a game
   */
  getActiveSession(gameName: string): GameSession | null {
    const row = this.db.prepare(`
      SELECT * FROM game_sessions
      WHERE game_name = ? AND is_active = 1
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(gameName) as any;

    if (!row) return null;

    return this.mapRow(row);
  }

  /**
   * List all sessions for a game (or all games)
   */
  listSessions(gameName?: string): GameSession[] {
    const query = gameName
      ? `SELECT * FROM game_sessions WHERE game_name = ? ORDER BY updated_at DESC`
      : `SELECT * FROM game_sessions ORDER BY updated_at DESC`;

    const rows = gameName
      ? this.db.prepare(query).all(gameName)
      : this.db.prepare(query).all();

    return (rows as any[]).map(row => this.mapRow(row));
  }

  /**
   * End an active session
   */
  endSession(id: string): void {
    this.db.prepare(`
      UPDATE game_sessions SET is_active = 0 WHERE id = ?
    `).run(id);
  }

  /**
   * Delete a session permanently
   */
  deleteSession(id: string): void {
    this.db.prepare(`DELETE FROM game_sessions WHERE id = ?`).run(id);
  }

  /**
   * Clean up old inactive sessions (older than N days)
   */
  cleanupOldSessions(olderThanDays: number = 30): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = this.db.prepare(`
      DELETE FROM game_sessions
      WHERE is_active = 0 AND updated_at < ?
    `).run(cutoffDate.toISOString());

    return result.changes;
  }

  /**
   * Get session statistics
   */
  getStats(): { total: number; active: number; byGame: Record<string, number> } {
    const total = (this.db.prepare(`SELECT COUNT(*) as count FROM game_sessions`).get() as any).count;
    const active = (this.db.prepare(`SELECT COUNT(*) as count FROM game_sessions WHERE is_active = 1`).get() as any).count;

    const byGame: Record<string, number> = {};
    const rows = this.db.prepare(`
      SELECT game_name, COUNT(*) as count
      FROM game_sessions
      GROUP BY game_name
    `).all() as any[];

    rows.forEach(row => {
      byGame[row.game_name] = row.count;
    });

    return { total, active, byGame };
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Map database row to GameSession object
   */
  private mapRow(row: any): GameSession {
    return {
      id: row.id,
      gameName: row.game_name,
      state: JSON.parse(row.state),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isActive: Boolean(row.is_active)
    };
  }
}
