import { execa } from 'execa';
import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import { getConfig } from '../lib/config';

export const codexAdapter: Adapter = {
  name: 'codex',

  async isAvailable(): Promise<boolean> {
    const config = getConfig();
    if (!config.adapters.codex.enabled) return false;

    try {
      const command = process.platform === 'win32' ? 'where' : 'which';
      await execa(command, [config.adapters.codex.path]);
      return true;
    } catch {
      return false;
    }
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();
    const model = options?.model ?? config.adapters.codex.model;

    try {
      // codex exec for non-interactive mode
      // --skip-git-repo-check allows running outside git repos
      // --json for JSONL output with token usage
      // -m for model selection
      const args = ['exec', '--skip-git-repo-check', '--json'];

      // For agentic mode: use workspace-write so Codex is willing to use tools
      // PuzldAI's tool system will control what actually gets executed
      // For non-agentic mode: allow native Codex tools to work
      args.push('--sandbox', 'workspace-write');

      if (model) {
        args.push('-m', model);
      }
      args.push(prompt);

      const { stdout, stderr } = await execa(
        config.adapters.codex.path,
        args,
        {
          timeout: config.timeout,
          cancelSignal: options?.signal,
          reject: false,
          stdin: 'ignore'
        }
      );

      const modelName = model ? `codex/${model}` : 'codex';

      if (stderr && !stdout) {
        return {
          content: '',
          model: modelName,
          duration: Date.now() - startTime,
          error: stderr
        };
      }

      // Parse JSONL output - each line is a separate JSON object
      try {
        const lines = stdout.trim().split('\n');
        const contentParts: string[] = [];
        let inputTokens = 0;
        let outputTokens = 0;

        for (const line of lines) {
          try {
            const json = JSON.parse(line);

            // Extract agent message content (accumulate all parts)
            if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
              const text = json.item.text;
              if (text) {
                contentParts.push(text);
              }
            }

            // Extract token usage from turn.completed (accumulate all turns)
            if (json.type === 'turn.completed' && json.usage) {
              inputTokens += json.usage.input_tokens || 0;
              outputTokens += json.usage.output_tokens || 0;
            }
          } catch (lineErr) {
            // Skip malformed JSON lines but continue parsing
            if (config.logLevel === 'debug') {
              console.warn(`[codex] Failed to parse JSONL line: ${(lineErr as Error).message}`);
            }
          }
        }

        // Join all content parts
        const content = contentParts.join('\n');

        return {
          content,
          model: modelName,
          duration: Date.now() - startTime,
          tokens: (inputTokens || outputTokens) ? {
            input: inputTokens,
            output: outputTokens
          } : undefined
        };
      } catch {
        // Fallback if JSONL parsing completely fails
        return {
          content: stdout || '',
          model: modelName,
          duration: Date.now() - startTime
        };
      }
    } catch (err: unknown) {
      const error = err as Error;
      const modelName = model ? `codex/${model}` : 'codex';
      return {
        content: '',
        model: modelName,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }
};
