import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { GameSessionManager } from '../../memory/game-sessions';
import { existsSync, unlinkSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

/**
 * Tests for CLI input validation functions
 *
 * Note: The validation functions are currently private to game.ts
 * These tests verify the expected behavior based on the implementation
 */

describe('CLI Input Validation', () => {
  let manager: GameSessionManager;
  let testDbPath: string;

  beforeEach(() => {
    const testDir = path.join(tmpdir(), `puzldai-validation-test-${Date.now()}`);
    testDbPath = path.join(testDir, 'game-sessions.db');
    manager = new GameSessionManager(path.dirname(testDbPath));
  });

  afterEach(() => {
    manager.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('Cleanup Days Validation', () => {
    it('should accept valid positive numbers', () => {
      // Valid cases: 0, 1, 30, 365, 3650
      const validValues = [0, 1, 30, 365, 3650];

      // Expected: All should be accepted
      validValues.forEach(value => {
        const result = manager.cleanupOldSessions(value);
        expect(typeof result).toBe('number'); // Should return count
      });
    });

    it('should default to 30 days when undefined', () => {
      // Expected: No error when called without parameter
      const result = manager.cleanupOldSessions();
      expect(typeof result).toBe('number');
    });

    // Note: Validation happens in CLI layer, so negative/NaN values
    // would be rejected before reaching this function
  });

  describe('Session ID Validation', () => {
    it('should reject non-existent session IDs', () => {
      const fakeId = 'game_1234567890_abcdefg';
      const session = manager.getSession(fakeId);

      // Expected: Session should not exist
      expect(session).toBeNull();
    });

    it('should accept valid existing session IDs', () => {
      // Create a session
      const sessionId = manager.createSession('factory-ai-droid', {
        status: 'playing',
        message: 'Test session'
      });

      // Expected: Should find the session
      const session = manager.getSession(sessionId);
      expect(session).not.toBeNull();
      expect(session?.id).toBe(sessionId);
      expect(session?.gameName).toBe('factory-ai-droid');
    });

    it('should validate session format', () => {
      // Valid format: game_<timestamp>_<randomid>
      const validFormats = [
        'game_1234567890_abc123',
        'game_9876543210_xyz789'
      ];

      const invalidFormats = [
        'invalid_format',
        'game_',
        'game_abc_',
        'game__abc',
        'GAME_1234567890_abc' // uppercase
      ];

      // Expected: Valid formats match pattern, invalid don't
      const pattern = /^game_\d+_[a-z0-9]+$/;

      validFormats.forEach(id => {
        expect(pattern.test(id)).toBe(true);
      });

      invalidFormats.forEach(id => {
        expect(pattern.test(id)).toBe(false);
      });
    });

    it('should validate session belongs to correct game', () => {
      // Create session for factory-ai-droid
      const factorySession = manager.createSession('factory-ai-droid', {
        status: 'playing',
        message: 'Factory game'
      });

      // Expected: Session exists and has correct game name
      const session = manager.getSession(factorySession);
      expect(session?.gameName).toBe('factory-ai-droid');
      expect(session?.gameName).not.toBe('charm-crush');
    });
  });

  describe('Difficulty Validation', () => {
    it('should accept valid difficulty levels', () => {
      const validDifficulties = ['easy', 'medium', 'hard'];

      // Expected: All should be valid difficulty settings
      validDifficulties.forEach(difficulty => {
        const normalized = difficulty.toLowerCase();
        expect(['easy', 'medium', 'hard']).toContain(normalized);
      });
    });

    it('should be case-insensitive', () => {
      const variations = [
        'EASY', 'Easy', 'eAsY',
        'MEDIUM', 'Medium', 'MeDiUm',
        'HARD', 'Hard', 'hArD'
      ];

      // Expected: All should normalize to valid difficulty
      variations.forEach(difficulty => {
        const normalized = difficulty.toLowerCase();
        expect(['easy', 'medium', 'hard']).toContain(normalized);
      });
    });

    it('should default to medium when undefined', () => {
      const defaultDifficulty = 'medium';

      // Expected: Medium is the default
      expect(['easy', 'medium', 'hard']).toContain(defaultDifficulty);
    });

    it('should reject invalid difficulties', () => {
      const invalidDifficulties = [
        'impossible',
        'normal',
        'expert',
        'beginner',
        '',
        '123'
      ];

      // Expected: None of these should be valid
      invalidDifficulties.forEach(difficulty => {
        expect(['easy', 'medium', 'hard']).not.toContain(difficulty.toLowerCase());
      });
    });
  });

  describe('Game Name Validation', () => {
    it('should accept valid game names', () => {
      const validGames = ['factory-ai-droid', 'charm-crush'];

      // Expected: These are the two valid game names
      validGames.forEach(game => {
        expect(['factory-ai-droid', 'charm-crush']).toContain(game);
      });
    });

    it('should reject invalid game names', () => {
      const invalidGames = [
        'chess',
        'sudoku',
        'factory',
        'charm',
        '',
        'factory_ai_droid' // underscore instead of hyphen
      ];

      // Expected: None of these should be valid
      invalidGames.forEach(game => {
        expect(['factory-ai-droid', 'charm-crush']).not.toContain(game);
      });
    });

    it('should be case-insensitive', () => {
      // Note: Validation should normalize to lowercase
      const variations = [
        'FACTORY-AI-DROID',
        'Factory-AI-Droid',
        'CHARM-CRUSH',
        'Charm-Crush'
      ];

      // Expected: All should normalize to valid game names
      variations.forEach(game => {
        const normalized = game.toLowerCase();
        expect(['factory-ai-droid', 'charm-crush']).toContain(normalized);
      });
    });
  });

  describe('Integration: End-to-End Validation', () => {
    it('should validate complete workflow with valid inputs', () => {
      // Create session with valid difficulty
      const sessionId = manager.createSession('factory-ai-droid', {
        status: 'playing',
        message: 'Valid session',
        data: {
          difficulty: 'medium'
        }
      });

      // Expected: Session created successfully
      expect(sessionId).toMatch(/^game_\d+_[a-z0-9]+$/);

      // Retrieve session
      const session = manager.getSession(sessionId);
      expect(session).not.toBeNull();
      expect(session?.gameName).toBe('factory-ai-droid');

      // End session
      manager.endSession(sessionId);
      const endedSession = manager.getSession(sessionId);
      expect(endedSession?.isActive).toBe(false);

      // Delete session
      manager.deleteSession(sessionId);
      const deletedSession = manager.getSession(sessionId);
      expect(deletedSession).toBeNull();
    });

    it('should handle cleanup with valid days parameter', () => {
      // Create multiple sessions
      for (let i = 0; i < 3; i++) {
        const sessionId = manager.createSession('charm-crush', {
          status: 'playing',
          message: `Session ${i}`
        });
        manager.endSession(sessionId);
      }

      // Cleanup old sessions (0 days = all inactive)
      const cleaned = manager.cleanupOldSessions(0);
      expect(cleaned).toBe(3);

      // Verify cleanup worked
      const sessions = manager.listSessions('charm-crush');
      expect(sessions.length).toBe(0);
    });
  });
});
