import { execa } from 'execa';
import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import { getConfig } from '../lib/config';

export const claudeAdapter: Adapter = {
  name: 'claude',

  async isAvailable(): Promise<boolean> {
    const config = getConfig();
    if (!config.adapters.claude.enabled) return false;

    try {
      await execa('which', [config.adapters.claude.path]);
      return true;
    } catch {
      return false;
    }
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();

    try {
      // claude -p "prompt" for non-interactive output
      // --tools "" disables all tools to prevent permission prompts
      const { stdout, stderr } = await execa(
        config.adapters.claude.path,
        ['-p', prompt, '--tools', ''],
        {
          timeout: config.timeout,
          cancelSignal: options?.signal,
          reject: false,
          stdin: 'ignore'
        }
      );

      if (stderr && !stdout) {
        return {
          content: '',
          model: 'claude',
          duration: Date.now() - startTime,
          error: stderr
        };
      }

      return {
        content: stdout || '',
        model: 'claude',
        duration: Date.now() - startTime
      };
    } catch (err: unknown) {
      const error = err as Error;
      return {
        content: '',
        model: 'claude',
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }
};
