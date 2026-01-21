/**
 * Tests for Campaign Metrics and Observability
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  MetricsCollector,
  createMetricsCollector,
  calculateMetrics,
  formatDuration,
  formatPercent,
  formatRate,
  generateMetricsSummary,
  exportMetricsJson,
  type MetricsSnapshot,
  type MetricsEvent
} from './campaign-metrics.js';
import type { CampaignState, CampaignTask } from './campaign-state.js';

// Test helpers
function createTestTask(
  id: string,
  status: CampaignTask['status'] = 'pending',
  attempts = 0
): CampaignTask {
  const now = Date.now();
  return {
    id,
    title: `Task ${id}`,
    description: `Description for task ${id}`,
    status,
    dependencies: [],
    acceptanceCriteria: [],
    assignedFiles: [],
    attempts,
    createdAt: now,
    updatedAt: now
  };
}

function createTestState(tasks: CampaignTask[]): CampaignState {
  return {
    campaignId: 'test-campaign',
    goal: 'Test campaign goal',
    status: 'running',
    version: 1,
    createdAt: Date.now() - 60000, // Started 1 minute ago
    updatedAt: Date.now(),
    tasks,
    checkpoints: [],
    decisions: [],
    artifacts: [],
    meta: {
      planner: 'claude',
      subPlanner: 'claude',
      workers: ['claude'],
      maxWorkers: 1,
      checkpointEvery: 5,
      freshStartEvery: 10,
      autonomy: 'auto',
      gitMode: 'campaign-branch',
      mergeStrategy: 'merge',
      useDroid: false
    }
  };
}

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = createMetricsCollector();
  });

  describe('constructor', () => {
    it('should create collector with default options', () => {
      const c = new MetricsCollector();
      expect(c).toBeDefined();
    });

    it('should create collector with custom options', () => {
      const events: MetricsEvent[] = [];
      const c = new MetricsCollector({
        enableEvents: true,
        maxEvents: 500,
        onEvent: (e) => events.push(e)
      });
      expect(c).toBeDefined();
    });
  });

  describe('event recording', () => {
    it('should record task started event', () => {
      collector.recordTaskStarted('t1');
      const events = collector.getEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('task_started');
      expect(events[0].taskId).toBe('t1');
    });

    it('should record task completed event', () => {
      collector.recordTaskStarted('t1');
      collector.recordTaskCompleted('t1');
      const events = collector.getEvents();
      expect(events.length).toBe(2);
      expect(events[1].type).toBe('task_completed');
    });

    it('should record task failed event', () => {
      collector.recordTaskFailed('t1', 'Test error');
      const events = collector.getEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('task_failed');
      expect(events[0].data?.error).toBe('Test error');
    });

    it('should record task retried event', () => {
      collector.recordTaskRetried('t1', 2);
      const events = collector.getEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('task_retried');
      expect(events[0].data?.attempt).toBe(2);
    });

    it('should record checkpoint event', () => {
      collector.recordCheckpoint('cp-123');
      const events = collector.getEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('checkpoint');
      expect(events[0].data?.checkpointId).toBe('cp-123');
    });

    it('should record drift check event', () => {
      collector.recordDriftCheck({
        drifted: true,
        severity: 'moderate',
        drift_areas: [{ domain: 'global', description: 'test', contributing_tasks: [], severity: 'moderate' }],
        confidence: 0.8
      });
      const events = collector.getEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('drift_check');
    });

    it('should record drift correction event', () => {
      collector.recordDriftCorrection(2, 1, 0);
      const events = collector.getEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('drift_correction');
      expect(events[0].data?.tasksAdded).toBe(2);
    });
  });

  describe('event filtering', () => {
    it('should filter events by type', () => {
      collector.recordTaskStarted('t1');
      collector.recordTaskCompleted('t1');
      collector.recordTaskStarted('t2');
      collector.recordTaskFailed('t2');

      const started = collector.getEventsByType('task_started');
      expect(started.length).toBe(2);

      const failed = collector.getEventsByType('task_failed');
      expect(failed.length).toBe(1);
    });
  });

  describe('snapshot generation', () => {
    it('should generate snapshot from state', () => {
      const state = createTestState([
        createTestTask('t1', 'completed'),
        createTestTask('t2', 'completed'),
        createTestTask('t3', 'failed', 2),
        createTestTask('t4', 'in_progress'),
        createTestTask('t5', 'pending')
      ]);

      const snapshot = collector.getSnapshot(state);

      expect(snapshot.campaignId).toBe('test-campaign');
      expect(snapshot.tasksTotal).toBe(5);
      expect(snapshot.tasksCompleted).toBe(2);
      expect(snapshot.tasksFailed).toBe(1);
      expect(snapshot.tasksInProgress).toBe(1);
      expect(snapshot.tasksPending).toBe(1);
      expect(snapshot.progressPercent).toBe(40);
      expect(snapshot.totalRetries).toBe(2);
    });

    it('should calculate failure rate correctly', () => {
      const state = createTestState([
        createTestTask('t1', 'completed'),
        createTestTask('t2', 'completed'),
        createTestTask('t3', 'failed'),
        createTestTask('t4', 'failed')
      ]);

      const snapshot = collector.getSnapshot(state);

      // 2 failed out of 4 attempted = 50%
      expect(snapshot.failureRate).toBe(50);
    });

    it('should track task durations', () => {
      collector.recordTaskStarted('t1');
      // Simulate some time passing
      collector.recordTaskCompleted('t1');

      const state = createTestState([createTestTask('t1', 'completed')]);
      const snapshot = collector.getSnapshot(state);

      // Duration should be tracked (will be very small in test)
      expect(snapshot.avgTaskDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should track drift metrics', () => {
      collector.recordDriftCheck({
        drifted: true,
        severity: 'moderate',
        drift_areas: [],
        confidence: 0.8
      });
      collector.recordDriftCorrection(1, 0, 0);

      const state = createTestState([createTestTask('t1')]);
      const snapshot = collector.getSnapshot(state);

      expect(snapshot.driftChecks).toBe(1);
      expect(snapshot.driftCorrections).toBe(1);
      expect(snapshot.lastDriftSeverity).toBe('moderate');
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      collector.recordTaskStarted('t1');
      collector.recordDriftCheck({ drifted: false, severity: 'minor', drift_areas: [], confidence: 1 });
      collector.reset();

      expect(collector.getEvents().length).toBe(0);

      const state = createTestState([createTestTask('t1')]);
      const snapshot = collector.getSnapshot(state);
      expect(snapshot.driftChecks).toBe(0);
    });
  });

  describe('event streaming', () => {
    it('should call onEvent callback', () => {
      const events: MetricsEvent[] = [];
      const c = createMetricsCollector({
        onEvent: (e) => events.push(e)
      });

      c.recordTaskStarted('t1');
      c.recordTaskCompleted('t1');

      expect(events.length).toBe(2);
    });

    it('should respect maxEvents limit', () => {
      const c = createMetricsCollector({ maxEvents: 5 });

      for (let i = 0; i < 10; i++) {
        c.recordTaskStarted(`t${i}`);
      }

      expect(c.getEvents().length).toBe(5);
    });
  });
});

describe('calculateMetrics', () => {
  it('should calculate metrics from state without collector', () => {
    const state = createTestState([
      createTestTask('t1', 'completed'),
      createTestTask('t2', 'completed'),
      createTestTask('t3', 'failed', 1),
      createTestTask('t4', 'pending')
    ]);

    const snapshot = calculateMetrics(state);

    expect(snapshot.tasksTotal).toBe(4);
    expect(snapshot.tasksCompleted).toBe(2);
    expect(snapshot.tasksFailed).toBe(1);
    expect(snapshot.progressPercent).toBe(50);
    expect(snapshot.totalRetries).toBe(1);
  });

  it('should handle empty task list', () => {
    const state = createTestState([]);
    const snapshot = calculateMetrics(state);

    expect(snapshot.tasksTotal).toBe(0);
    expect(snapshot.progressPercent).toBe(0);
    expect(snapshot.failureRate).toBe(0);
  });
});

describe('formatDuration', () => {
  it('should format milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('should format seconds', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(30000)).toBe('30.0s');
    expect(formatDuration(59999)).toBe('60.0s');
  });

  it('should format minutes', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(3540000)).toBe('59m 0s');
  });

  it('should format hours', () => {
    expect(formatDuration(3600000)).toBe('1h 0m');
    expect(formatDuration(5400000)).toBe('1h 30m');
    expect(formatDuration(7260000)).toBe('2h 1m');
  });
});

describe('formatPercent', () => {
  it('should format percentage with default decimals', () => {
    expect(formatPercent(50)).toBe('50.0%');
    expect(formatPercent(33.333)).toBe('33.3%');
  });

  it('should format percentage with custom decimals', () => {
    expect(formatPercent(50, 0)).toBe('50%');
    expect(formatPercent(33.333, 2)).toBe('33.33%');
  });
});

describe('formatRate', () => {
  it('should format as per minute for values >= 1', () => {
    expect(formatRate(1)).toBe('1.0/m');
    expect(formatRate(5.5)).toBe('5.5/m');
  });

  it('should format as per hour for values < 1', () => {
    expect(formatRate(0.5)).toBe('30.0/h');
    expect(formatRate(0.1)).toBe('6.0/h');
  });
});

describe('generateMetricsSummary', () => {
  it('should generate summary text', () => {
    const snapshot: MetricsSnapshot = {
      timestamp: Date.now(),
      campaignId: 'test-123',
      tasksTotal: 10,
      tasksCompleted: 5,
      tasksFailed: 1,
      tasksBlocked: 0,
      tasksInProgress: 2,
      tasksPending: 2,
      progressPercent: 50,
      completionRate: 2,
      failureRate: 16.7,
      totalRetries: 3,
      avgRetriesPerTask: 0.3,
      tasksWithRetries: 2,
      elapsedMs: 150000,
      avgTaskDurationMs: 30000,
      estimatedRemainingMs: 150000,
      driftChecks: 1,
      driftCorrections: 0,
      lastDriftSeverity: 'minor'
    };

    const summary = generateMetricsSummary(snapshot);

    expect(summary).toContain('Campaign: test-123');
    expect(summary).toContain('Progress: 50%');
    expect(summary).toContain('Completed: 5');
    expect(summary).toContain('Failed: 1');
    expect(summary).toContain('Drift:');
  });
});

describe('exportMetricsJson', () => {
  it('should export metrics as JSON', () => {
    const snapshot: MetricsSnapshot = {
      timestamp: 12345,
      campaignId: 'test',
      tasksTotal: 5,
      tasksCompleted: 2,
      tasksFailed: 0,
      tasksBlocked: 0,
      tasksInProgress: 1,
      tasksPending: 2,
      progressPercent: 40,
      completionRate: 1,
      failureRate: 0,
      totalRetries: 0,
      avgRetriesPerTask: 0,
      tasksWithRetries: 0,
      elapsedMs: 60000,
      avgTaskDurationMs: 0,
      estimatedRemainingMs: 0,
      driftChecks: 0,
      driftCorrections: 0
    };

    const json = exportMetricsJson(snapshot);
    const parsed = JSON.parse(json);

    expect(parsed.campaignId).toBe('test');
    expect(parsed.tasksTotal).toBe(5);
  });
});

describe('createMetricsCollector', () => {
  it('should create collector via factory function', () => {
    const collector = createMetricsCollector();
    expect(collector).toBeInstanceOf(MetricsCollector);
  });

  it('should pass options to collector', () => {
    const events: MetricsEvent[] = [];
    const collector = createMetricsCollector({
      onEvent: (e) => events.push(e)
    });

    collector.recordTaskStarted('t1');
    expect(events.length).toBe(1);
  });
});
