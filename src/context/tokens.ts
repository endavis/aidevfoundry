/**
 * Token Management Layer
 *
 * Handles token estimation, limits, and truncation per adapter.
 */

import { getConfig } from '../lib/config';

export interface TokenConfig {
  maxTokens: number;
  reserveTokens: number;
  chunkSize: number;
}

// Known Ollama model context limits
const KNOWN_MODEL_LIMITS: Record<string, number> = {
  'llama3.2': 128000,
  'llama3.1': 128000,
  'llama3': 8000,
  'llama2': 4096,
  'mixtral': 32000,
  'mistral': 32000,
  'codellama': 16000,
  'gemma2': 8000,
  'gemma': 8000,
  'phi3': 128000,
  'phi4': 128000,
  'qwen2': 128000,
  'qwen2.5': 128000,
  'deepseek': 128000,
  'command-r': 128000,
};

const DEFAULT_OLLAMA_LIMIT = 8000;

// Base limits (ollama is dynamic)
const BASE_LIMITS: Record<string, TokenConfig> = {
  claude: { maxTokens: 100000, reserveTokens: 4000, chunkSize: 8000 },
  gemini: { maxTokens: 128000, reserveTokens: 4000, chunkSize: 8000 },
  codex:  { maxTokens: 32000,  reserveTokens: 2000, chunkSize: 4000 },
};

/**
 * Get Ollama token limit dynamically
 */
function getOllamaLimit(): number {
  const config = getConfig();

  // 1. User override wins
  if (config.adapters.ollama.maxTokens) {
    return config.adapters.ollama.maxTokens;
  }

  // 2. Check known models
  const model = config.adapters.ollama.model || 'llama3.2';
  const modelBase = model.split(':')[0].toLowerCase();

  if (KNOWN_MODEL_LIMITS[modelBase]) {
    return KNOWN_MODEL_LIMITS[modelBase];
  }

  // 3. Safe fallback
  return DEFAULT_OLLAMA_LIMIT;
}

/**
 * Get adapter limits (ollama is dynamic based on model)
 */
export function getAdapterLimits(): Record<string, TokenConfig> {
  const ollamaLimit = getOllamaLimit();
  return {
    ...BASE_LIMITS,
    ollama: {
      maxTokens: ollamaLimit,
      reserveTokens: Math.min(1000, Math.floor(ollamaLimit * 0.1)),
      chunkSize: Math.min(2000, Math.floor(ollamaLimit * 0.25))
    }
  };
}

// Legacy export for compatibility
export const ADAPTER_LIMITS = getAdapterLimits();

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function getTokenConfig(agent: string): TokenConfig {
  const limits = getAdapterLimits();
  return limits[agent] || limits.ollama;
}

export function getAvailableTokens(agent: string, usedTokens: number = 0): number {
  const config = getTokenConfig(agent);
  return config.maxTokens - config.reserveTokens - usedTokens;
}

export function fitsInContext(text: string, agent: string, usedTokens: number = 0): boolean {
  const tokens = estimateTokens(text);
  return tokens <= getAvailableTokens(agent, usedTokens);
}

export function truncateForAgent(text: string, agent: string, usedTokens: number = 0): string {
  const available = getAvailableTokens(agent, usedTokens);
  const maxChars = available * CHARS_PER_TOKEN;

  if (text.length <= maxChars) return text;

  let truncated = text.slice(0, maxChars);

  // Try paragraph boundary
  const lastParagraph = truncated.lastIndexOf('\n\n');
  if (lastParagraph > maxChars * 0.7) {
    truncated = truncated.slice(0, lastParagraph);
  } else {
    // Try sentence boundary
    const lastSentence = truncated.lastIndexOf('. ');
    if (lastSentence > maxChars * 0.8) {
      truncated = truncated.slice(0, lastSentence + 1);
    }
  }

  return truncated + '\n\n[...truncated]';
}

export function splitIntoChunks(text: string, agent: string): string[] {
  const config = getTokenConfig(agent);
  const chunkChars = config.chunkSize * CHARS_PER_TOKEN;

  if (text.length <= chunkChars) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= chunkChars) {
      chunks.push(remaining);
      break;
    }

    let breakPoint = chunkChars;
    const paragraphBreak = remaining.lastIndexOf('\n\n', chunkChars);
    if (paragraphBreak > chunkChars * 0.5) {
      breakPoint = paragraphBreak + 2;
    } else {
      const sentenceBreak = remaining.lastIndexOf('. ', chunkChars);
      if (sentenceBreak > chunkChars * 0.5) {
        breakPoint = sentenceBreak + 2;
      }
    }

    chunks.push(remaining.slice(0, breakPoint).trim());
    remaining = remaining.slice(breakPoint).trim();
  }

  return chunks;
}

export function getContextUsage(text: string, agent: string): {
  used: number;
  available: number;
  percentage: number
} {
  const tokens = estimateTokens(text);
  const config = getTokenConfig(agent);
  const available = config.maxTokens - config.reserveTokens;

  return {
    used: tokens,
    available,
    percentage: Math.round((tokens / available) * 100)
  };
}

export function isNearLimit(text: string, agent: string): boolean {
  return getContextUsage(text, agent).percentage >= 80;
}
