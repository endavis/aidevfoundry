/**
 * Execution context and variable injection system
 *
 * Handles {{variable}} substitution and step result accumulation
 */

import type { StepResult } from './types';

export interface ExecutionContext {
  // Initial variables from plan
  initial: Record<string, unknown>;

  // Step results indexed by step ID
  steps: Record<string, StepResult>;

  // Named outputs (step.outputAs -> result)
  outputs: Record<string, string>;

  // Original prompt
  prompt: string;
}

/**
 * Create a new execution context
 */
export function createContext(
  prompt: string,
  initial: Record<string, unknown> = {}
): ExecutionContext {
  return {
    initial,
    steps: {},
    outputs: {},
    prompt
  };
}

/**
 * Add a step result to context
 */
export function addStepResult(
  ctx: ExecutionContext,
  result: StepResult,
  outputAs?: string
): ExecutionContext {
  const steps = { ...ctx.steps, [result.stepId]: result };
  const outputs = outputAs && result.content
    ? { ...ctx.outputs, [outputAs]: result.content }
    : ctx.outputs;

  return { ...ctx, steps, outputs };
}

/**
 * Inject variables into a template string
 *
 * Supports:
 *   {{prompt}}           - Original user prompt
 *   {{varName}}          - Initial context variable or named output
 *   {{stepId.content}}   - Step result content
 *   {{stepId.success}}   - Boolean: step completed without error
 *   {{stepId.error}}     - Error message if failed
 *   {{stepId.model}}     - Model used
 */
export function injectVariables(
  template: string,
  ctx: ExecutionContext
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path: string) => {
    const trimmed = path.trim();

    // {{prompt}} - original prompt
    if (trimmed === 'prompt') {
      return ctx.prompt;
    }

    // Check for dot notation (step.property)
    if (trimmed.includes('.')) {
      const [stepId, property] = trimmed.split('.', 2);
      const step = ctx.steps[stepId];

      if (!step) {
        return match; // Keep original if step not found
      }

      switch (property) {
        case 'content':
          return step.content ?? '';
        case 'success':
          return String(step.status === 'completed' && !step.error);
        case 'error':
          return step.error ?? '';
        case 'model':
          return step.model ?? '';
        case 'duration':
          return String(step.duration ?? 0);
        default:
          return match;
      }
    }

    // Check named outputs first, then initial context
    if (trimmed in ctx.outputs) {
      return ctx.outputs[trimmed];
    }

    if (trimmed in ctx.initial) {
      const val = ctx.initial[trimmed];
      return typeof val === 'string' ? val : JSON.stringify(val);
    }

    return match; // Keep original if not found
  });
}

/**
 * Evaluate a condition expression
 *
 * Supports simple expressions:
 *   {{stepId.success}}           - Boolean check
 *   {{stepId.success}} == true   - Equality
 *   {{stepId.content}}           - Truthy check (non-empty)
 */
export function evaluateCondition(
  condition: string,
  ctx: ExecutionContext
): boolean {
  // Inject variables first
  const evaluated = injectVariables(condition, ctx);

  // Handle explicit boolean comparisons
  if (evaluated.includes('==')) {
    const [left, right] = evaluated.split('==').map(s => s.trim());
    return left === right;
  }

  if (evaluated.includes('!=')) {
    const [left, right] = evaluated.split('!=').map(s => s.trim());
    return left !== right;
  }

  // Truthy check: non-empty string, not "false", not "0"
  const trimmed = evaluated.trim();
  return trimmed !== '' && trimmed !== 'false' && trimmed !== '0';
}

/**
 * Get all step IDs that a step depends on
 */
export function getUnresolvedDependencies(
  dependsOn: string[] | undefined,
  ctx: ExecutionContext
): string[] {
  if (!dependsOn || dependsOn.length === 0) {
    return [];
  }

  return dependsOn.filter(depId => {
    const result = ctx.steps[depId];
    return !result || result.status === 'pending' || result.status === 'running';
  });
}

/**
 * Check if all dependencies for a step are satisfied
 */
export function dependenciesSatisfied(
  dependsOn: string[] | undefined,
  ctx: ExecutionContext
): boolean {
  return getUnresolvedDependencies(dependsOn, ctx).length === 0;
}

/**
 * Check if any dependency failed
 */
export function anyDependencyFailed(
  dependsOn: string[] | undefined,
  ctx: ExecutionContext
): boolean {
  if (!dependsOn || dependsOn.length === 0) {
    return false;
  }

  return dependsOn.some(depId => {
    const result = ctx.steps[depId];
    return result?.status === 'failed';
  });
}
