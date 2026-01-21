/**
 * Tests for Campaign Domain Queue Functions
 */

import { describe, it, expect } from 'bun:test';
import {
  createDomainQueue,
  createMultiDomainQueue,
  getNextTaskForDomain,
  getDomainStatus,
  hasDomainWorkRemaining,
  getDomainsWithWork,
  getMultiDomainProgress,
  updateDomainTaskStatus,
  createQueueFromTasks,
  getNextTask,
  getProgress
} from './campaign-queue.js';
import type { CampaignTask, CampaignTaskStatus } from './campaign-state.js';
import type { EnhancedCampaignTask, CampaignDomain } from './campaign-types.js';

// Helper to create a base task
function createTask(
  id: string,
  status: CampaignTaskStatus = 'pending',
  domain?: string,
  priority?: number,
  dependencies?: string[]
): EnhancedCampaignTask {
  return {
    id,
    title: `Task ${id}`,
    status,
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    domain,
    area: domain, // Also set area for backwards compatibility
    priority,
    dependencies,
    entry_criteria: [],
    exit_criteria: []
  };
}

// Helper to create a domain config
function createDomain(name: string, taskIds: string[]): CampaignDomain {
  return {
    name,
    goal: `Goal for ${name}`,
    stories: taskIds,
    file_patterns: [],
    status: 'pending',
    progress_percent: 0
  };
}

describe('createDomainQueue', () => {
  it('should create queue for a domain with tasks', () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'pending', 'ui'),
      createTask('T2', 'in_progress', 'ui'),
      createTask('T3', 'completed', 'ui'),
      createTask('T4', 'pending', 'api'), // Different domain
    ];

    const queue = createDomainQueue('ui', tasks);

    expect(queue.domain).toBe('ui');
    expect(queue.pending).toEqual(['T1']);
    expect(queue.inProgress).toEqual(['T2']);
    expect(queue.completed).toEqual(['T3']);
    expect(queue.progress).toBe(33); // 1/3
    expect(queue.status).toBe('running'); // Has in_progress tasks
  });

  it('should create empty queue for domain with no tasks', () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'pending', 'api'),
    ];

    const queue = createDomainQueue('ui', tasks);

    expect(queue.domain).toBe('ui');
    expect(queue.pending).toHaveLength(0);
    expect(queue.progress).toBe(0);
    expect(queue.status).toBe('pending');
  });

  it('should mark domain as completed when all tasks are completed', () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'completed', 'ui'),
      createTask('T2', 'completed', 'ui'),
    ];

    const queue = createDomainQueue('ui', tasks);

    expect(queue.status).toBe('completed');
    expect(queue.progress).toBe(100);
  });

  it('should mark domain as failed when only failed tasks remain', () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'completed', 'ui'),
      createTask('T2', 'failed', 'ui'),
    ];

    const queue = createDomainQueue('ui', tasks);

    expect(queue.status).toBe('failed');
  });
});

describe('createMultiDomainQueue', () => {
  it('should create queues for multiple domains', () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'pending', 'ui'),
      createTask('T2', 'pending', 'api'),
      createTask('T3', 'pending', 'infra'),
    ];

    const domains: CampaignDomain[] = [
      createDomain('ui', ['T1']),
      createDomain('api', ['T2']),
      createDomain('infra', ['T3']),
    ];

    const multiQueue = createMultiDomainQueue(domains, tasks);

    expect(multiQueue.domains.size).toBe(3);
    expect(multiQueue.domains.get('ui')?.pending).toEqual(['T1']);
    expect(multiQueue.domains.get('api')?.pending).toEqual(['T2']);
    expect(multiQueue.domains.get('infra')?.pending).toEqual(['T3']);
    expect(multiQueue.orphanTasks).toHaveLength(0);
  });

  it('should identify orphan tasks', () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'pending', 'ui'),
      createTask('T2', 'pending'), // No domain
      createTask('T3', 'pending', 'unknown'), // Unknown domain
    ];

    const domains: CampaignDomain[] = [
      createDomain('ui', ['T1']),
    ];

    const multiQueue = createMultiDomainQueue(domains, tasks);

    expect(multiQueue.domains.size).toBe(1);
    expect(multiQueue.orphanTasks).toContain('T2');
    expect(multiQueue.orphanTasks).toContain('T3');
  });
});

describe('getNextTaskForDomain', () => {
  it('should return highest priority pending task', async () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'pending', 'ui', 3),
      createTask('T2', 'pending', 'ui', 1), // Highest priority
      createTask('T3', 'pending', 'ui', 2),
    ];

    const queue = createDomainQueue('ui', tasks);
    const nextTask = await getNextTaskForDomain(queue, tasks, process.cwd(), false);

    expect(nextTask?.id).toBe('T2'); // Priority 1
  });

  it('should prefer failed tasks over pending', async () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'pending', 'ui', 1),
      { ...createTask('T2', 'failed', 'ui', 2), attempts: 1 }, // Failed but retryable
    ];

    const queue = createDomainQueue('ui', tasks);
    const nextTask = await getNextTaskForDomain(queue, tasks, process.cwd(), false);

    expect(nextTask?.id).toBe('T2'); // Failed task prioritized
  });

  it('should not return task with unsatisfied dependencies', async () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'pending', 'ui', 1, ['T2']), // Depends on T2
      createTask('T2', 'pending', 'ui', 2),
    ];

    const queue = createDomainQueue('ui', tasks);
    const nextTask = await getNextTaskForDomain(queue, tasks, process.cwd(), false);

    expect(nextTask?.id).toBe('T2'); // T1 blocked by dependency
  });

  it('should return task when dependencies are satisfied', async () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'pending', 'ui', 1, ['T2']), // Depends on T2
      createTask('T2', 'completed', 'ui', 2), // Dependency completed
    ];

    const queue = createDomainQueue('ui', tasks);
    const nextTask = await getNextTaskForDomain(queue, tasks, process.cwd(), false);

    expect(nextTask?.id).toBe('T1'); // Dependency satisfied
  });

  it('should return null when no tasks available', async () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'completed', 'ui'),
    ];

    const queue = createDomainQueue('ui', tasks);
    const nextTask = await getNextTaskForDomain(queue, tasks, process.cwd(), false);

    expect(nextTask).toBeNull();
  });

  it('should skip tasks that exceeded retry limit', async () => {
    const tasks: EnhancedCampaignTask[] = [
      { ...createTask('T1', 'failed', 'ui'), attempts: 3 }, // Max retries exceeded
      createTask('T2', 'pending', 'ui'),
    ];

    const queue = createDomainQueue('ui', tasks);
    const nextTask = await getNextTaskForDomain(queue, tasks, process.cwd(), false);

    expect(nextTask?.id).toBe('T2'); // T1 exceeded retries
  });
});

describe('getDomainStatus', () => {
  it('should return correct status counts', () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'pending', 'ui'),
      createTask('T2', 'in_progress', 'ui'),
      createTask('T3', 'completed', 'ui'),
      createTask('T4', 'failed', 'ui'),
      createTask('T5', 'blocked', 'ui'),
    ];

    const queue = createDomainQueue('ui', tasks);
    const status = getDomainStatus(queue);

    expect(status.pending).toBe(1);
    expect(status.in_progress).toBe(1);
    expect(status.completed).toBe(1);
    expect(status.failed).toBe(1);
    expect(status.blocked).toBe(1);
    expect(status.total).toBe(5);
    expect(status.progress).toBe(20); // 1/5
  });
});

describe('hasDomainWorkRemaining', () => {
  it('should return true when pending tasks exist', () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'pending', 'ui'),
    ];

    const queue = createDomainQueue('ui', tasks);
    expect(hasDomainWorkRemaining(queue)).toBe(true);
  });

  it('should return true when in_progress tasks exist', () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'in_progress', 'ui'),
    ];

    const queue = createDomainQueue('ui', tasks);
    expect(hasDomainWorkRemaining(queue)).toBe(true);
  });

  it('should return false when all tasks completed', () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'completed', 'ui'),
    ];

    const queue = createDomainQueue('ui', tasks);
    expect(hasDomainWorkRemaining(queue)).toBe(false);
  });
});

describe('getDomainsWithWork', () => {
  it('should return domains that have remaining work', () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'pending', 'ui'),
      createTask('T2', 'completed', 'api'),
      createTask('T3', 'in_progress', 'infra'),
    ];

    const domains: CampaignDomain[] = [
      createDomain('ui', ['T1']),
      createDomain('api', ['T2']),
      createDomain('infra', ['T3']),
    ];

    const multiQueue = createMultiDomainQueue(domains, tasks);
    const domainsWithWork = getDomainsWithWork(multiQueue);

    expect(domainsWithWork).toContain('ui');
    expect(domainsWithWork).toContain('infra');
    expect(domainsWithWork).not.toContain('api'); // All completed
  });
});

describe('getMultiDomainProgress', () => {
  it('should calculate aggregate progress', () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'completed', 'ui'),
      createTask('T2', 'completed', 'ui'),
      createTask('T3', 'pending', 'api'),
      createTask('T4', 'completed', 'api'),
    ];

    const domains: CampaignDomain[] = [
      createDomain('ui', ['T1', 'T2']),
      createDomain('api', ['T3', 'T4']),
    ];

    const multiQueue = createMultiDomainQueue(domains, tasks);
    const progress = getMultiDomainProgress(multiQueue);

    expect(progress).toBe(75); // 3/4 completed
  });

  it('should return 0 for empty queue', () => {
    const multiQueue = createMultiDomainQueue([], []);
    expect(getMultiDomainProgress(multiQueue)).toBe(0);
  });
});

describe('updateDomainTaskStatus', () => {
  it('should move task to new status', () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'pending', 'ui'),
      createTask('T2', 'pending', 'ui'),
    ];

    const queue = createDomainQueue('ui', tasks);
    const updatedQueue = updateDomainTaskStatus(queue, 'T1', 'in_progress');

    expect(updatedQueue.pending).toEqual(['T2']);
    expect(updatedQueue.inProgress).toEqual(['T1']);
    expect(updatedQueue.status).toBe('running');
  });

  it('should update progress on completion', () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'in_progress', 'ui'),
      createTask('T2', 'pending', 'ui'),
    ];

    const queue = createDomainQueue('ui', tasks);
    const updatedQueue = updateDomainTaskStatus(queue, 'T1', 'completed');

    expect(updatedQueue.completed).toEqual(['T1']);
    expect(updatedQueue.progress).toBe(50); // 1/2
  });

  it('should mark domain completed when all tasks done', () => {
    const tasks: EnhancedCampaignTask[] = [
      createTask('T1', 'in_progress', 'ui'),
    ];

    const queue = createDomainQueue('ui', tasks);
    const updatedQueue = updateDomainTaskStatus(queue, 'T1', 'completed');

    expect(updatedQueue.status).toBe('completed');
    expect(updatedQueue.progress).toBe(100);
  });
});

// Test backwards compatibility with original queue functions
describe('Original Queue Functions (backwards compatibility)', () => {
  it('createQueueFromTasks should work as before', () => {
    const tasks: CampaignTask[] = [
      { id: 'T1', title: 'Task 1', status: 'pending', attempts: 0, createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'T2', title: 'Task 2', status: 'completed', attempts: 0, createdAt: Date.now(), updatedAt: Date.now() },
    ];

    const queue = createQueueFromTasks(tasks);

    expect(queue.pending).toEqual(['T1']);
    expect(queue.completed).toEqual(['T2']);
  });

  it('getNextTask should work as before', () => {
    const tasks: CampaignTask[] = [
      { id: 'T1', title: 'Task 1', status: 'pending', attempts: 0, createdAt: Date.now(), updatedAt: Date.now() },
    ];

    const queue = createQueueFromTasks(tasks);
    const nextTask = getNextTask(queue, tasks);

    expect(nextTask?.id).toBe('T1');
  });

  it('getProgress should work as before', () => {
    const tasks: CampaignTask[] = [
      { id: 'T1', title: 'Task 1', status: 'completed', attempts: 0, createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'T2', title: 'Task 2', status: 'pending', attempts: 0, createdAt: Date.now(), updatedAt: Date.now() },
    ];

    const queue = createQueueFromTasks(tasks);
    const progress = getProgress(queue, tasks.length);

    expect(progress).toBe(50);
  });
});
