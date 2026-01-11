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
      const command = process.platform === 'win32' ? 'where' : 'which';
      await execa(command, [config.adapters.crush.path || 'crush']);
      return true;
    } catch {
      return false;
    }
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();
    const crushConfig = config.adapters.crush;
    const model = options?.model ?? crushConfig?.model;

    try {
      // Crush doesn't have a 'run' subcommand - pass prompt directly
      // For non-interactive execution, use: crush [flags] "prompt"
      const args: string[] = [];

      // Add working directory if specified
      if (crushConfig?.cwd) {
        args.push('--cwd', crushConfig.cwd);
      }

      // Enable auto-accept (yolo mode) if configured
      if (crushConfig?.autoAccept) {
        args.push('--yolo');
      }

      // Enable debug mode if configured
      if (crushConfig?.debug) {
        args.push('--debug');
      }

      // Add model selection if specified
      if (model) {
        args.push('--model', model);
      }

      // Add the prompt (must be last)
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
