/**
 * Game CLI Command
 *
 * Manage puzzle games (Factory AI Droid, Charm Crush) from the command line.
 *
 * Commands:
 * - puzldai game <name> --new [--difficulty easy|medium|hard] - Start new game
 * - puzldai game <name> - Show current state (when no prompt)
 * - puzldai game <name> <command> - Send command to active session
 * - puzldai game <name> --list - List sessions
 * - puzldai game <name> --session <id> - Resume specific session
 * - puzldai game <name> --end - End current session
 * - puzldai game --stats - Show overall stats
 * - puzldai game --cleanup <days> - Clean old sessions
 */

import type { Command } from 'commander';
import {
  factoryDroidAdapter,
  charmCrushAdapter,
  createGameSession,
  getActiveSession,
  getSession,
  listGameSessions,
  updateGameSession,
  endGameSession,
  clearInactiveSessions,
  cleanupOldSessions,
  getGameSessionStats,
  type GameAdapter,
  type GameOptions
} from '../../adapters/index.js';

const GAME_ADAPTERS: Record<string, GameAdapter> = {
  'factory-ai-droid': factoryDroidAdapter,
  'charm-crush': charmCrushAdapter
};

const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'];

function parseDifficulty(value: string): 'easy' | 'medium' | 'hard' {
  const normalized = value.toLowerCase() as 'easy' | 'medium' | 'hard';
  if (!VALID_DIFFICULTIES.includes(normalized)) {
    throw new Error(`Invalid difficulty: ${value}. Valid options: ${VALID_DIFFICULTIES.join(', ')}`);
  }
  return normalized;
}

export function gameCommand(program: Command): void {
  program
    .command('game [name]')
    .description('Play puzzle games (factory-ai-droid, charm-crush)')
    .option('--new', 'Start a new game')
    .option('--difficulty <level>', 'Difficulty level (easy, medium, hard)', 'easy')
    .option('--list', 'List game sessions')
    .option('--session <id>', 'Resume specific session by ID')
    .option('--end', 'End current session')
    .option('--stats', 'Show game statistics')
    .option('--cleanup <days>', 'Clean up sessions older than specified days')
    .action(async (name: string | undefined, options: Record<string, unknown>) => {
      try {
        await runGameCommand(name, options);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });
}

async function runGameCommand(name: string | undefined, options: Record<string, unknown>): Promise<void> {
  const {
    new: isNew,
    difficulty,
    list: isList,
    session: sessionId,
    end: isEnd,
    stats: isStats,
    cleanup: cleanupDays
  } = options;

  if (isStats) {
    const stats = getGameSessionStats();
    console.log(`=== Game Statistics ===`);
    console.log(`Total sessions: ${stats.total}`);
    console.log(`Active sessions: ${stats.active}`);
    console.log(`Inactive sessions: ${stats.inactive}`);
    return;
  }

  if (cleanupDays !== undefined) {
    const days = Number(cleanupDays);
    if (isNaN(days) || days <= 0) {
      throw new Error('--cleanup requires a positive number of days');
    }
    const ms = days * 24 * 60 * 60 * 1000;
    const count = cleanupOldSessions(ms);
    console.log(`Cleaned up ${count} old session(s).`);
    return;
  }

  if (!name) {
    console.log('Available games:');
    console.log('  factory-ai-droid  - Resource management puzzle');
    console.log('  charm-crush      - Match-3 puzzle game');
    console.log('\nUse --stats for overall statistics or --cleanup <days> to clean old sessions.');
    return;
  }

  const adapter = GAME_ADAPTERS[name];
  if (!adapter) {
    throw new Error(`Unknown game: ${name}\nAvailable games: ${Object.keys(GAME_ADAPTERS).join(', ')}`);
  }

  if (isList) {
    const sessions = listGameSessions(name);
    if (sessions.length === 0) {
      console.log(`No sessions found for ${name}.`);
      return;
    }

    console.log(`=== ${name} Sessions ===\n`);
    for (const session of sessions) {
      const status = session.is_active ? 'ACTIVE' : 'INACTIVE';
      const updated = new Date(session.updated_at).toLocaleString();
      console.log(`ID: ${session.id}`);
      console.log(`Status: ${status}`);
      console.log(`Updated: ${updated}`);
      console.log(`---`);
    }
    return;
  }

  if (sessionId) {
    const session = getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (session.game_name !== name) {
      throw new Error(`Session ${sessionId} is for ${session.game_name}, not ${name}`);
    }
    console.log(adapter.renderState(session.state));
    return;
  }

  if (isEnd) {
    const active = getActiveSession(name);
    if (!active) {
      throw new Error(`No active session for ${name}.`);
    }
    endGameSession(active.id);
    console.log(`Session ended. Final state:`);
    console.log(adapter.renderState(active.state));
    return;
  }

  if (isNew) {
    const active = getActiveSession(name);
    if (active) {
      console.log(`Active session exists for ${name}.`);
      console.log('Use --end to end it first, or --session <id> to resume a different session.\n');
      console.log('Current state:');
      console.log(adapter.renderState(active.state));
      return;
    }

    const gameOptions: GameOptions = {
      difficulty: parseDifficulty(String(difficulty))
    };

    const state = adapter.initializeGame(gameOptions);
    const session = createGameSession(name, state);
    console.log(`New ${name} game started!`);
    console.log(`Session ID: ${session.id}`);
    console.log('');
    console.log(adapter.renderState(state));
    return;
  }

  const active = getActiveSession(name);
  if (!active) {
    console.log(`No active session for ${name}.`);
    console.log(`Use --new to start a new game.`);
    return;
  }

  const command = typeof options.args?.[0] === 'string' ? options.args[0] : '';
  if (!command) {
    console.log(adapter.renderState(active.state));
    return;
  }

  const response = await adapter.run(command, { state: active.state });

  if (response.state) {
    updateGameSession(active.id, response.state as Parameters<typeof updateGameSession>[1]);
  }

  console.log(response.content);

  if (response.state && (response.state as { status?: string }).status !== 'playing') {
    endGameSession(active.id);
  }
}

export { GAME_ADAPTERS, parseDifficulty };
