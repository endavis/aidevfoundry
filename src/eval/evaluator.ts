/**
 * Approach Evaluation System
 *
 * Verifies that the automatic approach selection produces
 * correct and high-quality results using LLM feedback.
 */

import { adapters, runOpenRouter } from '../adapters';
import { execute } from '../executor/executor';
import { buildPKPoetPlan } from '../executor/pk-poet-builder';
import { buildPoetiqPlan, buildSelfDiscoverPlan } from '../executor/factory-modes-builder';
import type { ExecutionPlan, ExecutorConfig } from '../executor/types';

export interface EvalResult {
  task: string;
  classifiedAs: string;
  modeUsed: string;
  success: boolean;
  duration: number;
  quality?: {
    score: number;       // 1-10
    reasoning: string;
  };
  error?: string;
}

export interface EvalSummary {
  totalTests: number;
  passed: number;
  failed: number;
  avgQuality: number;
  avgDuration: number;
  results: EvalResult[];
}

/**
 * Evaluate the quality of an execution result using LLM feedback
 */
async function evaluateQuality(
  task: string,
  result: string,
  mode: string
): Promise<{ score: number; reasoning: string }> {
  const evaluatorPrompt = `You are evaluating the quality of an AI assistant's response.

Task: "${task}"
Approach Used: ${mode}
Response:
---
${result.slice(0, 3000)}
---

Rate the quality of this response on a scale of 1-10 where:
- 10 = Perfect, comprehensive, exactly what was needed
- 7-9 = Good, addresses the task well with minor gaps
- 4-6 = Acceptable, partially addresses the task
- 1-3 = Poor, fails to address the task adequately

Consider:
1. Does the response directly address the task?
2. Is it complete and thorough?
3. Is it accurate and correct?
4. Is it well-structured and clear?
5. Was the approach (${mode}) appropriate for this task?

Respond in this exact JSON format only:
{"score": <number 1-10>, "reasoning": "<one sentence explanation>"}`;

  // Use OpenRouter with Devstral for evaluation (fast and cheap)
  try {
    const evalResult = await runOpenRouter(evaluatorPrompt);

    if (evalResult.error) {
      // Fallback to ollama if OpenRouter is not available
      const ollama = adapters['ollama'];
      if (ollama && (await ollama.isAvailable())) {
        const ollamaResult = await ollama.run(evaluatorPrompt, { disableTools: true });
        const parsed = JSON.parse(ollamaResult.content.match(/\{[\s\S]*\}/)?.[0] || '{}');
        return {
          score: parsed.score || 5,
          reasoning: parsed.reasoning || 'No reasoning provided',
        };
      }
      return { score: 5, reasoning: 'Evaluator not available' };
    }

    const parsed = JSON.parse(evalResult.content.match(/\{[\s\S]*\}/)?.[0] || '{}');
    return {
      score: parsed.score || 5,
      reasoning: parsed.reasoning || 'No reasoning provided',
    };
  } catch {
    return { score: 5, reasoning: 'Evaluation parsing failed' };
  }
}

/**
 * Classification function (must match do.ts exactly)
 */
export function classifyTask(task: string): string {
  const lower = task.toLowerCase();

  if (
    lower.includes('security') ||
    lower.includes('vulnerabil') ||
    lower.includes('attack') ||
    lower.includes('exploit') ||
    lower.includes('penetration') ||
    lower.includes('audit')
  ) {
    return 'security';
  }

  if (
    lower.includes('implement') ||
    lower.includes('create') ||
    lower.includes('build') ||
    lower.includes('add') ||
    lower.includes('develop') ||
    lower.includes('make') ||
    lower.includes('write')
  ) {
    return 'implement';
  }

  if (
    lower.includes('fix') ||
    lower.includes('bug') ||
    lower.includes('error') ||
    lower.includes('issue') ||
    lower.includes('broken') ||
    lower.includes('not working') ||
    lower.includes('failing')
  ) {
    return 'fix';
  }

  if (
    lower.includes('refactor') ||
    lower.includes('improve') ||
    lower.includes('optimize') ||
    lower.includes('clean up') ||
    lower.includes('restructure')
  ) {
    return 'refactor';
  }

  if (
    lower.includes('analyze') ||
    lower.includes('review') ||
    lower.includes('understand') ||
    lower.includes('investigate') ||
    lower.includes('find') ||
    lower.includes('search') ||
    lower.includes('look at')
  ) {
    return 'analyze';
  }

  if (
    lower.includes('explain') ||
    lower.includes('what is') ||
    lower.includes('how does') ||
    lower.includes('why') ||
    lower.includes('describe')
  ) {
    return 'explain';
  }

  return task.length < 50 ? 'simple' : 'implement';
}

/**
 * Get mode name for task type
 */
function getModeForType(taskType: string): string {
  const modes: Record<string, string> = {
    security: 'PK-Poet (Security)',
    implement: 'Poetiq (Verification-First)',
    fix: 'Self-Discover (Bug Fix)',
    refactor: 'PK-Poet (Refactor)',
    analyze: 'Self-Discover (Analysis)',
    explain: 'Self-Discover (Explain)',
    simple: 'Direct',
  };
  return modes[taskType] || 'Direct';
}

/**
 * Build plan for task type
 */
async function buildPlanForType(
  task: string,
  taskType: string
): Promise<ExecutionPlan> {
  // Get best available agent
  const agent = (await adapters['claude']?.isAvailable())
    ? 'claude'
    : (await adapters['gemini']?.isAvailable())
      ? 'gemini'
      : 'ollama';

  switch (taskType) {
    case 'security':
    case 'refactor':
      return buildPKPoetPlan(task, {
        depth: 'medium',
        reasonAgent: agent as any,
        discoverAgent: agent as any,
        attackAgent: agent as any,
        fortifyAgent: agent as any,
        executeAgent: agent as any,
      });

    case 'implement':
      return buildPoetiqPlan(task, { agent: agent as any });

    case 'fix':
    case 'analyze':
    case 'explain':
      return buildSelfDiscoverPlan(task, {
        agent: agent as any,
        depth: 'medium',
      });

    default:
      return {
        id: `simple_${Date.now()}`,
        mode: 'single',
        prompt: task,
        steps: [{
          id: 'execute',
          agent: agent as any,
          action: 'prompt',
          prompt: task,
        }],
        createdAt: Date.now(),
      };
  }
}

/**
 * Run a single evaluation
 */
export async function runEval(
  task: string,
  options: { skipExecution?: boolean; verbose?: boolean } = {}
): Promise<EvalResult> {
  const startTime = Date.now();
  const taskType = classifyTask(task);
  const mode = getModeForType(taskType);

  if (options.skipExecution) {
    return {
      task,
      classifiedAs: taskType,
      modeUsed: mode,
      success: true,
      duration: Date.now() - startTime,
    };
  }

  try {
    const plan = await buildPlanForType(task, taskType);

    const config: ExecutorConfig = {
      maxConcurrency: 1,
      defaultTimeout: 120000,
    };

    const result = await execute(plan, config);

    const quality = await evaluateQuality(
      task,
      result.finalOutput || '',
      mode
    );

    return {
      task,
      classifiedAs: taskType,
      modeUsed: mode,
      success: result.status === 'completed',
      duration: result.duration,
      quality,
    };
  } catch (err) {
    return {
      task,
      classifiedAs: taskType,
      modeUsed: mode,
      success: false,
      duration: Date.now() - startTime,
      error: (err as Error).message,
    };
  }
}

/**
 * Run full evaluation suite
 */
export async function runEvalSuite(
  tasks: string[],
  options: { skipExecution?: boolean; verbose?: boolean } = {}
): Promise<EvalSummary> {
  const results: EvalResult[] = [];

  for (const task of tasks) {
    if (options.verbose) {
      console.log(`Evaluating: "${task.slice(0, 50)}..."`);
    }

    const result = await runEval(task, options);
    results.push(result);

    if (options.verbose) {
      console.log(`  -> ${result.classifiedAs} (${result.modeUsed})`);
      if (result.quality) {
        console.log(`  -> Quality: ${result.quality.score}/10`);
      }
    }
  }

  const passed = results.filter(r => r.success).length;
  const qualityScores = results
    .filter(r => r.quality)
    .map(r => r.quality!.score);
  const avgQuality = qualityScores.length > 0
    ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
    : 0;
  const avgDuration = results.reduce((a, r) => a + r.duration, 0) / results.length;

  return {
    totalTests: results.length,
    passed,
    failed: results.length - passed,
    avgQuality,
    avgDuration,
    results,
  };
}

/**
 * Default evaluation tasks
 */
export const DEFAULT_EVAL_TASKS = [
  // Implementation
  'Implement a user login function with email validation',
  'Create a REST endpoint that returns paginated results',

  // Bug fix
  'Fix the null pointer exception in the user service',
  'The form validation is not working correctly',

  // Security
  'Check for SQL injection vulnerabilities in the query builder',

  // Refactor
  'Refactor the authentication module to use async/await',

  // Analysis
  'Analyze the performance of the database queries',
  'Review the error handling patterns in this codebase',

  // Explain
  'Explain how the dependency injection works in this app',
  'What is the purpose of the middleware chain?',
];
