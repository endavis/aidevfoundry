import pc from 'picocolors';
import {
  buildPipelinePlan,
  parsePipelineString,
  formatPlanForDisplay,
  execute,
  type ExecutionPlan
} from '../../executor';

interface PipeCommandOptions {
  interactive?: boolean;
  dryRun?: boolean;
  noCompress?: boolean;
}

/**
 * Pipe command - Run a task through multiple agents in sequence using intuitive -> syntax
 *
 * Usage:
 *   pk-puzldai pipe "task" "gemini:plan -> codex:review -> claude:code"
 *   pk-puzldai pipe "task" "gemini:analyze -> claude:code -> ollama:review"
 *   pk-puzldai pipe "task" "Droid [glm-4.7]:coding"  # With custom model
 *   pk-puzldai pipe "task" "gemini -> claude -> ollama"  # Just agents, default to prompt
 *
 * Syntax:
 *   - Agents separated by "->" or commas
 *   - Format: "agent:action" or "agent [model]:action"
 *   - Actions: analyze, code, review, fix, test, summarize (default: prompt)
 */
export async function pipeCommand(task: string, pipeline: string, options: PipeCommandOptions): Promise<void> {
  if (!task || task.trim() === '') {
    console.error(pc.red('Error: No task provided'));
    console.log(pc.dim('Usage: pk-puzldai pipe "task" "agent:action -> agent:action -> ..."'));
    process.exit(1);
  }

  if (!pipeline || pipeline.trim() === '') {
    console.error(pc.red('Error: No pipeline steps provided'));
    console.log(pc.dim('Usage: pk-puzldai pipe "task" "agent:action -> agent:action -> ..."'));
    console.log(pc.dim('Example: pk-puzldai pipe "build a web app" "gemini:plan -> claude:code -> codex:review"'));
    process.exit(1);
  }

  console.log(pc.bold('\nPipeline: ') + pipeline);
  if (options.interactive) {
    console.log(pc.cyan('Interactive mode: You will be prompted before each step'));
  }
  console.log();

  const pipelineOpts = parsePipelineString(pipeline);
  const plan = buildPipelinePlan(task, pipelineOpts);

  // Display the parsed steps
  console.log(pc.dim('Steps:'));
  for (let i = 0; i < pipelineOpts.steps.length; i++) {
    const step = pipelineOpts.steps[i];
    const modelStr = step.model ? pc.cyan(` [${step.model}]`) : '';
    console.log(pc.dim(`  ${i + 1}. ${step.agent}${modelStr}: ${step.action}`));
  }
  console.log();

  if (options.noCompress) {
    plan.context = {
      ...plan.context,
      orchestration: {
        noCompress: true
      }
    };
  }

  if (options.dryRun) {
    console.log(pc.bold('\nExecution Plan:\n'));
    console.log(formatPlanForDisplay(plan));
    return;
  }

  await executePlan(plan, options.interactive);
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
        const modelStr = step?.model ? pc.cyan(` [${step.model}]`) : '';
        console.log(pc.yellow(`[${currentStep}/${stepCount}] ${agent}${modelStr}: running...`));
      } else if (event.type === 'complete') {
        const data = event.data as { content?: string; model?: string; duration?: number } | undefined;
        const timeStr = data?.duration ? ` (${(data.duration / 1000).toFixed(1)}s)` : '';
        console.log(pc.green(`    ✓ complete${timeStr}`));
        // Show output immediately after step completes
        const step = plan.steps.find(s => s.id === event.stepId);
        const agent = step?.agent || 'auto';
        const modelStr = step?.model ? pc.cyan(` [${step.model}]`) : '';
        if (data?.content) {
          console.log();
          console.log(pc.bold(`--- Output (${agent}${modelStr}) ---`));
          console.log(data.content);
        }
      } else if (event.type === 'error') {
        console.log(pc.red(`    ✗ ${event.message || 'failed'}`));
      } else if (event.type === 'skip') {
        console.log(pc.dim(`    ⊘ skipped: ${event.message || ''}`));
      }
    }
  });

  console.log();

  if (result.status === 'failed') {
    console.error(pc.red('Pipeline failed'));
    for (const r of result.results) {
      if (r.error) {
        console.error(pc.red(`  ${r.stepId}: ${r.error}`));
      }
    }
    process.exit(1);
  }

  const duration = Date.now() - startTime;
  console.log(pc.dim('---'));
  console.log(pc.dim(`Status: ${result.status} | Time: ${(duration / 1000).toFixed(1)}s`));

  const models = result.results
    .filter(r => r.model)
    .map(r => r.model)
    .join(' → ');
  if (models) {
    console.log(pc.dim(`Pipeline: ${models}`));
  }
}
