/**
 * Memory Management
 *
 * Session persistence and storage for TUI chat mode.
 * Uses SQLite for persistent storage (Phase 8).
 */

// SQLite Database Layer
export {
  initDatabase,
  getDatabase,
  closeDatabase,
  getDatabasePath,
  getSchemaVersion,
  runMigration,
  isDatabaseInitialized
} from './database';

// SQLite-backed Sessions (Phase 8 - recommended)
export {
  createSession,
  loadSession,
  saveSession,
  deleteSession,
  listSessions,
  getLatestSession,
  addMessage,
  getConversationHistory,
  searchSessions,
  getSessionStats,
  clearSessionHistory,
  getSessionCount,
  type Message,
  type AgentSession,
  type SessionMeta,
  type SessionConfig
} from './sqlite-sessions';

// Legacy JSON sessions (for migration/fallback)
export {
  getSessionsDir,
  listSessions as listJsonSessions,
  loadSession as loadJsonSession
} from './sessions';
