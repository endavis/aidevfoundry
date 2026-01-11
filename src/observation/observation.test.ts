/**
 * Observation Export Reliability Tests
 *
 * Tests for ensuring observation export reliability, diff tracking,
 * and preference pair generation.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  startObservation,
  logResponse,
  logReviewDecision,
  completeObservation,
  getObservation,
  getRecentObservations,
  getObservationStats,
  trackDiffDecision,
  trackDiffDecisions,
  getDiffTracking,
  getDiffTrackingStats
} from './logger';

import {
  extractPreferencePairs,
  getPreferenceStats
} from './preference-extractor';

import { initDatabase, closeDatabase, getDatabase } from '../memory/database';

describe('Observation Logger Reliability', () => {
  beforeEach(() => {
    initDatabase();

    // Ensure a clean DB state for deterministic stats assertions
    const db = getDatabase();
    try {
      db.exec('DELETE FROM diff_tracking');
      db.exec('DELETE FROM observations');
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Basic Observation Logging', () => {
    it('should start and retrieve an observation', () => {
      const obsId = startObservation({
        sessionId: 'test-session',
        prompt: 'Add user authentication',
        agent: 'claude',
        model: 'claude-3-5-sonnet'
      });

      expect(obsId).toBeNumber();
      expect(obsId).toBeGreaterThan(0);

      const obs = getObservation(obsId);
      expect(obs).not.toBeNull();
      expect(obs?.prompt).toBe('Add user authentication');
      expect(obs?.agent).toBe('claude');
      expect(obs?.model).toBe('claude-3-5-sonnet');
      expect(obs?.sessionId).toBe('test-session');
    });

    it('should log response to observation', () => {
      const obsId = startObservation({
        prompt: 'Test task',
        agent: 'claude'
      });

      logResponse(obsId, {
        response: 'Here is the code...',
        explanation: 'I implemented the feature',
        proposedFiles: [
          { path: 'src/auth.ts', operation: 'create', content: '...' }
        ],
        durationMs: 1500,
        tokensIn: 100,
        tokensOut: 500
      });

      const obs = getObservation(obsId);
      expect(obs?.response).toBe('Here is the code...');
      expect(obs?.explanation).toBe('I implemented the feature');
      expect(obs?.durationMs).toBe(1500);
      expect(obs?.tokensIn).toBe(100);
      expect(obs?.tokensOut).toBe(500);
      expect(obs?.proposedFiles).toBeTruthy();
    });

    it('should log review decisions', () => {
      const obsId = startObservation({
        prompt: 'Test task',
        agent: 'claude'
      });

      logReviewDecision(obsId, {
        acceptedFiles: ['src/auth.ts', 'src/user.ts'],
        rejectedFiles: ['src/bad.ts'],
        userEdits: {
          'src/auth.ts': 'modified content diff'
        },
        finalFiles: {
          'src/auth.ts': 'final modified content',
          'src/user.ts': 'final user content'
        }
      });

      const obs = getObservation(obsId);
      expect(obs?.acceptedFiles).toBeTruthy();
      expect(obs?.rejectedFiles).toBeTruthy();
      expect(obs?.userEdits).toBeTruthy();
      expect(obs?.finalFiles).toBeTruthy();

      const accepted = JSON.parse(obs?.acceptedFiles || '[]');
      expect(accepted).toContain('src/auth.ts');
    });
  });

  describe('Diff Tracking', () => {
    it('should track a single diff decision', () => {
      const obsId = startObservation({
        prompt: 'Test task',
        agent: 'claude'
      });

      const diffId = trackDiffDecision({
        observationId: obsId,
        filePath: 'src/auth.ts',
        operation: 'create',
        decision: 'accepted',
        diffContent: '+function authenticate() {...}',
        hashBefore: undefined,
        hashAfter: 'abc123'
      });

      expect(diffId).toBeNumber();
      expect(diffId).toBeGreaterThan(0);

      const diffs = getDiffTracking(obsId);
      expect(diffs).toHaveLength(1);
      expect(diffs[0].filePath).toBe('src/auth.ts');
      expect(diffs[0].decision).toBe('accepted');
    });

    it('should track multiple diff decisions', () => {
      const obsId = startObservation({
        prompt: 'Test task',
        agent: 'claude'
      });

      const ids = trackDiffDecisions([
        {
          observationId: obsId,
          filePath: 'src/auth.ts',
          operation: 'create',
          decision: 'accepted'
        },
        {
          observationId: obsId,
          filePath: 'src/bad.ts',
          operation: 'create',
          decision: 'rejected'
        },
        {
          observationId: obsId,
          filePath: 'src/user.ts',
          operation: 'update',
          decision: 'user_edited',
          diffContent: '-old line\n+new line'
        }
      ]);

      expect(ids).toHaveLength(3);

      const diffs = getDiffTracking(obsId);
      expect(diffs).toHaveLength(3);

      const accepted = diffs.filter(d => d.decision === 'accepted');
      expect(accepted).toHaveLength(1);

      const rejected = diffs.filter(d => d.decision === 'rejected');
      expect(rejected).toHaveLength(1);

      const edited = diffs.filter(d => d.decision === 'user_edited');
      expect(edited).toHaveLength(1);
    });

    it('should get diff tracking stats', () => {
      const obsId = startObservation({
        prompt: 'Test task',
        agent: 'claude'
      });

      trackDiffDecisions([
        { observationId: obsId, filePath: 'a.ts', operation: 'create', decision: 'accepted' },
        { observationId: obsId, filePath: 'b.ts', operation: 'create', decision: 'rejected' },
        { observationId: obsId, filePath: 'c.ts', operation: 'update', decision: 'accepted' }
      ]);

      const stats = getDiffTrackingStats();
      expect(stats.total).toBeGreaterThanOrEqual(3);
      expect(stats.accepted).toBe(2);
      expect(stats.rejected).toBe(1);
      expect(stats.userEdited).toBe(0);
    });
  });

  describe('Preference Pair Extraction', () => {
    it('should extract accept/reject preference pairs', () => {
      const obsId = startObservation({
        prompt: 'Test task',
        agent: 'claude'
      });

      logResponse(obsId, {
        proposedFiles: [
          { path: 'src/auth.ts', operation: 'create', content: 'code1' },
          { path: 'src/user.ts', operation: 'create', content: 'code2' },
          { path: 'src/bad.ts', operation: 'create', content: 'code3' }
        ]
      });

      logReviewDecision(obsId, {
        acceptedFiles: ['src/auth.ts'],
        rejectedFiles: ['src/bad.ts']
      });

      const pairs = extractPreferencePairs({ limit: 10 });
      expect(pairs.length).toBeGreaterThan(0);

      const acceptRejectPairs = pairs.filter(p => p.signalType === 'accept_reject');
      expect(acceptRejectPairs.length).toBeGreaterThan(0);
    });

    it('should extract user edit preference pairs', () => {
      const obsId = startObservation({
        prompt: 'Test task',
        agent: 'claude'
      });

      logResponse(obsId, {
        proposedFiles: [
          { path: 'src/auth.ts', operation: 'create', content: 'original code' }
        ]
      });

      logReviewDecision(obsId, {
        userEdits: {
          'src/auth.ts': 'modified code'
        },
        finalFiles: {
          'src/auth.ts': 'final modified code'
        }
      });

      const pairs = extractPreferencePairs({ limit: 10 });
      const editPairs = pairs.filter(p => p.signalType === 'user_edit');
      expect(editPairs.length).toBeGreaterThan(0);
    });

    it('should get preference stats', () => {
      const obsId = startObservation({
        prompt: 'Test task',
        agent: 'claude'
      });

      logResponse(obsId, {
        proposedFiles: [
          { path: 'a.ts', operation: 'create', content: 'code' }
        ]
      });

      logReviewDecision(obsId, {
        acceptedFiles: ['a.ts'],
        rejectedFiles: ['b.ts']
      });

      const stats = getPreferenceStats();
      expect(stats.totalObservations).toBeGreaterThanOrEqual(1);
      expect(stats.withAcceptReject + stats.withUserEdits).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Observation Stats', () => {
    it('should get observation stats', () => {
      const obsId1 = startObservation({ prompt: 'Task 1', agent: 'claude' });
      const obsId2 = startObservation({ prompt: 'Task 2', agent: 'gemini' });

      logResponse(obsId1, { response: 'Response 1' });
      logResponse(obsId2, { response: 'Response 2' });

      logReviewDecision(obsId1, { acceptedFiles: ['a.ts'] });
      logReviewDecision(obsId2, { rejectedFiles: ['b.ts'] });

      const stats = getObservationStats();
      expect(stats.total).toBeGreaterThanOrEqual(2);
      expect(stats.byAgent['claude']).toBeGreaterThanOrEqual(1);
      expect(stats.byAgent['gemini']).toBeGreaterThanOrEqual(1);
      expect(stats.withAccepted).toBeGreaterThanOrEqual(1);
      expect(stats.withRejected).toBeGreaterThanOrEqual(1);
    });

    it('should get recent observations', () => {
      const obsId1 = startObservation({ prompt: 'Task 1', agent: 'claude' });
      const obsId2 = startObservation({ prompt: 'Task 2', agent: 'gemini' });

      logResponse(obsId1, { response: 'Response 1' });
      logResponse(obsId2, { response: 'Response 2' });

      const recent = getRecentObservations({ limit: 10 });
      expect(recent.length).toBeGreaterThanOrEqual(2);
      expect(recent[0].prompt).toBe('Task 2'); // Most recent first
    });
  });

  describe('Export Reliability', () => {
    it('should handle JSON serialization errors gracefully', () => {
      const obsId = startObservation({
        prompt: 'Test task',
        agent: 'claude'
      });

      // Log with malformed JSON that might happen in real scenarios
      logReviewDecision(obsId, {
        acceptedFiles: ['src/auth.ts'],
        userEdits: {
          'src/auth.ts': 'content with "quotes" and \'apostrophes\''
        }
      });

      const obs = getObservation(obsId);
      expect(obs).not.toBeNull();

      // Should be able to parse the stored data
      const userEdits = obs?.userEdits ? JSON.parse(obs.userEdits) : null;
      expect(userEdits).toBeTruthy();
      expect(userEdits?.['src/auth.ts']).toContain('quotes');
    });

    it('should handle empty observation sets', () => {
      const recent = getRecentObservations({ limit: 10 });
      expect(recent).toBeInstanceOf(Array);
    });

    it('should handle missing observation ID gracefully', () => {
      const obs = getObservation(999999);
      expect(obs).toBeNull();
    });
  });
});
