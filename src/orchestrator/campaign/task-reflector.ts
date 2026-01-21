/**
 * Task Reflector - Assesses task completion using exit criteria
 *
 * The reflector provides an independent assessment of task completion,
 * classifying failures and recommending appropriate actions.
 *
 * Uses Claude Sonnet for efficient, unbiased assessment per routing-rules.json.
 */

import type { CampaignTask } from './campaign-state.js';
import type { WorkerResult } from './campaign-worker.js';
import type {
  TaskReflectionResult,
  FailureClassification,
  ReflectionRecommendation,
  EnhancedCampaignTask,
  TaskCriterion,
  CriteriaValidationResult
} from './campaign-types.js';
import { validateCriteria } from './campaign-validation.js';
import { runAdapter } from '../../lib/adapter-runner.js';
import type { AgentName } from '../../executor/types.js';

// Reflector configuration from routing-rules.json
const REFLECTOR_AGENT: AgentName = 'claude';
const REFLECTOR_MODEL = 'claude-3-5-sonnet-latest';

/** Options for task reflection */
export interface ReflectorOptions {
  /** Working directory for criteria validation */
  cwd: string;

  /** Timeout for LLM calls in ms (default: 60000) */
  timeout?: number;

  /** Skip LLM analysis and use criteria-only assessment */
  criteriaOnly?: boolean;
}

/**
 * TaskReflector - Assesses task completion and classifies failures
 */
export class TaskReflector {
  private cwd: string;
  private timeout: number;
  private criteriaOnly: boolean;

  constructor(options: ReflectorOptions) {
    this.cwd = options.cwd;
    this.timeout = options.timeout ?? 60000;
    this.criteriaOnly = options.criteriaOnly ?? false;
  }

  /**
   * Assess whether a task was completed successfully
   *
   * @param task - The task that was executed
   * @param workerResult - The result from the worker
   * @returns TaskReflectionResult with pass/fail status, classification, and recommendation
   */
  async assess(
    task: CampaignTask | EnhancedCampaignTask,
    workerResult: WorkerResult
  ): Promise<TaskReflectionResult> {
    // If worker failed catastrophically, fast-path to failure
    if (!workerResult.success && workerResult.error) {
      return this.assessCatastrophicFailure(task, workerResult);
    }

    // Run exit criteria validation if available
    const exitCriteria = this.getExitCriteria(task);
    let criteriaResult: CriteriaValidationResult | null = null;

    if (exitCriteria.length > 0) {
      criteriaResult = await validateCriteria(exitCriteria, this.cwd, 'exit');

      // If criteria pass, task is successful
      if (criteriaResult.valid) {
        return {
          passed: true,
          recommendation: 'retry', // N/A for passed tasks, but required
          analysis: 'All exit criteria passed. Task completed successfully.',
          confidence: 1.0
        };
      }
    }

    // Worker reported success but criteria failed, or no criteria defined
    if (this.criteriaOnly) {
      return this.buildCriteriaOnlyResult(task, workerResult, criteriaResult);
    }

    // Use LLM for detailed failure analysis
    return await this.analyzeFailureWithLLM(task, workerResult, criteriaResult);
  }

  /**
   * Handle catastrophic worker failure (exception, timeout, etc.)
   */
  private assessCatastrophicFailure(
    task: CampaignTask,
    workerResult: WorkerResult
  ): TaskReflectionResult {
    const error = workerResult.error ?? 'Unknown error';

    // Classify based on error message patterns
    let classification: FailureClassification = 'SYNTAX';

    if (error.includes('timeout') || error.includes('Timeout')) {
      classification = 'INTEGRATION';
    } else if (error.includes('ENOENT') || error.includes('not found')) {
      classification = 'SYNTAX';
    } else if (error.includes('permission') || error.includes('EACCES')) {
      classification = 'INTEGRATION';
    } else if (error.includes('type') || error.includes('TypeError')) {
      classification = 'SYNTAX';
    }

    // Use consistent recommendation logic based on classification and attempts
    const recommendation = this.recommendFromClassification(classification, task);
    const fix = this.suggestFixForError(error);

    return {
      passed: false,
      classification,
      recommendation,
      analysis: `Worker failed with error: ${error}`,
      suggested_fixes: fix ? [fix] : undefined,
      confidence: 0.8
    };
  }

  /**
   * Build result from criteria validation only (no LLM)
   */
  private buildCriteriaOnlyResult(
    task: CampaignTask,
    workerResult: WorkerResult,
    criteriaResult: CriteriaValidationResult | null
  ): TaskReflectionResult {
    if (!criteriaResult) {
      // No criteria defined - use worker success status
      return {
        passed: workerResult.success,
        classification: workerResult.success ? undefined : 'LOGIC',
        recommendation: 'retry',
        analysis: 'No exit criteria defined. Using worker success status.',
        confidence: 0.5
      };
    }

    // Analyze failed criteria
    const classification = this.classifyFromCriteria(criteriaResult);
    const recommendation = this.recommendFromClassification(classification, task);
    const fix = this.suggestFixFromCriteria(criteriaResult);

    return {
      passed: false,
      classification,
      recommendation,
      analysis: `Exit criteria failed: ${criteriaResult.failures.join('; ')}`,
      suggested_fixes: fix ? [fix] : undefined,
      confidence: 0.7
    };
  }

  /**
   * Use LLM for detailed failure analysis
   */
  private async analyzeFailureWithLLM(
    task: CampaignTask,
    workerResult: WorkerResult,
    criteriaResult: CriteriaValidationResult | null
  ): Promise<TaskReflectionResult> {
    const prompt = this.buildAnalysisPrompt(task, workerResult, criteriaResult);

    try {
      const result = await runAdapter(REFLECTOR_AGENT, prompt, {
        model: REFLECTOR_MODEL,
        timeout: this.timeout
      });

      if (result.error) {
        // Fallback to criteria-only if LLM fails
        return this.buildCriteriaOnlyResult(task, workerResult, criteriaResult);
      }

      return this.parseReflectionResponse(result.content, task, criteriaResult);
    } catch {
      // Fallback to criteria-only
      return this.buildCriteriaOnlyResult(task, workerResult, criteriaResult);
    }
  }

  /**
   * Build prompt for LLM analysis
   */
  private buildAnalysisPrompt(
    task: CampaignTask,
    workerResult: WorkerResult,
    criteriaResult: CriteriaValidationResult | null
  ): string {
    let prompt = `You are a task reflector assessing whether a coding task was completed successfully.

## Task Information
Title: ${task.title}
Description: ${task.description || 'No description'}

## Acceptance Criteria
${(task.acceptanceCriteria || []).map((c, i) => `${i + 1}. ${c}`).join('\n') || 'None specified'}

## Worker Result
Success: ${workerResult.success}
Summary: ${workerResult.summary || 'No summary'}
${workerResult.error ? `Error: ${workerResult.error}` : ''}
${workerResult.artifacts.length > 0 ? `Artifacts: ${workerResult.artifacts.join(', ')}` : ''}
`;

    if (criteriaResult) {
      prompt += `
## Exit Criteria Validation
Passed: ${criteriaResult.valid}
${criteriaResult.failures.length > 0 ? `Failures:\n${criteriaResult.failures.map(f => `- ${f}`).join('\n')}` : ''}
`;
    }

    if (workerResult.gitDiff) {
      // Include abbreviated diff
      const diffLines = workerResult.gitDiff.split('\n');
      const truncatedDiff = diffLines.slice(0, 50).join('\n');
      prompt += `
## Git Diff (truncated)
\`\`\`diff
${truncatedDiff}${diffLines.length > 50 ? '\n... (truncated)' : ''}
\`\`\`
`;
    }

    prompt += `
## Instructions
Analyze this task result and provide your assessment in the following JSON format:

\`\`\`json
{
  "passed": false,
  "classification": "SYNTAX|LOGIC|INTEGRATION|STRATEGIC",
  "recommendation": "retry|escalate|skip|replan",
  "analysis": "Brief explanation of what went wrong",
  "suggested_fixes": ["Specific suggestion 1", "Specific suggestion 2"],
  "confidence": 0.0-1.0
}
\`\`\`

Classification definitions:
- SYNTAX: Code doesn't compile or parse (syntax errors, type errors)
- LOGIC: Code runs but produces wrong results (incorrect implementation)
- INTEGRATION: Code works in isolation but fails with other components
- STRATEGIC: Implementation diverged from requirements

Recommendation definitions:
- retry: Try again with same approach (for SYNTAX issues)
- escalate: Use a more capable agent (for LOGIC/INTEGRATION issues)
- skip: Skip task, mark as blocked (for external dependencies)
- replan: Revise the approach (for STRATEGIC issues)

Respond ONLY with the JSON block.`;

    return prompt;
  }

  /**
   * Parse LLM response into TaskReflectionResult
   */
  private parseReflectionResponse(
    response: string,
    task: CampaignTask,
    criteriaResult: CriteriaValidationResult | null
  ): TaskReflectionResult {
    // Extract JSON from response
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ||
                      response.match(/\{[\s\S]*"passed"[\s\S]*\}/);

    if (!jsonMatch) {
      // Fallback to criteria-only
      return this.buildCriteriaOnlyResult(task, { taskId: task.id, success: false, summary: '', artifacts: [] }, criteriaResult);
    }

    try {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);

      // Validate and normalize response
      const classification = this.normalizeClassification(parsed.classification);
      const recommendation = this.normalizeRecommendation(parsed.recommendation);

      // Handle suggested_fixes as array
      let suggestedFixes: string[] | undefined;
      if (Array.isArray(parsed.suggested_fixes)) {
        suggestedFixes = parsed.suggested_fixes.map(String);
      } else if (typeof parsed.suggestedFix === 'string') {
        suggestedFixes = [parsed.suggestedFix];
      }

      return {
        passed: Boolean(parsed.passed),
        classification: parsed.passed ? undefined : classification,
        recommendation,
        analysis: String(parsed.analysis || 'Analysis unavailable'),
        suggested_fixes: suggestedFixes,
        confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5))
      };
    } catch {
      // JSON parse failed - fallback
      return this.buildCriteriaOnlyResult(task, { taskId: task.id, success: false, summary: '', artifacts: [] }, criteriaResult);
    }
  }

  /**
   * Get exit criteria from task
   */
  private getExitCriteria(task: CampaignTask | EnhancedCampaignTask): TaskCriterion[] {
    // Check if task has explicit exit_criteria (EnhancedCampaignTask)
    if ('exit_criteria' in task && Array.isArray(task.exit_criteria)) {
      // Filter to only criteria with check_command
      return task.exit_criteria.filter(c => c.check_command);
    }

    // Regular CampaignTask doesn't have shell-executable criteria
    // Return empty - we'll use LLM assessment instead
    return [];
  }

  /**
   * Classify failure based on criteria results
   */
  private classifyFromCriteria(criteriaResult: CriteriaValidationResult): FailureClassification {
    const failures = criteriaResult.failures.join(' ').toLowerCase();

    // Syntax patterns
    if (failures.includes('compile') || failures.includes('syntax') ||
        failures.includes('parse') || failures.includes('type error') ||
        failures.includes('tsc') || failures.includes('eslint')) {
      return 'SYNTAX';
    }

    // Integration patterns
    if (failures.includes('integration') || failures.includes('e2e') ||
        failures.includes('api') || failures.includes('endpoint') ||
        failures.includes('connection') || failures.includes('network')) {
      return 'INTEGRATION';
    }

    // Strategic patterns
    if (failures.includes('requirement') || failures.includes('spec') ||
        failures.includes('acceptance') || failures.includes('business')) {
      return 'STRATEGIC';
    }

    // Default to logic
    return 'LOGIC';
  }

  /**
   * Determine recommendation based on classification and task attempts
   */
  private recommendFromClassification(
    classification: FailureClassification,
    task: CampaignTask
  ): ReflectionRecommendation {
    const attempts = task.attempts || 0;

    switch (classification) {
      case 'SYNTAX':
        // Syntax errors usually fixable with retry
        return attempts < 2 ? 'retry' : 'escalate';

      case 'LOGIC':
        // Logic errors may need stronger agent
        return attempts < 1 ? 'retry' : 'escalate';

      case 'INTEGRATION':
        // Integration issues often need escalation
        return 'escalate';

      case 'STRATEGIC':
        // Strategic issues need replanning
        return 'replan';

      default:
        return 'retry';
    }
  }

  /**
   * Suggest fix based on error message
   */
  private suggestFixForError(error: string): string | undefined {
    if (error.includes('ENOENT')) {
      return 'Check that all required files exist and paths are correct.';
    }
    if (error.includes('timeout')) {
      return 'Consider breaking the task into smaller subtasks or increasing timeout.';
    }
    if (error.includes('TypeError')) {
      return 'Review type definitions and ensure type safety.';
    }
    return undefined;
  }

  /**
   * Suggest fix based on criteria failures
   */
  private suggestFixFromCriteria(criteriaResult: CriteriaValidationResult): string | undefined {
    if (criteriaResult.failures.length === 0) return undefined;

    const firstFailure = criteriaResult.failures[0].toLowerCase();

    if (firstFailure.includes('test')) {
      return 'Review failing tests and ensure implementation matches expected behavior.';
    }
    if (firstFailure.includes('lint') || firstFailure.includes('eslint')) {
      return 'Fix linting errors by running the linter with --fix flag.';
    }
    if (firstFailure.includes('type') || firstFailure.includes('tsc')) {
      return 'Fix TypeScript errors by reviewing type definitions and imports.';
    }

    return `Address the failing criterion: ${criteriaResult.failures[0]}`;
  }

  /**
   * Normalize classification value
   */
  private normalizeClassification(value: unknown): FailureClassification {
    const str = String(value).toUpperCase();
    if (['SYNTAX', 'LOGIC', 'INTEGRATION', 'STRATEGIC'].includes(str)) {
      return str as FailureClassification;
    }
    return 'LOGIC';
  }

  /**
   * Normalize recommendation value
   */
  private normalizeRecommendation(value: unknown): ReflectionRecommendation {
    const str = String(value).toLowerCase();
    if (['retry', 'escalate', 'skip', 'replan'].includes(str)) {
      return str as ReflectionRecommendation;
    }
    return 'retry';
  }
}

/**
 * Factory function to create TaskReflector
 */
export function createReflector(options: ReflectorOptions): TaskReflector {
  return new TaskReflector(options);
}

/**
 * Quick assess function for simple use cases
 */
export async function assessTask(
  task: CampaignTask | EnhancedCampaignTask,
  workerResult: WorkerResult,
  cwd: string,
  options?: Partial<ReflectorOptions>
): Promise<TaskReflectionResult> {
  const reflector = new TaskReflector({ cwd, ...options });
  return reflector.assess(task, workerResult);
}
