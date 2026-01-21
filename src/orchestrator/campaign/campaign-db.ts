import type { CampaignState, CampaignTask } from './campaign-state.js';
import type {
  CampaignDomain,
  DomainStatus,
  CriteriaValidationResult,
  CriterionResult,
  DomainMetrics,
  CampaignMetrics
} from './campaign-types.js';
import { getDatabase } from '../../memory/database.js';

// Prepared statements cache
let upsertProjectStmt: any | null = null;
let upsertTaskStmt: any | null = null;
let logExecutionStmt: any | null = null;
let upsertDomainStmt: any | null = null;
let insertCriteriaResultStmt: any | null = null;
let insertDomainMetricStmt: any | null = null;

/** Domain progress record from database */
export interface DomainProgressRecord {
  id: number;
  project_id: string;
  name: string;
  status: DomainStatus;
  progress_percent: number;
  tasks_total: number;
  tasks_completed: number;
  tasks_failed: number;
  tasks_in_progress: number;
  file_patterns: string[] | null;
  git_branch: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

/** Criteria result record from database */
export interface CriteriaResultRecord {
  id: number;
  task_id: string;
  criteria_type: 'entry' | 'exit';
  criterion_description: string;
  check_command: string | null;
  passed: boolean;
  error_message: string | null;
  execution_ms: number | null;
  created_at: number;
}

/** Campaign metrics aggregate */
export interface CampaignMetricsAggregate {
  projectId: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  inProgressTasks: number;
  pendingTasks: number;
  totalDomains: number;
  activeDomains: number;
  completedDomains: number;
  avgTaskDuration: number | null;
  criteriaPassRate: number | null;
  retryRate: number | null;
}

function initStatements(): void {
  const db = getDatabase();

  upsertProjectStmt = db.prepare(`
    INSERT INTO campaign_projects (id, objective, status, git_branch, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      objective = excluded.objective,
      status = excluded.status,
      git_branch = excluded.git_branch,
      updated_at = excluded.updated_at
  `);

  upsertTaskStmt = db.prepare(`
    INSERT INTO campaign_tasks (
      id, project_id, title, description, status, dependencies, step_hints,
      assigned_files, attempts, last_error, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      status = excluded.status,
      dependencies = excluded.dependencies,
      step_hints = excluded.step_hints,
      assigned_files = excluded.assigned_files,
      attempts = excluded.attempts,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `);

  logExecutionStmt = db.prepare(`
    INSERT INTO campaign_execution_logs (task_id, attempt_num, stdout, stderr, git_diff, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  upsertDomainStmt = db.prepare(`
    INSERT INTO campaign_domains (
      project_id, name, status, progress_percent, tasks_total, tasks_completed,
      tasks_failed, tasks_in_progress, file_patterns, git_branch, started_at,
      completed_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, name) DO UPDATE SET
      status = excluded.status,
      progress_percent = excluded.progress_percent,
      tasks_total = excluded.tasks_total,
      tasks_completed = excluded.tasks_completed,
      tasks_failed = excluded.tasks_failed,
      tasks_in_progress = excluded.tasks_in_progress,
      file_patterns = excluded.file_patterns,
      git_branch = excluded.git_branch,
      started_at = COALESCE(campaign_domains.started_at, excluded.started_at),
      completed_at = excluded.completed_at,
      updated_at = excluded.updated_at
  `);

  insertCriteriaResultStmt = db.prepare(`
    INSERT INTO campaign_criteria_results (
      task_id, criteria_type, criterion_description, check_command, passed,
      error_message, execution_ms, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertDomainMetricStmt = db.prepare(`
    INSERT INTO campaign_domain_metrics (domain_id, metric_name, metric_value, recorded_at)
    VALUES (?, ?, ?, ?)
  `);
}

function ensureStatements(): void {
  if (!upsertProjectStmt) {
    initStatements();
  }
}

export function upsertCampaignProject(
  state: CampaignState,
  gitBranch: string | null
): void {
  ensureStatements();
  const now = Date.now();
  upsertProjectStmt!.run([
    state.campaignId,
    state.goal,
    state.status,
    gitBranch,
    state.createdAt,
    now
  ]);
}

export function upsertCampaignTasks(
  state: CampaignState
): void {
  ensureStatements();
  const now = Date.now();

  for (const task of state.tasks) {
    upsertTaskStmt!.run([
      task.id,
      state.campaignId,
      task.title,
      task.description || null,
      task.status,
      JSON.stringify(task.dependencies ?? []),
      JSON.stringify(task.acceptanceCriteria ?? []),
      JSON.stringify(task.assignedFiles ?? []),
      task.attempts,
      task.lastError || null,
      task.createdAt,
      now
    ]);
  }
}

export function logCampaignExecution(
  task: CampaignTask,
  attempt: number,
  stdout: string | null,
  stderr: string | null,
  gitDiff: string | null
): void {
  ensureStatements();
  logExecutionStmt!.run([
    task.id,
    attempt,
    stdout,
    stderr,
    gitDiff,
    Date.now()
  ]);
}

// ============================================================================
// Domain Progress Functions
// ============================================================================

/**
 * Upsert domain progress for a campaign
 */
export function upsertDomainProgress(
  projectId: string,
  domain: CampaignDomain,
  status: DomainStatus,
  taskCounts: {
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
  },
  gitBranch?: string | null
): void {
  ensureStatements();
  const now = Date.now();
  const progressPercent = taskCounts.total > 0
    ? (taskCounts.completed / taskCounts.total) * 100
    : 0;

  const startedAt = status !== 'pending' ? now : null;
  const completedAt = status === 'completed' ? now : null;

  upsertDomainStmt!.run([
    projectId,
    domain.name,
    status,
    progressPercent,
    taskCounts.total,
    taskCounts.completed,
    taskCounts.failed,
    taskCounts.inProgress,
    domain.file_patterns ? JSON.stringify(domain.file_patterns) : null,
    gitBranch ?? null,
    startedAt,
    completedAt,
    now,
    now
  ]);
}

/**
 * Get domain progress records for a campaign
 */
export function getDomainProgress(projectId: string): DomainProgressRecord[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM campaign_domains WHERE project_id = ? ORDER BY name
  `).all([projectId]) as any[];

  return rows.map((row) => ({
    ...row,
    file_patterns: row.file_patterns ? JSON.parse(row.file_patterns) : null,
    status: row.status as DomainStatus
  }));
}

/**
 * Get single domain progress
 */
export function getDomainProgressByName(
  projectId: string,
  domainName: string
): DomainProgressRecord | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM campaign_domains WHERE project_id = ? AND name = ?
  `).get([projectId, domainName]) as any | undefined;

  if (!row) return null;

  return {
    ...row,
    file_patterns: row.file_patterns ? JSON.parse(row.file_patterns) : null,
    status: row.status as DomainStatus
  };
}

// ============================================================================
// Criteria Result Functions
// ============================================================================

/**
 * Log criteria validation result
 */
export function logCriteriaResult(
  taskId: string,
  criteriaType: 'entry' | 'exit',
  result: CriterionResult
): void {
  ensureStatements();
  insertCriteriaResultStmt!.run([
    taskId,
    criteriaType,
    result.criterion.description,
    result.criterion.check_command ?? null,
    result.passed ? 1 : 0,
    result.error ?? null,
    result.duration_ms ?? null,
    Date.now()
  ]);
}

/**
 * Log all criteria results from a validation
 */
export function logCriteriaValidation(
  taskId: string,
  criteriaType: 'entry' | 'exit',
  validationResult: CriteriaValidationResult
): void {
  for (const result of validationResult.results) {
    logCriteriaResult(taskId, criteriaType, result);
  }
}

/**
 * Get criteria results for a task
 */
export function getCriteriaResults(
  taskId: string,
  criteriaType?: 'entry' | 'exit'
): CriteriaResultRecord[] {
  const db = getDatabase();
  let query = `SELECT * FROM campaign_criteria_results WHERE task_id = ?`;
  const params: any[] = [taskId];

  if (criteriaType) {
    query += ` AND criteria_type = ?`;
    params.push(criteriaType);
  }

  query += ` ORDER BY created_at`;

  const rows = db.prepare(query).all(params) as any[];
  return rows.map((row) => ({
    ...row,
    passed: row.passed === 1
  }));
}

/**
 * Get criteria pass rate for a project
 */
export function getCriteriaPassRate(
  projectId: string,
  criteriaType?: 'entry' | 'exit'
): number | null {
  const db = getDatabase();
  let query = `
    SELECT
      SUM(CASE WHEN cr.passed = 1 THEN 1 ELSE 0 END) as passed_count,
      COUNT(*) as total_count
    FROM campaign_criteria_results cr
    JOIN campaign_tasks t ON cr.task_id = t.id
    WHERE t.project_id = ?
  `;
  const params: any[] = [projectId];

  if (criteriaType) {
    query += ` AND cr.criteria_type = ?`;
    params.push(criteriaType);
  }

  const row = db.prepare(query).get(params) as any;
  if (!row || row.total_count === 0) return null;

  return (row.passed_count / row.total_count) * 100;
}

// ============================================================================
// Domain Metrics Functions
// ============================================================================

/**
 * Record a metric for a domain
 */
export function recordDomainMetric(
  domainId: number,
  metricName: string,
  metricValue: number
): void {
  ensureStatements();
  insertDomainMetricStmt!.run([
    domainId,
    metricName,
    metricValue,
    Date.now()
  ]);
}

/**
 * Get domain metrics by name
 */
export function getDomainMetricsByName(
  projectId: string,
  domainName: string
): DomainMetrics | null {
  const db = getDatabase();

  // Get domain
  const domain = getDomainProgressByName(projectId, domainName);
  if (!domain) return null;

  // Get task timing metrics
  const timingRow = db.prepare(`
    SELECT
      AVG(duration_ms) as avg_duration,
      SUM(duration_ms) as total_duration
    FROM campaign_tasks
    WHERE project_id = ? AND domain = ? AND duration_ms IS NOT NULL
  `).get([projectId, domainName]) as any;

  // Get retry count
  const retryRow = db.prepare(`
    SELECT SUM(attempts) as total_attempts, COUNT(*) as task_count
    FROM campaign_tasks
    WHERE project_id = ? AND domain = ?
  `).get([projectId, domainName]) as any;

  // Get criteria pass rates
  const criteriaRow = db.prepare(`
    SELECT
      SUM(CASE WHEN cr.passed = 1 THEN 1 ELSE 0 END) as passed,
      COUNT(*) as total
    FROM campaign_criteria_results cr
    JOIN campaign_tasks t ON cr.task_id = t.id
    WHERE t.project_id = ? AND t.domain = ?
  `).get([projectId, domainName]) as any;

  const totalAttempts = retryRow?.total_attempts || 0;
  const taskCount = retryRow?.task_count || 0;
  const retries = totalAttempts > taskCount ? totalAttempts - taskCount : 0;

  return {
    domain: domainName,
    tasks_completed: domain.tasks_completed,
    tasks_failed: domain.tasks_failed,
    retries,
    avg_task_duration_ms: timingRow?.avg_duration ?? 0,
    criteria_pass_rate: criteriaRow?.total > 0
      ? criteriaRow.passed / criteriaRow.total
      : 0,
    total_time_ms: timingRow?.total_duration ?? 0
  };
}

// ============================================================================
// Campaign Metrics Aggregate Functions
// ============================================================================

/**
 * Get comprehensive campaign metrics
 */
export function getCampaignMetrics(projectId: string): CampaignMetricsAggregate {
  const db = getDatabase();

  // Task counts by status
  const taskRow = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
    FROM campaign_tasks
    WHERE project_id = ?
  `).get([projectId]) as any;

  // Domain counts
  const domainRow = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'active' OR status = 'in_progress' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
    FROM campaign_domains
    WHERE project_id = ?
  `).get([projectId]) as any;

  // Average task duration
  const durationRow = db.prepare(`
    SELECT AVG(duration_ms) as avg_duration
    FROM campaign_tasks
    WHERE project_id = ? AND duration_ms IS NOT NULL
  `).get([projectId]) as any;

  // Criteria pass rate
  const passRate = getCriteriaPassRate(projectId);

  // Retry rate (attempts > 1)
  const retryRow = db.prepare(`
    SELECT
      SUM(CASE WHEN attempts > 1 THEN 1 ELSE 0 END) as retried,
      COUNT(*) as total
    FROM campaign_tasks
    WHERE project_id = ? AND status IN ('completed', 'failed')
  `).get([projectId]) as any;

  return {
    projectId,
    totalTasks: taskRow?.total || 0,
    completedTasks: taskRow?.completed || 0,
    failedTasks: taskRow?.failed || 0,
    inProgressTasks: taskRow?.in_progress || 0,
    pendingTasks: taskRow?.pending || 0,
    totalDomains: domainRow?.total || 0,
    activeDomains: domainRow?.active || 0,
    completedDomains: domainRow?.completed || 0,
    avgTaskDuration: durationRow?.avg_duration ?? null,
    criteriaPassRate: passRate,
    retryRate: retryRow?.total > 0
      ? (retryRow.retried / retryRow.total) * 100
      : null
  };
}

/**
 * Get metrics for all domains in a campaign
 */
export function getAllDomainMetrics(projectId: string): DomainMetrics[] {
  const domains = getDomainProgress(projectId);
  return domains
    .map((d) => getDomainMetricsByName(projectId, d.name))
    .filter((m): m is DomainMetrics => m !== null);
}

// ============================================================================
// Task Timing Functions
// ============================================================================

/**
 * Update task with timing information
 */
export function updateTaskTiming(
  taskId: string,
  timing: {
    startedAt?: number;
    completedAt?: number;
    durationMs?: number;
  }
): void {
  const db = getDatabase();
  const updates: string[] = [];
  const params: any[] = [];

  if (timing.startedAt !== undefined) {
    updates.push('started_at = ?');
    params.push(timing.startedAt);
  }
  if (timing.completedAt !== undefined) {
    updates.push('completed_at = ?');
    params.push(timing.completedAt);
  }
  if (timing.durationMs !== undefined) {
    updates.push('duration_ms = ?');
    params.push(timing.durationMs);
  }

  if (updates.length === 0) return;

  updates.push('updated_at = ?');
  params.push(Date.now());
  params.push(taskId);

  db.prepare(`
    UPDATE campaign_tasks SET ${updates.join(', ')} WHERE id = ?
  `).run(params);
}

/**
 * Update task domain assignment
 */
export function updateTaskDomain(taskId: string, domain: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE campaign_tasks SET domain = ?, updated_at = ? WHERE id = ?
  `).run([domain, Date.now(), taskId]);
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get tasks by domain
 */
export function getTasksByDomain(
  projectId: string,
  domainName: string
): CampaignTask[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM campaign_tasks WHERE project_id = ? AND domain = ?
  `).all([projectId, domainName]) as any[];

  return rows.map(rowToTask);
}

/**
 * Get tasks by status
 */
export function getTasksByStatus(
  projectId: string,
  status: string
): CampaignTask[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM campaign_tasks WHERE project_id = ? AND status = ?
  `).all([projectId, status]) as any[];

  return rows.map(rowToTask);
}

/**
 * Convert database row to CampaignTask
 */
function rowToTask(row: any): CampaignTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
    acceptanceCriteria: row.step_hints ? JSON.parse(row.step_hints) : [],
    assignedFiles: row.assigned_files ? JSON.parse(row.assigned_files) : [],
    attempts: row.attempts || 0,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Get execution logs for a task
 */
export function getExecutionLogs(
  taskId: string,
  limit?: number
): Array<{
  id: number;
  task_id: string;
  attempt_num: number;
  stdout: string | null;
  stderr: string | null;
  git_diff: string | null;
  created_at: number;
}> {
  const db = getDatabase();
  let query = `
    SELECT * FROM campaign_execution_logs
    WHERE task_id = ?
    ORDER BY attempt_num DESC
  `;

  if (limit) {
    query += ` LIMIT ${limit}`;
  }

  return db.prepare(query).all([taskId]) as any[];
}
