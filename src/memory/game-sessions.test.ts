import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { GameSessionManager } from './game-sessions';
import { unlinkSync, existsSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

describe('GameSessionManager - Schema Fix', () => {
  let manager: GameSessionManager;
  let testDbPath: string;

  beforeEach(() => {
    // Use temporary directory for test database
    const testDir = path.join(tmpdir(), `puzldai-test-${Date.now()}`);
    testDbPath = path.join(testDir, 'game-sessions.db');
    manager = new GameSessionManager(path.dirname(testDbPath));
  });

  afterEach(() => {
    manager.close();
    // Clean up test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('Multiple Inactive Sessions', () => {
    it('should allow multiple inactive sessions for the same game', () => {
      const gameName = 'factory-ai-droid';

      // Create first session
      const session1 = manager.createSession(gameName, {
        status: 'playing',
        message: 'Session 1'
      });

      // End it (make inactive)
      manager.endSession(session1);

      // Create second session
      const session2 = manager.createSession(gameName, {
        status: 'playing',
        message: 'Session 2'
      });

      // End it
      manager.endSession(session2);

      // Create third session
      const session3 = manager.createSession(gameName, {
        status: 'playing',
        message: 'Session 3'
      });

      // End it
      manager.endSession(session3);

      // Verify all three sessions exist
      const sessions = manager.listSessions(gameName);
      expect(sessions.length).toBe(3);

      // Verify all are inactive
      const inactiveSessions = sessions.filter(s => !s.isActive);
      expect(inactiveSessions.length).toBe(3);
    });
  });

  describe('Single Active Session Constraint', () => {
    it('should only allow one active session per game', () => {
      const gameName = 'charm-crush';

      // Create first session (automatically active)
      const session1 = manager.createSession(gameName, {
        status: 'playing',
        message: 'Session 1'
      });

      // Verify it's active
      let activeSession = manager.getActiveSession(gameName);
      expect(activeSession?.id).toBe(session1);
      expect(activeSession?.state.message).toBe('Session 1');

      // Create second session (should automatically deactivate first)
      const session2 = manager.createSession(gameName, {
        status: 'playing',
        message: 'Session 2'
      });

      // Verify only session2 is active now
      activeSession = manager.getActiveSession(gameName);
      expect(activeSession?.id).toBe(session2);
      expect(activeSession?.state.message).toBe('Session 2');

      // Verify session1 still exists but is inactive
      const session1Data = manager.getSession(session1);
      expect(session1Data).not.toBeNull();
      expect(session1Data?.isActive).toBe(false);

      // Verify total sessions
      const allSessions = manager.listSessions(gameName);
      expect(allSessions.length).toBe(2);

      // Verify only one is active
      const activeSessions = allSessions.filter(s => s.isActive);
      expect(activeSessions.length).toBe(1);
      expect(activeSessions[0].id).toBe(session2);
    });
  });

  describe('Multiple Games', () => {
    it('should allow one active session per game independently', () => {
      // Create active session for factory-ai-droid
      const factorySession = manager.createSession('factory-ai-droid', {
        status: 'playing',
        message: 'Factory game'
      });

      // Create active session for charm-crush
      const charmSession = manager.createSession('charm-crush', {
        status: 'playing',
        message: 'Charm game'
      });

      // Both should be active
      const factoryActive = manager.getActiveSession('factory-ai-droid');
      const charmActive = manager.getActiveSession('charm-crush');

      expect(factoryActive?.id).toBe(factorySession);
      expect(charmActive?.id).toBe(charmSession);
      expect(factoryActive?.isActive).toBe(true);
      expect(charmActive?.isActive).toBe(true);
    });
  });

  describe('Session Management', () => {
    it('should handle complete lifecycle correctly', () => {
      const gameName = 'factory-ai-droid';

      // Create and end multiple sessions
      for (let i = 1; i <= 5; i++) {
        const sessionId = manager.createSession(gameName, {
          status: 'playing',
          message: `Session ${i}`
        });

        // Only end the first 4, leave 5th active
        if (i < 5) {
          manager.endSession(sessionId);
        }
      }

      // Verify stats
      const stats = manager.getStats();
      expect(stats.total).toBe(5);
      expect(stats.active).toBe(1);
      expect(stats.byGame['factory-ai-droid']).toBe(5);

      // List sessions for this game
      const sessions = manager.listSessions(gameName);
      expect(sessions.length).toBe(5);

      const inactiveSessions = sessions.filter(s => !s.isActive);
      expect(inactiveSessions.length).toBe(4);

      const activeSessions = sessions.filter(s => s.isActive);
      expect(activeSessions.length).toBe(1);
    });
  });

  describe('Cleanup', () => {
    it('should clean up old inactive sessions', () => {
      const gameName = 'factory-ai-droid';

      // Create and immediately end sessions
      for (let i = 1; i <= 3; i++) {
        const sessionId = manager.createSession(gameName, {
          status: 'playing',
          message: `Old session ${i}`
        });
        manager.endSession(sessionId);
      }

      // Create one active session
      manager.createSession(gameName, {
        status: 'playing',
        message: 'Current session'
      });

      // Verify we have 4 sessions total (3 inactive + 1 active)
      let sessions = manager.listSessions(gameName);
      expect(sessions.length).toBe(4);

      // Clean up sessions older than 0 days (all inactive)
      const cleaned = manager.cleanupOldSessions(0);
      expect(cleaned).toBe(3);

      // Verify only active session remains
      sessions = manager.listSessions(gameName);
      expect(sessions.length).toBe(1);
      expect(sessions[0].isActive).toBe(true);
    });
  });
});
