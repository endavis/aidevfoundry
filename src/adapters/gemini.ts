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
    const model = options?.model ?? config.adapters.gemini.model;

    try {
      // Gemini CLI uses -m for model selection
      const args: string[] = [];
      if (model) {
        args.push('-m', model);
      }
      args.push(prompt);

      const { stdout, stderr } = await execa(
        config.adapters.gemini.path,
        args,
        {
          timeout: config.timeout,
          cancelSignal: options?.signal,
          reject: false,
          stdin: 'ignore'
        }
      );

      const modelName = model ? `gemini/${model}` : 'gemini';

      if (stderr && !stdout) {
        return {
          content: '',
          model: modelName,
          duration: Date.now() - startTime,
          error: stderr
        };
      }

      return {
        content: stdout || '',
        model: modelName,
        duration: Date.now() - startTime
      };
    } catch (err: unknown) {
      const error = err as Error;
      const modelName = model ? `gemini/${model}` : 'gemini';
      return {
        content: '',
        model: modelName,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }
};
