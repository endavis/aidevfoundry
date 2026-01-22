/**
 * Interactive Mode CLI Command
 *
 * Run CLI AI tools in interactive mode where pk-puzldai
 * acts as the "user" responding to prompts and verification requests.
 */

import { createSpinner } from 'nanospinner';
import { runInteractiveSession } from '../../interactive';
import type { AgentName } from '../../executor/types';
import { adapters } from '../../adapters';
import { resolveInteractiveAgent } from '../../lib/agent-selection';
import {
  renderSessionHeader,
  renderStatusPanel,
  renderInteraction,
  renderSessionSummary,
  renderHistorySummary,
  renderBanner,
} from '../../display';

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
  let interactionIndex = 0;

  try {
    const agent = (options.agent || 'gemini') as AgentName;
    const responder = (options.responder || 'ollama') as AgentName;
    const maxInteractions = options.maxInteractions ? parseInt(options.maxInteractions, 10) : 50;
    const timeout = options.timeout ? parseInt(options.timeout, 10) * 1000 : 300000;

    // Validate agent
    const selection = resolveInteractiveAgent(agent);
    if (selection.notice) {
      console.log(selection.notice);
    }

    const adapter = adapters[selection.agent];
    if (!adapter || !(await adapter.isAvailable())) {
      spinner.error({ text: `Agent ${selection.agent} is not available` });
      process.exit(1);
    }

    spinner.success({ text: 'Session initialized' });

    // Render PK-puzld ASCII art banner
    console.log('');
    for (const line of await renderBanner()) {
      console.log(line);
    }
    console.log('');

    // Render polished session header
    const headerLines = renderSessionHeader({
      agent: selection.agent,
      responder,
      maxInteractions,
      timeout,
      prompt,
    });
    for (const line of headerLines) {
      console.log(line);
    }
    console.log('');

    // Render initial status panel
    for (const line of renderStatusPanel('running', 0, maxInteractions)) {
      console.log(line);
    }
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
        interactionIndex += 1;

        // Clear status panel and show interaction
        for (const line of renderInteraction(interactionIndex, maxInteractions, p, r)) {
          console.log(line);
        }

        // Show updated status
        console.log('');
        for (const line of renderStatusPanel(r.shouldEnd ? 'completed' : 'running', interactionIndex, maxInteractions)) {
          console.log(line);
        }
        console.log('');
      },
      onStateChange: (_state) => {
        // Status updates are shown in onInteraction
      },
      onOutput: (chunk) => {
        process.stdout.write(chunk);
      },
    });

    // Render final summary
    for (const line of renderSessionSummary({
      success: result.success,
      state: result.state,
      interactions: result.interactions,
      duration: result.duration,
      error: result.error,
    })) {
      console.log(line);
    }

    // Render history if not verbose
    if (!options.verbose && result.history.length > 0) {
      for (const line of renderHistorySummary(result.history)) {
        console.log(line);
      }
    }

  } catch (error) {
    spinner.error({ text: `Session failed: ${(error as Error).message}` });
    process.exit(1);
  }
}
