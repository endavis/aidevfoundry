/**
 * Parallel Model Configuration Testing
 *
 * Tests PK-Poet and other patterns with:
 * - Various models in various roles
 * - Parallel execution to save time
 * - Head-to-head comparison of role assignments
 *
 * Goal: Find optimal model-role assignments
 * e.g., Is Codex better at planning or implementing?
 *       Is Gemini better at validation or critique?
 */

import pc from 'picocolors';
import { adapters } from '../adapters';
import { execute, type ExecutionPlan, type PlanStep } from '../executor';

// ============================================================================
// TYPES
// ============================================================================

export interface ModelRole {
  model: 'codex' | 'claude' | 'gemini' | 'factory';
  role: 'plan' | 'validate' | 'critique' | 'implement' | 'refine' | 'aggregate';
}

export interface ParallelConfig {
  id: string;
  name: string;
  /** Role assignments */
  roles: Record<string, 'codex' | 'claude' | 'gemini' | 'factory'>;
  /** Parallel groups - roles that can run simultaneously */
  parallelGroups: string[][];
}

export interface ParallelTestResult {
  configId: string;
  output: string;
  duration: number;
  stepTimings: Record<string, number>;
  error?: string;
}

// ============================================================================
// CONFIGURATIONS TO TEST
// ============================================================================

/**
 * Different model-role assignments to test
 * Each represents a hypothesis about optimal assignment
 */
const PARALLEL_CONFIGS: ParallelConfig[] = [
  {
    id: 'codex-lead',
    name: 'Codex Lead (Plan+Implement)',
    roles: {
      plan: 'codex',
      validate: 'gemini',
      implement: 'codex',
      critique: 'claude',
      refine: 'codex'
    },
    parallelGroups: [['plan'], ['validate', 'implement'], ['critique'], ['refine']]
  },
  {
    id: 'claude-lead',
    name: 'Claude Lead (Plan+Implement)',
    roles: {
      plan: 'claude',
      validate: 'gemini',
      implement: 'claude',
      critique: 'codex',
      refine: 'claude'
    },
    parallelGroups: [['plan'], ['validate', 'implement'], ['critique'], ['refine']]
  },
  {
    id: 'specialist',
    name: 'Specialist (Best at Each)',
    roles: {
      plan: 'codex',        // Codex: best reasoning
      validate: 'gemini',   // Gemini: good at analysis
      implement: 'claude',  // Claude: solid coding
      critique: 'gemini',   // Gemini: analytical
      refine: 'codex'       // Codex: final polish
    },
    parallelGroups: [['plan'], ['validate', 'implement'], ['critique'], ['refine']]
  },
  {
    id: 'parallel-moa',
    name: 'Parallel MoA',
    roles: {
      propose_codex: 'codex',
      propose_claude: 'claude',
      propose_gemini: 'gemini',
      aggregate: 'codex',
      refine: 'claude'
    },
    parallelGroups: [['propose_codex', 'propose_claude', 'propose_gemini'], ['aggregate'], ['refine']]
  },
  {
    id: 'dual-validate',
    name: 'Dual Validation',
    roles: {
      plan: 'codex',
      validate_gemini: 'gemini',
      validate_claude: 'claude',
      implement: 'codex',
      refine: 'codex'
    },
    parallelGroups: [['plan'], ['validate_gemini', 'validate_claude'], ['implement'], ['refine']]
  },
  {
    id: 'factory-hybrid',
    name: 'Factory Hybrid (GLM-4.7)',
    roles: {
      plan: 'factory',
      validate: 'gemini',
      implement: 'factory',
      critique: 'claude',
      refine: 'codex'
    },
    parallelGroups: [['plan'], ['validate'], ['implement'], ['critique', 'refine']]
  }
];

// ============================================================================
// EXECUTION ENGINE
// ============================================================================

/**
 * Build execution plan from parallel config
 */
function buildParallelPlan(config: ParallelConfig, task: string): ExecutionPlan {
  const steps: PlanStep[] = [];
  let stepIndex = 0;
  const outputMap: Record<string, string> = {};

  for (const group of config.parallelGroups) {
    const groupSteps: PlanStep[] = [];
    const prevGroupOutputs = Object.values(outputMap);

    for (const role of group) {
      const model = config.roles[role];
      const stepId = `step_${stepIndex++}`;
      outputMap[role] = `${stepId}_output`;

      // Build prompt based on role
      let prompt = '';
      const prevRef = prevGroupOutputs.length > 0
        ? `\n\nPrevious outputs:\n${prevGroupOutputs.map(o => `{{${o}}}`).join('\n\n')}`
        : '';

      switch (role) {
        case 'plan':
          prompt = `Create a detailed implementation plan for this task:\n\n${task}`;
          break;
        case 'validate':
        case 'validate_gemini':
        case 'validate_claude':
          prompt = `Validate and critique this plan. Identify issues, gaps, and improvements needed:${prevRef}`;
          break;
        case 'implement':
          prompt = `Implement the solution based on the plan. Write production-ready code:${prevRef}`;
          break;
        case 'critique':
          prompt = `Critically review this implementation. Find bugs, edge cases, and improvements:${prevRef}`;
          break;
        case 'refine':
          prompt = `Refine and improve based on feedback. Fix all issues:${prevRef}`;
          break;
        case 'propose_codex':
        case 'propose_claude':
        case 'propose_gemini':
          prompt = `Propose a complete solution for:\n\n${task}\n\nProvide full implementation.`;
          break;
        case 'aggregate':
          prompt = `Synthesize these proposals into the best solution. Take the best from each:${prevRef}`;
          break;
        default:
          prompt = `${role}:\n\n${task}${prevRef}`;
      }

      groupSteps.push({
        id: stepId,
        agent: model,
        action: 'prompt',
        prompt,
        dependsOn: stepIndex > group.length ? [steps[steps.length - 1]?.id].filter(Boolean) : undefined,
        outputAs: `${stepId}_output`
      });
    }

    // Steps in same group have no dependencies on each other (parallel)
    // But depend on previous group
    if (steps.length > 0) {
      const lastGroupEnd = steps.length;
      const lastGroupStart = lastGroupEnd - config.parallelGroups[config.parallelGroups.indexOf(group) - 1]?.length || 0;
      const deps = steps.slice(lastGroupStart, lastGroupEnd).map(s => s.id);

      groupSteps.forEach(s => {
        s.dependsOn = deps.length > 0 ? deps : undefined;
      });
    }

    steps.push(...groupSteps);
  }

  return {
    id: `parallel_${config.id}_${Date.now()}`,
    mode: 'pipeline',
    prompt: task,
    steps,
    createdAt: Date.now()
  };
}

/**
 * Run a single config with timing
 */
async function runConfig(config: ParallelConfig, task: string): Promise<ParallelTestResult> {
  const plan = buildParallelPlan(config, task);
  const startTime = Date.now();
  const stepTimings: Record<string, number> = {};

  try {
    const result = await execute(plan, {
      onEvent: (event) => {
        if (event.type === 'complete') {
          const data = event.data as { duration?: number } | undefined;
          if (data?.duration) {
            stepTimings[event.stepId || ''] = data.duration;
          }
        }
      }
    });

    const lastResult = result.results[result.results.length - 1];

    return {
      configId: config.id,
      output: lastResult?.content || '',
      duration: Date.now() - startTime,
      stepTimings,
      error: result.status === 'failed' ? 'Execution failed' : undefined
    };
  } catch (err) {
    return {
      configId: config.id,
      output: '',
      duration: Date.now() - startTime,
      stepTimings,
      error: (err as Error).message
    };
  }
}

/**
 * Judge comparison between configs
 */
async function judgeResults(
  task: string,
  results: ParallelTestResult[],
  judgeModel: 'codex' | 'claude' | 'gemini' = 'gemini'
): Promise<{ rankings: string[]; scores: Record<string, number>; reasoning: string }> {
  const adapter = adapters[judgeModel];

  const prompt = `Rank these solutions from best to worst. Output ONLY JSON.

TASK: ${task}

${results.map((r, i) => `SOLUTION ${i + 1} (${r.configId}, ${(r.duration / 1000).toFixed(1)}s):
${r.output?.slice(0, 1000) || '[ERROR]'}
`).join('\n')}

{"rankings":["configId1","configId2",...], "scores":{"configId":0-100,...}, "reasoning":"brief"}`;

  try {
    const response = await adapter.run(prompt, { timeout: 60000 });
    const match = response.content.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch {
    // Fallback: rank by output length and duration
  }

  // Fallback ranking
  const sorted = [...results]
    .filter(r => !r.error && r.output.length > 0)
    .sort((a, b) => {
      const scoreA = a.output.length / (a.duration / 1000);
      const scoreB = b.output.length / (b.duration / 1000);
      return scoreB - scoreA;
    });

  return {
    rankings: sorted.map(r => r.configId),
    scores: Object.fromEntries(sorted.map((r, i) => [r.configId, 100 - i * 15])),
    reasoning: 'Fallback ranking by output quality/speed ratio'
  };
}

// ============================================================================
// MAIN TEST FUNCTION
// ============================================================================

export interface ParallelTestOptions {
  configs?: string[];
  task?: string;
  verbose?: boolean;
  judge?: 'codex' | 'claude' | 'gemini';
}

export async function testParallelConfigs(options: ParallelTestOptions = {}): Promise<void> {
  const {
    configs = PARALLEL_CONFIGS.map(c => c.id),
    task = 'Write a debounce function in TypeScript with proper typing, cancellation support, and leading/trailing edge options',
    verbose = true,
    judge = 'gemini'
  } = options;

  const selectedConfigs = PARALLEL_CONFIGS.filter(c => configs.includes(c.id));

  console.log(pc.bold(pc.cyan('\n⚡ Parallel Model Configuration Test\n')));
  console.log(pc.dim(`Testing ${selectedConfigs.length} configurations in parallel\n`));

  // Show configurations
  console.log(pc.bold('Configurations:'));
  for (const config of selectedConfigs) {
    console.log(`  ${pc.cyan(config.name)}`);
    const roles = Object.entries(config.roles)
      .map(([role, model]) => `${role}:${model}`)
      .join(', ');
    console.log(pc.dim(`    ${roles}`));
  }
  console.log();

  console.log(pc.bold('Task:'));
  console.log(pc.dim(`  ${task.slice(0, 80)}...`));
  console.log();

  // Run all configs IN PARALLEL
  console.log(pc.yellow('Running all configs in parallel...\n'));
  const startTime = Date.now();

  const results = await Promise.all(
    selectedConfigs.map(config => runConfig(config, task))
  );

  const totalTime = Date.now() - startTime;

  // Show timing results
  console.log(pc.bold('\nTiming Results:'));
  console.log(pc.dim('─'.repeat(50)));

  for (const result of results) {
    const config = selectedConfigs.find(c => c.id === result.configId)!;
    const status = result.error ? pc.red('✗') : pc.green('✓');
    const time = (result.duration / 1000).toFixed(1);

    console.log(`${status} ${config.name.padEnd(25)} ${time}s`);

    if (verbose && Object.keys(result.stepTimings).length > 0) {
      for (const [step, duration] of Object.entries(result.stepTimings)) {
        console.log(pc.dim(`    ${step}: ${(duration / 1000).toFixed(1)}s`));
      }
    }
  }

  console.log(pc.dim('─'.repeat(50)));
  console.log(pc.dim(`Total parallel time: ${(totalTime / 1000).toFixed(1)}s`));
  console.log(pc.dim(`Sequential would be: ~${(results.reduce((a, r) => a + r.duration, 0) / 1000).toFixed(1)}s`));
  console.log(pc.green(`Speedup: ${(results.reduce((a, r) => a + r.duration, 0) / totalTime).toFixed(1)}x`));

  // Judge results
  console.log(pc.yellow('\nJudging results...\n'));
  const judgment = await judgeResults(task, results, judge);

  // Show rankings
  console.log(pc.bold('🏆 Rankings:'));
  console.log(pc.dim('─'.repeat(50)));

  judgment.rankings.forEach((configId, i) => {
    const config = selectedConfigs.find(c => c.id === configId);
    const result = results.find(r => r.configId === configId);
    const score = judgment.scores[configId] || 0;
    const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;

    if (config && result) {
      console.log(`${rank.padEnd(4)} ${config.name.padEnd(25)} Score: ${score} (${(result.duration / 1000).toFixed(1)}s)`);
    }
  });

  console.log(pc.dim('─'.repeat(50)));
  console.log(pc.dim(`Reasoning: ${judgment.reasoning}`));

  // Show winner's output
  if (judgment.rankings.length > 0 && verbose) {
    const winnerId = judgment.rankings[0];
    const winnerResult = results.find(r => r.configId === winnerId);
    const winnerConfig = selectedConfigs.find(c => c.id === winnerId);

    if (winnerResult && winnerConfig) {
      console.log(pc.bold(pc.green(`\n═══ Winner: ${winnerConfig.name} ═══\n`)));
      console.log(winnerResult.output.slice(0, 2000));
      if (winnerResult.output.length > 2000) {
        console.log(pc.dim(`\n... (${winnerResult.output.length - 2000} more chars)`));
      }
    }
  }
}

/**
 * Quick test of specific model-role assignment
 */
export async function quickParallelTest(
  roles: Record<string, 'codex' | 'claude' | 'gemini' | 'factory'>,
  task: string
): Promise<ParallelTestResult> {
  const config: ParallelConfig = {
    id: 'custom',
    name: 'Custom Config',
    roles,
    parallelGroups: [Object.keys(roles)]  // All parallel
  };

  return runConfig(config, task);
}

export { PARALLEL_CONFIGS };
