/**
 * Tests for Campaign Checkpoint Manager
 *
 * Tests checkpoint creation, validation, storage, and restoration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import {
  createCheckpoint,
  saveCheckpoint,
  loadCheckpoint,
  loadLatestCheckpoint,
  listCheckpoints,
  validateCheckpoint,
  resumeFromCheckpoint,
  quickCheckpoint,
  type CheckpointConfig
} from './campaign-checkpoint.js';
import type { CampaignState, CampaignTask } from './campaign-state.js';
import type { EnhancedCheckpoint } from './campaign-types.js';

// Test helpers
const testDir = resolve(tmpdir(), `campaign-checkpoint-test-${Date.now()}`);
const checkpointDir = resolve(testDir, 'checkpoints');

function createTestTask(id: string, status: CampaignTask['status'] = 'pending'): CampaignTask {
  return {
    id,
    title: `Task ${id}`,
    description: `Description for task ${id}`,
    status,
    dependencies: [],
    acceptanceCriteria: [],
    assignedFiles: [],
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function createTestState(tasks: CampaignTask[]): CampaignState {
  return {
    campaignId: 'test-campaign-1',
    goal: 'Test campaign goal',
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

function createTestConfig(): CheckpointConfig {
  return {
    checkpointDir,
    maxCheckpoints: 5,
    compress: false,
    cwd: testDir
  };
}

describe('Checkpoint Creation', () => {
  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should create checkpoint with unique ID', async () => {
    const state = createTestState([
      createTestTask('t1', 'completed'),
      createTestTask('t2', 'pending')
    ]);
    const config = createTestConfig();

    const checkpoint = await createCheckpoint(state, config);

    expect(checkpoint.id).toMatch(/^cp_\d+_[a-z0-9]+$/);
    expect(checkpoint.created_at).toBeGreaterThan(0);
  });

  it('should capture completed task IDs', async () => {
    const state = createTestState([
      createTestTask('t1', 'completed'),
      createTestTask('t2', 'completed'),
      createTestTask('t3', 'pending'),
      createTestTask('t4', 'in_progress')
    ]);
    const config = createTestConfig();

    const checkpoint = await createCheckpoint(state, config);

    expect(checkpoint.completed_task_ids).toContain('t1');
    expect(checkpoint.completed_task_ids).toContain('t2');
    expect(checkpoint.completed_task_ids).not.toContain('t3');
    expect(checkpoint.completed_task_ids).not.toContain('t4');
    expect(checkpoint.completed_task_ids.length).toBe(2);
  });

  it('should include summary', async () => {
    const state = createTestState([
      createTestTask('t1', 'completed'),
      createTestTask('t2', 'pending')
    ]);
    const config = createTestConfig();

    const checkpoint = await createCheckpoint(state, config, 'Manual checkpoint');

    expect(checkpoint.summary).toBe('Manual checkpoint');
  });

  it('should generate summary if not provided', async () => {
    const state = createTestState([
      createTestTask('t1', 'completed'),
      createTestTask('t2', 'completed'),
      createTestTask('t3', 'pending'),
      createTestTask('t4', 'pending')
    ]);
    const config = createTestConfig();

    const checkpoint = await createCheckpoint(state, config);

    expect(checkpoint.summary).toContain('2/4');
    expect(checkpoint.summary).toContain('50%');
  });

  it('should compute integrity hash', async () => {
    const state = createTestState([createTestTask('t1', 'completed')]);
    const config = createTestConfig();

    const checkpoint = await createCheckpoint(state, config);

    expect(checkpoint.integrity_hash).toHaveLength(16);
    expect(checkpoint.integrity_hash).toMatch(/^[a-f0-9]+$/);
  });

  it('should track size in bytes', async () => {
    const state = createTestState([createTestTask('t1', 'completed')]);
    const config = createTestConfig();

    const checkpoint = await createCheckpoint(state, config);

    expect(checkpoint.size_bytes).toBeGreaterThan(0);
  });

  it('should include domain states for default domain', async () => {
    const state = createTestState([
      createTestTask('t1', 'completed'),
      createTestTask('t2', 'in_progress')
    ]);
    const config = createTestConfig();

    const checkpoint = await createCheckpoint(state, config);

    expect(checkpoint.domain_states['default']).toBeDefined();
    expect(checkpoint.domain_states['default'].task_counts.completed).toBe(1);
    expect(checkpoint.domain_states['default'].task_counts.in_progress).toBe(1);
  });

  it('should include metrics', async () => {
    const state = createTestState([
      createTestTask('t1', 'completed'),
      createTestTask('t2', 'failed')
    ]);
    const config = createTestConfig();

    const checkpoint = await createCheckpoint(state, config);

    expect(checkpoint.metrics).toBeDefined();
    expect(checkpoint.metrics.tasks_total).toBe(2);
    expect(checkpoint.metrics.tasks_completed).toBe(1);
    expect(checkpoint.metrics.tasks_failed).toBe(1);
  });
});

describe('Checkpoint Storage', () => {
  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true });
    } catch {
      // Ignore
    }
  });

  it('should save checkpoint to file', async () => {
    const state = createTestState([createTestTask('t1', 'completed')]);
    const config = createTestConfig();

    const checkpoint = await createCheckpoint(state, config);
    const filepath = await saveCheckpoint(checkpoint, config);

    expect(filepath).toContain(checkpoint.id);

    const fileExists = await fs.access(filepath).then(() => true).catch(() => false);
    expect(fileExists).toBe(true);
  });

  it('should load checkpoint from file', async () => {
    const state = createTestState([createTestTask('t1', 'completed')]);
    const config = createTestConfig();

    const checkpoint = await createCheckpoint(state, config);
    const filepath = await saveCheckpoint(checkpoint, config);

    const loaded = await loadCheckpoint(filepath);

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(checkpoint.id);
    expect(loaded!.completed_task_ids).toEqual(checkpoint.completed_task_ids);
  });

  it('should return null for non-existent checkpoint', async () => {
    const loaded = await loadCheckpoint('/nonexistent/path.json');
    expect(loaded).toBeNull();
  });

  it('should load latest checkpoint', async () => {
    const config = createTestConfig();
    await fs.mkdir(checkpointDir, { recursive: true });

    // Create multiple checkpoints
    const state1 = createTestState([createTestTask('t1', 'completed')]);
    const cp1 = await createCheckpoint(state1, config, 'First');
    await saveCheckpoint(cp1, config);

    await new Promise(r => setTimeout(r, 10)); // Small delay for unique timestamp

    const state2 = createTestState([createTestTask('t1', 'completed'), createTestTask('t2', 'completed')]);
    const cp2 = await createCheckpoint(state2, config, 'Second');
    await saveCheckpoint(cp2, config);

    const latest = await loadLatestCheckpoint(checkpointDir);

    expect(latest).not.toBeNull();
    expect(latest!.summary).toBe('Second');
  });

  it('should list all checkpoints', async () => {
    const config = createTestConfig();
    await fs.mkdir(checkpointDir, { recursive: true });

    const state = createTestState([createTestTask('t1', 'completed')]);

    const cp1 = await createCheckpoint(state, config, 'First');
    await saveCheckpoint(cp1, config);

    await new Promise(r => setTimeout(r, 10));

    const cp2 = await createCheckpoint(state, config, 'Second');
    await saveCheckpoint(cp2, config);

    const list = await listCheckpoints(checkpointDir);

    expect(list.length).toBe(2);
    expect(list[0].summary).toBe('Second'); // Most recent first
    expect(list[1].summary).toBe('First');
  });

  it('should prune old checkpoints', async () => {
    const config = { ...createTestConfig(), maxCheckpoints: 2 };
    await fs.mkdir(checkpointDir, { recursive: true });

    const state = createTestState([createTestTask('t1', 'completed')]);

    // Create 3 checkpoints (max is 2)
    for (let i = 0; i < 3; i++) {
      const cp = await createCheckpoint(state, config, `Checkpoint ${i}`);
      await saveCheckpoint(cp, config);
      await new Promise(r => setTimeout(r, 10));
    }

    const list = await listCheckpoints(checkpointDir);

    expect(list.length).toBe(2);
    expect(list[0].summary).toBe('Checkpoint 2'); // Most recent
    expect(list[1].summary).toBe('Checkpoint 1');
  });
});

describe('Checkpoint Validation', () => {
  it('should validate valid checkpoint', () => {
    const checkpoint: EnhancedCheckpoint = {
      id: 'cp_test_123',
      created_at: Date.now(),
      summary: 'Test checkpoint',
      completed_task_ids: ['t1', 't2'],
      domain_states: {
        default: {
          domain: 'default',
          status: 'running',
          progress_percent: 50,
          task_counts: { pending: 1, in_progress: 0, completed: 2, failed: 0, blocked: 0 }
        }
      },
      git_refs: {},
      metrics: {
        tasks_total: 3,
        tasks_completed: 2,
        tasks_failed: 0,
        retries_total: 0,
        total_duration_ms: 1000,
        drift_checks: 0,
        drift_corrections: 0
      },
      integrity_hash: '', // Will be invalid but that's what we're testing
      size_bytes: 0 // Set to 0 for hash computation
    };

    // Compute real hash with integrity_hash='' and size_bytes=0
    const jsonStr = JSON.stringify({ ...checkpoint, integrity_hash: '', size_bytes: 0 });
    const hash = require('crypto').createHash('sha256').update(jsonStr).digest('hex').slice(0, 16);
    checkpoint.integrity_hash = hash;

    const validation = validateCheckpoint(checkpoint);

    expect(validation.valid).toBe(true);
    expect(validation.errors.length).toBe(0);
  });

  it('should detect missing ID', () => {
    const checkpoint = {
      id: '',
      created_at: Date.now(),
      summary: 'Test',
      completed_task_ids: [],
      domain_states: {},
      git_refs: {},
      metrics: {} as any,
      integrity_hash: 'abc123',
      size_bytes: 0
    } as EnhancedCheckpoint;

    const validation = validateCheckpoint(checkpoint);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Checkpoint missing ID');
  });

  it('should detect integrity hash mismatch', () => {
    const checkpoint: EnhancedCheckpoint = {
      id: 'cp_test_123',
      created_at: Date.now(),
      summary: 'Test',
      completed_task_ids: ['t1'],
      domain_states: {},
      git_refs: {},
      metrics: {
        tasks_total: 1,
        tasks_completed: 1,
        tasks_failed: 0,
        retries_total: 0,
        total_duration_ms: 1000,
        drift_checks: 0,
        drift_corrections: 0
      },
      integrity_hash: 'wrong_hash',
      size_bytes: 100
    };

    const validation = validateCheckpoint(checkpoint);

    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('integrity'))).toBe(true);
  });

  it('should warn about missing tasks when comparing to state', () => {
    const checkpoint: EnhancedCheckpoint = {
      id: 'cp_test_123',
      created_at: Date.now(),
      summary: 'Test',
      completed_task_ids: ['t1', 't999'], // t999 doesn't exist in state
      domain_states: {},
      git_refs: {},
      metrics: {
        tasks_total: 2,
        tasks_completed: 2,
        tasks_failed: 0,
        retries_total: 0,
        total_duration_ms: 1000,
        drift_checks: 0,
        drift_corrections: 0
      },
      integrity_hash: '',
      size_bytes: 0
    };

    // Compute real hash with integrity_hash='' and size_bytes=0
    const jsonStr = JSON.stringify({ ...checkpoint, integrity_hash: '', size_bytes: 0 });
    const hash = require('crypto').createHash('sha256').update(jsonStr).digest('hex').slice(0, 16);
    checkpoint.integrity_hash = hash;

    const state = createTestState([createTestTask('t1', 'completed')]);
    const validation = validateCheckpoint(checkpoint, state);

    expect(validation.warnings.some(w => w.includes('not found'))).toBe(true);
  });
});

describe('Resume from Checkpoint', () => {
  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true });
    } catch {
      // Ignore
    }
  });

  it('should resume with completed tasks marked', async () => {
    const config = createTestConfig();
    await fs.mkdir(checkpointDir, { recursive: true });

    // Create checkpoint with some completed tasks
    const initialState = createTestState([
      createTestTask('t1', 'completed'),
      createTestTask('t2', 'completed')
    ]);
    const cp = await createCheckpoint(initialState, config);
    await saveCheckpoint(cp, config);

    // Create fresh state (simulating restart)
    const freshState = createTestState([
      createTestTask('t1', 'pending'), // Should be restored to completed
      createTestTask('t2', 'pending'), // Should be restored to completed
      createTestTask('t3', 'pending')
    ]);

    const result = await resumeFromCheckpoint(freshState, config);

    expect(result.success).toBe(true);
    expect(result.checkpoint).not.toBeNull();
    expect(freshState.tasks.find(t => t.id === 't1')?.status).toBe('completed');
    expect(freshState.tasks.find(t => t.id === 't2')?.status).toBe('completed');
    expect(freshState.tasks.find(t => t.id === 't3')?.status).toBe('pending');
  });

  it('should reset in_progress tasks to pending', async () => {
    const config = createTestConfig();
    await fs.mkdir(checkpointDir, { recursive: true });

    // Create checkpoint
    const initialState = createTestState([createTestTask('t1', 'completed')]);
    const cp = await createCheckpoint(initialState, config);
    await saveCheckpoint(cp, config);

    // State with in_progress task (crashed mid-execution)
    const freshState = createTestState([
      createTestTask('t1', 'pending'),
      createTestTask('t2', 'in_progress') // Should be reset
    ]);

    const result = await resumeFromCheckpoint(freshState, config, {
      validateGit: false,
      resetInProgress: true
    });

    expect(result.success).toBe(true);
    expect(freshState.tasks.find(t => t.id === 't2')?.status).toBe('pending');
    expect(result.restoredTasks).toContain('t2');
  });

  it('should return error when no checkpoint exists', async () => {
    const config = createTestConfig();
    await fs.mkdir(checkpointDir, { recursive: true });

    const state = createTestState([createTestTask('t1', 'pending')]);
    const result = await resumeFromCheckpoint(state, config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No checkpoint found');
  });

  it('should load specific checkpoint by ID', async () => {
    const config = createTestConfig();
    await fs.mkdir(checkpointDir, { recursive: true });

    // Create two checkpoints
    const state1 = createTestState([createTestTask('t1', 'completed')]);
    const cp1 = await createCheckpoint(state1, config, 'First');
    await saveCheckpoint(cp1, config);

    await new Promise(r => setTimeout(r, 10));

    const state2 = createTestState([createTestTask('t1', 'completed'), createTestTask('t2', 'completed')]);
    const cp2 = await createCheckpoint(state2, config, 'Second');
    await saveCheckpoint(cp2, config);

    // Resume from first checkpoint specifically
    const freshState = createTestState([
      createTestTask('t1', 'pending'),
      createTestTask('t2', 'pending')
    ]);

    const result = await resumeFromCheckpoint(freshState, config, {
      validateGit: false,
      resetInProgress: true,
      checkpointId: cp1.id
    });

    expect(result.success).toBe(true);
    expect(result.checkpoint?.summary).toBe('First');
    expect(freshState.tasks.find(t => t.id === 't1')?.status).toBe('completed');
    expect(freshState.tasks.find(t => t.id === 't2')?.status).toBe('pending'); // Not in cp1
  });
});

describe('Quick Checkpoint Functions', () => {
  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true });
    } catch {
      // Ignore
    }
  });

  it('should create quick checkpoint', async () => {
    const state = createTestState([createTestTask('t1', 'completed')]);

    const checkpoint = await quickCheckpoint(state, testDir);

    expect(checkpoint).toBeDefined();
    expect(checkpoint.id).toBeDefined();
    expect(checkpoint.completed_task_ids).toContain('t1');
  });
});
