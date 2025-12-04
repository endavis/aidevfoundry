import { execa } from 'execa';
import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import { getConfig } from '../lib/config';

export const geminiAdapter: Adapter = {
  name: 'gemini',

  async isAvailable(): Promise<boolean> {
    const config = getConfig();
    if (!config.adapters.gemini.enabled) return false;

    try {
      await execa('which', [config.adapters.gemini.path]);
      return true;
    } catch {
      return false;
    }
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();

    try {
      // Gemini CLI - adjust flags based on actual CLI syntax
      const { stdout, stderr } = await execa(
        config.adapters.gemini.path,
        [prompt],
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
          model: 'gemini',
          duration: Date.now() - startTime,
          error: stderr
        };
      }

      return {
        content: stdout || '',
        model: 'gemini',
        duration: Date.now() - startTime
      };
    } catch (err: unknown) {
      const error = err as Error;
      return {
        content: '',
        model: 'gemini',
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }
};
