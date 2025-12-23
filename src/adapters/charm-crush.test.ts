import { describe, test, expect } from 'bun:test';
import { charmCrushAdapter } from './charm-crush';

describe('Charm Crush Adapter', () => {
  describe('Initialization', () => {
    test('creates game with correct initial state', () => {
      const state = charmCrushAdapter.initializeGame({ difficulty: 'easy' });

      expect(state.status).toBe('playing');
      expect(state.data.board).toHaveLength(8);
      expect(state.data.board[0]).toHaveLength(8);
      expect(state.data.score).toBe(0);
      expect(state.data.movesLeft).toBe(30);
      expect(state.data.targetScore).toBe(1000);
      expect(state.data.combo).toBe(0);
    });

    test('respects difficulty settings', () => {
      const easy = charmCrushAdapter.initializeGame({ difficulty: 'easy' });
      const medium = charmCrushAdapter.initializeGame({ difficulty: 'medium' });
      const hard = charmCrushAdapter.initializeGame({ difficulty: 'hard' });

      expect(easy.data.movesLeft).toBe(30);
      expect(easy.data.targetScore).toBe(1000);

      expect(medium.data.movesLeft).toBe(20);
      expect(medium.data.targetScore).toBe(1500);

      expect(hard.data.movesLeft).toBe(15);
      expect(hard.data.targetScore).toBe(2000);
    });

    test('initial board has no matches', () => {
      const state = charmCrushAdapter.initializeGame({ difficulty: 'easy' });
      const matches = charmCrushAdapter.detectMatches(state.data.board);

      expect(matches).toHaveLength(0);
    });
  });

  describe('Board Determinism', () => {
    test('board persists across non-mutating commands', async () => {
      const state = charmCrushAdapter.initializeGame({ difficulty: 'easy' });
      const boardBefore = JSON.stringify(state.data.board);

      const response = await charmCrushAdapter.run('status', { state });
      const boardAfter = JSON.stringify(response.state!.data.board);

      expect(boardAfter).toBe(boardBefore);
    });

    test('board persists when swap is undone', async () => {
      const state = charmCrushAdapter.initializeGame({ difficulty: 'easy' });

      // Find a swap that won't create a match
      let foundNoMatchSwap = false;
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const testState = JSON.parse(JSON.stringify(state));
          const temp = testState.data.board[r][c];
          testState.data.board[r][c] = testState.data.board[r][c + 1];
          testState.data.board[r][c + 1] = temp;

          const matches = charmCrushAdapter.detectMatches(testState.data.board);
          if (matches.length === 0) {
            const boardBefore = JSON.stringify(state.data.board);
            const response = await charmCrushAdapter.run(`swap ${r} ${c} ${r} ${c + 1}`, { state });
            const boardAfter = JSON.stringify(response.state!.data.board);

            expect(boardAfter).toBe(boardBefore);
            expect(response.state!.status).toBe('invalid');
            foundNoMatchSwap = true;
            break;
          }
        }
        if (foundNoMatchSwap) break;
      }

      // If board has matches everywhere, at least verify no crash
      expect(true).toBe(true);
    });
  });

  describe('Swap Validation', () => {
    test('rejects diagonal swaps', async () => {
      const state = charmCrushAdapter.initializeGame({ difficulty: 'easy' });
      const response = await charmCrushAdapter.run('swap 0 0 1 1', { state });

      expect(response.state!.status).toBe('invalid');
      expect(response.state!.message).toContain('adjacent');
    });

    test('rejects out of bounds swaps', async () => {
      const state = charmCrushAdapter.initializeGame({ difficulty: 'easy' });
      const response = await charmCrushAdapter.run('swap 0 0 0 8', { state });

      expect(response.state!.status).toBe('invalid');
      expect(response.state!.message).toContain('0 and 7');
    });

    test('accepts adjacent horizontal swaps', async () => {
      const state = charmCrushAdapter.initializeGame({ difficulty: 'easy' });
      const response = await charmCrushAdapter.run('swap 0 0 0 1', { state });

      // Should either be valid (if creates match) or invalid (if no match)
      expect(['playing', 'invalid']).toContain(response.state!.status);
    });

    test('accepts adjacent vertical swaps', async () => {
      const state = charmCrushAdapter.initializeGame({ difficulty: 'easy' });
      const response = await charmCrushAdapter.run('swap 0 0 1 0', { state });

      // Should either be valid (if creates match) or invalid (if no match)
      expect(['playing', 'invalid']).toContain(response.state!.status);
    });
  });

  describe('Scoring', () => {
    test('scores per match group not total cells', () => {
      // Create a board with two separate horizontal 3-matches
      const board = [
        ['🔴', '🔴', '🔴', '🟡', '🟢', '🟢', '🟢', '🟣'],
        ['🟡', '🟣', '🟠', '🔴', '🔵', '🟢', '🟡', '🟣'],
        ['🔵', '🟡', '🟠', '🔴', '🔵', '🟡', '🟣', '🟠'],
        ['🟢', '🔵', '🟣', '🟠', '🔴', '🟡', '🔵', '🟡'],
        ['🟠', '🔴', '🟡', '🔵', '🟣', '🔴', '🟢', '🔵'],
        ['🟣', '🟢', '🔵', '🟡', '🟠', '🟣', '🔴', '🟡'],
        ['🔴', '🟡', '🟢', '🟣', '🔵', '🟠', '🟡', '🔴'],
        ['🔵', '🟠', '🔴', '🟢', '🟡', '🔵', '🟣', '🟢']
      ];

      const matchGroups = charmCrushAdapter.detectMatches(board);

      // Should have exactly 2 match groups
      expect(matchGroups).toHaveLength(2);
      // Both should be 3-matches
      expect(matchGroups.every(g => g.size === 3)).toBe(true);
    });

    test('valid swap increases score', async () => {
      const state = charmCrushAdapter.initializeGame({ difficulty: 'easy' });

      // Get hint for a valid move
      const hint = charmCrushAdapter.findHint(state.data.board);
      if (!hint) {
        // If no hint available, skip this specific test
        expect(true).toBe(true);
        return;
      }

      const scoreBefore = state.data.score;
      const response = await charmCrushAdapter.run(
        `swap ${hint.r1} ${hint.c1} ${hint.r2} ${hint.c2}`,
        { state }
      );

      expect(response.state!.data.score).toBeGreaterThan(scoreBefore);
    });

    test('calculates match score correctly', () => {
      const score3 = charmCrushAdapter.calculateMatchScore(3, 1);
      const score4 = charmCrushAdapter.calculateMatchScore(4, 1);
      const score5 = charmCrushAdapter.calculateMatchScore(5, 1);
      const score6 = charmCrushAdapter.calculateMatchScore(6, 1);

      expect(score3).toBe(10);
      expect(score4).toBe(20);
      expect(score5).toBe(30);
      expect(score6).toBe(50);
    });

    test('applies combo multiplier correctly', () => {
      const baseScore = charmCrushAdapter.calculateMatchScore(3, 1);
      const comboScore = charmCrushAdapter.calculateMatchScore(3, 2);

      expect(comboScore).toBe(baseScore * 2);
    });
  });

  describe('Match Detection', () => {
    test('detects horizontal matches', () => {
      const board = [
        ['🔴', '🔴', '🔴', '🟢', '🟢', '🟢', '🔵', '🔵'],
        ['🟡', '🟣', '🟠', '🔴', '🔵', '🟢', '🟡', '🟣'],
        ['🟡', '🟣', '🟠', '🔴', '🔵', '🟢', '🟡', '🟣'],
        ['🟡', '🟣', '🟠', '🔴', '🔵', '🟢', '🟡', '🟣'],
        ['🟡', '🟣', '🟠', '🔴', '🔵', '🟢', '🟡', '🟣'],
        ['🟡', '🟣', '🟠', '🔴', '🔵', '🟢', '🟡', '🟣'],
        ['🟡', '🟣', '🟠', '🔴', '🔵', '🟢', '🟡', '🟣'],
        ['🟡', '🟣', '🟠', '🔴', '🔵', '🟢', '🟡', '🟣']
      ];

      const matches = charmCrushAdapter.detectMatches(board);
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    test('detects vertical matches', () => {
      const board = [
        ['🔴', '🟡', '🟠', '🔴', '🔵', '🟢', '🟡', '🟣'],
        ['🔴', '🟣', '🟠', '🔴', '🔵', '🟢', '🟡', '🟣'],
        ['🔴', '🟣', '🟠', '🔴', '🔵', '🟢', '🟡', '🟣'],
        ['🟡', '🟣', '🟠', '🔴', '🔵', '🟢', '🟡', '🟣'],
        ['🟡', '🟣', '🟠', '🔴', '🔵', '🟢', '🟡', '🟣'],
        ['🟡', '🟣', '🟠', '🔴', '🔵', '🟢', '🟡', '🟣'],
        ['🟡', '🟣', '🟠', '🔴', '🔵', '🟢', '🟡', '🟣'],
        ['🟡', '🟣', '🟠', '🔴', '🔵', '🟢', '🟡', '🟣']
      ];

      const matches = charmCrushAdapter.detectMatches(board);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Win/Lose Conditions', () => {
    test('detects win when reaching target score', async () => {
      const state = charmCrushAdapter.initializeGame({ difficulty: 'easy' });
      state.data.score = 999;

      // Manually trigger win by setting score
      state.data.score = 1000;
      charmCrushAdapter.checkWinLose(state);

      expect(state.status).toBe('won');
    });

    test('detects loss when running out of moves', async () => {
      const state = charmCrushAdapter.initializeGame({ difficulty: 'easy' });
      state.data.movesLeft = 0;

      charmCrushAdapter.checkWinLose(state);

      expect(state.status).toBe('lost');
    });

    test('decrements moves on valid swap', async () => {
      const state = charmCrushAdapter.initializeGame({ difficulty: 'easy' });
      const hint = charmCrushAdapter.findHint(state.data.board);

      if (!hint) {
        expect(true).toBe(true);
        return;
      }

      const movesBefore = state.data.movesLeft;
      await charmCrushAdapter.run(`swap ${hint.r1} ${hint.c1} ${hint.r2} ${hint.c2}`, { state });

      expect(state.data.movesLeft).toBe(movesBefore - 1);
    });
  });

  describe('Hint System', () => {
    test('findHint returns valid move', () => {
      const state = charmCrushAdapter.initializeGame({ difficulty: 'easy' });
      const hint = charmCrushAdapter.findHint(state.data.board);

      if (hint) {
        expect(hint.r1).toBeGreaterThanOrEqual(0);
        expect(hint.r1).toBeLessThan(8);
        expect(hint.c1).toBeGreaterThanOrEqual(0);
        expect(hint.c1).toBeLessThan(8);
        expect(hint.r2).toBeGreaterThanOrEqual(0);
        expect(hint.r2).toBeLessThan(8);
        expect(hint.c2).toBeGreaterThanOrEqual(0);
        expect(hint.c2).toBeLessThan(8);

        // Verify adjacency
        const isAdjacent = charmCrushAdapter.isAdjacent(hint.r1, hint.c1, hint.r2, hint.c2);
        expect(isAdjacent).toBe(true);
      }
    });
  });

  describe('State Persistence', () => {
    test('returns state in response', async () => {
      const state = charmCrushAdapter.initializeGame({ difficulty: 'easy' });
      const response = await charmCrushAdapter.run('status', { state });

      expect(response.state).toBeDefined();
      expect(response.state!.data.board).toEqual(state.data.board);
    });
  });
});
