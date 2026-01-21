/**
 * Tests for Campaign Drift Detection
 *
 * Tests drift detection, severity calculation, and corrective planning.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  DriftDetector,
  createDriftDetector,
  checkForDrift,
  exceedsThreshold,
  applyCorrectivePlan,
  DEFAULT_DRIFT_CONFIG,
  type DriftDetectorOptions
} from './campaign-drift.js';
import type { CampaignState, CampaignTask } from './campaign-state.js';
import type { CorrectivePlan, DriftSeverity } from './campaign-types.js';

// Test helpers
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

function createTestState(tasks: CampaignTask[]): CampaignState {
  return {
    campaignId: 'test-campaign-1',
    goal: 'Test campaign goal - implement a feature',
    status: 'running',
    version: 1,
    createdAt: Date.now() - 60000,
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

function createTestOptions(): DriftDetectorOptions {
  return {
    cwd: process.cwd(),
    criteriaOnly: true // Skip LLM calls in tests
  };
}

describe('DriftDetector', () => {
  describe('constructor', () => {
    it('should create detector with default options', () => {
      const detector = new DriftDetector({ cwd: '/test' });
      expect(detector).toBeDefined();
    });

    it('should create detector with custom options', () => {
      const detector = new DriftDetector({
        cwd: '/test',
        agent: 'gemini',
        model: 'gemini-pro',
        timeout: 30000,
        criteriaOnly: true
      });
      expect(detector).toBeDefined();
    });
  });

  describe('shouldCheck', () => {
    let detector: DriftDetector;

    beforeEach(() => {
      detector = new DriftDetector(createTestOptions());
    });

    it('should return false when drift detection is disabled', () => {
      const state = createTestState([createTestTask('t1', 'completed')]);
      const result = detector.shouldCheck(state, { ...DEFAULT_DRIFT_CONFIG, enabled: false });

      expect(result.shouldCheck).toBe(false);
    });

    it('should return true for manual checks', () => {
      const state = createTestState([createTestTask('t1', 'completed')]);
      const result = detector.shouldCheck(state, DEFAULT_DRIFT_CONFIG, 'manual');

      expect(result.shouldCheck).toBe(true);
      expect(result.reason).toBe('manual');
    });

    it('should trigger on milestone progress', async () => {
      const state = createTestState([
        createTestTask('t1', 'completed'),
        createTestTask('t2', 'completed'),
        createTestTask('t3', 'pending'),
        createTestTask('t4', 'pending')
      ]);

      // First detection to set baseline at 50% (2/4)
      await detector.detect(state);

      // Complete third task to reach 75% - this crosses the milestone
      state.tasks[2].status = 'completed';

      const result = detector.shouldCheck(state, {
        ...DEFAULT_DRIFT_CONFIG,
        check_at_milestones: [75]
      });

      // Progress went from 50% to 75%, which crosses the 75% milestone
      expect(result.shouldCheck).toBe(true);
      expect(result.reason).toBe('milestone');
    });

    it('should trigger after N task completions', () => {
      const tasks = Array.from({ length: 6 }, (_, i) =>
        createTestTask(`t${i}`, i < 5 ? 'completed' : 'pending')
      );
      const state = createTestState(tasks);

      const result = detector.shouldCheck(state, {
        ...DEFAULT_DRIFT_CONFIG,
        check_every_n_tasks: 5
      });

      expect(result.shouldCheck).toBe(true);
      expect(result.reason).toBe('task_count');
    });
  });

  describe('detect - failure rate', () => {
    it('should detect high failure rate', async () => {
      const detector = new DriftDetector(createTestOptions());
      const state = createTestState([
        createTestTask('t1', 'failed'),
        createTestTask('t2', 'failed'),
        createTestTask('t3', 'completed'),
        createTestTask('t4', 'failed')
      ]);

      const result = await detector.detect(state);

      expect(result.drifted).toBe(true);
      expect(result.drift_areas.some(a => a.description.includes('failure rate'))).toBe(true);
    });

    it('should not flag low failure rate', async () => {
      const detector = new DriftDetector(createTestOptions());
      const state = createTestState([
        createTestTask('t1', 'completed'),
        createTestTask('t2', 'completed'),
        createTestTask('t3', 'completed'),
        createTestTask('t4', 'failed')
      ]);

      const result = await detector.detect(state);

      // 25% failure rate should not trigger
      const failureArea = result.drift_areas.find(a => a.description.includes('failure rate'));
      expect(failureArea).toBeUndefined();
    });
  });

  describe('detect - stalled progress', () => {
    it('should detect stuck tasks', async () => {
      const detector = new DriftDetector(createTestOptions());
      const now = Date.now();
      const state = createTestState([
        createTestTask('t1', 'in_progress', { updatedAt: now - 45 * 60 * 1000 }), // 45 mins ago
        createTestTask('t2', 'pending')
      ]);

      const result = await detector.detect(state);

      expect(result.drifted).toBe(true);
      expect(result.drift_areas.some(a => a.description.includes('stuck'))).toBe(true);
    });

    it('should not flag recently started tasks', async () => {
      const detector = new DriftDetector(createTestOptions());
      const state = createTestState([
        createTestTask('t1', 'in_progress'), // Just started
        createTestTask('t2', 'pending')
      ]);

      const result = await detector.detect(state);

      const stallArea = result.drift_areas.find(a => a.description.includes('stuck'));
      expect(stallArea).toBeUndefined();
    });
  });

  describe('detect - blocked tasks', () => {
    it('should detect blocked tasks cascade', async () => {
      const detector = new DriftDetector(createTestOptions());
      const state = createTestState([
        createTestTask('t1', 'blocked'),
        createTestTask('t2', 'blocked'),
        createTestTask('t3', 'blocked'),
        createTestTask('t4', 'pending', { dependencies: ['t1'] }),
        createTestTask('t5', 'pending', { dependencies: ['t2'] })
      ]);

      const result = await detector.detect(state);

      expect(result.drifted).toBe(true);
      expect(result.drift_areas.some(a => a.description.includes('blocked'))).toBe(true);
      expect(result.severity).toBe('severe');
    });
  });

  describe('detect - excessive retries', () => {
    it('should detect tasks with many retries', async () => {
      const detector = new DriftDetector(createTestOptions());
      const state = createTestState([
        createTestTask('t1', 'failed', { attempts: 4 }),
        createTestTask('t2', 'failed', { attempts: 3 }),
        createTestTask('t3', 'failed', { attempts: 5 }),
        createTestTask('t4', 'pending')
      ]);

      const result = await detector.detect(state);

      expect(result.drifted).toBe(true);
      expect(result.drift_areas.some(a => a.description.includes('retries'))).toBe(true);
    });
  });

  describe('severity calculation', () => {
    it('should return severe for multiple issues', async () => {
      const detector = new DriftDetector(createTestOptions());
      const now = Date.now();
      const state = createTestState([
        createTestTask('t1', 'failed'),
        createTestTask('t2', 'failed'),
        createTestTask('t3', 'failed'),
        createTestTask('t4', 'blocked'),
        createTestTask('t5', 'blocked'),
        createTestTask('t6', 'blocked'),
        createTestTask('t7', 'in_progress', { updatedAt: now - 45 * 60 * 1000 })
      ]);

      const result = await detector.detect(state);

      expect(result.severity).toBe('severe');
    });

    it('should return minor for no drift', async () => {
      const detector = new DriftDetector(createTestOptions());
      const state = createTestState([
        createTestTask('t1', 'completed'),
        createTestTask('t2', 'completed'),
        createTestTask('t3', 'pending')
      ]);

      const result = await detector.detect(state);

      expect(result.drifted).toBe(false);
      expect(result.severity).toBe('minor');
    });
  });

  describe('history tracking', () => {
    it('should track drift check history', async () => {
      const detector = new DriftDetector(createTestOptions());
      const state = createTestState([createTestTask('t1', 'completed')]);

      await detector.detect(state);
      await detector.detect(state);
      await detector.detect(state);

      expect(detector.getHistory().length).toBe(3);
      expect(detector.getChecksPerformed()).toBe(3);
    });

    it('should reset history', async () => {
      const detector = new DriftDetector(createTestOptions());
      const state = createTestState([createTestTask('t1', 'completed')]);

      await detector.detect(state);
      await detector.detect(state);

      detector.reset();

      expect(detector.getHistory().length).toBe(0);
      expect(detector.getChecksPerformed()).toBe(0);
    });
  });
});

describe('Factory functions', () => {
  it('createDriftDetector should create detector', () => {
    const detector = createDriftDetector({ cwd: '/test' });
    expect(detector).toBeInstanceOf(DriftDetector);
  });

  it('checkForDrift should return result', async () => {
    const state = createTestState([
      createTestTask('t1', 'completed'),
      createTestTask('t2', 'pending')
    ]);

    const result = await checkForDrift(state, '/test', { criteriaOnly: true });

    expect(result).toBeDefined();
    expect(result.drifted).toBeDefined();
    expect(result.severity).toBeDefined();
  });
});

describe('exceedsThreshold', () => {
  it('should correctly compare severities', () => {
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

describe('applyCorrectivePlan', () => {
  it('should add tasks from corrective plan', () => {
    const state = createTestState([createTestTask('t1', 'completed')]);
    const plan: CorrectivePlan = {
      summary: 'Add corrective tasks',
      tasks_to_add: [
        { title: 'Fix Issue 1', description: 'Fix the first issue' },
        { title: 'Fix Issue 2', description: 'Fix the second issue' }
      ],
      tasks_to_modify: [],
      tasks_to_remove: [],
      priority_domains: []
    };

    const result = applyCorrectivePlan(state, plan);

    expect(result.added).toBe(2);
    expect(state.tasks.length).toBe(3);
  });

  it('should modify tasks from corrective plan', () => {
    const state = createTestState([
      createTestTask('t1', 'pending'),
      createTestTask('t2', 'pending')
    ]);
    const plan: CorrectivePlan = {
      summary: 'Modify tasks',
      tasks_to_add: [],
      tasks_to_modify: [
        { id: 't1', changes: { title: 'Updated Title', description: 'Updated Description' } }
      ],
      tasks_to_remove: [],
      priority_domains: []
    };

    const result = applyCorrectivePlan(state, plan);

    expect(result.modified).toBe(1);
    expect(state.tasks.find(t => t.id === 't1')?.title).toBe('Updated Title');
  });

  it('should remove tasks from corrective plan', () => {
    const state = createTestState([
      createTestTask('t1', 'pending'),
      createTestTask('t2', 'pending'),
      createTestTask('t3', 'pending')
    ]);
    const plan: CorrectivePlan = {
      summary: 'Remove tasks',
      tasks_to_add: [],
      tasks_to_modify: [],
      tasks_to_remove: ['t2'],
      priority_domains: []
    };

    const result = applyCorrectivePlan(state, plan);

    expect(result.removed).toBe(1);
    expect(state.tasks.length).toBe(2);
    expect(state.tasks.find(t => t.id === 't2')).toBeUndefined();
  });

  it('should handle combined operations', () => {
    const state = createTestState([
      createTestTask('t1', 'pending'),
      createTestTask('t2', 'pending'),
      createTestTask('t3', 'pending')
    ]);
    const plan: CorrectivePlan = {
      summary: 'Combined corrections',
      tasks_to_add: [{ title: 'New Task' }],
      tasks_to_modify: [{ id: 't1', changes: { title: 'Modified' } }],
      tasks_to_remove: ['t2'],
      priority_domains: []
    };

    const result = applyCorrectivePlan(state, plan);

    expect(result.added).toBe(1);
    expect(result.modified).toBe(1);
    expect(result.removed).toBe(1);
    expect(state.tasks.length).toBe(3); // 3 - 1 + 1 = 3
  });
});

describe('DEFAULT_DRIFT_CONFIG', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_DRIFT_CONFIG.enabled).toBe(true);
    expect(DEFAULT_DRIFT_CONFIG.check_at_milestones).toContain(50);
    expect(DEFAULT_DRIFT_CONFIG.check_every_n_tasks).toBe(5);
    expect(DEFAULT_DRIFT_CONFIG.pause_threshold).toBe('severe');
  });
});
