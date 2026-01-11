/**
 * Charm Crush Game Adapter
 *
 * A colorful match-3 puzzle game where you swap adjacent charms
 * to create matches and achieve score targets.
 *
 * Game Mechanics:
 * - 8x8 board with 6 charm types
 * - Swap adjacent cells to create matches of 3+
 * - Cascade system with combo multipliers
 * - Win by reaching target score before moves run out
 */

import type { GameAdapter, GameOptions, GameState, ModelResponse, RunOptions } from '../lib/types';

interface CharmCrushState extends GameState {
  data: {
    board: string[][];
    score: number;
    movesLeft: number;
    targetScore: number;
    combo: number;
    difficulty: string;
  };
  moves: string[];
}

const CHARM_TYPES = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'];

const DIFFICULTY_SETTINGS = {
  easy: { movesLeft: 30, targetScore: 1000 },
  medium: { movesLeft: 20, targetScore: 1500 },
  hard: { movesLeft: 15, targetScore: 2000 }
};

function createEmptyBoard(): string[][] {
  return Array(8).fill(null).map(() => Array(8).fill(''));
}

function createRandomCharm(): string {
  return CHARM_TYPES[Math.floor(Math.random() * CHARM_TYPES.length)];
}

function hasNoMatches(board: string[][]): boolean {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 6; c++) {
      const charm = board[r][c];
      if (charm && board[r][c+1] === charm && board[r][c+2] === charm) {
        return false;
      }
    }
  }
  for (let c = 0; c < 8; c++) {
    for (let r = 0; r < 6; r++) {
      const charm = board[r][c];
      if (charm && board[r+1][c] === charm && board[r+2][c] === charm) {
        return false;
      }
    }
  }
  return true;
}

function createInitialBoard(): string[][] {
  const board = createEmptyBoard();
  do {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        board[r][c] = createRandomCharm();
      }
    }
  } while (!hasNoMatches(board));
  return board;
}

function createInitialState(options: GameOptions): CharmCrushState {
  const settings = DIFFICULTY_SETTINGS[options.difficulty];
  return {
    status: 'playing',
    moves: [],
    score: 0,
    message: 'Swap adjacent charms to create matches of 3 or more!',
    data: {
      board: createInitialBoard(),
      score: 0,
      movesLeft: settings.movesLeft,
      targetScore: settings.targetScore,
      combo: 1,
      difficulty: options.difficulty
    }
  };
}

function renderCharmCrushState(state: GameState): string {
  const s = state as CharmCrushState;

  let output = `=== Charm Crush ===\n`;
  output += `Difficulty: ${s.data.difficulty}\n\n`;

  if (state.status === 'won') {
    output += `VICTORY! ${state.message}\n\n`;
  } else if (state.status === 'lost') {
    output += `GAME OVER! ${state.message}\n\n`;
  } else if (state.status === 'invalid') {
    output += `ERROR: ${state.message}\n\n`;
  }

  output += `   0 1 2 3 4 5 6 7\n`;
  output += `  ┌─────────────────┐\n`;
  for (let r = 0; r < 8; r++) {
    output += `${r} │ ${s.data.board[r].join(' ')}\n`;
  }
  output += `  └─────────────────┘\n\n`;

  output += `Score: ${s.data.score}/${s.data.targetScore}\n`;
  output += `Moves Left: ${s.data.movesLeft}\n`;

  if (state.status === 'playing' && s.data.combo > 1) {
    output += `Combo: ${s.data.combo}x\n`;
  }

  if (state.status === 'playing') {
    const scoreNeeded = s.data.targetScore - s.data.score;
    output += `\nNeed ${scoreNeeded} more points in ${s.data.movesLeft} moves.\n`;
  }

  return output;
}

function validateCharmCrushCommand(command: string, state: GameState): { valid: boolean; error?: string } {
  if (state.status === 'won' || state.status === 'lost') {
    return { valid: false, error: 'Game is over. Use --new to start a new game.' };
  }

  if (command.startsWith('swap')) {
    const parts = command.split(' ');
    if (parts.length !== 5) {
      return { valid: false, error: 'Usage: swap <row1> <col1> <row2> <col2>' };
    }

    const [_, r1, c1, r2, c2] = parts.map(Number);

    if (isNaN(r1) || isNaN(c1) || isNaN(r2) || isNaN(c2)) {
      return { valid: false, error: 'Coordinates must be numbers (0-7)' };
    }

    if (r1 < 0 || r1 > 7 || c1 < 0 || c1 > 7) {
      return { valid: false, error: `Cell (${r1}, ${c1}) out of bounds (0-7)` };
    }
    if (r2 < 0 || r2 > 7 || c2 < 0 || c2 > 7) {
      return { valid: false, error: `Cell (${r2}, ${c2}) out of bounds (0-7)` };
    }

    const isAdjacent =
      (Math.abs(r1 - r2) === 1 && c1 === c2) ||
      (Math.abs(c1 - c2) === 1 && r1 === r2);

    if (!isAdjacent) {
      return { valid: false, error: 'Cells must be adjacent (not diagonal)' };
    }
  } else if (command === 'hint') {
    return { valid: true };
  } else if (command === 'status' || command === '') {
    return { valid: true };
  } else {
    return { valid: false, error: 'Unknown command. Use: swap <r1> <c1> <r2> <c2>, hint, or status' };
  }

  return { valid: true };
}

function detectMatches(board: string[][]): Array<{row: number; col: number}> {
  const matches: Array<{row: number; col: number}> = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 6; c++) {
      const charm = board[r][c];
      if (charm && board[r][c+1] === charm && board[r][c+2] === charm) {
        matches.push({row: r, col: c}, {row: r, col: c+1}, {row: r, col: c+2});
      }
    }
  }

  for (let c = 0; c < 8; c++) {
    for (let r = 0; r < 6; r++) {
      const charm = board[r][c];
      if (charm && board[r+1][c] === charm && board[r+2][c] === charm) {
        matches.push({row: r, col: c}, {row: r+1, col: c}, {row: r+2, col: c});
      }
    }
  }

  const seen = new Set<string>();
  const unique: Array<{row: number; col: number}> = [];
  for (const m of matches) {
    const key = `${m.row},${m.col}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(m);
    }
  }
  return unique;
}

function applyGravity(board: string[][]): void {
  for (let c = 0; c < 8; c++) {
    let writeRow = 7;
    for (let readRow = 7; readRow >= 0; readRow--) {
      if (board[readRow][c]) {
        if (writeRow !== readRow) {
          board[writeRow][c] = board[readRow][c];
          board[readRow][c] = '';
        }
        writeRow--;
      }
    }
  }
}

function refillBoard(board: string[][]): void {
  for (let c = 0; c < 8; c++) {
    for (let r = 0; r < 8; r++) {
      if (!board[r][c]) {
        board[r][c] = createRandomCharm();
      }
    }
  }
}

function processCascade(state: CharmCrushState): number {
  let combo = 1;
  let totalPoints = 0;

  while (true) {
    const matches = detectMatches(state.data.board);
    if (matches.length === 0) break;

    const points = matches.length * 10 * combo;
    totalPoints += points;

    matches.forEach(({row, col}) => {
      state.data.board[row][col] = '';
    });

    applyGravity(state.data.board);
    refillBoard(state.data.board);

    combo++;
  }

  state.data.combo = combo;
  state.data.score += totalPoints;

  return totalPoints;
}

function checkWinLose(state: CharmCrushState): void {
  if (state.data.score >= state.data.targetScore) {
    state.status = 'won';
    state.message = `Reached ${state.data.targetScore} points with ${state.data.movesLeft} moves left!`;
  } else if (state.data.movesLeft <= 0) {
    state.status = 'lost';
    state.message = `Only ${state.data.score}/${state.data.targetScore} points after using all moves.`;
  } else {
    state.status = 'playing';
  }
}

export const charmCrushAdapter: GameAdapter = {
  name: 'charm-crush',

  async isAvailable(): Promise<boolean> {
    return true;
  },

  initializeGame(options: GameOptions): GameState {
    return createInitialState(options);
  },

  renderState(state: GameState): string {
    return renderCharmCrushState(state);
  },

  validateCommand(command: string, state: GameState): { valid: boolean; error?: string } {
    return validateCharmCrushCommand(command, state);
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const startTime = Date.now();
    const state = options?.state as CharmCrushState ?? createInitialState({ difficulty: 'easy' });

    if (!prompt || prompt === 'status') {
      return {
        content: renderCharmCrushState(state),
        model: this.name,
        duration: Date.now() - startTime,
        state
      };
    }

    const validation = validateCharmCrushCommand(prompt, state);
    if (!validation.valid) {
      return {
        content: `Invalid command: ${validation.error}\n\n${renderCharmCrushState(state)}`,
        model: this.name,
        duration: Date.now() - startTime,
        state: { ...state, status: 'invalid', message: validation.error }
      };
    }

    if (prompt.startsWith('swap')) {
      const parts = prompt.split(' ');
      const [_, r1, c1, r2, c2] = parts.map(Number);

      const temp = state.data.board[r1][c1];
      state.data.board[r1][c1] = state.data.board[r2][c2];
      state.data.board[r2][c2] = temp;

      const matches = detectMatches(state.data.board);
      if (matches.length === 0) {
        state.data.board[r2][c2] = state.data.board[r1][c1];
        state.data.board[r1][c1] = temp;
        return {
          content: `No match created. Try a different swap.\n\n${renderCharmCrushState(state)}`,
          model: this.name,
          duration: Date.now() - startTime,
          state: { ...state, status: 'invalid', message: 'No match created' }
        };
      }

      const pointsEarned = processCascade(state);
      state.data.movesLeft--;
      state.message = `Match! +${pointsEarned} points (${state.data.combo}x combo)`;
      state.moves = [...(state.moves ?? []), prompt];

      checkWinLose(state);
    } else if (prompt === 'hint') {
      const hints: string[] = [];
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 7; c++) {
          const charm = state.data.board[r][c];
          if (charm && state.data.board[r][c+1] === charm) {
            hints.push(`Try swapping (${r}, ${c}) or (${r}, ${c+1}) with adjacent cell`);
          }
        }
      }
      for (let c = 0; c < 8; c++) {
        for (let r = 0; r < 7; r++) {
          const charm = state.data.board[r][c];
          if (charm && state.data.board[r+1][c] === charm) {
            hints.push(`Try swapping (${r}, ${c}) or (${r+1}, ${c}) with adjacent cell`);
          }
        }
      }
      state.message = hints.length > 0 ? hints[0] : 'No obvious moves available';
    }

    return {
      content: renderCharmCrushState(state),
      model: this.name,
      duration: Date.now() - startTime,
      state
    };
  }
};

export {
  type CharmCrushState,
  CHARM_TYPES,
  DIFFICULTY_SETTINGS
};
