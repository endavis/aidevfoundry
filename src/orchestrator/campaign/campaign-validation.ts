/**
 * Campaign Task Criteria Validation
 *
 * Validates entry and exit criteria for campaign tasks using shell commands.
 * Entry criteria must pass before a task can start.
 * Exit criteria validate task completion objectively.
 */

import { execa, type ExecaError } from 'execa';
import type {
  TaskCriterion,
  CriteriaValidationResult,
  CriterionResult,
  EnhancedCampaignTask,
  DEFAULT_TASK_CRITERION
} from './campaign-types.js';

/**
 * Default timeout for criterion validation (30 seconds)
 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Maximum output length to capture (prevent memory issues)
 */
const MAX_OUTPUT_LENGTH = 10_000;

/**
 * Validate a single criterion by executing its check command
 *
 * @param criterion - The criterion to validate
 * @param cwd - Working directory for command execution
 * @returns CriterionResult with pass/fail status and output
 */
export async function validateCriterion(
  criterion: TaskCriterion,
  cwd: string
): Promise<CriterionResult> {
  const startTime = Date.now();
  const timeoutMs = (criterion.timeout_seconds ?? 30) * 1000;
  const expectedExitCode = criterion.expected_exit_code ?? 0;

  try {
    // Execute the check command
    const result = await execa('sh', ['-c', criterion.check_command], {
      cwd,
      timeout: timeoutMs,
      reject: false, // Don't throw on non-zero exit
      all: true, // Capture both stdout and stderr
      env: {
        ...process.env,
        // Ensure consistent output for validation
        FORCE_COLOR: '0',
        NO_COLOR: '1'
      }
    });

    const output = truncateOutput(result.all || result.stdout || '', MAX_OUTPUT_LENGTH);
    const exitCode = result.exitCode ?? -1;
    const passed = exitCode === expectedExitCode;

    return {
      criterion,
      passed,
      exit_code: exitCode,
      output,
      duration_ms: Date.now() - startTime
    };
  } catch (err: unknown) {
    const execaErr = err as ExecaError;
    const duration = Date.now() - startTime;

    // Handle timeout
    if (execaErr.timedOut) {
      return {
        criterion,
        passed: false,
        exit_code: -1,
        output: '',
        duration_ms: duration,
        error: `Command timed out after ${criterion.timeout_seconds ?? 30} seconds`
      };
    }

    // Handle other execution errors - safely get output as string
    const errorOutput = typeof execaErr.all === 'string'
      ? execaErr.all
      : (typeof execaErr.message === 'string' ? execaErr.message : '');

    return {
      criterion,
      passed: false,
      exit_code: execaErr.exitCode ?? -1,
      output: truncateOutput(errorOutput, MAX_OUTPUT_LENGTH),
      duration_ms: duration,
      error: execaErr.message
    };
  }
}

/**
 * Validate all entry criteria for a task
 *
 * Entry criteria must all pass before a task can start execution.
 * Returns early on first blocking failure if configured.
 *
 * @param task - The enhanced campaign task with entry criteria
 * @param cwd - Working directory for command execution
 * @returns CriteriaValidationResult with overall status and per-criterion results
 */
export async function validateEntryCriteria(
  task: EnhancedCampaignTask,
  cwd: string
): Promise<CriteriaValidationResult> {
  return validateCriteria(task.entry_criteria || [], cwd, 'entry');
}

/**
 * Validate all exit criteria for a task
 *
 * Exit criteria validate that a task was completed successfully.
 * All criteria are evaluated regardless of failures (no early exit).
 *
 * @param task - The enhanced campaign task with exit criteria
 * @param cwd - Working directory for command execution
 * @returns CriteriaValidationResult with overall status and per-criterion results
 */
export async function validateExitCriteria(
  task: EnhancedCampaignTask,
  cwd: string
): Promise<CriteriaValidationResult> {
  return validateCriteria(task.exit_criteria || [], cwd, 'exit');
}

/**
 * Validate a list of criteria
 *
 * @param criteria - Array of criteria to validate
 * @param cwd - Working directory
 * @param mode - 'entry' (fail fast on blocking) or 'exit' (evaluate all)
 * @returns CriteriaValidationResult
 */
export async function validateCriteria(
  criteria: TaskCriterion[],
  cwd: string,
  mode: 'entry' | 'exit' = 'exit'
): Promise<CriteriaValidationResult> {
  const startTime = Date.now();
  const results: CriterionResult[] = [];
  const failures: string[] = [];

  if (criteria.length === 0) {
    return {
      valid: true,
      failures: [],
      results: [],
      duration_ms: 0
    };
  }

  for (const criterion of criteria) {
    const result = await validateCriterion(criterion, cwd);
    results.push(result);

    if (!result.passed) {
      const errorMsg = criterion.error_message || criterion.description;
      failures.push(errorMsg);

      // For entry criteria, fail fast on blocking failures
      if (mode === 'entry' && (criterion.blocking ?? true)) {
        break;
      }
    }
  }

  return {
    valid: failures.length === 0,
    failures,
    results,
    duration_ms: Date.now() - startTime
  };
}

/**
 * Check if a task's entry criteria are satisfied
 *
 * Quick check that returns boolean only, useful for queue operations.
 *
 * @param task - The task to check
 * @param cwd - Working directory
 * @returns true if all entry criteria pass
 */
export async function canTaskStart(
  task: EnhancedCampaignTask,
  cwd: string
): Promise<boolean> {
  if (!task.entry_criteria || task.entry_criteria.length === 0) {
    return true;
  }

  const result = await validateEntryCriteria(task, cwd);
  return result.valid;
}

/**
 * Validate criteria in parallel (for performance with independent checks)
 *
 * Use this when criteria don't depend on each other and parallel execution
 * is safe and beneficial.
 *
 * @param criteria - Array of criteria to validate in parallel
 * @param cwd - Working directory
 * @param maxConcurrent - Maximum concurrent validations (default: 3)
 * @returns CriteriaValidationResult
 */
export async function validateCriteriaParallel(
  criteria: TaskCriterion[],
  cwd: string,
  maxConcurrent: number = 3
): Promise<CriteriaValidationResult> {
  const startTime = Date.now();

  if (criteria.length === 0) {
    return {
      valid: true,
      failures: [],
      results: [],
      duration_ms: 0
    };
  }

  // Process in batches to limit concurrency
  const results: CriterionResult[] = [];
  const failures: string[] = [];

  for (let i = 0; i < criteria.length; i += maxConcurrent) {
    const batch = criteria.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(
      batch.map(c => validateCriterion(c, cwd))
    );

    for (const result of batchResults) {
      results.push(result);
      if (!result.passed) {
        const errorMsg = result.criterion.error_message || result.criterion.description;
        failures.push(errorMsg);
      }
    }
  }

  return {
    valid: failures.length === 0,
    failures,
    results,
    duration_ms: Date.now() - startTime
  };
}

/**
 * Format criteria validation result for display
 *
 * @param result - The validation result to format
 * @param verbose - Include command output in formatting
 * @returns Formatted string
 */
export function formatCriteriaResult(
  result: CriteriaValidationResult,
  verbose: boolean = false
): string {
  const lines: string[] = [];

  if (result.valid) {
    lines.push(`✓ All ${result.results.length} criteria passed (${result.duration_ms}ms)`);
  } else {
    lines.push(`✗ ${result.failures.length}/${result.results.length} criteria failed (${result.duration_ms}ms)`);
  }

  if (verbose || !result.valid) {
    for (const r of result.results) {
      const icon = r.passed ? '✓' : '✗';
      const duration = `${r.duration_ms}ms`;
      lines.push(`  ${icon} ${r.criterion.description} (${duration})`);

      if (!r.passed && r.error) {
        lines.push(`      Error: ${r.error}`);
      }

      if (verbose && r.output) {
        const outputLines = r.output.split('\n').map(l => `      ${l}`);
        lines.push(...outputLines.slice(0, 5)); // Limit output lines
        if (outputLines.length > 5) {
          lines.push(`      ... (${outputLines.length - 5} more lines)`);
        }
      }
    }
  }

  return lines.join('\n');
}

/**
 * Create a validation summary for logging/persistence
 *
 * @param result - The validation result
 * @returns Summary object suitable for database storage
 */
export function createValidationSummary(result: CriteriaValidationResult): {
  valid: boolean;
  total: number;
  passed: number;
  failed: number;
  duration_ms: number;
  failures: string[];
} {
  return {
    valid: result.valid,
    total: result.results.length,
    passed: result.results.filter(r => r.passed).length,
    failed: result.results.filter(r => !r.passed).length,
    duration_ms: result.duration_ms,
    failures: result.failures
  };
}

/**
 * Truncate output to maximum length, preserving end if truncated
 */
function truncateOutput(output: string, maxLength: number): string {
  if (output.length <= maxLength) {
    return output;
  }
  const truncatedMark = '\n... [truncated] ...\n';
  const keepEnd = Math.floor(maxLength / 4);
  const keepStart = maxLength - keepEnd - truncatedMark.length;
  return output.slice(0, keepStart) + truncatedMark + output.slice(-keepEnd);
}

/**
 * Merge default criterion values with provided criterion
 */
export function withDefaults(criterion: Partial<TaskCriterion> & Pick<TaskCriterion, 'description' | 'check_command'>): TaskCriterion {
  return {
    description: criterion.description,
    check_command: criterion.check_command,
    expected_exit_code: criterion.expected_exit_code ?? 0,
    timeout_seconds: criterion.timeout_seconds ?? 30,
    blocking: criterion.blocking ?? true,
    error_message: criterion.error_message
  };
}
