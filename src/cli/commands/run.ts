import pc from 'picocolors';
import * as readline from 'readline';
import { orchestrate } from '../../orchestrator';
import {
  buildPipelinePlan,
  parsePipelineString,
  execute,
  type ExecutionPlan,
  type PlanStep,
  type StepResult
} from '../../executor';
import { loadTemplate, listTemplates } from '../../executor/templates';

interface RunCommandOptions {
  agent?: string;
  model?: string;
  pipeline?: string;
  template?: string;
  interactive?: boolean;
}

export async function runCommand(task: string, options: RunCommandOptions): Promise<void> {
  if (!task || task.trim() === '') {
    console.error(pc.red('Error: No task provided'));
    console.log(pc.dim('Usage: ai run "your task here"'));
    process.exit(1);
  }

  if (options.pipeline) {
    await runPipeline(task, options.pipeline, options.interactive);
    return;
  }

  if (options.template) {
    await runTemplate(task, options.template, options.interactive);
    return;
  }

  await runSingleAgent(task, options);
}

async function runSingleAgent(task: string, options: RunCommandOptions): Promise<void> {
  const startTime = Date.now();

  if (options.agent && options.agent !== 'auto') {
    console.log(pc.dim(`Using agent: ${options.agent}`));
  } else {
    console.log(pc.dim('Routing task...'));
  }

  let streamed = false;
  const result = await orchestrate(task, {
    agent: options.agent,
    model: options.model,
    onChunk: (chunk) => {
      streamed = true;
      process.stdout.write(chunk);
    }
  });

  if (result.error) {
    console.error(pc.red(`\nError: ${result.error}`));
    process.exit(1);
  }

  if (!streamed && result.content) {
    console.log(result.content);
  }

  const duration = Date.now() - startTime;
  console.log(pc.dim(`\n---`));
  console.log(pc.dim(`Model: ${result.model} | Time: ${(duration / 1000).toFixed(1)}s`));
  if (result.tokens) {
    console.log(pc.dim(`Tokens: ${result.tokens.input} in / ${result.tokens.output} out`));
  }
}

async function runPipeline(task: string, pipelineStr: string, interactive?: boolean): Promise<void> {
  console.log(pc.bold('\nRunning pipeline: ') + pipelineStr);
  if (interactive) {
    console.log(pc.cyan('Interactive mode: You will be prompted before each step'));
  }
  console.log();

  const pipelineOpts = parsePipelineString(pipelineStr);
  const plan = buildPipelinePlan(task, pipelineOpts);

  await executePlan(plan, interactive);
}

async function runTemplate(task: string, templateName: string, interactive?: boolean): Promise<void> {
  const template = loadTemplate(templateName);

  if (!template) {
    console.error(pc.red(`Error: Template "${templateName}" not found`));
    console.log(pc.dim('Available templates: ' + listTemplates().join(', ')));
    process.exit(1);
  }

  console.log(pc.bold('\nUsing template: ') + template.name);
  if (template.description) {
    console.log(pc.dim(template.description));
  }
  if (interactive) {
    console.log(pc.cyan('Interactive mode: You will be prompted before each step'));
  }
  console.log();

  const plan = buildPipelinePlan(task, { steps: template.steps });

  await executePlan(plan, interactive);
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
      console.log(pc.yellow('\nAborting pipeline...'));
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
        console.log(pc.yellow('[' + currentStep + '/' + stepCount + '] ' + agent + ': running...'));
      } else if (event.type === 'complete') {
        const data = event.data as { content?: string; model?: string; duration?: number } | undefined;
        const timeStr = data?.duration ? ' (' + (data.duration / 1000).toFixed(1) + 's)' : '';
        console.log(pc.green('    ✓ complete' + timeStr));
        // Show output immediately after step completes
        const step = plan.steps.find(s => s.id === event.stepId);
        const agent = step?.agent || 'auto';
        if (data?.content) {
          console.log();
          console.log(pc.bold('--- Output (' + agent + ') ---'));
          console.log(data.content);
        }
      } else if (event.type === 'error') {
        console.log(pc.red('    ✗ ' + (event.message || 'failed')));
      } else if (event.type === 'skip') {
        console.log(pc.dim('    ⊘ skipped: ' + (event.message || '')));
      }
    },
    onBeforeStep: interactive ? createStepPrompt(stepCount) : undefined
  });

  console.log();

  if (result.status === 'failed') {
    console.error(pc.red('Pipeline failed'));
    for (const r of result.results) {
      if (r.error) {
        console.error(pc.red('  ' + r.stepId + ': ' + r.error));
      }
    }
    process.exit(1);
  }

  const duration = Date.now() - startTime;
  console.log(pc.dim('---'));
  console.log(pc.dim('Status: ' + result.status + ' | Time: ' + (duration / 1000).toFixed(1) + 's'));

  const models = result.results
    .filter(r => r.model)
    .map(r => r.model)
    .join(' → ');
  if (models) {
    console.log(pc.dim('Pipeline: ' + models));
  }
}
