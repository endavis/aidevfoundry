/**
 * Game CLI Command
 */

import type { Command } from 'commander';
import type { GameAdapter, GameOptions, GameSession, GameState } from '../../lib/types';
import { factoryDroidAdapter, charmCrushAdapter } from '../../adapters';
import {
  createGameSession,
  getActiveGameSession,
  getGameSession,
  listGameSessions,
  updateGameSession,
  endGameSession,
  activateGameSession,
  deleteGameSession,
  cleanupOldGameSessions,
  getGameSessionStats
} from '../../memory';

const GAME_ADAPTERS: Record<string, GameAdapter> = {
  'factory-ai-droid': factoryDroidAdapter,
  'charm-crush': charmCrushAdapter
};

const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

type Difficulty = (typeof VALID_DIFFICULTIES)[number];

type GameCommandOpts = {
  new?: boolean;
  difficulty?: string;
  list?: boolean;
  session?: string;
  end?: boolean;
  delete?: string;
  stats?: boolean;
  cleanup?: string;
};

function parseDifficulty(value: string): Difficulty {
  const normalized = value.toLowerCase() as Difficulty;
  if (!VALID_DIFFICULTIES.includes(normalized)) {
    throw new Error(`Invalid difficulty: ${value}. Valid options: ${VALID_DIFFICULTIES.join(', ')}`);
  }
  return normalized;
}

function renderSessionList(sessions: GameSession[]): void {
  for (const s of sessions) {
    const status = s.isActive ? 'ACTIVE' : 'INACTIVE';
    console.log(`ID: ${s.id}`);
    console.log(`Game: ${s.gameName}`);
    console.log(`Status: ${status}`);
    console.log(`Updated: ${new Date(s.updatedAt).toLocaleString()}`);
    console.log('---');
  }
}

export function gameCommand(program: Command): void {
  program
    .command('game')
    .description('Play puzzle games (factory-ai-droid, charm-crush)')
    .argument('[name]', 'Game name')
    .argument('[command...]', 'Game command to send to active session')
    .option('--new', 'Start a new game')
    .option('--difficulty <level>', 'Difficulty level (easy, medium, hard)', 'easy')
    .option('--list', 'List game sessions')
    .option('--session <id>', 'Activate and show a specific session by ID')
    .option('--end', 'End current active session for the game')
    .option('--delete <id>', 'Delete a session by ID')
    .option('--stats', 'Show game statistics')
    .option('--cleanup <days>', 'Delete inactive sessions older than N days')
    .action(async (name: string | undefined, commandParts: string[], opts: GameCommandOpts) => {
      try {
        await runGameCommand(name, commandParts, opts);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });
}

async function runGameCommand(
  name: string | undefined,
  commandParts: string[],
  opts: GameCommandOpts
): Promise<void> {
  if (opts.stats) {
    const stats = getGameSessionStats();
    console.log('=== Game Statistics ===');
    console.log(`Total sessions: ${stats.total}`);
    console.log(`Active sessions: ${stats.active}`);
    console.log(`Inactive sessions: ${stats.inactive}`);
    return;
  }

  if (opts.cleanup !== undefined) {
    const days = Number(opts.cleanup);
    if (Number.isNaN(days) || days <= 0) {
      throw new Error('--cleanup requires a positive number of days');
    }
    const count = cleanupOldGameSessions(days * 24 * 60 * 60 * 1000);
    console.log(`Deleted ${count} old inactive session(s).`);
    return;
  }

  if (opts.delete) {
    const session = getGameSession(opts.delete);
    if (!session) {
      throw new Error(`Session not found: ${opts.delete}`);
    }
    deleteGameSession(opts.delete);
    console.log(`Deleted session ${opts.delete} (${session.gameName}).`);
    return;
  }

  if (opts.list) {
    const sessions = listGameSessions(name);
    if (sessions.length === 0) {
      console.log(name ? `No sessions found for ${name}.` : 'No game sessions found.');
      return;
    }

    console.log('=== Game Sessions ===\n');
    renderSessionList(sessions);
    return;
  }

  if (opts.session) {
    const session = getGameSession(opts.session);
    if (!session) {
      throw new Error(`Session not found: ${opts.session}`);
    }

    if (name && session.gameName !== name) {
      throw new Error(`Session ${opts.session} is for ${session.gameName}, not ${name}`);
    }

    activateGameSession(opts.session);
    const adapter = GAME_ADAPTERS[session.gameName];
    if (!adapter) {
      throw new Error(`Unknown game: ${session.gameName}`);
    }

    console.log(adapter.renderState(session.state));
    return;
  }

  if (!name) {
    console.log('Available games:');
    console.log('  factory-ai-droid  - Resource management puzzle');
    console.log('  charm-crush       - Match-3 puzzle game');
    console.log('\nUse --stats, --list, or --cleanup <days>.');
    return;
  }

  const adapter = GAME_ADAPTERS[name];
  if (!adapter) {
    throw new Error(`Unknown game: ${name}. Available games: ${Object.keys(GAME_ADAPTERS).join(', ')}`);
  }

  if (opts.end) {
    const active = getActiveGameSession(name);
    if (!active) {
      console.log(`No active session for ${name}.`);
      return;
    }

    endGameSession(active.id);
    console.log('Session ended. Final state:');
    console.log(adapter.renderState(active.state));
    return;
  }

  if (opts.new) {
    const existing = getActiveGameSession(name);
    if (existing) {
      console.log(`Active session exists for ${name}.`);
      console.log('Use --end to end it first, or --session <id> to resume a different session.\n');
      console.log('Current state:');
      console.log(adapter.renderState(existing.state));
      return;
    }

    const gameOptions: GameOptions = {
      difficulty: parseDifficulty(opts.difficulty ?? 'easy')
    };

    const state = adapter.initializeGame(gameOptions);
    const session = createGameSession(name, state);

    console.log(`New ${name} game started!`);
    console.log(`Session ID: ${session.id}`);
    console.log('');
    console.log(adapter.renderState(state));
    return;
  }

  const active = getActiveGameSession(name);
  if (!active) {
    console.log(`No active session for ${name}.`);
    console.log('Use --new to start a new game.');
    return;
  }

  const commandText = commandParts.join(' ').trim();
  if (!commandText) {
    console.log(adapter.renderState(active.state));
    return;
  }

  const validation = adapter.validateCommand?.(commandText, active.state);
  if (validation && !validation.valid) {
    console.log(`Invalid command: ${validation.error}`);
    console.log('');
    console.log(adapter.renderState(active.state));
    return;
  }

  const response = await adapter.run(commandText, { state: active.state });
  const newState = (response.state as GameState | undefined) ?? active.state;

  updateGameSession(active.id, newState);
  console.log(response.content);

  if (newState.status === 'won' || newState.status === 'lost') {
    endGameSession(active.id);
  }
}
