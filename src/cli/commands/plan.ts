/**
 * Plan command - LLM auto-generates an execution plan
 *
 * Usage:
 *   ai plan "complex task"
 *   ai plan "complex task" --execute
 *   ai plan "complex task" --planner claude
 */

import pc from 'picocolors';
import { createSpinner } from 'nanospinner';
import { generatePlan, formatPlanForDisplay } from '../../executor/planner';
import { execute, type AgentName, type ExecutionPlan } from '../../executor';

export interface PlanOptions {
  execute?: boolean;
  planner?: string;
}

export async function planCommand(
  task: string,
  options: PlanOptions
): Promise<void> {
  if (!task || task.trim() === '') {
    console.error(pc.red('Error: No task provided'));
    console.log(pc.dim('Usage: ai plan "your complex task here"'));
    process.exit(1);
  }

  const plannerAgent = (options.planner || 'ollama') as AgentName;

  const spinner = createSpinner('Generating plan with ' + plannerAgent + '...').start();
  const result = await generatePlan(task, plannerAgent);

  if (result.error || !result.plan) {
    spinner.error({ text: 'Failed: ' + (result.error || 'Could not generate plan') });
    process.exit(1);
  }

  spinner.success({ text: 'Plan generated' });
  console.log(pc.bold('\n--- Generated Plan ---\n'));
  console.log(formatPlanForDisplay(result.plan, result.reasoning));
  console.log();

  if (options.execute) {
    console.log(pc.bold('\n--- Executing Plan ---\n'));
    await executePlan(result.plan);
  } else {
    console.log(pc.dim('Run with --execute to run this plan'));
  }
}

async function executePlan(plan: ExecutionPlan): Promise<void> {
  const startTime = Date.now();
  const stepCount = plan.steps.length;
  let currentStep = 0;

  const result = await execute(plan, {
    onEvent: (event) => {
      if (event.type === 'start') {
        currentStep++;
        const step = plan.steps.find(s => s.id === event.stepId);
        const agent = step?.agent || 'auto';
        const action = step?.action || 'prompt';
        console.log(pc.yellow(`[${currentStep}/${stepCount}] ${agent}: ${action}...`));
      } else if (event.type === 'complete') {
        console.log(pc.green(`    ✓ complete`));
      } else if (event.type === 'error') {
        console.log(pc.red(`    ✗ ${event.message || 'failed'}`));
      }
    }
  });

  console.log();

  if (result.status === 'failed') {
    console.error(pc.red('Plan execution failed'));
    for (const r of result.results) {
      if (r.error) {
        console.error(pc.red(`  ${r.stepId}: ${r.error}`));
      }
    }
    process.exit(1);
  }

  if (result.finalOutput) {
    console.log(pc.bold('--- Final Output ---\n'));
    console.log(result.finalOutput);
  }

  const duration = Date.now() - startTime;
  console.log(pc.dim(`\n---`));
  console.log(pc.dim(`Status: ${result.status} | Time: ${(duration / 1000).toFixed(1)}s`));

  const models = result.results
    .filter(r => r.model)
    .map(r => r.model)
    .join(' → ');
  if (models) {
    console.log(pc.dim(`Pipeline: ${models}`));
  }
}
