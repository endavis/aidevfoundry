/**
 * ExecutionPlan validation system
 *
 * Validates plans before execution to fail fast on structural issues:
 * - Duplicate step IDs
 * - Unknown dependency references
 * - Dependency cycles
 * - Empty prompts
 * - Invalid agent names
 *
 * This prevents the executor from hanging indefinitely when plans
 * contain missing dependencies or cycles.
 */

import type { ExecutionPlan, PlanStep, StepAction } from './types';
import { adapters } from '../adapters';

/**
 * Validation error with code and location
 */
export interface ValidationError {
  code: ValidationErrorCode;
  message: string;
  stepId?: string;
  details?: Record<string, unknown>;
}

/**
 * Error codes for categorizing validation failures
 */
export type ValidationErrorCode =
  | 'EMPTY_STEPS'
  | 'DUPLICATE_STEP_ID'
  | 'UNKNOWN_DEPENDENCY'
  | 'DEPENDENCY_CYCLE'
  | 'EMPTY_PROMPT'
  | 'EMPTY_STEP_ID'
  | 'INVALID_AGENT'
  | 'INVALID_ACTION'
  | 'SELF_DEPENDENCY';

/**
 * Result of plan validation
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Valid agent names from the adapters registry + 'auto'
 */
function getValidAgentNames(): Set<string> {
  const validNames = new Set(Object.keys(adapters));
  validNames.add('auto'); // Auto-routing is always valid
  return validNames;
}

/**
 * Valid step action types
 */
const VALID_ACTIONS: Set<StepAction> = new Set([
  'prompt',
  'analyze',
  'combine',
  'transform',
  'validate',
  'route'
]);

/**
 * Detect cycles in a dependency graph using DFS
 *
 * Returns the first cycle found as an array of step IDs, or null if no cycle exists
 */
function detectCycle(
  stepId: string,
  dependencyMap: Map<string, string[]>,
  visited: Set<string>,
  recursionStack: Set<string>,
  path: string[]
): string[] | null {
  visited.add(stepId);
  recursionStack.add(stepId);
  path.push(stepId);

  const deps = dependencyMap.get(stepId) || [];
  for (const dep of deps) {
    if (!visited.has(dep)) {
      const cycle = detectCycle(dep, dependencyMap, visited, recursionStack, path);
      if (cycle) return cycle;
    } else if (recursionStack.has(dep)) {
      // Found a cycle - extract the cycle path
      const cycleStart = path.indexOf(dep);
      return [...path.slice(cycleStart), dep];
    }
  }

  path.pop();
  recursionStack.delete(stepId);
  return null;
}

/**
 * Find all dependency cycles in the plan
 */
function findDependencyCycles(steps: PlanStep[]): string[][] {
  const dependencyMap = new Map<string, string[]>();
  const stepIds = new Set<string>();

  // Build dependency map
  for (const step of steps) {
    stepIds.add(step.id);
    if (step.dependsOn && step.dependsOn.length > 0) {
      // Only include dependencies that reference existing steps
      const validDeps = step.dependsOn.filter(d => steps.some(s => s.id === d));
      dependencyMap.set(step.id, validDeps);
    }
  }

  const visited = new Set<string>();
  const cycles: string[][] = [];

  // Check each step for cycles
  for (const stepId of stepIds) {
    if (!visited.has(stepId)) {
      const cycle = detectCycle(stepId, dependencyMap, visited, new Set(), []);
      if (cycle) {
        cycles.push(cycle);
      }
    }
  }

  return cycles;
}

/**
 * Validate a single step
 */
function validateStep(
  step: PlanStep,
  index: number,
  validAgents: Set<string>
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check for empty step ID
  if (!step.id || step.id.trim() === '') {
    errors.push({
      code: 'EMPTY_STEP_ID',
      message: `Step at index ${index} has an empty or missing ID`,
      details: { index }
    });
  }

  // Check for empty prompt
  if (!step.prompt || step.prompt.trim() === '') {
    errors.push({
      code: 'EMPTY_PROMPT',
      message: `Step "${step.id}" has an empty prompt`,
      stepId: step.id
    });
  }

  // Check for valid agent
  if (!validAgents.has(step.agent)) {
    errors.push({
      code: 'INVALID_AGENT',
      message: `Step "${step.id}" has invalid agent "${step.agent}". Valid agents: ${[...validAgents].join(', ')}`,
      stepId: step.id,
      details: { agent: step.agent, validAgents: [...validAgents] }
    });
  }

  // Check for valid action
  if (!VALID_ACTIONS.has(step.action)) {
    errors.push({
      code: 'INVALID_ACTION',
      message: `Step "${step.id}" has invalid action "${step.action}". Valid actions: ${[...VALID_ACTIONS].join(', ')}`,
      stepId: step.id,
      details: { action: step.action, validActions: [...VALID_ACTIONS] }
    });
  }

  // Check for self-dependency
  if (step.dependsOn?.includes(step.id)) {
    errors.push({
      code: 'SELF_DEPENDENCY',
      message: `Step "${step.id}" depends on itself`,
      stepId: step.id
    });
  }

  // Validate fallback agent if specified
  if (step.fallback && !validAgents.has(step.fallback)) {
    errors.push({
      code: 'INVALID_AGENT',
      message: `Step "${step.id}" has invalid fallback agent "${step.fallback}"`,
      stepId: step.id,
      details: { fallbackAgent: step.fallback }
    });
  }

  return errors;
}

/**
 * Validate an ExecutionPlan for structural correctness
 *
 * Checks for:
 * - Empty steps array
 * - Duplicate step IDs
 * - Unknown dependency references
 * - Dependency cycles
 * - Empty prompts
 * - Invalid agent names
 *
 * @param plan - The plan to validate
 * @returns ValidationResult with errors and warnings
 */
export function validateExecutionPlan(plan: ExecutionPlan): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const validAgents = getValidAgentNames();

  // Check for empty steps
  if (!plan.steps || plan.steps.length === 0) {
    errors.push({
      code: 'EMPTY_STEPS',
      message: 'Plan has no steps to execute'
    });
    return { valid: false, errors, warnings };
  }

  // Collect all step IDs and check for duplicates
  const stepIds = new Set<string>();
  const duplicateIds = new Set<string>();

  for (const step of plan.steps) {
    if (stepIds.has(step.id)) {
      duplicateIds.add(step.id);
    }
    stepIds.add(step.id);
  }

  for (const dupId of duplicateIds) {
    errors.push({
      code: 'DUPLICATE_STEP_ID',
      message: `Duplicate step ID: "${dupId}"`,
      stepId: dupId
    });
  }

  // Validate each step
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    errors.push(...validateStep(step, i, validAgents));
  }

  // Check for unknown dependencies
  for (const step of plan.steps) {
    if (step.dependsOn) {
      for (const depId of step.dependsOn) {
        if (!stepIds.has(depId)) {
          errors.push({
            code: 'UNKNOWN_DEPENDENCY',
            message: `Step "${step.id}" depends on unknown step "${depId}"`,
            stepId: step.id,
            details: { dependencyId: depId, availableSteps: [...stepIds] }
          });
        }
      }
    }
  }

  // Check for dependency cycles
  const cycles = findDependencyCycles(plan.steps);
  for (const cycle of cycles) {
    errors.push({
      code: 'DEPENDENCY_CYCLE',
      message: `Dependency cycle detected: ${cycle.join(' → ')}`,
      stepId: cycle[0],
      details: { cycle }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(result: ValidationResult): string {
  if (result.valid) {
    return 'Plan validation passed';
  }

  const lines: string[] = ['Plan validation failed:'];

  for (const error of result.errors) {
    const prefix = error.stepId ? `[${error.stepId}] ` : '';
    lines.push(`  ✗ ${prefix}${error.message}`);
  }

  if (result.warnings.length > 0) {
    lines.push('Warnings:');
    for (const warning of result.warnings) {
      const prefix = warning.stepId ? `[${warning.stepId}] ` : '';
      lines.push(`  ⚠ ${prefix}${warning.message}`);
    }
  }

  return lines.join('\n');
}

/**
 * Validate a plan and throw if invalid
 *
 * Use this for fail-fast validation before execution
 */
export function assertValidPlan(plan: ExecutionPlan): void {
  const result = validateExecutionPlan(plan);
  if (!result.valid) {
    throw new Error(formatValidationErrors(result));
  }
}
