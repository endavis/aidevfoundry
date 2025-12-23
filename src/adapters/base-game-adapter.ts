import type { Adapter } from '../lib/types';

/**
 * Game state interface - minimal structure for puzzle games
 */
export interface GameState {
  status: 'playing' | 'won' | 'lost' | 'invalid';
  moves?: string[];
  score?: number;
  message?: string;
  data?: unknown; // Game-specific data
}

/**
 * Extended adapter interface for game-based adapters
 * Provides common game functionality while maintaining Adapter compatibility
 */
export interface GameAdapter extends Adapter {
  /**
   * Initialize a new game with optional difficulty/settings
   */
  initializeGame(options?: Record<string, unknown>): GameState;

  /**
   * Render the current game state as a formatted string
   */
  renderState(state: GameState): string;

  /**
   * Validate if a command is legal in the current state
   */
  validateCommand?(command: string, state: GameState): boolean;
}

/**
 * Base utility functions for game adapters
 */
export const GameAdapterUtils = {
  /**
   * Create a standardized game response
   */
  createResponse(state: GameState, adapter: GameAdapter, duration: number, error?: string) {
    return {
      content: error || adapter.renderState(state),
      model: adapter.name,
      duration,
      error,
      state // Include state in response for session persistence
    };
  },

  /**
   * Parse difficulty from prompt
   */
  parseDifficulty(prompt: string): string {
    const match = prompt.match(/difficulty[:\s]+(\w+)/i);
    return match?.[1]?.toLowerCase() || 'medium';
  },

  /**
   * Check if prompt is requesting new game
   */
  isNewGameRequest(prompt: string): boolean {
    return /new\s+game|start|begin|init/i.test(prompt);
  }
};
