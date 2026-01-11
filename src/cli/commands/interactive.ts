/**
 * Interactive Mode CLI Command
 *
 * Run CLI AI tools in interactive mode where pk-puzldai
 * acts as the "user" responding to prompts and verification requests.
 */

import { createSpinner } from 'nanospinner';
import pc from 'picocolors';
import { runInteractiveSession } from '../../interactive';
import type { AgentName } from '../../executor/types';
import { adapters } from '../../adapters';
import { resolveInteractiveAgent } from '../../lib/agent-selection';

interface InteractiveCommandOptions {
  agent?: string;
  responder?: string;
  maxInteractions?: string;
  timeout?: string;
  model?: string;
  verbose?: boolean;
}

export async function interactiveCommand(
  prompt: string,
  options: InteractiveCommandOptions
): Promise<void> {
  const spinner = createSpinner('Starting interactive session...').start();

  try {
    const agent = (options.agent || 'gemini') as AgentName;
    const responder = (options.responder || 'ollama') as AgentName;
    const maxInteractions = options.maxInteractions ? parseInt(options.maxInteractions, 10) : 50;
    const timeout = options.timeout ? parseInt(options.timeout, 10) * 1000 : 300000;

    // Validate agent
    const selection = resolveInteractiveAgent(agent);
    if (selection.notice) {
      console.log(pc.yellow(selection.notice));
    }

    const adapter = adapters[selection.agent];
    if (!adapter || !(await adapter.isAvailable())) {
      spinner.error({ text: `Agent ${selection.agent} is not available` });
      process.exit(1);
    }

    spinner.success({ text: 'Session initialized' });

    console.log('');
    console.log(pc.bold(pc.cyan('=== Interactive Mode ===')));
    console.log(pc.dim('pk-puzldai will respond to prompts from the CLI tool'));
    console.log('');
    console.log(pc.dim('Agent:'), selection.agent);
    console.log(pc.dim('Responder:'), responder);
    console.log(pc.dim('Max Interactions:'), maxInteractions);
    console.log(pc.dim('Timeout:'), `${timeout / 1000}s`);
    console.log('');
    console.log(pc.dim('Initial Prompt:'), prompt);
    console.log('');
    console.log(pc.dim('─'.repeat(50)));
    console.log('');

    const result = await runInteractiveSession({
      agent: selection.agent as AgentName,
      initialPrompt: prompt,
      planContext: prompt,
      responderAgent: responder,
      maxInteractions,
      sessionTimeout: timeout,
      model: options.model,
      onInteraction: (p, r) => {
        if (options.verbose) {
          console.log(pc.yellow(`\n◀ Detected (${p.type}): ${p.text.slice(0, 100)}...`));
          console.log(pc.green(`▶ Response: ${r.response}`));
          if (r.reasoning) {
            console.log(pc.dim(`  Reasoning: ${r.reasoning}`));
          }
        }
      },
      onOutput: (chunk) => {
        if (options.verbose) {
          process.stdout.write(pc.dim(chunk));
        }
      },
    });

    console.log('');
    console.log(pc.dim('─'.repeat(50)));
    console.log('');
    console.log(pc.bold('=== Session Complete ==='));
    console.log(pc.dim('Status:'), result.success ? pc.green('Success') : pc.red('Failed'));
    console.log(pc.dim('Interactions:'), result.interactions);
    console.log(pc.dim('Duration:'), `${(result.duration / 1000).toFixed(1)}s`);

    if (result.error) {
      console.log(pc.dim('Error:'), pc.red(result.error));
    }

    if (!options.verbose && result.output) {
      console.log('');
      console.log(pc.dim('Output:'));
      console.log(result.output);
    }

    if (result.history.length > 0) {
      console.log('');
      console.log(pc.dim('Interaction History:'));
      result.history.forEach((h, i) => {
        console.log(pc.dim(`  ${i + 1}.`), `[${h.prompt.type}]`, pc.cyan(h.response.response));
      });
    }

  } catch (error) {
    spinner.error({ text: `Session failed: ${(error as Error).message}` });
    process.exit(1);
  }
}
