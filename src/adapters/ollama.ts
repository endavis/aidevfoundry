import { Ollama } from 'ollama';
import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import { getConfig } from '../lib/config';

let ollamaClient: Ollama | null = null;

function getOllama(): Ollama {
  if (!ollamaClient) {
    const config = getConfig();
    ollamaClient = new Ollama({ host: config.adapters.ollama.host });
  }
  return ollamaClient;
}

export const ollamaAdapter: Adapter = {
  name: 'ollama',

  async isAvailable(): Promise<boolean> {
    const config = getConfig();
    if (!config.adapters.ollama.enabled) return false;

    try {
      const ollama = getOllama();
      await ollama.list();
      return true;
    } catch {
      return false;
    }
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();
    // Note: Ollama is a pure LLM API with no native tools, so disableTools is a no-op

    try {
      const ollama = getOllama();

      if (options?.onChunk) {
        let content = '';
        const response = await ollama.chat({
          model: config.adapters.ollama.model,
          messages: [{ role: 'user', content: prompt }],
          stream: true
        });

        for await (const chunk of response) {
          if (options.signal?.aborted) break;
          content += chunk.message.content;
          options.onChunk(chunk.message.content);
        }

        return {
          content,
          model: `ollama/${config.adapters.ollama.model}`,
          duration: Date.now() - startTime
        };
      }

      const response = await ollama.chat({
        model: config.adapters.ollama.model,
        messages: [{ role: 'user', content: prompt }]
      });

      return {
        content: response.message.content,
        model: `ollama/${config.adapters.ollama.model}`,
        duration: Date.now() - startTime,
        tokens: {
          input: response.prompt_eval_count || 0,
          output: response.eval_count || 0
        }
      };
    } catch (err: unknown) {
      const error = err as Error;
      return {
        content: '',
        model: `ollama/${config.adapters.ollama.model}`,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }
};
