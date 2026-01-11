import type { GameSession, GameState } from '../lib/types';
import { getDatabase } from './database';

function rowToGameSession(row: {
  id: string;
  game_name: string;
  state_json: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}): GameSession {
  let state: GameState;
  try {
    state = JSON.parse(row.state_json) as GameState;
  } catch {
    state = { status: 'invalid', message: 'Failed to parse saved game state' };
  }

  return {
    id: row.id,
    gameName: row.game_name,
    state,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createGameSession(gameName: string, state: GameState): GameSession {
  const db = getDatabase();
  const now = Date.now();
  const id = `${gameName}_${now}`;

  db.prepare(
    `INSERT INTO game_sessions (id, game_name, state_json, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`
  ).run(id, gameName, JSON.stringify(state), now, now);

  return {
    id,
    gameName,
    state,
    isActive: true,
    createdAt: now,
    updatedAt: now
  };
}

export function getActiveGameSession(gameName: string): GameSession | null {
  const db = getDatabase();
  const row = db.prepare(
    `SELECT id, game_name, state_json, is_active, created_at, updated_at
     FROM game_sessions
     WHERE game_name = ? AND is_active = 1
     ORDER BY updated_at DESC
     LIMIT 1`
  ).get(gameName) as
    | {
        id: string;
        game_name: string;
        state_json: string;
        is_active: number;
        created_at: number;
        updated_at: number;
      }
    | undefined;

  return row ? rowToGameSession(row) : null;
}

export function getGameSession(sessionId: string): GameSession | null {
  const db = getDatabase();
  const row = db.prepare(
    `SELECT id, game_name, state_json, is_active, created_at, updated_at
     FROM game_sessions
     WHERE id = ?`
  ).get(sessionId) as
    | {
        id: string;
        game_name: string;
        state_json: string;
        is_active: number;
        created_at: number;
        updated_at: number;
      }
    | undefined;

  return row ? rowToGameSession(row) : null;
}

export function listGameSessions(gameName?: string): GameSession[] {
  const db = getDatabase();
  const rows = (
    gameName
      ? db
          .prepare(
            `SELECT id, game_name, state_json, is_active, created_at, updated_at
             FROM game_sessions
             WHERE game_name = ?
             ORDER BY updated_at DESC`
          )
          .all(gameName)
      : db
          .prepare(
            `SELECT id, game_name, state_json, is_active, created_at, updated_at
             FROM game_sessions
             ORDER BY updated_at DESC`
          )
          .all()
  ) as Array<{
    id: string;
    game_name: string;
    state_json: string;
    is_active: number;
    created_at: number;
    updated_at: number;
  }>;

  return rows.map(rowToGameSession);
}

export function updateGameSession(sessionId: string, state: GameState): void {
  const db = getDatabase();
  const now = Date.now();
  db.prepare(
    `UPDATE game_sessions
     SET state_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(JSON.stringify(state), now, sessionId);
}

export function endGameSession(sessionId: string): void {
  const db = getDatabase();
  const now = Date.now();
  db.prepare(
    `UPDATE game_sessions
     SET is_active = 0, updated_at = ?
     WHERE id = ?`
  ).run(now, sessionId);
}

export function activateGameSession(sessionId: string): GameSession {
  const db = getDatabase();
  const session = getGameSession(sessionId);
  if (!session) {
    throw new Error(`Game session not found: ${sessionId}`);
  }

  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE game_sessions
       SET is_active = 0, updated_at = ?
       WHERE game_name = ? AND is_active = 1`
    ).run(now, session.gameName);

    db.prepare(
      `UPDATE game_sessions
       SET is_active = 1, updated_at = ?
       WHERE id = ?`
    ).run(now, sessionId);
  });

  tx();

  const activated = getGameSession(sessionId);
  if (!activated) {
    throw new Error(`Game session disappeared: ${sessionId}`);
  }
  return activated;
}

export function deleteGameSession(sessionId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM game_sessions WHERE id = ?').run(sessionId);
}

export function cleanupOldGameSessions(maxAgeMs: number): number {
  const db = getDatabase();
  const cutoff = Date.now() - maxAgeMs;
  const result = db
    .prepare(
      `DELETE FROM game_sessions
       WHERE is_active = 0 AND updated_at < ?`
    )
    .run(cutoff);
  return result.changes;
}

export function getGameSessionStats(): { total: number; active: number; inactive: number } {
  const db = getDatabase();
  const total = (db.prepare('SELECT COUNT(*) AS c FROM game_sessions').get() as { c: number }).c;
  const active = (db
    .prepare('SELECT COUNT(*) AS c FROM game_sessions WHERE is_active = 1')
    .get() as { c: number }).c;
  const inactive = total - active;
  return { total, active, inactive };
}
