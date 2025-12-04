/**
 * Compare command - run same prompt against multiple agents in parallel
 *
 * Usage:
 *   ai compare "task" --agents claude,gemini,ollama
 *   ai compare "task" --agents claude,gemini --sequential
 *   ai compare "task" --agents claude,gemini --pick
 */

import pc from 'picocolors';
import {
  buildComparePlan,
  parseAgentsString,
  execute,
  type AgentName,
  type ExecutionResult
} from '../../executor';
import { drawCompareBoxes } from '../../display/boxes';

export interface CompareOptions {
  agents: string;
  sequential?: boolean;
  pick?: boolean;
}

export async function compareCommand(
  prompt: string,
  options: CompareOptions
): Promise<void> {
  const agents = parseAgentsString(options.agents);

  if (agents.length < 2) {
    console.error(pc.red('Error: Compare requires at least 2 agents'));
    console.log(pc.dim('Usage: ai compare "task" --agents claude,gemini,ollama'));
    process.exit(1);
  }

  console.log(pc.bold('\nComparing agents: ') + agents.join(', '));
  if (options.sequential) {
    console.log(pc.dim('Mode: Sequential'));
  } else {
    console.log(pc.dim('Mode: Parallel'));
  }
  if (options.pick) {
    console.log(pc.dim('Will select best response'));
  }
  console.log();

  const plan = buildComparePlan(prompt, {
    agents: agents as AgentName[],
    sequential: options.sequential,
    pick: options.pick
  });

  const startTime = Date.now();
  const isTTY = process.stdout.isTTY;

  // Show progress for each agent
  if (isTTY) {
    agents.forEach(agent => {
      console.log(pc.dim(`  ${agent}: waiting...`));
    });
  }

  // Move cursor up to overwrite progress
  const moveUp = (n: number) => {
    if (isTTY) process.stdout.write(`\x1b[${n}A`);
  };
  const clearLine = () => {
    if (isTTY) process.stdout.write('\x1b[2K\r');
  };

  const result = await execute(plan, {
    onEvent: (event) => {
      if (!isTTY) return;

      // Steps are created in same order as agents array
      const stepIndex = parseInt(event.stepId.replace('step_', ''), 10);
      if (isNaN(stepIndex) || stepIndex >= agents.length) return;

      const agent = agents[stepIndex];
      const linesUp = agents.length - stepIndex;

      moveUp(linesUp);
      clearLine();

      switch (event.type) {
        case 'start':
          console.log(pc.yellow(`  ${agent}: running...`));
          break;
        case 'complete':
          console.log(pc.green(`  ${agent}: complete`));
          break;
        case 'error':
          console.log(pc.red(`  ${agent}: failed`));
          break;
        default:
          console.log(pc.dim(`  ${agent}: ${event.type}`));
      }

      // Move cursor back down
      if (linesUp > 1) {
        process.stdout.write(`\x1b[${linesUp - 1}B`);
      }
    }
  });

  console.log();

  // Display results in boxes
  displayResults(result, agents, prompt);

  const duration = Date.now() - startTime;
  console.log(pc.dim(`\nTotal time: ${(duration / 1000).toFixed(1)}s`));

  // If pick mode, show selected
  if (options.pick && result.finalOutput) {
    console.log(pc.bold('\n--- Selected Response ---\n'));
    console.log(result.finalOutput);
  }
}

function displayResults(
  result: ExecutionResult,
  agents: string[],
  prompt: string
): void {
  const responses: Array<{ agent: string; content: string; error?: string; model?: string; duration?: number }> = [];

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const found = result.results.find(r => r.stepId === `step_${i}`);

    responses.push({
      agent,
      content: found?.content || '',
      error: found?.error || (!found ? 'No response' : undefined),
      model: found?.model,
      duration: found?.duration
    });
  }

  drawCompareBoxes(responses, prompt);
}
