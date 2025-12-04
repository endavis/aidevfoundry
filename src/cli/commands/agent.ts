import * as readline from 'readline';
import pc from 'picocolors';
import { orchestrate } from '../../orchestrator';

interface AgentCommandOptions {
  agent?: string;
}

export async function agentCommand(options: AgentCommandOptions): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });

  const agentName = options.agent || 'auto';

  console.log(pc.bold('\nPulzdAI Interactive Agent'));
  console.log(pc.dim(`Mode: ${agentName === 'auto' ? 'Auto-routing' : `Using ${agentName}`}`));
  console.log(pc.dim('Type "exit" or "quit" to leave, Ctrl+C to cancel current task\n'));

  const prompt = () => {
    rl.question(pc.cyan('> '), async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed === 'exit' || trimmed === 'quit') {
        console.log(pc.dim('Goodbye!'));
        rl.close();
        process.exit(0);
      }

      // Handle special commands
      if (trimmed.startsWith('/')) {
        const cmd = trimmed.slice(1).toLowerCase();
        if (cmd === 'help') {
          console.log(pc.dim('\nCommands:'));
          console.log(pc.dim('  /help   - Show this help'));
          console.log(pc.dim('  /agent  - Show current agent'));
          console.log(pc.dim('  exit    - Exit interactive mode\n'));
          prompt();
          return;
        }
        if (cmd === 'agent') {
          console.log(pc.dim(`Current agent: ${agentName}\n`));
          prompt();
          return;
        }
        console.log(pc.yellow(`Unknown command: ${trimmed}\n`));
        prompt();
        return;
      }

      // Create abort controller for Ctrl+C during task
      const controller = new AbortController();
      let aborted = false;

      const abortHandler = () => {
        aborted = true;
        controller.abort();
        console.log(pc.yellow('\n[Cancelled]'));
      };

      process.once('SIGINT', abortHandler);

      const startTime = Date.now();
      let streamed = false;

      try {
        const result = await orchestrate(trimmed, {
          agent: options.agent,
          signal: controller.signal,
          onChunk: (chunk) => {
            streamed = true;
            process.stdout.write(chunk);
          }
        });

        if (!aborted) {
          if (result.error) {
            console.error(pc.red(`\nError: ${result.error}`));
          } else if (!streamed && result.content) {
            console.log(result.content);
          }

          const duration = Date.now() - startTime;
          console.log(pc.dim(`\n[${result.model} | ${(duration / 1000).toFixed(1)}s]\n`));
        }
      } catch (err: unknown) {
        if (!aborted) {
          const error = err as Error;
          console.error(pc.red(`\nError: ${error.message}\n`));
        }
      }

      process.removeListener('SIGINT', abortHandler);

      if (!aborted) {
        prompt();
      } else {
        // Re-prompt after abort
        console.log('');
        prompt();
      }
    });
  };

  // Handle Ctrl+C when no task is running
  rl.on('close', () => {
    console.log(pc.dim('\nGoodbye!'));
    process.exit(0);
  });

  prompt();
}
