/**
 * Base Game Adapter
 *
 * Provides common functionality for game adapters including:
 * - Game state management and persistence
 * - Command parsing and validation
 * - Session lifecycle (create, resume, end)
 * - Rendering game state for display
 */

import type { Adapter, ModelResponse, RunOptions } from '../lib/types';

export interface GameState {
  status: 'playing' | 'won' | 'lost' | 'invalid';
  moves?: string[];
  score?: number;
  message?: string;
  data?: unknown;
}

export interface GameOptions {
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface GameAdapter extends Adapter {
  name: string;
  initializeGame(options: GameOptions): GameState;
  renderState(state: GameState): string;
  validateCommand?(command: string, state: GameState): { valid: boolean; error?: string };
}

export interface GameSession {
  id: string;
  game_name: string;
  state: GameState;
  is_active: number;
  created_at: number;
  updated_at: number;
}

const GAME_SESSIONS: Map<string, GameSession> = new Map();

export function createGameSession(gameName: string, state: GameState): GameSession {
  const session: GameSession = {
    id: `${gameName}_${Date.now()}`,
    game_name: gameName,
    state,
    is_active: 1,
    created_at: Date.now(),
    updated_at: Date.now()
  };
  GAME_SESSIONS.set(session.id, session);
  return session;
}

export function getActiveSession(gameName: string): GameSession | undefined {
  for (const session of GAME_SESSIONS.values()) {
    if (session.game_name === gameName && session.is_active) {
      return session;
    }
  }
  return undefined;
}

export function getSession(sessionId: string): GameSession | undefined {
  return GAME_SESSIONS.get(sessionId);
}

export function listGameSessions(gameName?: string): GameSession[] {
  const sessions: GameSession[] = [];
  for (const session of GAME_SESSIONS.values()) {
    if (!gameName || session.game_name === gameName) {
      sessions.push(session);
    }
  }
  return sessions.sort((a, b) => b.updated_at - a.updated_at);
}

export function updateGameSession(sessionId: string, state: GameState): void {
  const session = GAME_SESSIONS.get(sessionId);
  if (session) {
    session.state = state;
    session.updated_at = Date.now();
    GAME_SESSIONS.set(sessionId, session);
  }
}

export function endGameSession(sessionId: string): void {
  const session = GAME_SESSIONS.get(sessionId);
  if (session) {
    session.is_active = 0;
    session.updated_at = Date.now();
    GAME_SESSIONS.set(sessionId, session);
  }
}

export function deleteGameSession(sessionId: string): void {
  GAME_SESSIONS.delete(sessionId);
}

export function clearInactiveSessions(gameName?: string): number {
  let count = 0;
  for (const [id, session] of GAME_SESSIONS.entries()) {
    if (!session.is_active && (!gameName || session.game_name === gameName)) {
      GAME_SESSIONS.delete(id);
      count++;
    }
  }
  return count;
}

export function cleanupOldSessions(maxAgeMs: number): number {
  const cutoff = Date.now() - maxAgeMs;
  let count = 0;
  for (const [id, session] of GAME_SESSIONS.entries()) {
    if (session.updated_at < cutoff) {
      GAME_SESSIONS.delete(id);
      count++;
    }
  }
  return count;
}

export function getGameSessionStats(): { total: number; active: number; inactive: number } {
  let total = 0;
  let active = 0;
  let inactive = 0;
  for (const session of GAME_SESSIONS.values()) {
    total++;
    if (session.is_active) active++;
    else inactive++;
  }
  return { total, active, inactive };
}

export function runGameCommand(
  adapter: GameAdapter,
  session: GameSession,
  command: string,
  options?: RunOptions
): ModelResponse {
  const startTime = Date.now();
  const state = session.state;

  const validation = adapter.validateCommand?.(command, state);
  if (validation && !validation.valid) {
    return {
      content: `Invalid command: ${validation.error}\n\n${adapter.renderState(state)}`,
      model: adapter.name,
      duration: Date.now() - startTime,
      state: { ...state, status: 'invalid', message: validation.error }
    };
  }

  const response = adapter.run(command, { ...options, state: session.state });

  return response;
}
