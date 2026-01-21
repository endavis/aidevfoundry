/**
 * Enhanced Campaign Types for Parallel Domain Orchestration
 *
 * This module defines types for the enhanced campaign orchestrator that supports:
 * - Multi-domain campaigns with parallel Ralph loops
 * - Entry/exit criteria for objective task validation
 * - Domain-scoped file patterns
 * - Parallel execution configuration
 */

import type { AgentName, PlanMode } from '../../executor/types.js';
import type { CampaignTask, CampaignTaskStatus } from './campaign-state.js';

// ============================================================================
// Domain Types
// ============================================================================

/**
 * CampaignDomain - A logical grouping of tasks that can execute independently
 *
 * Domains enable parallel execution: UI, API, and infrastructure work can
 * proceed simultaneously on separate branches.
 */
export interface CampaignDomain {
  /** Unique domain identifier (e.g., 'ui', 'api', 'infra') */
  name: string;

  /** High-level goal for this domain */
  goal: string;

  /** User stories/tasks belonging to this domain */
  stories: string[];

  /** Glob patterns for files this domain may modify */
  file_patterns: string[];

  /** Domain-specific branch name (e.g., 'campaign/my-campaign/ui') */
  branch?: string;

  /** Current domain status */
  status: DomainStatus;

  /** Progress percentage (0-100) */
  progress_percent: number;

  /** Agent to use for this domain's tasks */
  preferred_agent?: AgentName;

  /** Optional domain-specific configuration */
  config?: DomainConfig;
}

export type DomainStatus =
  | 'pending'      // Not started
  | 'running'      // Actively executing tasks
  | 'paused'       // Temporarily halted
  | 'completed'    // All tasks done
  | 'failed'       // Domain failed, needs intervention
  | 'blocked';     // Waiting on external dependency

export interface DomainConfig {
  /** Maximum concurrent tasks within this domain */
  max_concurrent?: number;

  /** Timeout for individual tasks in minutes */
  task_timeout_minutes?: number;

  /** Whether to auto-retry failed tasks */
  auto_retry?: boolean;

  /** Maximum retry attempts per task */
  max_retries?: number;
}

// ============================================================================
// Criteria Types (Entry/Exit Validation)
// ============================================================================

/**
 * TaskCriterion - A single validation check for task gating
 *
 * Entry criteria must pass before a task starts.
 * Exit criteria validate task completion.
 */
export interface TaskCriterion {
  /** Human-readable description of what this criterion checks */
  description: string;

  /** Shell command to execute for validation */
  check_command: string;

  /** Expected exit code (default: 0 for success) */
  expected_exit_code?: number;

  /** Timeout in seconds (default: 30) */
  timeout_seconds?: number;

  /** Whether failure of this criterion is blocking */
  blocking?: boolean;

  /** Optional custom error message on failure */
  error_message?: string;
}

/**
 * CriteriaValidationResult - Result of running entry/exit criteria
 */
export interface CriteriaValidationResult {
  /** Whether all criteria passed */
  valid: boolean;

  /** List of failed criteria descriptions */
  failures: string[];

  /** Detailed results per criterion */
  results: CriterionResult[];

  /** Total validation duration in ms */
  duration_ms: number;
}

export interface CriterionResult {
  /** The criterion that was checked */
  criterion: TaskCriterion;

  /** Whether this criterion passed */
  passed: boolean;

  /** Actual exit code from the command */
  exit_code: number;

  /** Command output (stdout + stderr) */
  output: string;

  /** Duration in ms */
  duration_ms: number;

  /** Error if command failed to execute */
  error?: string;
}

// ============================================================================
// Enhanced Task Types
// ============================================================================

/**
 * EnhancedCampaignTask - Task with entry/exit criteria and execution mode support
 *
 * Extends the base CampaignTask with validation criteria and mode selection.
 */
export interface EnhancedCampaignTask extends CampaignTask {
  /** Criteria that must pass before task can start */
  entry_criteria: TaskCriterion[];

  /** Criteria that validate task completion */
  exit_criteria: TaskCriterion[];

  /** Domain this task belongs to */
  domain?: string;

  /** Priority within domain (1 = highest) */
  priority?: number;

  /** Estimated complexity for routing */
  estimated_complexity?: 'low' | 'medium' | 'high';

  /** Files this task is expected to modify */
  files_to_modify?: string[];

  /** Execution mode for this task */
  execution_mode?: PlanMode;

  /** Specific agent to use (overrides domain preference) */
  assigned_agent?: AgentName;

  /** Step hints for the worker */
  step_hints?: string[];

  /** Last criteria validation result */
  last_entry_validation?: CriteriaValidationResult;

  /** Last exit validation result */
  last_exit_validation?: CriteriaValidationResult;
}

// ============================================================================
// Parallel Execution Configuration
// ============================================================================

/**
 * ParallelCampaignConfig - Configuration for parallel domain execution
 */
export interface ParallelCampaignConfig {
  /** Maximum domains to run concurrently */
  max_concurrent: number;

  /** Global timeout in minutes (0 = no limit) */
  timeout_minutes: number;

  /** Whether to stop all domains on first failure */
  fail_fast: boolean;

  /** Git strategy for parallel branches */
  git_strategy: ParallelGitStrategy;

  /** Merge coordination settings */
  merge_coordination: MergeCoordination;

  /** Progress callback interval in ms */
  progress_interval_ms: number;

  /** Drift detection settings */
  drift_detection: DriftDetectionConfig;
}

export type ParallelGitStrategy =
  | 'domain-branches'   // Each domain gets its own branch
  | 'single-branch'     // All work on campaign branch
  | 'worktrees';        // Use git worktrees for true parallelism

export interface MergeCoordination {
  /** How to merge domain branches */
  strategy: 'sequential' | 'octopus' | 'manual';

  /** Order to merge domains (if sequential) */
  merge_order?: string[];

  /** Whether to require review before merge */
  require_review: boolean;

  /** Conflict resolution approach */
  conflict_resolution: 'auto' | 'manual' | 'agent';
}

export interface DriftDetectionConfig {
  /** Enable drift detection */
  enabled: boolean;

  /** Check at these progress milestones (0-100) */
  check_at_milestones: number[];

  /** Also check after N tasks regardless of progress */
  check_every_n_tasks: number;

  /** Severity threshold to pause campaign */
  pause_threshold: DriftSeverity;
}

export type DriftSeverity = 'minor' | 'moderate' | 'severe';

// ============================================================================
// Campaign State Extensions
// ============================================================================

/**
 * EnhancedCampaignState - Extended state with domain support
 */
export interface EnhancedCampaignState {
  /** All configured domains */
  domains: CampaignDomain[];

  /** Parallel execution configuration */
  parallel_config: ParallelCampaignConfig;

  /** Domain-level metrics */
  domain_metrics: Record<string, DomainMetrics>;

  /** Overall campaign metrics */
  campaign_metrics: CampaignMetrics;
}

export interface DomainMetrics {
  /** Domain name */
  domain: string;

  /** Tasks completed in this domain */
  tasks_completed: number;

  /** Tasks failed in this domain */
  tasks_failed: number;

  /** Total retries in this domain */
  retries: number;

  /** Average task duration in ms */
  avg_task_duration_ms: number;

  /** Criteria pass rate (0-1) */
  criteria_pass_rate: number;

  /** Time spent in this domain in ms */
  total_time_ms: number;
}

export interface CampaignMetrics {
  /** Total tasks across all domains */
  tasks_total: number;

  /** Completed tasks */
  tasks_completed: number;

  /** Failed tasks */
  tasks_failed: number;

  /** Total retries */
  retries_total: number;

  /** Campaign start time */
  started_at?: number;

  /** Campaign end time */
  ended_at?: number;

  /** Total duration in ms */
  total_duration_ms: number;

  /** Drift checks performed */
  drift_checks: number;

  /** Drift corrections applied */
  drift_corrections: number;
}

// ============================================================================
// Task Reflection Types
// ============================================================================

/**
 * TaskReflectionResult - Output from the task reflector
 */
export interface TaskReflectionResult {
  /** Whether the task passed validation */
  passed: boolean;

  /** Classification of failure (if failed) */
  classification?: FailureClassification;

  /** Recommended action */
  recommendation: ReflectionRecommendation;

  /** Detailed analysis */
  analysis: string;

  /** Suggested fixes (if applicable) */
  suggested_fixes?: string[];

  /** Confidence in the assessment (0-1) */
  confidence: number;
}

export type FailureClassification =
  | 'SYNTAX'       // Code doesn't compile/parse
  | 'LOGIC'        // Code runs but produces wrong results
  | 'INTEGRATION'  // Code works in isolation but fails with other components
  | 'STRATEGIC';   // Implementation diverged from requirements

export type ReflectionRecommendation =
  | 'retry'        // Retry with same approach
  | 'escalate'     // Escalate to more capable agent
  | 'skip'         // Skip task, mark as blocked
  | 'replan';      // Replan the task with new approach

// ============================================================================
// Drift Detection Types
// ============================================================================

/**
 * DriftDetectionResult - Output from drift detector
 */
export interface DriftDetectionResult {
  /** Whether drift was detected */
  drifted: boolean;

  /** Severity of drift */
  severity: DriftSeverity;

  /** Areas where drift was detected */
  drift_areas: DriftArea[];

  /** Suggested corrective actions */
  corrective_plan?: CorrectivePlan;

  /** Confidence in the assessment (0-1) */
  confidence: number;
}

export interface DriftArea {
  /** Domain affected */
  domain: string;

  /** Description of the drift */
  description: string;

  /** Tasks that contributed to drift */
  contributing_tasks: string[];

  /** Severity for this specific area */
  severity: DriftSeverity;
}

export interface CorrectivePlan {
  /** Summary of corrections needed */
  summary: string;

  /** Tasks to add */
  tasks_to_add: Partial<EnhancedCampaignTask>[];

  /** Tasks to modify */
  tasks_to_modify: Array<{ id: string; changes: Partial<EnhancedCampaignTask> }>;

  /** Tasks to remove */
  tasks_to_remove: string[];

  /** Priority domains to focus on */
  priority_domains: string[];
}

// ============================================================================
// Checkpoint Types
// ============================================================================

/**
 * EnhancedCheckpoint - Full campaign state capture
 */
export interface EnhancedCheckpoint {
  /** Unique checkpoint ID */
  id: string;

  /** Creation timestamp */
  created_at: number;

  /** Human-readable summary */
  summary: string;

  /** Completed task IDs */
  completed_task_ids: string[];

  /** Domain states at checkpoint time */
  domain_states: Record<string, DomainCheckpointState>;

  /** Git references for each domain branch */
  git_refs: Record<string, string>;

  /** Metrics at checkpoint time */
  metrics: CampaignMetrics;

  /** Checkpoint integrity hash */
  integrity_hash: string;

  /** Size in bytes (for compression tracking) */
  size_bytes: number;
}

export interface DomainCheckpointState {
  /** Domain name */
  domain: string;

  /** Status at checkpoint */
  status: DomainStatus;

  /** Progress at checkpoint */
  progress_percent: number;

  /** Tasks in each status */
  task_counts: Record<CampaignTaskStatus, number>;

  /** Current branch HEAD */
  branch_head?: string;
}

// ============================================================================
// Progress Event Types
// ============================================================================

/**
 * CampaignProgressEvent - Event fired during campaign execution
 */
export interface CampaignProgressEvent {
  /** Event type */
  type: CampaignEventType;

  /** Timestamp */
  timestamp: number;

  /** Campaign ID */
  campaign_id: string;

  /** Domain (if domain-specific) */
  domain?: string;

  /** Task (if task-specific) */
  task_id?: string;

  /** Event payload */
  payload: unknown;

  /** Human-readable message */
  message: string;
}

export type CampaignEventType =
  | 'campaign_started'
  | 'campaign_paused'
  | 'campaign_resumed'
  | 'campaign_completed'
  | 'campaign_failed'
  | 'domain_started'
  | 'domain_completed'
  | 'domain_failed'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'criteria_validated'
  | 'checkpoint_created'
  | 'drift_detected'
  | 'merge_started'
  | 'merge_completed'
  | 'merge_conflict';

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_PARALLEL_CONFIG: ParallelCampaignConfig = {
  max_concurrent: 3,
  timeout_minutes: 0, // No limit
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

export const DEFAULT_TASK_CRITERION: Partial<TaskCriterion> = {
  expected_exit_code: 0,
  timeout_seconds: 30,
  blocking: true
};

// ============================================================================
// Type Guards
// ============================================================================

export function isEnhancedTask(task: CampaignTask): task is EnhancedCampaignTask {
  return 'entry_criteria' in task && 'exit_criteria' in task;
}

export function isDomainBased(config: ParallelCampaignConfig): boolean {
  return config.git_strategy === 'domain-branches' || config.git_strategy === 'worktrees';
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a new domain with default values
 */
export function createDomain(
  name: string,
  goal: string,
  file_patterns: string[] = []
): CampaignDomain {
  return {
    name,
    goal,
    stories: [],
    file_patterns,
    status: 'pending',
    progress_percent: 0
  };
}

/**
 * Create default criteria for common checks
 */
export function createTypescriptCompileCriterion(): TaskCriterion {
  return {
    description: 'TypeScript compiles without errors',
    check_command: 'npm run typecheck',
    timeout_seconds: 60,
    blocking: true
  };
}

export function createTestsCriterion(pattern?: string): TaskCriterion {
  const command = pattern ? `npm test -- ${pattern}` : 'npm test';
  return {
    description: pattern ? `Tests pass for ${pattern}` : 'All tests pass',
    check_command: command,
    timeout_seconds: 120,
    blocking: true
  };
}

export function createFileExistsCriterion(filepath: string): TaskCriterion {
  return {
    description: `File exists: ${filepath}`,
    check_command: `test -f "${filepath}"`,
    timeout_seconds: 5,
    blocking: true
  };
}

export function createGrepCriterion(pattern: string, filepath: string): TaskCriterion {
  return {
    description: `Pattern '${pattern}' found in ${filepath}`,
    check_command: `grep -q "${pattern}" "${filepath}"`,
    timeout_seconds: 10,
    blocking: true
  };
}
