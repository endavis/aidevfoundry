/**
 * Campaign Drift Detection and Correction
 *
 * Monitors campaign progress against the original goal and detects when
 * execution has drifted from the intended path. Provides corrective
 * recommendations to bring the campaign back on track.
 */

import type { CampaignState, CampaignTask } from './campaign-state.js';
import type {
  DriftDetectionConfig,
  DriftDetectionResult,
  DriftArea,
  DriftSeverity,
  CorrectivePlan,
  EnhancedCampaignTask,
  CampaignDomain
} from './campaign-types.js';
import { runAdapter } from '../../lib/adapter-runner.js';
import type { AgentName } from '../../executor/types.js';

// ============================================================================
// Types
// ============================================================================

/** Options for drift detection */
export interface DriftDetectorOptions {
  /** Working directory for file checks */
  cwd: string;
  /** Agent to use for analysis */
  agent?: AgentName;
  /** Model override */
  model?: string;
  /** Timeout for analysis */
  timeout?: number;
  /** Use criteria-only mode (no LLM) */
  criteriaOnly?: boolean;
}

/** Progress snapshot for drift comparison */
export interface ProgressSnapshot {
  /** Progress percentage (0-100) */
  progress: number;
  /** Number of completed tasks */
  completedTasks: number;
  /** Total tasks */
  totalTasks: number;
  /** Failed tasks */
  failedTasks: number;
  /** Timestamp */
  timestamp: number;
}

/** Drift check trigger reasons */
export type DriftCheckReason =
  | 'milestone'    // Progress hit a milestone
  | 'task_count'   // N tasks completed since last check
  | 'failure'      // Multiple failures occurred
  | 'manual';      // User requested

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_AGENT: AgentName = 'claude';
const DEFAULT_MODEL = 'claude-3-5-sonnet-latest';
const DEFAULT_TIMEOUT = 60000;

/** Default drift detection configuration */
export const DEFAULT_DRIFT_CONFIG: DriftDetectionConfig = {
  enabled: true,
  check_at_milestones: [25, 50, 75, 90],
  check_every_n_tasks: 5,
  pause_threshold: 'severe'
};

// ============================================================================
// Drift Detector Class
// ============================================================================

/**
 * DriftDetector - Monitors campaign drift and suggests corrections
 */
export class DriftDetector {
  private options: Required<DriftDetectorOptions>;
  private lastCheck: ProgressSnapshot | null = null;
  private checksPerformed = 0;
  private driftHistory: DriftDetectionResult[] = [];

  constructor(options: DriftDetectorOptions) {
    this.options = {
      cwd: options.cwd,
      agent: options.agent ?? DEFAULT_AGENT,
      model: options.model ?? DEFAULT_MODEL,
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      criteriaOnly: options.criteriaOnly ?? false
    };
  }

  /**
   * Check if a drift check should be triggered
   */
  shouldCheck(
    state: CampaignState,
    config: DriftDetectionConfig = DEFAULT_DRIFT_CONFIG,
    reason?: DriftCheckReason
  ): { shouldCheck: boolean; reason: DriftCheckReason | null } {
    if (!config.enabled) {
      return { shouldCheck: false, reason: null };
    }

    // Manual check always proceeds
    if (reason === 'manual') {
      return { shouldCheck: true, reason: 'manual' };
    }

    const snapshot = this.createSnapshot(state);

    // Check milestone triggers
    for (const milestone of config.check_at_milestones) {
      if (this.lastCheck && this.lastCheck.progress < milestone && snapshot.progress >= milestone) {
        return { shouldCheck: true, reason: 'milestone' };
      }
    }

    // Check task count trigger
    if (this.lastCheck) {
      const tasksDelta = snapshot.completedTasks - this.lastCheck.completedTasks;
      if (tasksDelta >= config.check_every_n_tasks) {
        return { shouldCheck: true, reason: 'task_count' };
      }
    } else {
      // First check after initial setup
      if (snapshot.completedTasks >= config.check_every_n_tasks) {
        return { shouldCheck: true, reason: 'task_count' };
      }
    }

    // Check failure trigger
    const recentFailures = state.tasks.filter(t =>
      t.status === 'failed' &&
      (!this.lastCheck || t.updatedAt > this.lastCheck.timestamp)
    ).length;

    if (recentFailures >= 3) {
      return { shouldCheck: true, reason: 'failure' };
    }

    return { shouldCheck: false, reason: null };
  }

  /**
   * Perform drift detection
   */
  async detect(
    state: CampaignState,
    reason: DriftCheckReason = 'manual'
  ): Promise<DriftDetectionResult> {
    const snapshot = this.createSnapshot(state);
    this.lastCheck = snapshot;
    this.checksPerformed++;

    // Gather drift indicators
    const driftAreas = await this.gatherDriftIndicators(state);

    // Determine severity
    const severity = this.calculateSeverity(driftAreas);

    // Generate corrective plan if drift detected
    let correctivePlan: CorrectivePlan | undefined;
    if (driftAreas.length > 0 && !this.options.criteriaOnly) {
      correctivePlan = await this.generateCorrectivePlan(state, driftAreas, severity);
    }

    const result: DriftDetectionResult = {
      drifted: driftAreas.length > 0,
      severity,
      drift_areas: driftAreas,
      corrective_plan: correctivePlan,
      confidence: this.calculateConfidence(driftAreas)
    };

    this.driftHistory.push(result);
    return result;
  }

  /**
   * Create progress snapshot from current state
   */
  private createSnapshot(state: CampaignState): ProgressSnapshot {
    const completed = state.tasks.filter(t => t.status === 'completed').length;
    const failed = state.tasks.filter(t => t.status === 'failed').length;
    const total = state.tasks.length;

    return {
      progress: total > 0 ? (completed / total) * 100 : 0,
      completedTasks: completed,
      totalTasks: total,
      failedTasks: failed,
      timestamp: Date.now()
    };
  }

  /**
   * Gather drift indicators from various sources
   */
  private async gatherDriftIndicators(state: CampaignState): Promise<DriftArea[]> {
    const areas: DriftArea[] = [];

    // Check 1: High failure rate
    const failureArea = this.checkFailureRate(state);
    if (failureArea) areas.push(failureArea);

    // Check 2: Stalled progress
    const stallArea = this.checkStalledProgress(state);
    if (stallArea) areas.push(stallArea);

    // Check 3: Circular dependencies / blocked tasks
    const blockedArea = this.checkBlockedTasks(state);
    if (blockedArea) areas.push(blockedArea);

    // Check 4: Task scope creep (too many retries)
    const retryArea = this.checkExcessiveRetries(state);
    if (retryArea) areas.push(retryArea);

    // Check 5: Domain imbalance (if applicable)
    if (this.hasDomains(state)) {
      const domainArea = this.checkDomainImbalance(state);
      if (domainArea) areas.push(domainArea);
    }

    return areas;
  }

  /**
   * Check for high failure rate
   */
  private checkFailureRate(state: CampaignState): DriftArea | null {
    const completed = state.tasks.filter(t => t.status === 'completed').length;
    const failed = state.tasks.filter(t => t.status === 'failed').length;
    const total = completed + failed;

    if (total === 0) return null;

    const failureRate = failed / total;

    if (failureRate > 0.5) {
      return {
        domain: 'global',
        description: `High failure rate: ${Math.round(failureRate * 100)}% of attempted tasks failed`,
        contributing_tasks: state.tasks.filter(t => t.status === 'failed').map(t => t.id),
        severity: failureRate > 0.7 ? 'severe' : 'moderate'
      };
    }

    if (failureRate > 0.3) {
      return {
        domain: 'global',
        description: `Elevated failure rate: ${Math.round(failureRate * 100)}% of attempted tasks failed`,
        contributing_tasks: state.tasks.filter(t => t.status === 'failed').map(t => t.id),
        severity: 'minor'
      };
    }

    return null;
  }

  /**
   * Check for stalled progress
   */
  private checkStalledProgress(state: CampaignState): DriftArea | null {
    const inProgress = state.tasks.filter(t => t.status === 'in_progress');

    // Check for tasks stuck in_progress for too long (30 minutes)
    const now = Date.now();
    const stuckTasks = inProgress.filter(t => {
      const taskAge = now - (t.updatedAt || t.createdAt);
      return taskAge > 30 * 60 * 1000; // 30 minutes
    });

    if (stuckTasks.length > 0) {
      return {
        domain: 'global',
        description: `${stuckTasks.length} task(s) stuck in progress for over 30 minutes`,
        contributing_tasks: stuckTasks.map(t => t.id),
        severity: stuckTasks.length >= 3 ? 'severe' : 'moderate'
      };
    }

    return null;
  }

  /**
   * Check for blocked tasks
   */
  private checkBlockedTasks(state: CampaignState): DriftArea | null {
    const blocked = state.tasks.filter(t => t.status === 'blocked');

    if (blocked.length === 0) return null;

    // Check if blocked tasks are blocking other tasks
    const blockedIds = new Set(blocked.map(t => t.id));
    const cascadeBlocked = state.tasks.filter(t =>
      t.status === 'pending' &&
      t.dependencies?.some(d => blockedIds.has(d))
    );

    if (blocked.length >= 3 || cascadeBlocked.length >= 5) {
      return {
        domain: 'global',
        description: `${blocked.length} blocked task(s) with ${cascadeBlocked.length} dependent tasks waiting`,
        contributing_tasks: [...blocked.map(t => t.id), ...cascadeBlocked.map(t => t.id)],
        severity: 'severe'
      };
    }

    if (blocked.length >= 1) {
      return {
        domain: 'global',
        description: `${blocked.length} blocked task(s) may slow progress`,
        contributing_tasks: blocked.map(t => t.id),
        severity: 'minor'
      };
    }

    return null;
  }

  /**
   * Check for excessive retries
   */
  private checkExcessiveRetries(state: CampaignState): DriftArea | null {
    const highRetryTasks = state.tasks.filter(t => t.attempts >= 3);

    if (highRetryTasks.length === 0) return null;

    const totalRetries = highRetryTasks.reduce((sum, t) => sum + t.attempts, 0);

    if (highRetryTasks.length >= 3 || totalRetries >= 10) {
      return {
        domain: 'global',
        description: `${highRetryTasks.length} task(s) required excessive retries (${totalRetries} total attempts)`,
        contributing_tasks: highRetryTasks.map(t => t.id),
        severity: highRetryTasks.length >= 5 ? 'severe' : 'moderate'
      };
    }

    return null;
  }

  /**
   * Check for domain imbalance
   */
  private checkDomainImbalance(state: CampaignState): DriftArea | null {
    if (!this.hasDomains(state)) return null;

    const stateWithDomains = state as CampaignState & { domains: CampaignDomain[] };
    const domainStats: Record<string, { completed: number; failed: number; total: number }> = {};

    // Count tasks per domain
    for (const task of state.tasks) {
      const domain = (task as CampaignTask & { domain?: string }).domain || 'default';
      if (!domainStats[domain]) {
        domainStats[domain] = { completed: 0, failed: 0, total: 0 };
      }
      domainStats[domain].total++;
      if (task.status === 'completed') domainStats[domain].completed++;
      if (task.status === 'failed') domainStats[domain].failed++;
    }

    // Find domains with significant imbalance
    const imbalanced: string[] = [];
    for (const [domain, stats] of Object.entries(domainStats)) {
      const completionRate = stats.total > 0 ? stats.completed / stats.total : 0;
      const failureRate = stats.total > 0 ? stats.failed / stats.total : 0;

      // Domain significantly behind others or high failure rate
      if (completionRate < 0.2 && stats.total >= 3) {
        imbalanced.push(domain);
      } else if (failureRate > 0.5 && stats.total >= 2) {
        imbalanced.push(domain);
      }
    }

    if (imbalanced.length > 0) {
      return {
        domain: imbalanced[0],
        description: `Domain(s) [${imbalanced.join(', ')}] showing significant imbalance`,
        contributing_tasks: state.tasks
          .filter(t => imbalanced.includes((t as CampaignTask & { domain?: string }).domain || 'default'))
          .map(t => t.id),
        severity: imbalanced.length >= 2 ? 'moderate' : 'minor'
      };
    }

    return null;
  }

  /**
   * Calculate overall severity from drift areas
   */
  private calculateSeverity(areas: DriftArea[]): DriftSeverity {
    if (areas.length === 0) return 'minor';

    const severities = areas.map(a => a.severity);

    if (severities.includes('severe')) return 'severe';
    if (severities.includes('moderate')) return 'moderate';
    return 'minor';
  }

  /**
   * Calculate confidence in the drift assessment
   */
  private calculateConfidence(areas: DriftArea[]): number {
    if (areas.length === 0) return 1.0;

    // More areas = more confident in drift detection
    const areaConfidence = Math.min(areas.length * 0.2, 0.8);

    // Severity adds confidence
    const severityBonus = areas.some(a => a.severity === 'severe') ? 0.2 : 0;

    return Math.min(areaConfidence + severityBonus + 0.2, 1.0);
  }

  /**
   * Generate corrective plan using LLM
   */
  private async generateCorrectivePlan(
    state: CampaignState,
    areas: DriftArea[],
    severity: DriftSeverity
  ): Promise<CorrectivePlan | undefined> {
    const prompt = this.buildCorrectionPrompt(state, areas, severity);

    try {
      const result = await runAdapter(this.options.agent, prompt, {
        model: this.options.model,
        timeout: this.options.timeout
      });

      if (result.error) {
        return undefined;
      }

      return this.parseCorrectionResponse(result.content);
    } catch {
      return undefined;
    }
  }

  /**
   * Build prompt for corrective plan generation
   */
  private buildCorrectionPrompt(
    state: CampaignState,
    areas: DriftArea[],
    severity: DriftSeverity
  ): string {
    const failedTasks = state.tasks.filter(t => t.status === 'failed');
    const blockedTasks = state.tasks.filter(t => t.status === 'blocked');

    return `You are a campaign corrector analyzing drift in a coding campaign.

## Campaign Goal
${state.goal}

## Current Status
- Total Tasks: ${state.tasks.length}
- Completed: ${state.tasks.filter(t => t.status === 'completed').length}
- Failed: ${failedTasks.length}
- Blocked: ${blockedTasks.length}
- In Progress: ${state.tasks.filter(t => t.status === 'in_progress').length}

## Drift Areas Detected (${severity} severity)
${areas.map(a => `- [${a.domain}] ${a.description}`).join('\n')}

## Failed Tasks
${failedTasks.slice(0, 5).map(t => `- ${t.title}: ${t.lastError || 'No error recorded'}`).join('\n') || 'None'}

## Blocked Tasks
${blockedTasks.slice(0, 5).map(t => `- ${t.title}`).join('\n') || 'None'}

## Instructions
Analyze the drift and provide a corrective plan in JSON format:

\`\`\`json
{
  "summary": "Brief summary of recommended corrections",
  "tasks_to_add": [
    { "title": "New task title", "description": "Description", "dependencies": [] }
  ],
  "tasks_to_modify": [
    { "id": "task-id", "changes": { "title": "Updated title", "description": "Updated description" } }
  ],
  "tasks_to_remove": ["task-id-to-remove"],
  "priority_domains": ["domain1", "domain2"]
}
\`\`\`

Focus on actionable corrections that address the root cause of drift. Respond ONLY with the JSON block.`;
  }

  /**
   * Parse LLM response into CorrectivePlan
   */
  private parseCorrectionResponse(content: string): CorrectivePlan | undefined {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                      content.match(/\{[\s\S]*"summary"[\s\S]*\}/);

    if (!jsonMatch) return undefined;

    try {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);

      return {
        summary: String(parsed.summary || 'No summary provided'),
        tasks_to_add: Array.isArray(parsed.tasks_to_add) ? parsed.tasks_to_add : [],
        tasks_to_modify: Array.isArray(parsed.tasks_to_modify) ? parsed.tasks_to_modify : [],
        tasks_to_remove: Array.isArray(parsed.tasks_to_remove) ? parsed.tasks_to_remove : [],
        priority_domains: Array.isArray(parsed.priority_domains) ? parsed.priority_domains : []
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Check if state has domains
   */
  private hasDomains(state: CampaignState): boolean {
    return 'domains' in state && Array.isArray((state as { domains?: unknown }).domains);
  }

  /**
   * Get drift history
   */
  getHistory(): DriftDetectionResult[] {
    return [...this.driftHistory];
  }

  /**
   * Get number of checks performed
   */
  getChecksPerformed(): number {
    return this.checksPerformed;
  }

  /**
   * Reset detector state
   */
  reset(): void {
    this.lastCheck = null;
    this.checksPerformed = 0;
    this.driftHistory = [];
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a drift detector
 */
export function createDriftDetector(options: DriftDetectorOptions): DriftDetector {
  return new DriftDetector(options);
}

/**
 * Quick drift check function
 */
export async function checkForDrift(
  state: CampaignState,
  cwd: string,
  options?: Partial<DriftDetectorOptions>
): Promise<DriftDetectionResult> {
  const detector = new DriftDetector({ cwd, ...options });
  return detector.detect(state);
}

/**
 * Check if severity exceeds threshold
 */
export function exceedsThreshold(
  severity: DriftSeverity,
  threshold: DriftSeverity
): boolean {
  const severityOrder: Record<DriftSeverity, number> = {
    minor: 1,
    moderate: 2,
    severe: 3
  };

  return severityOrder[severity] >= severityOrder[threshold];
}

/**
 * Apply corrective plan to state
 *
 * Note: This modifies the state in place
 */
export function applyCorrectivePlan(
  state: CampaignState,
  plan: CorrectivePlan
): { added: number; modified: number; removed: number } {
  let added = 0;
  let modified = 0;
  let removed = 0;

  // Remove tasks
  for (const taskId of plan.tasks_to_remove) {
    const index = state.tasks.findIndex(t => t.id === taskId);
    if (index >= 0) {
      state.tasks.splice(index, 1);
      removed++;
    }
  }

  // Modify tasks
  for (const modification of plan.tasks_to_modify) {
    const task = state.tasks.find(t => t.id === modification.id);
    if (task) {
      Object.assign(task, modification.changes);
      task.updatedAt = Date.now();
      modified++;
    }
  }

  // Add tasks
  const now = Date.now();
  for (const newTask of plan.tasks_to_add) {
    const task: CampaignTask = {
      id: `corrective_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: newTask.title || 'Corrective Task',
      description: newTask.description,
      status: 'pending',
      dependencies: (newTask as Partial<CampaignTask>).dependencies || [],
      acceptanceCriteria: (newTask as Partial<CampaignTask>).acceptanceCriteria || [],
      assignedFiles: (newTask as Partial<CampaignTask>).assignedFiles || [],
      attempts: 0,
      createdAt: now,
      updatedAt: now
    };
    state.tasks.push(task);
    added++;
  }

  state.updatedAt = Date.now();

  return { added, modified, removed };
}
