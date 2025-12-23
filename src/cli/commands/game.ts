import { adapters } from '../../adapters';
import type { GameAdapter } from '../../adapters/base-game-adapter';
import { GameSessionManager } from '../../memory/game-sessions';
import pc from 'picocolors';

/**
 * CLI command for playing puzzle games
 * Supports Factory AI Droid and Charm Crush
 */

interface GameOptions {
  difficulty?: string;
  new?: boolean;
  session?: string;
  list?: boolean;
  stats?: boolean;
  end?: boolean;
  delete?: string;
  cleanup?: number;
}

// ============================================================================
// Validation Helpers
// ============================================================================

const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const VALID_GAME_NAMES = ['factory-ai-droid', 'charm-crush'] as const;

/**
 * Validate cleanup days option
 */
function validateCleanupDays(days: unknown): { valid: boolean; value?: number; error?: string } {
  if (days === undefined) {
    return { valid: true, value: 30 }; // Default
  }

  const parsed = typeof days === 'number' ? days : Number(days);

  if (isNaN(parsed)) {
    return { valid: false, error: 'Cleanup days must be a number' };
  }

  if (parsed < 0) {
    return { valid: false, error: 'Cleanup days cannot be negative' };
  }

  if (parsed > 3650) {
    return { valid: false, error: 'Cleanup days cannot exceed 3650 (10 years)' };
  }

  return { valid: true, value: Math.floor(parsed) };
}

/**
 * Validate session ID format and existence
 */
function validateSessionId(
  id: string,
  manager: GameSessionManager,
  requiredGame?: string
): { valid: boolean; error?: string } {
  if (!id || typeof id !== 'string') {
    return { valid: false, error: 'Session ID must be a non-empty string' };
  }

  // Check basic format (game_timestamp_randomid)
  if (!/^game_\d+_[a-z0-9]+$/.test(id)) {
    return {
      valid: false,
      error: `Invalid session ID format: '${id}'`
    };
  }

  // Check existence
  const session = manager.getSession(id);
  if (!session) {
    return {
      valid: false,
      error: `Session not found: '${id}'`
    };
  }

  // Check game name if required
  if (requiredGame && session.gameName !== requiredGame) {
    return {
      valid: false,
      error: `Session '${id}' belongs to '${session.gameName}', not '${requiredGame}'`
    };
  }

  return { valid: true };
}

/**
 * Validate difficulty setting
 */
function validateDifficulty(difficulty: unknown): { valid: boolean; value?: string; error?: string } {
  if (difficulty === undefined) {
    return { valid: true, value: 'medium' }; // Default
  }

  if (typeof difficulty !== 'string') {
    return { valid: false, error: 'Difficulty must be a string' };
  }

  const normalized = difficulty.toLowerCase();

  if (!VALID_DIFFICULTIES.includes(normalized as typeof VALID_DIFFICULTIES[number])) {
    return {
      valid: false,
      error: `Invalid difficulty '${difficulty}'. Must be one of: ${VALID_DIFFICULTIES.join(', ')}`
    };
  }

  return { valid: true, value: normalized };
}

/**
 * Validate game name
 */
function validateGameName(gameName: unknown): { valid: boolean; value?: string; error?: string } {
  if (!gameName || typeof gameName !== 'string') {
    return {
      valid: false,
      error: 'Game name must be a non-empty string'
    };
  }

  const normalized = gameName.toLowerCase();

  // Check if adapter exists
  if (!adapters[normalized]) {
    return {
      valid: false,
      error: `Game '${gameName}' not found. Available: ${VALID_GAME_NAMES.join(', ')}`
    };
  }

  // Check if it's a game adapter
  const adapter = adapters[normalized] as GameAdapter;
  if (!adapter.initializeGame || !adapter.renderState) {
    return {
      valid: false,
      error: `'${gameName}' is not a game adapter`
    };
  }

  return { valid: true, value: normalized };
}

export async function gameCommand(
  gameName: string,
  prompt?: string,
  options: GameOptions = {}
) {
  const sessionManager = new GameSessionManager();

  try {
    // Show statistics
    if (options.stats) {
      const stats = sessionManager.getStats();
      console.log(pc.cyan('\n=== Game Session Statistics ===\n'));
      console.log(`Total sessions: ${pc.bold(stats.total.toString())}`);
      console.log(`Active sessions: ${pc.green(stats.active.toString())}`);
      console.log('\nSessions by game:');
      Object.entries(stats.byGame).forEach(([game, count]) => {
        console.log(`  ${pc.bold(game)}: ${count}`);
      });
      console.log('');
      return;
    }

    // Cleanup old sessions
    if (options.cleanup !== undefined) {
      const validation = validateCleanupDays(options.cleanup);
      if (!validation.valid) {
        console.error(pc.red(`\nError: ${validation.error}\n`));
        console.log(pc.dim('Usage: --cleanup <days>'));
        console.log(pc.dim('Example: --cleanup 30 (remove sessions older than 30 days)\n'));
        return;
      }

      const days = validation.value!;
      const deleted = sessionManager.cleanupOldSessions(days);
      console.log(pc.green(`\nCleaned up ${deleted} sessions older than ${days} days\n`));
      return;
    }

    // Delete specific session
    if (options.delete) {
      const validation = validateSessionId(options.delete, sessionManager);
      if (!validation.valid) {
        console.error(pc.red(`\nError: ${validation.error}\n`));
        console.log(pc.dim('Usage: --delete <session-id>'));
        console.log(pc.dim('Tip: Use --list to see available sessions\n'));
        return;
      }

      sessionManager.deleteSession(options.delete);
      console.log(pc.green(`\nDeleted session ${options.delete}\n`));
      return;
    }

    // List sessions
    if (options.list) {
      const sessions = sessionManager.listSessions(gameName || undefined);
      const displayName = gameName || 'All Games';
      console.log(pc.cyan(`\n=== ${displayName} Sessions ===\n`));

      if (sessions.length === 0) {
        console.log(pc.dim('No sessions found.'));
        return;
      }

      sessions.forEach(session => {
        const statusBadge = session.isActive
          ? pc.green('[active]')
          : pc.dim('[ended]');

        console.log(`${pc.bold(session.id)} ${statusBadge}`);
        console.log(`  Game: ${pc.cyan(session.gameName)}`);
        console.log(`  Created: ${pc.dim(new Date(session.createdAt).toLocaleString())}`);
        console.log(`  Updated: ${pc.dim(new Date(session.updatedAt).toLocaleString())}`);
        console.log(`  Status: ${session.state.status}`);
        if (session.state.score !== undefined) {
          console.log(`  Score: ${session.state.score}`);
        }
        console.log('');
      });
      return;
    }

    // Validate game name for actual gameplay
    if (!gameName) {
      console.error(pc.red('Error: Game name required'));
      console.log(pc.dim('\nAvailable games:'));
      VALID_GAME_NAMES.forEach(name => console.log(pc.dim(`  - ${name}`)));
      console.log(pc.dim('\nUsage:'));
      console.log(pc.dim('  puzldai game <game-name> [options]'));
      console.log(pc.dim('  puzldai game --list              # List all sessions'));
      console.log(pc.dim('  puzldai game --stats             # Show statistics'));
      return;
    }

    // Validate and get adapter
    const gameValidation = validateGameName(gameName);
    if (!gameValidation.valid) {
      console.error(pc.red(`\nError: ${gameValidation.error}\n`));
      return;
    }

    const gameAdapter = adapters[gameValidation.value!] as GameAdapter;

    // End active session
    if (options.end) {
      const session = sessionManager.getActiveSession(gameValidation.value!);
      if (!session) {
        console.error(pc.red('\nNo active session to end.\n'));
        console.log(pc.dim(`Tip: Use --list to see available sessions\n`));
        return;
      }
      sessionManager.endSession(session.id);
      console.log(pc.green(`\nEnded session ${session.id}\n`));
      return;
    }

    // Start new game (only when explicitly requested)
    if (options.new) {
      const difficultyValidation = validateDifficulty(options.difficulty);
      if (!difficultyValidation.valid) {
        console.error(pc.red(`\nError: ${difficultyValidation.error}\n`));
        return;
      }

      const difficulty = difficultyValidation.value!;
      const state = gameAdapter.initializeGame({ difficulty });
      const sessionId = sessionManager.createSession(gameValidation.value!, state);

      console.log(pc.green(`\n✓ Started new ${gameValidation.value!} game`));
      console.log(pc.dim(`  Difficulty: ${difficulty}`));
      console.log(pc.dim(`  Session ID: ${sessionId}\n`));
      console.log(gameAdapter.renderState(state));
      console.log(pc.dim('\nTip: Use the same command to send game commands'));
      console.log(pc.dim('     Use --end to finish the session'));
      return;
    }

    // Get session for gameplay
    let session;
    if (options.session) {
      const sessionValidation = validateSessionId(options.session, sessionManager, gameValidation.value!);
      if (!sessionValidation.valid) {
        console.error(pc.red(`\nError: ${sessionValidation.error}\n`));
        console.log(pc.dim(`Tip: Use --list to see available sessions for ${gameValidation.value!}\n`));
        return;
      }
      session = sessionManager.getSession(options.session);
    } else {
      session = sessionManager.getActiveSession(gameValidation.value!);
    }

    if (!session) {
      console.error(pc.red('\nNo active game session found.'));
      console.log(pc.dim(`Start a new game with: puzldai game ${gameValidation.value!} --new\n`));
      return;
    }

    // If no prompt, show current state
    if (!prompt) {
      console.log(pc.yellow('\nShowing current game state:\n'));
      console.log(gameAdapter.renderState(session.state));
      console.log(pc.dim(`\nSession: ${session.id}`));
      return;
    }

    // Execute game command
    console.log(pc.dim(`\n⚙️  Processing: ${prompt}\n`));

    // Validate command before running (if adapter supports it)
    if (gameAdapter.validateCommand) {
      const isValid = gameAdapter.validateCommand(prompt, session.state);
      if (!isValid) {
        console.error(pc.red('\n✗ Invalid command format or game state does not allow this command\n'));
        console.log(pc.dim('Use "help" to see available commands'));
        return;
      }
    }

    // Run command with current state
    const response = await gameAdapter.run(prompt, { state: session.state });

    if (response.error) {
      console.error(pc.red(`\n✗ Error: ${response.error}\n`));
      return;
    }

    // Update session with new state if present
    if (response.state) {
      sessionManager.updateSession(session.id, response.state);

      // End session if game is won or lost
      if (response.state.status === 'won' || response.state.status === 'lost') {
        sessionManager.endSession(session.id);
      }
    }

    console.log(response.content);

    console.log(pc.dim(`\n✓ Completed in ${response.duration}ms`));
    console.log(pc.dim(`Session: ${session.id}`));

  } catch (err: unknown) {
    console.error(pc.red(`\nUnexpected error: ${(err as Error).message}\n`));
  } finally {
    sessionManager.close();
  }
}
