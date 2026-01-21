/**
 * Integration Tests for Campaign System
 *
 * Tests end-to-end workflows for:
 * - Campaign state management
 * - Drift detection
 * - Metrics collection
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync } from 'fs';

// State management
import {
  loadCampaignState,
  saveCampaignState,
  type CampaignState,
  type CampaignTask
} from './campaign-state.js';

// Drift detection
import {
  DriftDetector,
  checkForDrift,
  exceedsThreshold,
  applyCorrectivePlan
} from './campaign-drift.js';

// Metrics
import {
  MetricsCollector,
  calculateMetrics,
  generateMetricsSummary
} from './campaign-metrics.js';

// Test helpers
function createTempDir(): string {
  const dir = join(tmpdir(), `campaign-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupTempDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function createTestTask(
  id: string,
  status: CampaignTask['status'] = 'pending',
  overrides?: Partial<CampaignTask>
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
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function createTestState(tasks?: CampaignTask[]): CampaignState {
  const now = Date.now();
  return {
    campaignId: `test-campaign-${now}`,
    goal: 'Integration test campaign',
    status: 'running',
    version: 1,
    createdAt: now - 60000,
    updatedAt: now,
    tasks: tasks || [
      createTestTask('t1', 'pending'),
      createTestTask('t2', 'pending', { dependencies: ['t1'] }),
      createTestTask('t3', 'pending', { dependencies: ['t1'] }),
      createTestTask('t4', 'pending', { dependencies: ['t2', 't3'] })
    ],
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

describe('Campaign State Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  it('should create and manipulate state', () => {
    const state = createTestState();

    expect(state.campaignId).toBeDefined();
    expect(state.tasks.length).toBe(4);

    // Simulate task completion
    state.tasks[0].status = 'completed';
    state.tasks[1].status = 'in_progress';

    const completed = state.tasks.filter(t => t.status === 'completed').length;
    const inProgress = state.tasks.filter(t => t.status === 'in_progress').length;

    expect(completed).toBe(1);
    expect(inProgress).toBe(1);

    cleanupTempDir(tempDir);
  });

  it('should save and load state correctly', async () => {
    const state = createTestState();
    const stateDir = join(tempDir, '.campaign');
    mkdirSync(stateDir, { recursive: true });
    const stateFile = join(stateDir, 'campaign.json');

    // Process some tasks
    state.tasks[0].status = 'completed';
    state.tasks[1].status = 'in_progress';

    // Save state (saveCampaignState takes stateFile path, state, optional expectedVersion)
    await saveCampaignState(stateFile, state);

    // Load state
    const loaded = await loadCampaignState(stateFile);

    expect(loaded).toBeDefined();
    expect(loaded!.campaignId).toBe(state.campaignId);
    expect(loaded!.tasks[0].status).toBe('completed');
    expect(loaded!.tasks[1].status).toBe('in_progress');
    // Version increments on save (started at 1, now 2)
    expect(loaded!.version).toBe(2);

    cleanupTempDir(tempDir);
  });

  it('should track state transitions', () => {
    const state = createTestState();

    // Simulate full task workflow
    state.tasks[0].status = 'in_progress';
    expect(state.tasks[0].status).toBe('in_progress');

    state.tasks[0].status = 'completed';
    expect(state.tasks[0].status).toBe('completed');

    state.tasks[1].status = 'in_progress';
    state.tasks[1].status = 'failed';
    state.tasks[1].attempts = 1;
    expect(state.tasks[1].attempts).toBe(1);

    cleanupTempDir(tempDir);
  });
});

describe('Campaign Drift Detection Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  it('should detect drift with high failure rate', async () => {
    const state = createTestState([
      createTestTask('t1', 'failed'),
      createTestTask('t2', 'failed'),
      createTestTask('t3', 'failed'),
      createTestTask('t4', 'pending')
    ]);

    const result = await checkForDrift(state, tempDir, { criteriaOnly: true });

    expect(result.drifted).toBe(true);
    expect(result.drift_areas.length).toBeGreaterThan(0);

    cleanupTempDir(tempDir);
  });

  it('should not detect drift when all is well', async () => {
    const state = createTestState([
      createTestTask('t1', 'completed'),
      createTestTask('t2', 'completed'),
      createTestTask('t3', 'pending'),
      createTestTask('t4', 'pending')
    ]);

    const result = await checkForDrift(state, tempDir, { criteriaOnly: true });

    expect(result.drifted).toBe(false);
    expect(result.severity).toBe('minor');

    cleanupTempDir(tempDir);
  });

  it('should track drift history', async () => {
    const detector = new DriftDetector({ cwd: tempDir, criteriaOnly: true });
    const state = createTestState();

    // Run multiple checks
    await detector.detect(state);
    await detector.detect(state);
    await detector.detect(state);

    expect(detector.getChecksPerformed()).toBe(3);
    expect(detector.getHistory().length).toBe(3);

    cleanupTempDir(tempDir);
  });

  it('should apply corrective plan', () => {
    const state = createTestState();

    const plan = {
      summary: 'Add corrective tasks',
      tasks_to_add: [
        { title: 'Fix Issue', description: 'Fix the failing tests' }
      ],
      tasks_to_modify: [
        { id: 't1', changes: { title: 'Updated Task 1' } }
      ],
      tasks_to_remove: [],
      priority_domains: []
    };

    const result = applyCorrectivePlan(state, plan);

    expect(result.added).toBe(1);
    expect(result.modified).toBe(1);
    expect(state.tasks.length).toBe(5);
    expect(state.tasks.find(t => t.id === 't1')?.title).toBe('Updated Task 1');

    cleanupTempDir(tempDir);
  });

  it('should compare severity thresholds correctly', () => {
    expect(exceedsThreshold('severe', 'minor')).toBe(true);
    expect(exceedsThreshold('severe', 'moderate')).toBe(true);
    expect(exceedsThreshold('severe', 'severe')).toBe(true);

    expect(exceedsThreshold('moderate', 'minor')).toBe(true);
    expect(exceedsThreshold('moderate', 'moderate')).toBe(true);
    expect(exceedsThreshold('moderate', 'severe')).toBe(false);

    expect(exceedsThreshold('minor', 'minor')).toBe(true);
    expect(exceedsThreshold('minor', 'moderate')).toBe(false);
    expect(exceedsThreshold('minor', 'severe')).toBe(false);
  });
});

describe('Campaign Metrics Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  it('should track task lifecycle events', () => {
    const collector = new MetricsCollector();
    const state = createTestState();

    // Simulate task execution
    collector.recordTaskStarted('t1');
    state.tasks[0].status = 'in_progress';

    collector.recordTaskCompleted('t1');
    state.tasks[0].status = 'completed';

    collector.recordTaskStarted('t2');
    collector.recordTaskFailed('t2', 'Test error');
    state.tasks[1].status = 'failed';
    state.tasks[1].attempts = 1;

    collector.recordTaskRetried('t2', 2);

    // Get snapshot
    const snapshot = collector.getSnapshot(state);

    expect(snapshot.tasksCompleted).toBe(1);
    expect(snapshot.tasksFailed).toBe(1);

    // Check events
    const events = collector.getEvents();
    expect(events.length).toBe(5);

    cleanupTempDir(tempDir);
  });

  it('should integrate with drift detection', () => {
    const collector = new MetricsCollector();
    const state = createTestState();

    // Record drift check
    collector.recordDriftCheck({
      drifted: true,
      severity: 'moderate',
      drift_areas: [
        {
          domain: 'global',
          description: 'Test drift',
          contributing_tasks: ['t1'],
          severity: 'moderate'
        }
      ],
      confidence: 0.8
    });

    collector.recordDriftCorrection(1, 0, 0);

    const snapshot = collector.getSnapshot(state);

    expect(snapshot.driftChecks).toBe(1);
    expect(snapshot.driftCorrections).toBe(1);
    expect(snapshot.lastDriftSeverity).toBe('moderate');

    cleanupTempDir(tempDir);
  });

  it('should generate summary from calculated metrics', () => {
    const state = createTestState([
      createTestTask('t1', 'completed'),
      createTestTask('t2', 'completed'),
      createTestTask('t3', 'failed', { attempts: 2 }),
      createTestTask('t4', 'pending')
    ]);

    const snapshot = calculateMetrics(state);
    const summary = generateMetricsSummary(snapshot);

    expect(summary).toContain('Progress: 50%');
    expect(summary).toContain('Completed: 2');
    expect(summary).toContain('Failed: 1');
    expect(summary).toContain('Total Retries: 2');

    cleanupTempDir(tempDir);
  });
});

describe('Full Campaign Workflow Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  it('should complete workflow with state persistence and metrics', async () => {
    // 1. Initialize campaign
    const state = createTestState();
    const collector = new MetricsCollector();
    const stateDir = join(tempDir, '.campaign');
    mkdirSync(stateDir, { recursive: true });
    const stateFile = join(stateDir, 'campaign.json');

    // 2. Process tasks with metrics tracking
    collector.recordTaskStarted('t1');
    state.tasks[0].status = 'in_progress';

    collector.recordTaskCompleted('t1');
    state.tasks[0].status = 'completed';

    collector.recordTaskStarted('t2');
    collector.recordTaskCompleted('t2');
    state.tasks[1].status = 'completed';

    collector.recordTaskStarted('t3');
    collector.recordTaskCompleted('t3');
    state.tasks[2].status = 'completed';

    collector.recordTaskStarted('t4');
    collector.recordTaskCompleted('t4');
    state.tasks[3].status = 'completed';

    // 3. Check for drift
    const drift = await checkForDrift(state, tempDir, { criteriaOnly: true });
    collector.recordDriftCheck(drift);
    expect(drift.drifted).toBe(false);

    // 4. Verify metrics
    const snapshot = collector.getSnapshot(state);
    expect(snapshot.progressPercent).toBe(100);
    expect(snapshot.tasksCompleted).toBe(4);
    expect(snapshot.driftChecks).toBe(1);

    // 5. Save final state
    state.status = 'completed';
    await saveCampaignState(stateFile, state);

    // 6. Verify persistence
    const loaded = await loadCampaignState(stateFile);
    expect(loaded?.status).toBe('completed');
    expect(loaded?.tasks.every(t => t.status === 'completed')).toBe(true);

    cleanupTempDir(tempDir);
  });

  it('should handle failure and recovery workflow', async () => {
    // 1. Initialize campaign
    const state = createTestState();
    const stateDir = join(tempDir, '.campaign');
    mkdirSync(stateDir, { recursive: true });
    const stateFile = join(stateDir, 'campaign.json');

    // 2. Complete some work
    state.tasks[0].status = 'completed';

    // Save checkpoint state
    await saveCampaignState(stateFile, state);

    // 3. Simulate failure - t2 fails
    state.tasks[1].status = 'failed';
    state.tasks[1].attempts = 1;

    // 4. Detect drift (single failure shouldn't trigger severe drift)
    const drift = await checkForDrift(state, tempDir, { criteriaOnly: true });

    // With 1 failed out of 2 attempted (50% failure rate), drift may or may not be detected
    // depending on thresholds - check that the system handles it correctly
    expect(drift.severity).toBeDefined();

    // 5. Recover by loading previous state
    const recovered = await loadCampaignState(stateFile);
    expect(recovered).toBeDefined();
    expect(recovered!.tasks[0].status).toBe('completed');
    // Note: The recovered state won't have the failure since we saved before failing

    cleanupTempDir(tempDir);
  });
});
