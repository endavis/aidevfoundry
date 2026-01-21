/**
 * OpenRouter Adapter
 *
 * Uses the OpenRouter API to access various models including
 * smaller, faster models like Gemini Flash, GPT-5-nano, etc.
 *
 * Default model: google/gemini-2.0-flash-lite-001 (fast, efficient)
 *
 * Fast model presets:
 *   - gemini-flash-lite: google/gemini-2.0-flash-lite-001
 *   - gemini-flash: google/gemini-2.0-flash-001
 *   - gpt-5-nano: openai/gpt-5-nano (when available)
 *   - gpt-4o-mini: openai/gpt-4o-mini
 *   - claude-haiku: anthropic/claude-3-5-haiku
 *   - devstral: mistralai/devstral-2505
 *   - llama-small: meta-llama/llama-3.2-3b-instruct
 */

import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import { getConfig } from '../lib/config';

// Fast model presets for quick access
export const FAST_MODELS = {
  'gemini-flash-lite': 'google/gemini-2.0-flash-lite-001',
  'gemini-flash': 'google/gemini-2.0-flash-001',
  'gpt-5-nano': 'openai/gpt-5-nano',  // Placeholder - use when available
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'claude-haiku': 'anthropic/claude-3-5-haiku',
  'devstral': 'mistralai/devstral-2505',
  'llama-small': 'meta-llama/llama-3.2-3b-instruct',
} as const;

// Default model for evaluation/utility tasks (fast and cheap)
const DEFAULT_MODEL = FAST_MODELS['gemini-flash-lite'];

export interface OpenRouterConfig {
  enabled: boolean;
  apiKey?: string;  // Can also use OPENROUTER_API_KEY env var
  model?: string;   // Can be a preset name or full model ID
  baseUrl?: string;
}

// Resolve model preset to full model ID
function resolveModel(model: string): string {
  return FAST_MODELS[model as keyof typeof FAST_MODELS] || model;
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
    const rawModel = options?.model ?? orConfig?.model ?? DEFAULT_MODEL;
    const model = resolveModel(rawModel); // Resolve preset names to full IDs
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
 * Model can be a preset name (e.g., 'gemini-flash-lite') or full ID.
 */
export async function runOpenRouter(
  prompt: string,
  model: string = 'gemini-flash-lite'
): Promise<{ content: string; error?: string; duration?: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const startTime = Date.now();
  const resolvedModel = resolveModel(model);

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
        model: resolvedModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      return { content: '', error: `API error: ${response.status}`, duration: Date.now() - startTime };
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return {
      content: data.choices?.[0]?.message?.content || '',
      duration: Date.now() - startTime
    };
  } catch (err) {
    return { content: '', error: (err as Error).message, duration: Date.now() - startTime };
  }
}

/**
 * Streaming version for real-time updates.
 * Calls onChunk with each token as it arrives.
 */
export async function runOpenRouterStream(
  prompt: string,
  model: string = 'gemini-flash-lite',
  onChunk?: (chunk: string) => void
): Promise<{ content: string; error?: string; duration?: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const startTime = Date.now();
  const resolvedModel = resolveModel(model);

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
        model: resolvedModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 4096,
        stream: true,
      }),
    });

    if (!response.ok) {
      return { content: '', error: `API error: ${response.status}`, duration: Date.now() - startTime };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return { content: '', error: 'No response body', duration: Date.now() - startTime };
    }

    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6); // Remove 'data: ' prefix
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const content = parsed.choices?.[0]?.delta?.content || '';
          if (content) {
            fullContent += content;
            onChunk?.(content);
          }
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }

    return { content: fullContent, duration: Date.now() - startTime };
  } catch (err) {
    return { content: '', error: (err as Error).message, duration: Date.now() - startTime };
  }
}

/**
 * Get list of available fast model presets
 */
export function listFastModels(): Array<{ name: string; model: string }> {
  return Object.entries(FAST_MODELS).map(([name, model]) => ({ name, model }));
}
