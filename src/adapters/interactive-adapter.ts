/**
 * Interactive Adapter Wrapper
 *
 * Wraps any CLI adapter to support interactive mode where
 * pk-puzldai acts as the "user" responding to prompts.
 */

import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import { runInteractiveSession } from '../interactive';
import type { InteractiveSessionConfig } from '../interactive';
import type { AgentName } from '../executor/types';

/**
 * Extended run options for interactive mode
 */
export interface InteractiveRunOptions extends RunOptions {
  /** Enable interactive mode */
  interactive?: boolean;
  /** Plan context for the AI responder */
  planContext?: string;
  /** Agent to use for generating responses */
  responderAgent?: AgentName;
  /** Maximum number of interactions */
  maxInteractions?: number;
  /** Session timeout in milliseconds */
  sessionTimeout?: number;
  /** Callback for each interaction */
  onInteraction?: (prompt: string, response: string) => void;
  /** Callback for output chunks */
  onOutput?: (chunk: string) => void;
}

/**
 * Create an interactive version of an adapter
 *
 * @param adapter The base adapter to wrap
 * @param agentName The name of the agent for configuration lookup
 * @returns An adapter that supports both regular and interactive modes
 */
export function createInteractiveAdapter(
  adapter: Adapter,
  agentName: AgentName
): Adapter & { runInteractive: (prompt: string, options: InteractiveRunOptions) => Promise<ModelResponse> } {
  return {
    ...adapter,

    /**
     * Run with automatic interactive mode detection
     */
    async run(prompt: string, options?: InteractiveRunOptions): Promise<ModelResponse> {
      // If interactive mode is explicitly requested, use interactive session
      if (options?.interactive) {
        return this.runInteractive(prompt, options);
      }

      // Otherwise use the base adapter
      return adapter.run(prompt, options);
    },

    /**
     * Run in interactive mode
     */
    async runInteractive(prompt: string, options: InteractiveRunOptions): Promise<ModelResponse> {
      const startTime = Date.now();

      const sessionConfig: InteractiveSessionConfig = {
        agent: agentName,
        initialPrompt: prompt,
        planContext: options.planContext || prompt,
        responderAgent: options.responderAgent || 'ollama',
        maxInteractions: options.maxInteractions || 50,
        sessionTimeout: options.sessionTimeout || 300000,
        model: options.model,
        onInteraction: options.onInteraction
          ? (p, r) => options.onInteraction!(p.text, r.response)
          : undefined,
        onOutput: options.onOutput,
      };

      try {
        const result = await runInteractiveSession(sessionConfig);

        return {
          content: result.output,
          model: `${agentName}/interactive`,
          duration: result.duration,
          error: result.error,
        };
      } catch (err) {
        return {
          content: '',
          model: `${agentName}/interactive`,
          duration: Date.now() - startTime,
          error: (err as Error).message,
        };
      }
    },
  };
}

/**
 * Run a prompt in interactive mode with a specific agent
 *
 * This is a convenience function for running interactive sessions
 * without needing to wrap an adapter.
 *
 * @param agent Agent to use
 * @param prompt Initial prompt
 * @param options Interactive run options
 * @returns Model response with the full conversation output
 */
export async function runInteractive(
  agent: AgentName,
  prompt: string,
  options: Omit<InteractiveRunOptions, 'interactive'> = {}
): Promise<ModelResponse> {
  const startTime = Date.now();

  const sessionConfig: InteractiveSessionConfig = {
    agent,
    initialPrompt: prompt,
    planContext: options.planContext || prompt,
    responderAgent: options.responderAgent || 'ollama',
    maxInteractions: options.maxInteractions || 50,
    sessionTimeout: options.sessionTimeout || 300000,
    model: options.model,
    onInteraction: options.onInteraction
      ? (p, r) => options.onInteraction!(p.text, r.response)
      : undefined,
    onOutput: options.onOutput,
  };

  try {
    const result = await runInteractiveSession(sessionConfig);

    return {
      content: result.output,
      model: `${agent}/interactive`,
      duration: result.duration,
      error: result.error,
    };
  } catch (err) {
    return {
      content: '',
      model: `${agent}/interactive`,
      duration: Date.now() - startTime,
      error: (err as Error).message,
    };
  }
}
