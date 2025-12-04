import { execa } from 'execa';
import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import { getConfig } from '../lib/config';

export const codexAdapter: Adapter = {
  name: 'codex',

  async isAvailable(): Promise<boolean> {
    const config = getConfig();
    if (!config.adapters.codex.enabled) return false;

    try {
      await execa('which', [config.adapters.codex.path]);
      return true;
    } catch {
      return false;
    }
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();

    try {
      // codex exec for non-interactive mode
      // --skip-git-repo-check allows running outside git repos
      const { stdout, stderr } = await execa(
        config.adapters.codex.path,
        ['exec', '--skip-git-repo-check', prompt],
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
          model: 'codex',
          duration: Date.now() - startTime,
          error: stderr
        };
      }

      return {
        content: stdout || '',
        model: 'codex',
        duration: Date.now() - startTime
      };
    } catch (err: unknown) {
      const error = err as Error;
      return {
        content: '',
        model: 'codex',
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }
};
