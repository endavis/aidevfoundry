import { execa } from 'execa';
import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import { getConfig } from '../lib/config';

/**
 * Charm Crush CLI adapter
 * Integrates with Charm's Crush terminal-based AI coding agent
 */

export const crushAdapter: Adapter = {
  name: 'crush',

  async isAvailable(): Promise<boolean> {
    const config = getConfig();
    if (!config.adapters.crush?.enabled) return false;

    try {
      // Check if crush CLI is available
      await execa('which', [config.adapters.crush.path || 'crush']);
      return true;
    } catch {
      return false;
    }
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();
    const model = options?.model ?? config.adapters.crush?.model;

    try {
      const args: string[] = [];

      // Add model selection if specified
      if (model) {
        args.push('--model', model);
      }

      // Crush supports non-interactive mode via stdin
      args.push('--non-interactive');

      // Add the prompt
      args.push(prompt);

      const { stdout, stderr } = await execa(
        config.adapters.crush?.path || 'crush',
        args,
        {
          timeout: config.timeout,
          cancelSignal: options?.signal,
          reject: false,
          stdin: 'ignore'
        }
      );

      const modelName = model ? `crush/${model}` : 'crush';

      if (stderr && !stdout) {
        return {
          content: '',
          model: modelName,
          duration: Date.now() - startTime,
          error: stderr
        };
      }

      // Crush outputs plain text responses
      return {
        content: stdout || '',
        model: modelName,
        duration: Date.now() - startTime
      };

    } catch (err: unknown) {
      const error = err as Error;
      const modelName = model ? `crush/${model}` : 'crush';
      return {
        content: '',
        model: modelName,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }
};
