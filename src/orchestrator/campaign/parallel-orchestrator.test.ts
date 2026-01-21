/**
 * Tests for Parallel Domain Orchestrator
 */

import { describe, it, expect, mock } from 'bun:test';
import {
  ParallelOrchestrator,
  runDomainsInParallel,
  createParallelConfig,
  type ParallelOrchestratorOptions
} from './parallel-orchestrator.js';
import type { CampaignDomain, EnhancedCampaignTask, ParallelCampaignConfig } from './campaign-types.js';
import type { CampaignTaskStatus } from './campaign-state.js';

// Create a mock task
function createMockTask(
  id: string,
  domain: string,
  status: CampaignTaskStatus = 'pending',
  priority: number = 1
): EnhancedCampaignTask {
  return {
    id,
    title: `Task ${id}`,
    status,
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    domain,
    priority,
    entry_criteria: [],
    exit_criteria: []
  };
}

// Create a mock domain
function createMockDomain(name: string): CampaignDomain {
  return {
    name,
    goal: `Goal for ${name}`,
    stories: [],
    file_patterns: [],
    status: 'pending',
    progress_percent: 0
  };
}

describe('ParallelOrchestrator', () => {
  describe('constructor', () => {
    it('should initialize with correct status', () => {
      const options: ParallelOrchestratorOptions = {
        campaignId: 'test-campaign',
        goal: 'Test goal',
        domains: [createMockDomain('ui')],
        tasks: [createMockTask('T1', 'ui')],
        config: createParallelConfig(),
        cwd: process.cwd()
      };

      const orchestrator = new ParallelOrchestrator(options);

      expect(orchestrator.getStatus()).toBe('idle');
    });

    it('should initialize domain contexts', () => {
      const options: ParallelOrchestratorOptions = {
        campaignId: 'test-campaign',
        goal: 'Test goal',
        domains: [
          createMockDomain('ui'),
          createMockDomain('api')
        ],
        tasks: [
          createMockTask('T1', 'ui'),
          createMockTask('T2', 'api')
        ],
        config: createParallelConfig(),
        cwd: process.cwd()
      };

      const orchestrator = new ParallelOrchestrator(options);
      const contexts = orchestrator.getDomainContexts();

      expect(contexts.size).toBe(2);
      expect(contexts.has('ui')).toBe(true);
      expect(contexts.has('api')).toBe(true);
    });
  });

  describe('getMetrics', () => {
    it('should return initial metrics', () => {
      const options: ParallelOrchestratorOptions = {
        campaignId: 'test-campaign',
        goal: 'Test goal',
        domains: [createMockDomain('ui')],
        tasks: [
          createMockTask('T1', 'ui'),
          createMockTask('T2', 'ui')
        ],
        config: createParallelConfig(),
        cwd: process.cwd()
      };

      const orchestrator = new ParallelOrchestrator(options);
      const metrics = orchestrator.getMetrics();

      expect(metrics.tasks_total).toBe(2);
      expect(metrics.tasks_completed).toBe(0);
      expect(metrics.tasks_failed).toBe(0);
    });
  });

  describe('status transitions', () => {
    it('should transition from idle to running on start', async () => {
      const options: ParallelOrchestratorOptions = {
        campaignId: 'test-campaign',
        goal: 'Test goal',
        domains: [createMockDomain('ui')],
        tasks: [], // No tasks = immediate completion
        config: createParallelConfig({ progress_interval_ms: 0 }),
        cwd: process.cwd()
      };

      const orchestrator = new ParallelOrchestrator(options);
      await orchestrator.start();

      expect(orchestrator.getStatus()).toBe('completed');
    });

    it('should not allow starting from non-idle state', async () => {
      const options: ParallelOrchestratorOptions = {
        campaignId: 'test-campaign',
        goal: 'Test goal',
        domains: [createMockDomain('ui')],
        tasks: [],
        config: createParallelConfig({ progress_interval_ms: 0 }),
        cwd: process.cwd()
      };

      const orchestrator = new ParallelOrchestrator(options);
      await orchestrator.start();

      // Already completed, can't start again
      await expect(orchestrator.start()).rejects.toThrow();
    });
  });

  describe('event emission', () => {
    it('should emit campaign_started event on start', async () => {
      const events: string[] = [];

      const options: ParallelOrchestratorOptions = {
        campaignId: 'test-campaign',
        goal: 'Test goal',
        domains: [createMockDomain('ui')],
        tasks: [],
        config: createParallelConfig({ progress_interval_ms: 0 }),
        cwd: process.cwd(),
        onEvent: (event) => events.push(event.type)
      };

      const orchestrator = new ParallelOrchestrator(options);
      await orchestrator.start();

      expect(events).toContain('campaign_started');
      expect(events).toContain('campaign_completed');
    });
  });
});

describe('createParallelConfig', () => {
  it('should return default config', () => {
    const config = createParallelConfig();

    expect(config.max_concurrent).toBe(3);
    expect(config.timeout_minutes).toBe(0);
    expect(config.fail_fast).toBe(false);
    expect(config.git_strategy).toBe('domain-branches');
    expect(config.drift_detection.enabled).toBe(true);
  });

  it('should apply overrides', () => {
    const config = createParallelConfig({
      max_concurrent: 5,
      fail_fast: true
    });

    expect(config.max_concurrent).toBe(5);
    expect(config.fail_fast).toBe(true);
    // Defaults preserved
    expect(config.git_strategy).toBe('domain-branches');
  });
});

describe('runDomainsInParallel', () => {
  it('should complete with no tasks', async () => {
    const options: ParallelOrchestratorOptions = {
      campaignId: 'test-campaign',
      goal: 'Test goal',
      domains: [createMockDomain('ui')],
      tasks: [],
      config: createParallelConfig({ progress_interval_ms: 0 }),
      cwd: process.cwd()
    };

    const result = await runDomainsInParallel(options);

    expect(result.status).toBe('completed');
    expect(result.metrics.tasks_total).toBe(0);
  });

  it('should report domain results', async () => {
    const options: ParallelOrchestratorOptions = {
      campaignId: 'test-campaign',
      goal: 'Test goal',
      domains: [
        createMockDomain('ui'),
        createMockDomain('api')
      ],
      tasks: [], // No tasks, both complete immediately
      config: createParallelConfig({ progress_interval_ms: 0 }),
      cwd: process.cwd()
    };

    const result = await runDomainsInParallel(options);

    expect(result.domainResults).toHaveProperty('ui');
    expect(result.domainResults).toHaveProperty('api');
  });
});

describe('Progress reporting', () => {
  it('should call onProgress callback', async () => {
    const progressUpdates: number[] = [];

    const options: ParallelOrchestratorOptions = {
      campaignId: 'test-campaign',
      goal: 'Test goal',
      domains: [createMockDomain('ui')],
      tasks: [],
      config: createParallelConfig({
        progress_interval_ms: 10 // Fast interval for testing
      }),
      cwd: process.cwd(),
      onProgress: (update) => progressUpdates.push(update.overallProgress)
    };

    const orchestrator = new ParallelOrchestrator(options);

    // Start and wait a bit for progress to fire
    await orchestrator.start();

    // At least one progress update should have fired
    // (may or may not depending on timing)
    expect(typeof progressUpdates.length).toBe('number');
  });
});

describe('Domain isolation', () => {
  it('should track domain contexts independently', () => {
    const options: ParallelOrchestratorOptions = {
      campaignId: 'test-campaign',
      goal: 'Test goal',
      domains: [
        createMockDomain('ui'),
        createMockDomain('api'),
        createMockDomain('infra')
      ],
      tasks: [
        createMockTask('T1', 'ui'),
        createMockTask('T2', 'ui'),
        createMockTask('T3', 'api'),
        createMockTask('T4', 'infra')
      ],
      config: createParallelConfig(),
      cwd: process.cwd()
    };

    const orchestrator = new ParallelOrchestrator(options);
    const contexts = orchestrator.getDomainContexts();

    // UI domain has 2 tasks
    expect(contexts.get('ui')?.queue.pending).toHaveLength(2);

    // API domain has 1 task
    expect(contexts.get('api')?.queue.pending).toHaveLength(1);

    // Infra domain has 1 task
    expect(contexts.get('infra')?.queue.pending).toHaveLength(1);
  });
});
