/**
 * Parallel Domain Orchestrator
 *
 * Orchestrates multiple domains running in parallel, each with its own
 * Ralph-style task loop. Enables independent progress on UI, API,
 * infrastructure work simultaneously.
 */

import { EventEmitter } from 'events';
import type {
  CampaignDomain,
  ParallelCampaignConfig,
  CampaignProgressEvent,
  CampaignEventType,
  DomainStatus,
  CampaignMetrics,
  DEFAULT_PARALLEL_CONFIG
} from './campaign-types.js';
import type { CampaignTask, CampaignState } from './campaign-state.js';
import {
  createDomainQueue,
  createMultiDomainQueue,
  getNextTaskForDomain,
  getDomainStatus,
  hasDomainWorkRemaining,
  getMultiDomainProgress,
  updateDomainTaskStatus,
  type DomainQueue,
  type MultiDomainQueue
} from './campaign-queue.js';
import { runWorkerTask, type WorkerResult } from './campaign-worker.js';
import { validateExitCriteria } from './campaign-validation.js';
import type { EnhancedCampaignTask } from './campaign-types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Orchestrator status
 */
export type OrchestratorStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stopping';

/**
 * Domain execution context
 */
export interface DomainContext {
  domain: CampaignDomain;
  queue: DomainQueue;
  currentTask: CampaignTask | null;
  worker: AbortController | null;
  startedAt: number | null;
  completedTasks: number;
  failedTasks: number;
  retries: number;
}

/**
 * Progress callback payload
 */
export interface ProgressUpdate {
  campaignId: string;
  overallProgress: number;
  domains: Record<string, {
    status: DomainStatus;
    progress: number;
    currentTask: string | null;
    completedTasks: number;
    failedTasks: number;
  }>;
  timestamp: number;
}

/**
 * Parallel orchestrator options
 */
export interface ParallelOrchestratorOptions {
  campaignId: string;
  goal: string;
  domains: CampaignDomain[];
  tasks: CampaignTask[];
  config: ParallelCampaignConfig;
  cwd: string;
  workers?: string[];
  useDroid?: boolean;
  onProgress?: (update: ProgressUpdate) => void;
  onEvent?: (event: CampaignProgressEvent) => void;
  onTaskComplete?: (task: CampaignTask, result: WorkerResult) => Promise<void>;
  onTaskFailed?: (task: CampaignTask, result: WorkerResult) => Promise<void>;
}

// ============================================================================
// ParallelOrchestrator Class
// ============================================================================

/**
 * ParallelOrchestrator - Coordinates parallel domain execution
 *
 * Features:
 * - Runs domains concurrently up to max_concurrent limit
 * - Each domain has isolated task queue
 * - Progress callbacks for UI updates
 * - Graceful pause/resume/stop
 * - Domain failure isolation (one domain failing doesn't stop others)
 */
export class ParallelOrchestrator extends EventEmitter {
  private options: ParallelOrchestratorOptions;
  private status: OrchestratorStatus = 'idle';
  private domainContexts: Map<string, DomainContext> = new Map();
  private multiQueue: MultiDomainQueue;
  private globalAbort: AbortController = new AbortController();
  private progressInterval: NodeJS.Timeout | null = null;
  private startedAt: number = 0;
  private metrics: CampaignMetrics;

  constructor(options: ParallelOrchestratorOptions) {
    super();
    this.options = options;
    this.multiQueue = createMultiDomainQueue(options.domains, options.tasks);

    // Initialize domain contexts
    for (const domain of options.domains) {
      const queue = this.multiQueue.domains.get(domain.name)!;
      this.domainContexts.set(domain.name, {
        domain,
        queue,
        currentTask: null,
        worker: null,
        startedAt: null,
        completedTasks: 0,
        failedTasks: 0,
        retries: 0
      });
    }

    // Initialize metrics
    this.metrics = {
      tasks_total: options.tasks.length,
      tasks_completed: 0,
      tasks_failed: 0,
      retries_total: 0,
      total_duration_ms: 0,
      drift_checks: 0,
      drift_corrections: 0
    };
  }

  /**
   * Start the parallel orchestration
   */
  async start(): Promise<void> {
    if (this.status !== 'idle' && this.status !== 'paused') {
      throw new Error(`Cannot start orchestrator in ${this.status} state`);
    }

    this.status = 'running';
    this.startedAt = Date.now();
    this.emitEvent('campaign_started', 'Campaign started');

    // Start progress reporting
    if (this.options.config.progress_interval_ms > 0) {
      this.progressInterval = setInterval(() => {
        this.reportProgress();
      }, this.options.config.progress_interval_ms);
    }

    // Run domains in parallel
    await this.runDomainsInParallel();
  }

  /**
   * Pause the orchestration
   */
  async pause(): Promise<void> {
    if (this.status !== 'running') {
      return;
    }

    this.status = 'paused';
    this.emitEvent('campaign_paused', 'Campaign paused');

    // Stop progress reporting
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }

    // Note: Running tasks will complete, but no new tasks start
  }

  /**
   * Resume from paused state
   */
  async resume(): Promise<void> {
    if (this.status !== 'paused') {
      throw new Error(`Cannot resume orchestrator in ${this.status} state`);
    }

    this.status = 'running';
    this.emitEvent('campaign_resumed', 'Campaign resumed');

    // Restart progress reporting
    if (this.options.config.progress_interval_ms > 0) {
      this.progressInterval = setInterval(() => {
        this.reportProgress();
      }, this.options.config.progress_interval_ms);
    }

    // Continue running domains
    await this.runDomainsInParallel();
  }

  /**
   * Stop the orchestration (cannot be resumed)
   */
  async stop(): Promise<void> {
    this.status = 'stopping';

    // Abort all running workers
    this.globalAbort.abort();

    for (const context of this.domainContexts.values()) {
      if (context.worker) {
        context.worker.abort();
      }
    }

    // Stop progress reporting
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }

    this.status = 'idle';
    this.emitEvent('campaign_completed', 'Campaign stopped');
  }

  /**
   * Get current orchestrator status
   */
  getStatus(): OrchestratorStatus {
    return this.status;
  }

  /**
   * Get current metrics
   */
  getMetrics(): CampaignMetrics {
    return {
      ...this.metrics,
      total_duration_ms: this.startedAt ? Date.now() - this.startedAt : 0
    };
  }

  /**
   * Get domain contexts for external inspection
   */
  getDomainContexts(): Map<string, DomainContext> {
    return this.domainContexts;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Run all domains in parallel with concurrency limit
   */
  private async runDomainsInParallel(): Promise<void> {
    const maxConcurrent = this.options.config.max_concurrent;
    const activeDomains: Set<string> = new Set();

    while (this.status === 'running') {
      // Get domains that have work remaining and aren't currently running
      const domainsWithWork = Array.from(this.domainContexts.entries())
        .filter(([name, ctx]) =>
          hasDomainWorkRemaining(ctx.queue) && !activeDomains.has(name)
        )
        .map(([name]) => name);

      if (domainsWithWork.length === 0 && activeDomains.size === 0) {
        // All done
        break;
      }

      // Start domains up to concurrency limit
      const slotsAvailable = maxConcurrent - activeDomains.size;
      const domainsToStart = domainsWithWork.slice(0, slotsAvailable);

      // Start domain loops
      const domainPromises: Promise<void>[] = [];

      for (const domainName of domainsToStart) {
        activeDomains.add(domainName);
        domainPromises.push(
          this.runDomainLoop(domainName)
            .finally(() => {
              activeDomains.delete(domainName);
            })
        );
      }

      // Wait for at least one domain to complete or all started domains
      if (domainPromises.length > 0) {
        await Promise.race([
          Promise.all(domainPromises),
          new Promise<void>(resolve => {
            // Also resolve if status changes
            const check = setInterval(() => {
              if (this.status !== 'running') {
                clearInterval(check);
                resolve();
              }
            }, 100);
          })
        ]);
      } else {
        // Wait for running domains
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Update final status
    const allCompleted = Array.from(this.domainContexts.values())
      .every(ctx => ctx.queue.status === 'completed');

    const anyFailed = Array.from(this.domainContexts.values())
      .some(ctx => ctx.queue.status === 'failed');

    if (this.status === 'running') {
      if (allCompleted) {
        this.status = 'completed';
        this.emitEvent('campaign_completed', 'Campaign completed successfully');
      } else if (anyFailed && this.options.config.fail_fast) {
        this.status = 'failed';
        this.emitEvent('campaign_failed', 'Campaign failed (fail_fast enabled)');
      } else if (!allCompleted) {
        this.status = 'completed'; // Partial completion
        this.emitEvent('campaign_completed', 'Campaign completed with some failures');
      }
    }

    // Stop progress reporting
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  /**
   * Run the task loop for a single domain
   */
  private async runDomainLoop(domainName: string): Promise<void> {
    const context = this.domainContexts.get(domainName)!;
    context.startedAt = Date.now();

    this.emitEvent('domain_started', `Domain ${domainName} started`, domainName);

    while (this.status === 'running' && hasDomainWorkRemaining(context.queue)) {
      // Get next task
      const task = await getNextTaskForDomain(
        context.queue,
        this.options.tasks,
        this.options.cwd,
        true // Check entry criteria
      );

      if (!task) {
        // No task available (dependencies not met or entry criteria failed)
        // Wait a bit and try again
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      // Update queue status
      context.queue = updateDomainTaskStatus(context.queue, task.id, 'in_progress');
      context.currentTask = task;

      this.emitEvent('task_started', `Task ${task.id} started`, domainName, task.id);

      // Execute task
      const workerAbort = new AbortController();
      context.worker = workerAbort;

      try {
        const result = await runWorkerTask(
          task,
          this.options.workers || ['claude'],
          this.options.cwd,
          this.options.useDroid ?? false
        );

        if (result.success) {
          // Validate exit criteria for enhanced tasks
          let passed = true;
          if ('exit_criteria' in task && (task as EnhancedCampaignTask).exit_criteria?.length) {
            const validation = await validateExitCriteria(task as EnhancedCampaignTask, this.options.cwd);
            passed = validation.valid;
            if (!passed) {
              result.success = false;
              result.error = `Exit criteria failed: ${validation.failures.join(', ')}`;
            }
          }

          if (passed) {
            context.queue = updateDomainTaskStatus(context.queue, task.id, 'completed');
            context.completedTasks++;
            this.metrics.tasks_completed++;
            this.emitEvent('task_completed', `Task ${task.id} completed`, domainName, task.id);

            if (this.options.onTaskComplete) {
              await this.options.onTaskComplete(task, result);
            }
          } else {
            await this.handleTaskFailure(context, task, result);
          }
        } else {
          await this.handleTaskFailure(context, task, result);
        }
      } catch (err) {
        const result: WorkerResult = {
          taskId: task.id,
          success: false,
          error: (err as Error).message,
          artifacts: [],
          summary: ''
        };
        await this.handleTaskFailure(context, task, result);
      } finally {
        context.worker = null;
        context.currentTask = null;
      }
    }

    // Update domain status
    if (context.queue.status === 'completed') {
      this.emitEvent('domain_completed', `Domain ${domainName} completed`, domainName);
    } else if (context.queue.status === 'failed') {
      this.emitEvent('domain_failed', `Domain ${domainName} failed`, domainName);
    }
  }

  /**
   * Handle task failure with retry logic
   */
  private async handleTaskFailure(
    context: DomainContext,
    task: CampaignTask,
    result: WorkerResult
  ): Promise<void> {
    const maxRetries = context.domain.config?.max_retries ?? 3;

    if (task.attempts < maxRetries) {
      // Retry
      context.queue = updateDomainTaskStatus(context.queue, task.id, 'failed');
      context.retries++;
      this.metrics.retries_total++;
      this.emitEvent('task_failed', `Task ${task.id} failed (will retry)`, context.domain.name, task.id);
    } else {
      // Max retries exceeded
      context.queue = updateDomainTaskStatus(context.queue, task.id, 'blocked');
      context.failedTasks++;
      this.metrics.tasks_failed++;
      this.emitEvent('task_failed', `Task ${task.id} failed (max retries)`, context.domain.name, task.id);
    }

    // Update task attempts
    const taskIndex = this.options.tasks.findIndex(t => t.id === task.id);
    if (taskIndex >= 0) {
      this.options.tasks[taskIndex].attempts++;
      this.options.tasks[taskIndex].lastError = result.error;
    }

    if (this.options.onTaskFailed) {
      await this.options.onTaskFailed(task, result);
    }
  }

  /**
   * Report progress to callback
   */
  private reportProgress(): void {
    if (!this.options.onProgress) return;

    const domains: ProgressUpdate['domains'] = {};

    for (const [name, context] of this.domainContexts) {
      const status = getDomainStatus(context.queue);
      domains[name] = {
        status: context.queue.status,
        progress: status.progress,
        currentTask: context.currentTask?.id || null,
        completedTasks: context.completedTasks,
        failedTasks: context.failedTasks
      };
    }

    const update: ProgressUpdate = {
      campaignId: this.options.campaignId,
      overallProgress: getMultiDomainProgress(this.multiQueue),
      domains,
      timestamp: Date.now()
    };

    this.options.onProgress(update);
  }

  /**
   * Emit a campaign event
   */
  private emitEvent(
    type: CampaignEventType,
    message: string,
    domain?: string,
    taskId?: string
  ): void {
    const event: CampaignProgressEvent = {
      type,
      timestamp: Date.now(),
      campaign_id: this.options.campaignId,
      domain,
      task_id: taskId,
      payload: {},
      message
    };

    this.emit('event', event);

    if (this.options.onEvent) {
      this.options.onEvent(event);
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Run domains in parallel (functional API)
 *
 * @param options - Orchestrator options
 * @returns Promise that resolves when all domains complete
 */
export async function runDomainsInParallel(
  options: ParallelOrchestratorOptions
): Promise<{
  status: OrchestratorStatus;
  metrics: CampaignMetrics;
  domainResults: Record<string, { status: DomainStatus; completed: number; failed: number }>;
}> {
  const orchestrator = new ParallelOrchestrator(options);

  await orchestrator.start();

  const domainResults: Record<string, { status: DomainStatus; completed: number; failed: number }> = {};
  for (const [name, context] of orchestrator.getDomainContexts()) {
    domainResults[name] = {
      status: context.queue.status,
      completed: context.completedTasks,
      failed: context.failedTasks
    };
  }

  return {
    status: orchestrator.getStatus(),
    metrics: orchestrator.getMetrics(),
    domainResults
  };
}

/**
 * Create default parallel config
 */
export function createParallelConfig(
  overrides?: Partial<ParallelCampaignConfig>
): ParallelCampaignConfig {
  const defaults: ParallelCampaignConfig = {
    max_concurrent: 3,
    timeout_minutes: 0,
    fail_fast: false,
    git_strategy: 'domain-branches',
    merge_coordination: {
      strategy: 'sequential',
      require_review: false,
      conflict_resolution: 'auto'
    },
    progress_interval_ms: 5000,
    drift_detection: {
      enabled: true,
      check_at_milestones: [25, 50, 75, 100],
      check_every_n_tasks: 10,
      pause_threshold: 'severe'
    }
  };

  return { ...defaults, ...overrides };
}
