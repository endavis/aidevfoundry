/**
 * Campaign Metrics and Observability
 *
 * Provides real-time metrics collection, aggregation, and reporting for campaign execution.
 * Tracks task completion rates, timing, retries, domain progress, and drift events.
 */

import type { CampaignState, CampaignTask } from './campaign-state.js';
import type { CampaignMetrics, DomainMetrics, DriftDetectionResult } from './campaign-types.js';

// ============================================================================
// Types
// ============================================================================

/** Real-time metrics snapshot */
export interface MetricsSnapshot {
  timestamp: number;
  campaignId: string;

  // Task metrics
  tasksTotal: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksBlocked: number;
  tasksInProgress: number;
  tasksPending: number;

  // Progress metrics
  progressPercent: number;
  completionRate: number; // Tasks completed per minute
  failureRate: number; // Percentage of attempted tasks that failed

  // Retry metrics
  totalRetries: number;
  avgRetriesPerTask: number;
  tasksWithRetries: number;

  // Timing metrics
  elapsedMs: number;
  avgTaskDurationMs: number;
  estimatedRemainingMs: number;

  // Drift metrics
  driftChecks: number;
  driftCorrections: number;
  lastDriftSeverity?: string;
}

/** Metrics event for real-time streaming */
export interface MetricsEvent {
  type: 'task_started' | 'task_completed' | 'task_failed' | 'task_retried' |
        'checkpoint' | 'drift_check' | 'drift_correction';
  timestamp: number;
  taskId?: string;
  data?: Record<string, unknown>;
}

/** Metrics collector configuration */
export interface MetricsCollectorOptions {
  /** Enable real-time event tracking */
  enableEvents?: boolean;
  /** Maximum events to retain in memory */
  maxEvents?: number;
  /** Callback for real-time event streaming */
  onEvent?: (event: MetricsEvent) => void;
}

// ============================================================================
// Metrics Collector
// ============================================================================

/**
 * Collects and aggregates campaign metrics in real-time.
 */
export class MetricsCollector {
  private events: MetricsEvent[] = [];
  private options: Required<MetricsCollectorOptions>;
  private startTime: number;
  private taskStartTimes: Map<string, number> = new Map();
  private taskDurations: number[] = [];
  private driftChecks = 0;
  private driftCorrections = 0;
  private lastDriftResult?: DriftDetectionResult;

  constructor(options: MetricsCollectorOptions = {}) {
    this.options = {
      enableEvents: options.enableEvents ?? true,
      maxEvents: options.maxEvents ?? 1000,
      onEvent: options.onEvent ?? (() => {})
    };
    this.startTime = Date.now();
  }

  /**
   * Record task started event
   */
  recordTaskStarted(taskId: string): void {
    this.taskStartTimes.set(taskId, Date.now());
    this.emit({
      type: 'task_started',
      timestamp: Date.now(),
      taskId
    });
  }

  /**
   * Record task completed event
   */
  recordTaskCompleted(taskId: string): void {
    const startTime = this.taskStartTimes.get(taskId);
    if (startTime) {
      const duration = Date.now() - startTime;
      this.taskDurations.push(duration);
      this.taskStartTimes.delete(taskId);
    }

    this.emit({
      type: 'task_completed',
      timestamp: Date.now(),
      taskId
    });
  }

  /**
   * Record task failed event
   */
  recordTaskFailed(taskId: string, error?: string): void {
    this.taskStartTimes.delete(taskId);
    this.emit({
      type: 'task_failed',
      timestamp: Date.now(),
      taskId,
      data: error ? { error } : undefined
    });
  }

  /**
   * Record task retry event
   */
  recordTaskRetried(taskId: string, attempt: number): void {
    this.emit({
      type: 'task_retried',
      timestamp: Date.now(),
      taskId,
      data: { attempt }
    });
  }

  /**
   * Record checkpoint event
   */
  recordCheckpoint(checkpointId: string): void {
    this.emit({
      type: 'checkpoint',
      timestamp: Date.now(),
      data: { checkpointId }
    });
  }

  /**
   * Record drift check event
   */
  recordDriftCheck(result: DriftDetectionResult): void {
    this.driftChecks++;
    this.lastDriftResult = result;
    this.emit({
      type: 'drift_check',
      timestamp: Date.now(),
      data: {
        drifted: result.drifted,
        severity: result.severity,
        areas: result.drift_areas.length
      }
    });
  }

  /**
   * Record drift correction event
   */
  recordDriftCorrection(tasksAdded: number, tasksModified: number, tasksRemoved: number): void {
    this.driftCorrections++;
    this.emit({
      type: 'drift_correction',
      timestamp: Date.now(),
      data: { tasksAdded, tasksModified, tasksRemoved }
    });
  }

  /**
   * Get current metrics snapshot from state
   */
  getSnapshot(state: CampaignState): MetricsSnapshot {
    const now = Date.now();
    const elapsed = now - this.startTime;

    // Count tasks by status
    const counts = {
      total: state.tasks.length,
      completed: 0,
      failed: 0,
      blocked: 0,
      in_progress: 0,
      pending: 0
    };

    let totalRetries = 0;
    let tasksWithRetries = 0;

    for (const task of state.tasks) {
      switch (task.status) {
        case 'completed': counts.completed++; break;
        case 'failed': counts.failed++; break;
        case 'blocked': counts.blocked++; break;
        case 'in_progress': counts.in_progress++; break;
        default: counts.pending++;
      }
      totalRetries += task.attempts;
      if (task.attempts > 0) tasksWithRetries++;
    }

    // Calculate derived metrics
    const attempted = counts.completed + counts.failed;
    const progressPercent = counts.total > 0
      ? Math.round((counts.completed / counts.total) * 100)
      : 0;
    const failureRate = attempted > 0
      ? (counts.failed / attempted) * 100
      : 0;
    const completionRate = elapsed > 0
      ? (counts.completed / (elapsed / 60000)) // Per minute
      : 0;
    const avgTaskDuration = this.taskDurations.length > 0
      ? this.taskDurations.reduce((a, b) => a + b, 0) / this.taskDurations.length
      : 0;
    const estimatedRemaining = completionRate > 0
      ? ((counts.total - counts.completed) / completionRate) * 60000
      : 0;

    return {
      timestamp: now,
      campaignId: state.campaignId,
      tasksTotal: counts.total,
      tasksCompleted: counts.completed,
      tasksFailed: counts.failed,
      tasksBlocked: counts.blocked,
      tasksInProgress: counts.in_progress,
      tasksPending: counts.pending,
      progressPercent,
      completionRate,
      failureRate,
      totalRetries,
      avgRetriesPerTask: counts.total > 0 ? totalRetries / counts.total : 0,
      tasksWithRetries,
      elapsedMs: elapsed,
      avgTaskDurationMs: avgTaskDuration,
      estimatedRemainingMs: estimatedRemaining,
      driftChecks: this.driftChecks,
      driftCorrections: this.driftCorrections,
      lastDriftSeverity: this.lastDriftResult?.severity
    };
  }

  /**
   * Get all recorded events
   */
  getEvents(): MetricsEvent[] {
    return [...this.events];
  }

  /**
   * Get events filtered by type
   */
  getEventsByType(type: MetricsEvent['type']): MetricsEvent[] {
    return this.events.filter(e => e.type === type);
  }

  /**
   * Reset collector state
   */
  reset(): void {
    this.events = [];
    this.taskStartTimes.clear();
    this.taskDurations = [];
    this.startTime = Date.now();
    this.driftChecks = 0;
    this.driftCorrections = 0;
    this.lastDriftResult = undefined;
  }

  /**
   * Emit event to listeners
   */
  private emit(event: MetricsEvent): void {
    if (!this.options.enableEvents) return;

    this.events.push(event);

    // Trim old events if exceeding max
    if (this.events.length > this.options.maxEvents) {
      this.events = this.events.slice(-this.options.maxEvents);
    }

    this.options.onEvent(event);
  }
}

// ============================================================================
// Metrics Utilities
// ============================================================================

/**
 * Format duration for display
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Format percentage for display
 */
export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format rate for display (per minute)
 */
export function formatRate(value: number): string {
  if (value < 1) return `${(value * 60).toFixed(1)}/h`;
  return `${value.toFixed(1)}/m`;
}

/**
 * Calculate metrics from campaign state (stateless, no collector needed)
 */
export function calculateMetrics(state: CampaignState): MetricsSnapshot {
  const now = Date.now();
  const elapsed = now - state.createdAt;

  // Count tasks by status
  const counts = {
    total: state.tasks.length,
    completed: 0,
    failed: 0,
    blocked: 0,
    in_progress: 0,
    pending: 0
  };

  let totalRetries = 0;
  let tasksWithRetries = 0;

  for (const task of state.tasks) {
    switch (task.status) {
      case 'completed': counts.completed++; break;
      case 'failed': counts.failed++; break;
      case 'blocked': counts.blocked++; break;
      case 'in_progress': counts.in_progress++; break;
      default: counts.pending++;
    }
    totalRetries += task.attempts;
    if (task.attempts > 0) tasksWithRetries++;
  }

  const attempted = counts.completed + counts.failed;
  const progressPercent = counts.total > 0
    ? Math.round((counts.completed / counts.total) * 100)
    : 0;
  const failureRate = attempted > 0
    ? (counts.failed / attempted) * 100
    : 0;
  const completionRate = elapsed > 0
    ? (counts.completed / (elapsed / 60000))
    : 0;
  const estimatedRemaining = completionRate > 0
    ? ((counts.total - counts.completed) / completionRate) * 60000
    : 0;

  return {
    timestamp: now,
    campaignId: state.campaignId,
    tasksTotal: counts.total,
    tasksCompleted: counts.completed,
    tasksFailed: counts.failed,
    tasksBlocked: counts.blocked,
    tasksInProgress: counts.in_progress,
    tasksPending: counts.pending,
    progressPercent,
    completionRate,
    failureRate,
    totalRetries,
    avgRetriesPerTask: counts.total > 0 ? totalRetries / counts.total : 0,
    tasksWithRetries,
    elapsedMs: elapsed,
    avgTaskDurationMs: 0, // Not available without collector
    estimatedRemainingMs: estimatedRemaining,
    driftChecks: 0,
    driftCorrections: 0
  };
}

/**
 * Generate metrics summary text
 */
export function generateMetricsSummary(snapshot: MetricsSnapshot): string {
  const lines: string[] = [
    `Campaign: ${snapshot.campaignId}`,
    `Progress: ${snapshot.progressPercent}% (${snapshot.tasksCompleted}/${snapshot.tasksTotal})`,
    `Elapsed: ${formatDuration(snapshot.elapsedMs)}`,
    `Rate: ${formatRate(snapshot.completionRate)}`,
    '',
    'Task Status:',
    `  Completed: ${snapshot.tasksCompleted}`,
    `  Failed: ${snapshot.tasksFailed}`,
    `  In Progress: ${snapshot.tasksInProgress}`,
    `  Blocked: ${snapshot.tasksBlocked}`,
    `  Pending: ${snapshot.tasksPending}`,
    '',
    'Metrics:',
    `  Failure Rate: ${formatPercent(snapshot.failureRate)}`,
    `  Total Retries: ${snapshot.totalRetries}`,
    `  Avg Retries/Task: ${snapshot.avgRetriesPerTask.toFixed(2)}`
  ];

  if (snapshot.avgTaskDurationMs > 0) {
    lines.push(`  Avg Task Duration: ${formatDuration(snapshot.avgTaskDurationMs)}`);
  }

  if (snapshot.estimatedRemainingMs > 0) {
    lines.push(`  Est. Remaining: ${formatDuration(snapshot.estimatedRemainingMs)}`);
  }

  if (snapshot.driftChecks > 0) {
    lines.push('');
    lines.push('Drift:');
    lines.push(`  Checks: ${snapshot.driftChecks}`);
    lines.push(`  Corrections: ${snapshot.driftCorrections}`);
    if (snapshot.lastDriftSeverity) {
      lines.push(`  Last Severity: ${snapshot.lastDriftSeverity}`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate JSON metrics export
 */
export function exportMetricsJson(snapshot: MetricsSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new metrics collector
 */
export function createMetricsCollector(
  options?: MetricsCollectorOptions
): MetricsCollector {
  return new MetricsCollector(options);
}
