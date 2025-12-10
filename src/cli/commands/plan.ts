/**
 * Plan command - LLM auto-generates an execution plan
 *
 * Usage:
 *   ai plan "complex task"
 *   ai plan "complex task" --execute
 *   ai plan "complex task" --execute --interactive
 *   ai plan "complex task" --planner claude
 */

import pc from 'picocolors';
import * as readline from 'readline';
import { createSpinner } from 'nanospinner';
import { generatePlan, formatPlanForDisplay } from '../../executor/planner';
import { execute, type AgentName, type ExecutionPlan, type PlanStep, type StepResult } from '../../executor';

export interface PlanOptions {
  execute?: boolean;
  planner?: string;
  interactive?: boolean;
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
    if (options.interactive) {
      console.log(pc.cyan('Interactive mode: You will be prompted before each step\n'));
    }
    await executePlan(result.plan, options.interactive);
  } else {
    console.log(pc.dim('Run with --execute to run this plan'));
    console.log(pc.dim('Add --interactive for step-by-step confirmation'));
  }
}

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function createStepPrompt(totalSteps: number): (step: PlanStep, index: number, previousResults: StepResult[]) => Promise<boolean> {
  return async (step: PlanStep, index: number, previousResults: StepResult[]): Promise<boolean> => {
    const stepNum = index + 1;
    const agent = step.agent || 'auto';

    // Show previous step output if available
    if (previousResults.length > 0) {
      const lastResult = previousResults[previousResults.length - 1];
      if (lastResult.content) {
        console.log();
        console.log(pc.bold('--- Previous Output ---'));
        console.log(lastResult.content);
        console.log(pc.bold('--- End Output ---'));
      }
    }

    console.log();
    console.log(pc.bold('Step ' + stepNum + '/' + totalSteps + ': ' + agent));
    console.log(pc.dim('  Action: ' + step.action));
    console.log(pc.dim('  Prompt: ' + step.prompt.slice(0, 100) + (step.prompt.length > 100 ? '...' : '')));

    const answer = await askQuestion(pc.cyan('  Run this step? [Y/n/q] '));

    if (answer === 'q' || answer === 'quit') {
      console.log(pc.yellow('\nAborting plan...'));
      process.exit(0);
    }

    return answer !== 'n' && answer !== 'no';
  };
}

async function executePlan(plan: ExecutionPlan, interactive?: boolean): Promise<void> {
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
    },
    onBeforeStep: interactive ? createStepPrompt(stepCount) : undefined
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
