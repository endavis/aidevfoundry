/**
 * Tests for Campaign Progress Persistence
 *
 * Tests the enhanced SQLite persistence for campaign domain progress,
 * criteria validation results, and metrics tracking.
 */

import { describe, test, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { initDatabase, closeDatabase, getDatabase } from '../../memory/database.js';
import {
  upsertCampaignProject,
  upsertCampaignTasks,
  logCampaignExecution,
  upsertDomainProgress,
  getDomainProgress,
  getDomainProgressByName,
  logCriteriaResult,
  logCriteriaValidation,
  getCriteriaResults,
  getCriteriaPassRate,
  recordDomainMetric,
  getDomainMetricsByName,
  getCampaignMetrics,
  getAllDomainMetrics,
  updateTaskTiming,
  updateTaskDomain,
  getTasksByDomain,
  getTasksByStatus,
  getExecutionLogs
} from './campaign-db.js';
import type { CampaignState, CampaignTask } from './campaign-state.js';
import type { CampaignDomain, CriteriaValidationResult } from './campaign-types.js';

// Test data
const TEST_PROJECT_ID = 'test-project-' + Date.now();
const TEST_TASK_1: CampaignTask = {
  id: `${TEST_PROJECT_ID}-T1`,
  title: 'Test Task 1',
  description: 'First test task',
  status: 'pending',
  dependencies: [],
  acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
  assignedFiles: ['file1.ts'],
  attempts: 0,
  createdAt: Date.now()
};

const TEST_TASK_2: CampaignTask = {
  id: `${TEST_PROJECT_ID}-T2`,
  title: 'Test Task 2',
  description: 'Second test task',
  status: 'completed',
  dependencies: [`${TEST_PROJECT_ID}-T1`],
  acceptanceCriteria: ['Criterion A'],
  assignedFiles: ['file2.ts'],
  attempts: 1,
  createdAt: Date.now()
};

const TEST_STATE: CampaignState = {
  campaignId: TEST_PROJECT_ID,
  goal: 'Test campaign goal',
  status: 'active',
  tasks: [TEST_TASK_1, TEST_TASK_2],
  completedTaskIds: [],
  failedTaskIds: [],
  createdAt: Date.now(),
  currentIteration: 0
};

const TEST_DOMAIN: CampaignDomain = {
  name: 'ui',
  goal: 'Build UI components',
  tasks: [TEST_TASK_1.id, TEST_TASK_2.id],
  file_patterns: ['src/ui/**/*.ts', 'src/components/**/*.tsx']
};

// Legacy test state for backwards compatibility
const LEGACY_STATE: CampaignState = {
  campaignId: 'campaign_test_1',
  goal: 'Test campaign',
  status: 'running',
  tasks: [
    {
      id: 'campaign_test_task_1',
      title: 'Do thing',
      description: 'Test task',
      acceptanceCriteria: ['A'],
      dependencies: [],
      assignedFiles: [],
      status: 'pending',
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  ],
  completedTaskIds: [],
  failedTaskIds: [],
  createdAt: Date.now(),
  currentIteration: 0
};

// Initialize before tests
beforeAll(() => {
  initDatabase();
});

// Clean test data before each test
beforeEach(() => {
  const db = getDatabase();
  // Clean up test data from previous tests
  db.exec(`DELETE FROM campaign_domain_metrics WHERE domain_id IN (SELECT id FROM campaign_domains WHERE project_id LIKE 'test-project-%' OR project_id LIKE 'campaign_test_%')`);
  db.exec(`DELETE FROM campaign_domains WHERE project_id LIKE 'test-project-%' OR project_id LIKE 'campaign_test_%'`);
  db.exec(`DELETE FROM campaign_criteria_results WHERE task_id LIKE 'test-project-%' OR task_id LIKE 'campaign_test_%'`);
  db.exec(`DELETE FROM campaign_execution_logs WHERE task_id LIKE 'test-project-%' OR task_id LIKE 'campaign_test_%'`);
  db.exec(`DELETE FROM campaign_tasks WHERE project_id LIKE 'test-project-%' OR project_id LIKE 'campaign_test_%'`);
  db.exec(`DELETE FROM campaign_projects WHERE id LIKE 'test-project-%' OR id LIKE 'campaign_test_%'`);
});

afterEach(() => {
  const db = getDatabase();
  db.exec(`DELETE FROM campaign_domain_metrics WHERE domain_id IN (SELECT id FROM campaign_domains WHERE project_id LIKE 'test-project-%' OR project_id LIKE 'campaign_test_%')`);
  db.exec(`DELETE FROM campaign_domains WHERE project_id LIKE 'test-project-%' OR project_id LIKE 'campaign_test_%'`);
  db.exec(`DELETE FROM campaign_criteria_results WHERE task_id LIKE 'test-project-%' OR task_id LIKE 'campaign_test_%'`);
  db.exec(`DELETE FROM campaign_execution_logs WHERE task_id LIKE 'test-project-%' OR task_id LIKE 'campaign_test_%'`);
  db.exec(`DELETE FROM campaign_tasks WHERE project_id LIKE 'test-project-%' OR project_id LIKE 'campaign_test_%'`);
  db.exec(`DELETE FROM campaign_projects WHERE id LIKE 'test-project-%' OR id LIKE 'campaign_test_%'`);
});

describe('campaign db persistence (legacy)', () => {
  test('persists project, tasks, and execution logs', () => {
    upsertCampaignProject(LEGACY_STATE, 'main');
    upsertCampaignTasks(LEGACY_STATE);
    logCampaignExecution(LEGACY_STATE.tasks[0], 1, 'ok', null, 'diff');

    const db = getDatabase();
    const project = db.prepare('SELECT * FROM campaign_projects WHERE id = ?').get(LEGACY_STATE.campaignId) as {
      id: string;
    };
    const task = db.prepare('SELECT * FROM campaign_tasks WHERE id = ?').get('campaign_test_task_1') as { id: string };
    const logs = db.prepare('SELECT * FROM campaign_execution_logs WHERE task_id = ?').all('campaign_test_task_1') as Array<{
      task_id: string;
    }>;

    expect(project.id).toBe(LEGACY_STATE.campaignId);
    expect(task.id).toBe('campaign_test_task_1');
    expect(logs.length).toBeGreaterThan(0);
  });
});

describe('Core Persistence', () => {
  it('should upsert campaign project', () => {
    upsertCampaignProject(TEST_STATE, 'campaign/test');

    const db = getDatabase();
    const row = db.prepare(`SELECT * FROM campaign_projects WHERE id = ?`).get([TEST_PROJECT_ID]) as any;

    expect(row).toBeTruthy();
    expect(row.objective).toBe(TEST_STATE.goal);
    expect(row.status).toBe(TEST_STATE.status);
    expect(row.git_branch).toBe('campaign/test');
  });

  it('should upsert campaign tasks', () => {
    upsertCampaignProject(TEST_STATE, null);
    upsertCampaignTasks(TEST_STATE);

    const db = getDatabase();
    const rows = db.prepare(`SELECT * FROM campaign_tasks WHERE project_id = ?`).all([TEST_PROJECT_ID]) as any[];

    expect(rows.length).toBe(2);
    expect(rows.find((r: any) => r.id === TEST_TASK_1.id)).toBeTruthy();
    expect(rows.find((r: any) => r.id === TEST_TASK_2.id)).toBeTruthy();
  });

  it('should log execution', () => {
    upsertCampaignProject(TEST_STATE, null);
    upsertCampaignTasks(TEST_STATE);

    logCampaignExecution(TEST_TASK_1, 1, 'stdout output', 'stderr output', 'diff content');

    const logs = getExecutionLogs(TEST_TASK_1.id);
    expect(logs.length).toBe(1);
    expect(logs[0].stdout).toBe('stdout output');
    expect(logs[0].stderr).toBe('stderr output');
    expect(logs[0].git_diff).toBe('diff content');
    expect(logs[0].attempt_num).toBe(1);
  });
});

describe('Domain Progress', () => {
  beforeEach(() => {
    upsertCampaignProject(TEST_STATE, null);
    upsertCampaignTasks(TEST_STATE);
  });

  it('should upsert domain progress', () => {
    upsertDomainProgress(
      TEST_PROJECT_ID,
      TEST_DOMAIN,
      'active',
      { total: 10, completed: 3, failed: 1, inProgress: 2 },
      'campaign/test/ui'
    );

    const progress = getDomainProgressByName(TEST_PROJECT_ID, 'ui');
    expect(progress).toBeTruthy();
    expect(progress!.status).toBe('active');
    expect(progress!.progress_percent).toBe(30);
    expect(progress!.tasks_total).toBe(10);
    expect(progress!.tasks_completed).toBe(3);
    expect(progress!.tasks_failed).toBe(1);
    expect(progress!.tasks_in_progress).toBe(2);
    expect(progress!.git_branch).toBe('campaign/test/ui');
  });

  it('should get all domain progress', () => {
    const domain2: CampaignDomain = {
      name: 'api',
      goal: 'Build API endpoints',
      tasks: [],
      file_patterns: ['src/api/**/*.ts']
    };

    upsertDomainProgress(TEST_PROJECT_ID, TEST_DOMAIN, 'active', { total: 5, completed: 2, failed: 0, inProgress: 1 });
    upsertDomainProgress(TEST_PROJECT_ID, domain2, 'pending', { total: 3, completed: 0, failed: 0, inProgress: 0 });

    const domains = getDomainProgress(TEST_PROJECT_ID);
    expect(domains.length).toBe(2);
    expect(domains.find(d => d.name === 'ui')).toBeTruthy();
    expect(domains.find(d => d.name === 'api')).toBeTruthy();
  });

  it('should return null for non-existent domain', () => {
    const progress = getDomainProgressByName(TEST_PROJECT_ID, 'nonexistent');
    expect(progress).toBeNull();
  });

  it('should update existing domain on upsert', () => {
    upsertDomainProgress(TEST_PROJECT_ID, TEST_DOMAIN, 'pending', { total: 5, completed: 0, failed: 0, inProgress: 0 });
    upsertDomainProgress(TEST_PROJECT_ID, TEST_DOMAIN, 'active', { total: 5, completed: 2, failed: 0, inProgress: 1 });

    const progress = getDomainProgressByName(TEST_PROJECT_ID, 'ui');
    expect(progress!.status).toBe('active');
    expect(progress!.tasks_completed).toBe(2);
  });
});

describe('Criteria Results', () => {
  beforeEach(() => {
    upsertCampaignProject(TEST_STATE, null);
    upsertCampaignTasks(TEST_STATE);
  });

  it('should log single criteria result', () => {
    logCriteriaResult(TEST_TASK_1.id, 'entry', {
      criterion: {
        description: 'TypeScript compiles',
        check_command: 'npm run typecheck',
        type: 'shell'
      },
      passed: true,
      duration_ms: 1234
    });

    const results = getCriteriaResults(TEST_TASK_1.id);
    expect(results.length).toBe(1);
    expect(results[0].criteria_type).toBe('entry');
    expect(results[0].criterion_description).toBe('TypeScript compiles');
    expect(results[0].passed).toBe(true);
    expect(results[0].execution_ms).toBe(1234);
  });

  it('should log criteria validation batch', () => {
    const validation: CriteriaValidationResult = {
      valid: false,
      results: [
        {
          criterion: { description: 'Tests pass', check_command: 'npm test', type: 'shell' },
          passed: true,
          duration_ms: 5000
        },
        {
          criterion: { description: 'Lint passes', check_command: 'npm run lint', type: 'shell' },
          passed: false,
          error: 'Lint errors found',
          duration_ms: 2000
        }
      ],
      failures: ['Lint errors found']
    };

    logCriteriaValidation(TEST_TASK_1.id, 'exit', validation);

    const results = getCriteriaResults(TEST_TASK_1.id, 'exit');
    expect(results.length).toBe(2);
    expect(results.find(r => r.criterion_description === 'Tests pass')?.passed).toBe(true);
    expect(results.find(r => r.criterion_description === 'Lint passes')?.passed).toBe(false);
  });

  it('should filter criteria by type', () => {
    logCriteriaResult(TEST_TASK_1.id, 'entry', {
      criterion: { description: 'Entry check', type: 'shell' },
      passed: true
    });
    logCriteriaResult(TEST_TASK_1.id, 'exit', {
      criterion: { description: 'Exit check', type: 'shell' },
      passed: true
    });

    const entryResults = getCriteriaResults(TEST_TASK_1.id, 'entry');
    const exitResults = getCriteriaResults(TEST_TASK_1.id, 'exit');

    expect(entryResults.length).toBe(1);
    expect(entryResults[0].criterion_description).toBe('Entry check');
    expect(exitResults.length).toBe(1);
    expect(exitResults[0].criterion_description).toBe('Exit check');
  });

  it('should calculate criteria pass rate', () => {
    logCriteriaResult(TEST_TASK_1.id, 'exit', {
      criterion: { description: 'Check 1', type: 'shell' },
      passed: true
    });
    logCriteriaResult(TEST_TASK_1.id, 'exit', {
      criterion: { description: 'Check 2', type: 'shell' },
      passed: true
    });
    logCriteriaResult(TEST_TASK_1.id, 'exit', {
      criterion: { description: 'Check 3', type: 'shell' },
      passed: false
    });
    logCriteriaResult(TEST_TASK_2.id, 'exit', {
      criterion: { description: 'Check 4', type: 'shell' },
      passed: true
    });

    const passRate = getCriteriaPassRate(TEST_PROJECT_ID);
    expect(passRate).toBe(75); // 3 out of 4
  });

  it('should return null pass rate when no criteria', () => {
    const passRate = getCriteriaPassRate(TEST_PROJECT_ID);
    expect(passRate).toBeNull();
  });
});

describe('Task Operations', () => {
  beforeEach(() => {
    upsertCampaignProject(TEST_STATE, null);
    upsertCampaignTasks(TEST_STATE);
  });

  it('should update task timing', () => {
    const startedAt = Date.now();
    const completedAt = startedAt + 5000;

    updateTaskTiming(TEST_TASK_1.id, {
      startedAt,
      completedAt,
      durationMs: 5000
    });

    const db = getDatabase();
    const row = db.prepare(`SELECT started_at, completed_at, duration_ms FROM campaign_tasks WHERE id = ?`)
      .get([TEST_TASK_1.id]) as any;

    expect(row.started_at).toBe(startedAt);
    expect(row.completed_at).toBe(completedAt);
    expect(row.duration_ms).toBe(5000);
  });

  it('should update task domain', () => {
    updateTaskDomain(TEST_TASK_1.id, 'ui');

    const db = getDatabase();
    const row = db.prepare(`SELECT domain FROM campaign_tasks WHERE id = ?`).get([TEST_TASK_1.id]) as any;
    expect(row.domain).toBe('ui');
  });

  it('should get tasks by domain', () => {
    updateTaskDomain(TEST_TASK_1.id, 'ui');
    updateTaskDomain(TEST_TASK_2.id, 'api');

    const uiTasks = getTasksByDomain(TEST_PROJECT_ID, 'ui');
    expect(uiTasks.length).toBe(1);
    expect(uiTasks[0].id).toBe(TEST_TASK_1.id);
  });

  it('should get tasks by status', () => {
    const pendingTasks = getTasksByStatus(TEST_PROJECT_ID, 'pending');
    const completedTasks = getTasksByStatus(TEST_PROJECT_ID, 'completed');

    expect(pendingTasks.length).toBe(1);
    expect(pendingTasks[0].id).toBe(TEST_TASK_1.id);
    expect(completedTasks.length).toBe(1);
    expect(completedTasks[0].id).toBe(TEST_TASK_2.id);
  });
});

describe('Campaign Metrics', () => {
  beforeEach(() => {
    upsertCampaignProject(TEST_STATE, null);
    upsertCampaignTasks(TEST_STATE);
  });

  it('should get campaign metrics aggregate', () => {
    upsertDomainProgress(TEST_PROJECT_ID, TEST_DOMAIN, 'active', { total: 5, completed: 2, failed: 0, inProgress: 1 });

    const metrics = getCampaignMetrics(TEST_PROJECT_ID);

    expect(metrics.projectId).toBe(TEST_PROJECT_ID);
    expect(metrics.totalTasks).toBe(2);
    expect(metrics.completedTasks).toBe(1);
    expect(metrics.pendingTasks).toBe(1);
    expect(metrics.totalDomains).toBe(1);
    expect(metrics.activeDomains).toBe(1);
  });

  it('should handle empty project metrics', () => {
    const emptyProjectId = 'test-project-empty-' + Date.now();
    const emptyState: CampaignState = {
      campaignId: emptyProjectId,
      goal: 'Empty project',
      status: 'active',
      tasks: [],
      completedTaskIds: [],
      failedTaskIds: [],
      createdAt: Date.now(),
      currentIteration: 0
    };
    upsertCampaignProject(emptyState, null);

    const metrics = getCampaignMetrics(emptyProjectId);
    expect(metrics.totalTasks).toBe(0);
    expect(metrics.totalDomains).toBe(0);
  });

  it('should get domain metrics', () => {
    updateTaskDomain(TEST_TASK_1.id, 'ui');
    updateTaskDomain(TEST_TASK_2.id, 'ui');
    updateTaskTiming(TEST_TASK_2.id, { durationMs: 3000 });
    upsertDomainProgress(TEST_PROJECT_ID, TEST_DOMAIN, 'active', { total: 2, completed: 1, failed: 0, inProgress: 0 });

    const domainMetrics = getDomainMetricsByName(TEST_PROJECT_ID, 'ui');

    expect(domainMetrics).toBeTruthy();
    expect(domainMetrics!.domain).toBe('ui');
    expect(domainMetrics!.tasks_completed).toBe(1);
    expect(domainMetrics!.avg_task_duration_ms).toBe(3000);
  });

  it('should get all domain metrics', () => {
    const domain2: CampaignDomain = {
      name: 'api',
      goal: 'Build API',
      tasks: [],
      file_patterns: ['src/api/**/*.ts']
    };

    upsertDomainProgress(TEST_PROJECT_ID, TEST_DOMAIN, 'active', { total: 2, completed: 1, failed: 0, inProgress: 0 });
    upsertDomainProgress(TEST_PROJECT_ID, domain2, 'pending', { total: 3, completed: 0, failed: 0, inProgress: 0 });

    const allMetrics = getAllDomainMetrics(TEST_PROJECT_ID);
    expect(allMetrics.length).toBe(2);
  });
});

describe('Execution Logs', () => {
  beforeEach(() => {
    upsertCampaignProject(TEST_STATE, null);
    upsertCampaignTasks(TEST_STATE);
  });

  it('should retrieve execution logs with limit', () => {
    logCampaignExecution(TEST_TASK_1, 1, 'output 1', null, null);
    logCampaignExecution(TEST_TASK_1, 2, 'output 2', null, null);
    logCampaignExecution(TEST_TASK_1, 3, 'output 3', null, null);

    const allLogs = getExecutionLogs(TEST_TASK_1.id);
    const limitedLogs = getExecutionLogs(TEST_TASK_1.id, 2);

    expect(allLogs.length).toBe(3);
    expect(limitedLogs.length).toBe(2);
    // Should be ordered by attempt_num DESC
    expect(limitedLogs[0].attempt_num).toBe(3);
  });

  it('should handle null stdout/stderr', () => {
    logCampaignExecution(TEST_TASK_1, 1, null, null, null);

    const logs = getExecutionLogs(TEST_TASK_1.id);
    expect(logs[0].stdout).toBeNull();
    expect(logs[0].stderr).toBeNull();
  });
});

describe('Record Domain Metric', () => {
  beforeEach(() => {
    upsertCampaignProject(TEST_STATE, null);
    upsertCampaignTasks(TEST_STATE);
    upsertDomainProgress(TEST_PROJECT_ID, TEST_DOMAIN, 'active', { total: 2, completed: 0, failed: 0, inProgress: 1 });
  });

  it('should record domain metric', () => {
    const domain = getDomainProgressByName(TEST_PROJECT_ID, 'ui');
    expect(domain).toBeTruthy();

    recordDomainMetric(domain!.id, 'avg_response_time', 1500);
    recordDomainMetric(domain!.id, 'error_rate', 0.05);

    const db = getDatabase();
    const rows = db.prepare(`SELECT * FROM campaign_domain_metrics WHERE domain_id = ?`).all([domain!.id]) as any[];

    expect(rows.length).toBe(2);
    expect(rows.find((r: any) => r.metric_name === 'avg_response_time')?.metric_value).toBe(1500);
    expect(rows.find((r: any) => r.metric_name === 'error_rate')?.metric_value).toBe(0.05);
  });
});
