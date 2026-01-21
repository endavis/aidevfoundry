/**
 * Tests for Campaign Task Criteria Validation
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import {
  validateCriterion,
  validateEntryCriteria,
  validateExitCriteria,
  validateCriteria,
  canTaskStart,
  validateCriteriaParallel,
  formatCriteriaResult,
  createValidationSummary,
  withDefaults
} from './campaign-validation.js';
import type { TaskCriterion, EnhancedCampaignTask, CampaignTaskStatus } from './campaign-types.js';

// Helper to create a minimal enhanced task
function createTask(
  entry: TaskCriterion[] = [],
  exit: TaskCriterion[] = []
): EnhancedCampaignTask {
  return {
    id: 'test-task',
    title: 'Test Task',
    status: 'pending' as CampaignTaskStatus,
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    entry_criteria: entry,
    exit_criteria: exit
  };
}

describe('validateCriterion', () => {
  it('should pass when command succeeds with exit code 0', async () => {
    const criterion: TaskCriterion = {
      description: 'Check true command',
      check_command: 'true',
      timeout_seconds: 5
    };

    const result = await validateCriterion(criterion, process.cwd());

    expect(result.passed).toBe(true);
    expect(result.exit_code).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it('should fail when command exits with non-zero code', async () => {
    const criterion: TaskCriterion = {
      description: 'Check false command',
      check_command: 'false',
      timeout_seconds: 5
    };

    const result = await validateCriterion(criterion, process.cwd());

    expect(result.passed).toBe(false);
    expect(result.exit_code).toBe(1);
  });

  it('should capture command output', async () => {
    const criterion: TaskCriterion = {
      description: 'Echo test',
      check_command: 'echo "hello world"',
      timeout_seconds: 5
    };

    const result = await validateCriterion(criterion, process.cwd());

    expect(result.passed).toBe(true);
    expect(result.output).toContain('hello world');
  });

  it('should handle custom expected exit codes', async () => {
    const criterion: TaskCriterion = {
      description: 'Expect exit code 1',
      check_command: 'exit 1',
      expected_exit_code: 1,
      timeout_seconds: 5
    };

    const result = await validateCriterion(criterion, process.cwd());

    expect(result.passed).toBe(true);
    expect(result.exit_code).toBe(1);
  });

  it('should fail on timeout', async () => {
    const criterion: TaskCriterion = {
      description: 'Long running command',
      // Use a command that's reliably slow on all platforms
      check_command: process.platform === 'win32' ? 'ping -n 10 127.0.0.1' : 'sleep 10',
      timeout_seconds: 2 // Short timeout
    };

    const result = await validateCriterion(criterion, process.cwd());

    expect(result.passed).toBe(false);
    // On timeout, either the error contains 'timed out' or we get a non-zero exit
    // The behavior can vary across platforms
    const hasTimeoutIndicator = result.error?.includes('timed out') ||
                                result.error?.includes('timeout') ||
                                result.exit_code !== 0;
    expect(hasTimeoutIndicator).toBe(true);
  }, 15000); // Increase test timeout

  it('should handle invalid commands', async () => {
    const criterion: TaskCriterion = {
      description: 'Invalid command',
      check_command: 'nonexistent_command_xyz123',
      timeout_seconds: 5
    };

    const result = await validateCriterion(criterion, process.cwd());

    expect(result.passed).toBe(false);
    expect(result.exit_code).not.toBe(0);
  });
});

describe('validateCriteria', () => {
  it('should return valid for empty criteria list', async () => {
    const result = await validateCriteria([], process.cwd());

    expect(result.valid).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.results).toHaveLength(0);
  });

  it('should validate multiple criteria', async () => {
    const criteria: TaskCriterion[] = [
      { description: 'Check 1', check_command: 'true' },
      { description: 'Check 2', check_command: 'true' },
      { description: 'Check 3', check_command: 'true' }
    ];

    const result = await validateCriteria(criteria, process.cwd());

    expect(result.valid).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(result.results.every(r => r.passed)).toBe(true);
  });

  it('should collect all failures', async () => {
    const criteria: TaskCriterion[] = [
      { description: 'Pass', check_command: 'true' },
      { description: 'Fail 1', check_command: 'false', blocking: false },
      { description: 'Fail 2', check_command: 'false', blocking: false }
    ];

    const result = await validateCriteria(criteria, process.cwd(), 'exit');

    expect(result.valid).toBe(false);
    expect(result.failures).toHaveLength(2);
    expect(result.results).toHaveLength(3);
  });

  it('should fail fast on blocking entry criteria', async () => {
    const criteria: TaskCriterion[] = [
      { description: 'Fail blocking', check_command: 'false', blocking: true },
      { description: 'Never reached', check_command: 'true' }
    ];

    const result = await validateCriteria(criteria, process.cwd(), 'entry');

    expect(result.valid).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.results).toHaveLength(1); // Second criterion not evaluated
  });
});

describe('validateEntryCriteria', () => {
  it('should validate entry criteria on task', async () => {
    const task = createTask([
      { description: 'Entry 1', check_command: 'true' },
      { description: 'Entry 2', check_command: 'true' }
    ]);

    const result = await validateEntryCriteria(task, process.cwd());

    expect(result.valid).toBe(true);
    expect(result.results).toHaveLength(2);
  });

  it('should return valid for task with no entry criteria', async () => {
    const task = createTask([], []);

    const result = await validateEntryCriteria(task, process.cwd());

    expect(result.valid).toBe(true);
    expect(result.results).toHaveLength(0);
  });
});

describe('validateExitCriteria', () => {
  it('should validate exit criteria on task', async () => {
    const task = createTask([], [
      { description: 'Exit 1', check_command: 'true' },
      { description: 'Exit 2', check_command: 'true' }
    ]);

    const result = await validateExitCriteria(task, process.cwd());

    expect(result.valid).toBe(true);
    expect(result.results).toHaveLength(2);
  });

  it('should evaluate all exit criteria even on failure', async () => {
    const task = createTask([], [
      { description: 'Pass', check_command: 'true' },
      { description: 'Fail', check_command: 'false' },
      { description: 'Also pass', check_command: 'true' }
    ]);

    const result = await validateExitCriteria(task, process.cwd());

    expect(result.valid).toBe(false);
    expect(result.results).toHaveLength(3); // All evaluated
    expect(result.failures).toHaveLength(1);
  });
});

describe('canTaskStart', () => {
  it('should return true when all entry criteria pass', async () => {
    const task = createTask([
      { description: 'Check', check_command: 'true' }
    ]);

    const canStart = await canTaskStart(task, process.cwd());

    expect(canStart).toBe(true);
  });

  it('should return false when entry criteria fail', async () => {
    const task = createTask([
      { description: 'Check', check_command: 'false' }
    ]);

    const canStart = await canTaskStart(task, process.cwd());

    expect(canStart).toBe(false);
  });

  it('should return true for task with no entry criteria', async () => {
    const task = createTask();

    const canStart = await canTaskStart(task, process.cwd());

    expect(canStart).toBe(true);
  });
});

describe('validateCriteriaParallel', () => {
  it('should validate criteria in parallel', async () => {
    const criteria: TaskCriterion[] = [
      { description: 'Check 1', check_command: 'true' },
      { description: 'Check 2', check_command: 'true' },
      { description: 'Check 3', check_command: 'true' },
      { description: 'Check 4', check_command: 'true' }
    ];

    const start = Date.now();
    const result = await validateCriteriaParallel(criteria, process.cwd(), 4);
    const elapsed = Date.now() - start;

    expect(result.valid).toBe(true);
    expect(result.results).toHaveLength(4);
    // Parallel should be faster than sequential (roughly)
    expect(elapsed).toBeLessThan(2000);
  });

  it('should collect all failures from parallel execution', async () => {
    const criteria: TaskCriterion[] = [
      { description: 'Pass', check_command: 'true' },
      { description: 'Fail 1', check_command: 'false' },
      { description: 'Fail 2', check_command: 'false' }
    ];

    const result = await validateCriteriaParallel(criteria, process.cwd());

    expect(result.valid).toBe(false);
    expect(result.failures).toHaveLength(2);
  });
});

describe('formatCriteriaResult', () => {
  it('should format passing result concisely', async () => {
    const result = await validateCriteria([
      { description: 'Check 1', check_command: 'true' }
    ], process.cwd());

    const formatted = formatCriteriaResult(result);

    expect(formatted).toContain('✓');
    expect(formatted).toContain('passed');
  });

  it('should format failing result with details', async () => {
    const result = await validateCriteria([
      { description: 'Failing check', check_command: 'false' }
    ], process.cwd());

    const formatted = formatCriteriaResult(result);

    expect(formatted).toContain('✗');
    expect(formatted).toContain('failed');
    expect(formatted).toContain('Failing check');
  });

  it('should include output in verbose mode', async () => {
    const result = await validateCriteria([
      { description: 'Echo check', check_command: 'echo "test output"' }
    ], process.cwd());

    const formatted = formatCriteriaResult(result, true);

    expect(formatted).toContain('test output');
  });
});

describe('createValidationSummary', () => {
  it('should create summary from result', async () => {
    const result = await validateCriteria([
      { description: 'Pass', check_command: 'true' },
      { description: 'Fail', check_command: 'false' }
    ], process.cwd(), 'exit');

    const summary = createValidationSummary(result);

    expect(summary.valid).toBe(false);
    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.failures).toHaveLength(1);
    expect(summary.duration_ms).toBeGreaterThan(0);
  });
});

describe('withDefaults', () => {
  it('should apply default values', () => {
    const criterion = withDefaults({
      description: 'Test',
      check_command: 'true'
    });

    expect(criterion.expected_exit_code).toBe(0);
    expect(criterion.timeout_seconds).toBe(30);
    expect(criterion.blocking).toBe(true);
  });

  it('should preserve provided values', () => {
    const criterion = withDefaults({
      description: 'Test',
      check_command: 'exit 2',
      expected_exit_code: 2,
      timeout_seconds: 60,
      blocking: false
    });

    expect(criterion.expected_exit_code).toBe(2);
    expect(criterion.timeout_seconds).toBe(60);
    expect(criterion.blocking).toBe(false);
  });
});
