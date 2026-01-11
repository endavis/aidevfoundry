import pc from 'picocolors';
import { orchestrate } from '../../orchestrator/intelligent-orchestrator';

interface OrchestrateCommandOptions {
  agent?: string;
  mode?: 'delegate' | 'coordinate' | 'supervise';
  agents?: string;
  interactive?: boolean;
}

export async function orchestrateCommand(
  task: string,
  options: OrchestrateCommandOptions
): Promise<void> {
  if (!task || task.trim() === '') {
    console.error(pc.red('Error: No task provided'));
    console.log(pc.dim('Usage: pk-puzldai orchestrate "complex task" --mode delegate'));
    process.exit(1);
  }

  const startTime = Date.now();

  console.log(pc.bold('\n🤖 Intelligent Orchestration'));
  console.log(pc.dim(`Mode: ${options.mode || 'delegate'}`));

  if (options.agents) {
    console.log(pc.dim(`Agents: ${options.agents}`));
  }

  console.log(pc.dim(`Task: ${task.slice(0, 80)}${task.length > 80 ? '...' : ''}\n`));

  try {
    const result = await orchestrate(task, {
      agent: options.agent,
      mode: options.mode as 'delegate' | 'coordinate' | 'supervise',
      agents: options.agents?.split(',').map(a => a.trim()),
      onAgentResponse: (agent, response) => {
        console.log(pc.dim(`\n  [${agent}] ${response.model} - ${response.duration}ms`));
        if (response.tokens) {
          console.log(pc.dim(`     Tokens: ${response.tokens.input} in / ${response.tokens.output} out`));
        }
      }
    });

    console.log(pc.bold('\n--- Result ---\n'));
    console.log(result.content);

    const duration = Date.now() - startTime;
    console.log(pc.dim(`\n---`));
    console.log(pc.dim(`Model: ${result.model} | Time: ${(duration / 1000).toFixed(1)}s`));
    if (result.tokens) {
      console.log(pc.dim(`Tokens: ${result.tokens.input} in / ${result.tokens.output} out`));
    }

  } catch (err) {
    console.error(pc.red(`\nOrchestration error: ${(err as Error).message}`));
    process.exit(1);
  }
}
