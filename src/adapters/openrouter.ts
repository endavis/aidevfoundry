/**
 * OpenRouter Adapter
 *
 * Uses the OpenRouter API to access various models including
 * smaller, faster models like Devstral for evaluation tasks.
 *
 * Default model: mistralai/devstral-2505 (fast, efficient coding model)
 */

import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import { getConfig } from '../lib/config';

// Default model for evaluation/utility tasks
const DEFAULT_MODEL = 'mistralai/devstral-2505';

export interface OpenRouterConfig {
  enabled: boolean;
  apiKey?: string;  // Can also use OPENROUTER_API_KEY env var
  model?: string;
  baseUrl?: string;
}

export const openrouterAdapter: Adapter = {
  name: 'openrouter',

  async isAvailable(): Promise<boolean> {
    const config = getConfig();
    const orConfig = (config.adapters as any).openrouter as OpenRouterConfig | undefined;

    if (!orConfig?.enabled) return false;

    // Check for API key in config or environment
    const apiKey = orConfig.apiKey || process.env.OPENROUTER_API_KEY;
    return !!apiKey;
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();
    const orConfig = (config.adapters as any).openrouter as OpenRouterConfig | undefined;

    const apiKey = orConfig?.apiKey || process.env.OPENROUTER_API_KEY;
    const model = options?.model ?? orConfig?.model ?? DEFAULT_MODEL;
    const baseUrl = orConfig?.baseUrl || 'https://openrouter.ai/api/v1';

    if (!apiKey) {
      return {
        content: '',
        model: model,
        duration: Date.now() - startTime,
        error: 'OpenRouter API key not configured. Set OPENROUTER_API_KEY env var or add to config.'
      };
    }

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://puzld.ai',
          'X-Title': 'PuzldAI'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 4096,
        }),
        signal: options?.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: '',
          model,
          duration: Date.now() - startTime,
          error: `OpenRouter API error: ${response.status} - ${errorText}`
        };
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string };
      };

      if (data.error) {
        return {
          content: '',
          model,
          duration: Date.now() - startTime,
          error: data.error.message || 'Unknown OpenRouter error'
        };
      }

      const content = data.choices?.[0]?.message?.content || '';
      const usage = data.usage;

      return {
        content,
        model: `openrouter/${model}`,
        duration: Date.now() - startTime,
        tokens: usage ? {
          input: usage.prompt_tokens || 0,
          output: usage.completion_tokens || 0
        } : undefined
      };

    } catch (err: unknown) {
      const error = err as Error;
      return {
        content: '',
        model,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }
};

/**
 * Quick utility function to run a prompt via OpenRouter
 * without needing the full adapter interface.
 *
 * Used internally for evaluation and lightweight LLM calls.
 */
export async function runOpenRouter(
  prompt: string,
  model: string = DEFAULT_MODEL
): Promise<{ content: string; error?: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return { content: '', error: 'OPENROUTER_API_KEY not set' };
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://puzld.ai',
        'X-Title': 'PuzldAI'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      return { content: '', error: `API error: ${response.status}` };
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return { content: data.choices?.[0]?.message?.content || '' };
  } catch (err) {
    return { content: '', error: (err as Error).message };
  }
}
