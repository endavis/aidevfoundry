import type { GameAdapter, GameState } from './base-game-adapter';
import { GameAdapterUtils } from './base-game-adapter';
import type { ModelResponse, RunOptions } from '../lib/types';

/**
 * Charm Crush - Match-3 puzzle game
 *
 * Swap adjacent charms to create matches and reach score targets
 */

interface CharmCrushState extends GameState {
  data: {
    board: string[][]; // 8x8 grid of charms
    score: number;
    movesLeft: number;
    targetScore: number;
    combo: number;
  };
}

const CHARMS = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'];

export const charmCrushAdapter: GameAdapter = {
  name: 'charm-crush',

  async isAvailable(): Promise<boolean> {
    // Pure logic game - always available
    return true;
  },

  initializeGame(options: Record<string, unknown> = {}): CharmCrushState {
    const difficulty = (options.difficulty as string) || 'medium';

    const config = {
      easy: { moves: 30, target: 1000 },
      medium: { moves: 20, target: 1500 },
      hard: { moves: 15, target: 2000 }
    }[difficulty] || { moves: 20, target: 1500 };

    // Create initial board ensuring no initial matches
    const board = this.createInitialBoard();

    return {
      status: 'playing',
      moves: [],
      score: 0,
      data: {
        board,
        score: 0,
        movesLeft: config.moves,
        targetScore: config.target,
        combo: 0
      }
    };
  },

  // Helper: Create initial 8x8 board with no matches
  createInitialBoard(): string[][] {
    const board: string[][] = [];

    for (let row = 0; row < 8; row++) {
      board[row] = [];
      for (let col = 0; col < 8; col++) {
        let charm: string;
        let attempts = 0;

        // Keep trying until we get a charm that doesn't create a match
        do {
          charm = CHARMS[Math.floor(Math.random() * CHARMS.length)];
          attempts++;

          // Safety: if we can't find a non-matching charm after 50 attempts, just use it
          if (attempts > 50) break;

          // Check if this would create a horizontal match
          const horizontalMatch = col >= 2 &&
            board[row][col - 1] === charm &&
            board[row][col - 2] === charm;

          // Check if this would create a vertical match
          const verticalMatch = row >= 2 &&
            board[row - 1][col] === charm &&
            board[row - 2][col] === charm;

          if (!horizontalMatch && !verticalMatch) break;
        } while (true);

        board[row][col] = charm;
      }
    }

    return board;
  },

  // Helper: Get random charm
  getRandomCharm(): string {
    return CHARMS[Math.floor(Math.random() * CHARMS.length)];
  },

  // Helper: Check if two cells are adjacent (not diagonal)
  isAdjacent(r1: number, c1: number, r2: number, c2: number): boolean {
    const rowDiff = Math.abs(r1 - r2);
    const colDiff = Math.abs(c1 - c2);

    // Adjacent means exactly one cell away in one direction
    return (rowDiff === 1 && colDiff === 0) || (rowDiff === 0 && colDiff === 1);
  },

  // Helper: Detect all matches on the board (returns match groups with sizes)
  detectMatches(board: string[][]): Array<{cells: Array<{row: number, col: number}>, size: number}> {
    const matchGroups: Array<{cells: Array<{row: number, col: number}>, size: number}> = [];
    const processed = new Set<string>();

    // Check horizontal matches
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 6; col++) {
        const charm = board[row][col];
        if (!charm || processed.has(`${row},${col}`)) continue;

        // Count consecutive matching charms
        let count = 1;
        for (let k = col + 1; k < 8 && board[row][k] === charm; k++) {
          count++;
        }

        // If 3+ match, record this group
        if (count >= 3) {
          const cells: Array<{row: number, col: number}> = [];
          for (let k = 0; k < count; k++) {
            cells.push({ row, col: col + k });
            processed.add(`${row},${col + k}`);
          }
          matchGroups.push({ cells, size: count });
        }
      }
    }

    // Check vertical matches
    for (let col = 0; col < 8; col++) {
      for (let row = 0; row < 6; row++) {
        const charm = board[row][col];
        if (!charm || processed.has(`${row},${col}`)) continue;

        // Count consecutive matching charms
        let count = 1;
        for (let k = row + 1; k < 8 && board[k][col] === charm; k++) {
          count++;
        }

        // If 3+ match, record this group
        if (count >= 3) {
          const cells: Array<{row: number, col: number}> = [];
          for (let k = 0; k < count; k++) {
            cells.push({ row: row + k, col });
            processed.add(`${row + k},${col}`);
          }
          matchGroups.push({ cells, size: count });
        }
      }
    }

    return matchGroups;
  },

  // Helper: Clear matched charms and return count
  clearMatches(board: string[][], matches: Array<{row: number, col: number}>): number {
    matches.forEach(({ row, col }) => {
      board[row][col] = '';
    });
    return matches.length;
  },

  // Helper: Apply gravity - drop charms down to fill empty spaces
  applyGravity(board: string[][]): void {
    for (let col = 0; col < 8; col++) {
      // Collect all non-empty charms in this column
      const charms: string[] = [];
      for (let row = 0; row < 8; row++) {
        if (board[row][col]) {
          charms.push(board[row][col]);
        }
      }

      // Fill column from bottom up
      for (let row = 7; row >= 0; row--) {
        if (charms.length > 0) {
          board[row][col] = charms.pop()!;
        } else {
          board[row][col] = '';
        }
      }
    }
  },

  // Helper: Refill board with new random charms
  refillBoard(board: string[][]): void {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if (!board[row][col]) {
          board[row][col] = this.getRandomCharm();
        }
      }
    }
  },

  // Helper: Calculate score for match based on size
  calculateMatchScore(matchCount: number, combo: number): number {
    let baseScore: number;

    if (matchCount === 3) {
      baseScore = 10;
    } else if (matchCount === 4) {
      baseScore = 20;
    } else if (matchCount === 5) {
      baseScore = 30;
    } else {
      baseScore = 50; // 6+
    }

    return baseScore * Math.max(1, combo);
  },

  // Helper: Process cascades - keep matching until no more matches
  processCascade(state: CharmCrushState): number {
    let cascadeCount = 0;
    let totalScore = 0;

    while (true) {
      // Check for matches
      const matchGroups = this.detectMatches(state.data.board);

      if (matchGroups.length === 0) {
        // No more matches, reset combo
        state.data.combo = 0;
        break;
      }

      // Increment cascade count
      cascadeCount++;
      const combo = cascadeCount;

      // Calculate score for each match group separately
      let cascadeScore = 0;
      const allCells: Array<{row: number, col: number}> = [];

      for (const group of matchGroups) {
        const groupScore = this.calculateMatchScore(group.size, combo);
        cascadeScore += groupScore;
        allCells.push(...group.cells);
      }

      // Clear all matched cells
      this.clearMatches(state.data.board, allCells);

      state.data.score += cascadeScore;
      totalScore += cascadeScore;
      state.data.combo = combo;

      // Apply gravity and refill
      this.applyGravity(state.data.board);
      this.refillBoard(state.data.board);
    }

    state.score = state.data.score; // Update top-level score
    return totalScore;
  },

  // Helper: Find a valid hint move
  findHint(board: string[][]): { r1: number; c1: number; r2: number; c2: number } | null {
    // Try every possible swap
    for (let r1 = 0; r1 < 8; r1++) {
      for (let c1 = 0; c1 < 8; c1++) {
        // Try swapping with right neighbor
        if (c1 < 7) {
          const r2 = r1;
          const c2 = c1 + 1;

          // Perform swap
          const temp = board[r1][c1];
          board[r1][c1] = board[r2][c2];
          board[r2][c2] = temp;

          // Check for matches
          const matchGroups = this.detectMatches(board);

          // Undo swap
          board[r2][c2] = board[r1][c1];
          board[r1][c1] = temp;

          if (matchGroups.length > 0) {
            return { r1, c1, r2, c2 };
          }
        }

        // Try swapping with bottom neighbor
        if (r1 < 7) {
          const r2 = r1 + 1;
          const c2 = c1;

          // Perform swap
          const temp = board[r1][c1];
          board[r1][c1] = board[r2][c2];
          board[r2][c2] = temp;

          // Check for matches
          const matchGroups = this.detectMatches(board);

          // Undo swap
          board[r2][c2] = board[r1][c1];
          board[r1][c1] = temp;

          if (matchGroups.length > 0) {
            return { r1, c1, r2, c2 };
          }
        }
      }
    }

    return null;
  },

  // Helper: Check win/lose conditions
  checkWinLose(state: CharmCrushState): void {
    // Check win condition
    if (state.data.score >= state.data.targetScore) {
      state.status = 'won';
      state.message = `Victory! Score: ${state.data.score} (target: ${state.data.targetScore})`;
    }
    // Check lose condition
    else if (state.data.movesLeft <= 0) {
      state.status = 'lost';
      state.message = `Game Over! Score: ${state.data.score}/${state.data.targetScore}`;
    }
  },

  renderState(state: CharmCrushState): string {
    const { board, score, movesLeft, targetScore, combo } = state.data;

    let output = `
╔═══════════════════════════════════════════╗
║           CHARM CRUSH                     ║
╚═══════════════════════════════════════════╝

Score: ${score} / ${targetScore}
Moves Left: ${movesLeft}
${combo > 0 ? `Combo: ${combo}x` : ''}

    0  1  2  3  4  5  6  7
  ┌──────────────────────────┐
${board.map((row, i) => `${i} │ ${row.join(' ')} │`).join('\n')}
  └──────────────────────────┘

Status: ${state.status.toUpperCase()}`;

    if (state.message) {
      output += `\n⚠️  ${state.message}`;
    }

    output += `

Available commands:
  • swap <r1> <c1> <r2> <c2>  - Swap two adjacent charms (e.g., swap 0 0 0 1)
  • hint                      - Get move suggestion
  • status                    - Show current status
  • help                      - Show detailed help`;

    return output.trim();
  },

  validateCommand(command: string, state: CharmCrushState): boolean {
    if (state.status !== 'playing') return false;

    const trimmed = command.trim().toLowerCase();

    // Validate swap command format
    if (trimmed.startsWith('swap')) {
      const parts = trimmed.split(/\s+/);
      if (parts.length !== 5) return false;

      const [, r1, c1, r2, c2] = parts.map(Number);
      return !isNaN(r1) && !isNaN(c1) && !isNaN(r2) && !isNaN(c2);
    }

    // Other valid commands
    return /^(hint|status|help)/i.test(trimmed);
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const startTime = Date.now();

    try {
      // Handle new game requests
      if (GameAdapterUtils.isNewGameRequest(prompt)) {
        const difficulty = GameAdapterUtils.parseDifficulty(prompt);
        const state = this.initializeGame({ difficulty });

        return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);
      }

      // Get current state from options or initialize a new game
      let state: CharmCrushState;
      if (options && 'state' in options && options.state) {
        state = options.state as CharmCrushState;
      } else {
        state = this.initializeGame();
      }

      // Parse command
      const trimmed = prompt.trim().toLowerCase();

      // Don't allow moves if game is over
      if (state.status !== 'playing' && !['status', 'help'].includes(trimmed)) {
        state.message = 'Game is over. Start a new game to continue playing.';
        return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);
      }

      // Handle status command
      if (trimmed === 'status') {
        state.message = 'Current game status';
        return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);
      }

      // Handle help command
      if (trimmed === 'help') {
        state.message = `
CHARM CRUSH - Game Rules

GOAL: Reach ${state.data.targetScore} points within ${state.data.movesLeft} moves

HOW TO PLAY:
  • Swap two adjacent charms to create matches of 3 or more
  • Matches are cleared and new charms fall from the top
  • Cascading matches increase your combo multiplier

SCORING:
  • 3-match: 10 points × combo
  • 4-match: 20 points × combo
  • 5-match: 30 points × combo
  • 6+-match: 50 points × combo

COMMANDS:
  • swap <r1> <c1> <r2> <c2> - Swap charms at coordinates (0-7)
  • hint                     - Get a move suggestion
  • status                   - Show current game state
  • help                     - Show this help message

EXAMPLE:
  swap 0 0 0 1  - Swaps charm at row 0, col 0 with row 0, col 1
        `.trim();
        return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);
      }

      // Handle hint command
      if (trimmed === 'hint') {
        const hint = this.findHint(state.data.board);

        if (hint) {
          state.message = `Try: swap ${hint.r1} ${hint.c1} ${hint.r2} ${hint.c2}`;
        } else {
          state.message = 'No valid moves found! This is rare - the board may be in a locked state.';
        }

        return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);
      }

      // Handle swap command
      if (trimmed.startsWith('swap')) {
        const parts = trimmed.split(/\s+/);

        if (parts.length !== 5) {
          state.status = 'invalid';
          state.message = 'Invalid swap format. Use: swap <r1> <c1> <r2> <c2>';
          return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);
        }

        const [, r1Str, c1Str, r2Str, c2Str] = parts;
        const r1 = parseInt(r1Str, 10);
        const c1 = parseInt(c1Str, 10);
        const r2 = parseInt(r2Str, 10);
        const c2 = parseInt(c2Str, 10);

        // Validate coordinates
        if (isNaN(r1) || isNaN(c1) || isNaN(r2) || isNaN(c2)) {
          state.status = 'invalid';
          state.message = 'Invalid coordinates. All values must be numbers.';
          return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);
        }

        if (r1 < 0 || r1 > 7 || c1 < 0 || c1 > 7 || r2 < 0 || r2 > 7 || c2 < 0 || c2 > 7) {
          state.status = 'invalid';
          state.message = 'Coordinates must be between 0 and 7';
          return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);
        }

        // Check adjacency
        if (!this.isAdjacent(r1, c1, r2, c2)) {
          state.status = 'invalid';
          state.message = 'Cells must be adjacent (not diagonal)';
          return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);
        }

        // Perform swap
        const temp = state.data.board[r1][c1];
        state.data.board[r1][c1] = state.data.board[r2][c2];
        state.data.board[r2][c2] = temp;

        // Check for matches
        const matches = this.detectMatches(state.data.board);

        if (matches.length === 0) {
          // No match, undo swap
          state.data.board[r2][c2] = state.data.board[r1][c1];
          state.data.board[r1][c1] = temp;

          state.status = 'invalid';
          state.message = 'Invalid swap: No match created. Try another move.';
          return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);
        }

        // Valid match - decrement moves
        state.data.movesLeft--;
        state.moves = [...(state.moves || []), trimmed];

        // Process cascade and get total score
        const scoreGained = this.processCascade(state);

        // Check win/lose conditions
        this.checkWinLose(state);

        if (state.status === 'playing') {
          state.message = `Valid swap! Score: +${scoreGained} (total: ${state.data.score})`;
        }

        return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);
      }

      // Unknown command
      state.status = 'invalid';
      state.message = 'Unknown command. Use: swap <r1> <c1> <r2> <c2>, hint, status, or help';
      return GameAdapterUtils.createResponse(state, this, Date.now() - startTime);

    } catch (err: unknown) {
      const state: CharmCrushState = {
        status: 'invalid',
        message: (err as Error).message,
        score: 0,
        moves: [],
        data: {
          board: this.createInitialBoard(),
          score: 0,
          movesLeft: 0,
          targetScore: 1500,
          combo: 0
        }
      };

      return GameAdapterUtils.createResponse(
        state,
        this,
        Date.now() - startTime,
        (err as Error).message
      );
    }
  }
};
