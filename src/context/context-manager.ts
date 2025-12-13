/**
 * Context Window Manager
 *
 * Handles preparing conversation history for different agents with
 * varying context window sizes. Automatically compacts/summarizes
 * when switching to smaller context models.
 */

import type { UnifiedMessage } from './unified-message';
import {
  getContextLimit,
  estimateMessageTokens,
  calculateConversationTokens,
  getTextContent,
} from './unified-message';
import { translateForAgent } from './provider-translator';
import { summarizeIfNeeded, isSummarizerAvailable } from './summarizer';

/**
 * Context preparation options
 */
export interface ContextOptions {
  // Target agent
  agent: string;
  // Specific model (for variable context sizes like ollama)
  model?: string;
  // System prompt to prepend
  systemPrompt?: string;
  // Reserve tokens for response
  reserveForResponse?: number;
  // Minimum messages to always keep (most recent)
  minRecentMessages?: number;
}

const DEFAULT_OPTIONS: Required<Omit<ContextOptions, 'agent' | 'model' | 'systemPrompt'>> = {
  reserveForResponse: 4000,
  minRecentMessages: 4,
};

/**
 * Result of context preparation
 */
export interface PreparedContext {
  // Translated messages ready for the provider
  messages: unknown[];
  // Tokens used (before translation, estimate)
  tokensUsed: number;
  // Context limit for target agent
  contextLimit: number;
  // Whether compaction was needed
  wasCompacted: boolean;
  // Summary generated (if compaction happened)
  summary?: string;
}

/**
 * Prepare context for a specific agent
 *
 * Handles:
 * 1. Calculating token usage
 * 2. Compacting if exceeds agent's context limit
 * 3. Translating to provider format
 */
export async function prepareContextForAgent(
  messages: UnifiedMessage[],
  options: ContextOptions
): Promise<PreparedContext> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const contextLimit = getContextLimit(opts.agent, opts.model);
  const availableTokens = contextLimit - opts.reserveForResponse;

  // Calculate system prompt tokens
  const systemTokens = opts.systemPrompt
    ? Math.ceil(opts.systemPrompt.length / 4)
    : 0;

  const tokensForMessages = availableTokens - systemTokens;
  const currentTokens = calculateConversationTokens(messages);

  let finalMessages = messages;
  let wasCompacted = false;
  let summary: string | undefined;

  // Check if we need to compact
  if (currentTokens > tokensForMessages) {
    const result = await compactMessages(
      messages,
      tokensForMessages,
      opts.minRecentMessages
    );
    finalMessages = result.messages;
    wasCompacted = true;
    summary = result.summary;
  }

  // Translate to provider format
  const translatedMessages = translateForAgent(
    finalMessages,
    opts.agent,
    opts.systemPrompt
  );

  return {
    messages: translatedMessages,
    tokensUsed: calculateConversationTokens(finalMessages) + systemTokens,
    contextLimit,
    wasCompacted,
    summary,
  };
}

/**
 * Compact messages to fit within token limit
 */
async function compactMessages(
  messages: UnifiedMessage[],
  tokenLimit: number,
  minRecentMessages: number
): Promise<{ messages: UnifiedMessage[]; summary: string }> {
  // Always keep the most recent messages
  const recentMessages = messages.slice(-minRecentMessages);
  const recentTokens = calculateConversationTokens(recentMessages);

  // If even recent messages exceed limit, just truncate
  if (recentTokens >= tokenLimit) {
    return {
      messages: recentMessages,
      summary: '',
    };
  }

  const tokensForSummary = tokenLimit - recentTokens;
  const oldMessages = messages.slice(0, -minRecentMessages);

  // Build text from old messages
  const oldText = oldMessages
    .map(m => `${m.role}: ${getTextContent(m)}`)
    .join('\n\n');

  // Summarize if we have a summarizer
  let summary: string;
  if (await isSummarizerAvailable()) {
    try {
      summary = await summarizeIfNeeded(oldText, tokensForSummary);
    } catch {
      // Fallback to truncation
      summary = truncateText(oldText, tokensForSummary);
    }
  } else {
    summary = truncateText(oldText, tokensForSummary);
  }

  // Create summary message
  const summaryMessage: UnifiedMessage = {
    sessionId: messages[0]?.sessionId ?? '',
    role: 'system',
    content: [{
      type: 'text',
      content: `<conversation_summary>\n${summary}\n</conversation_summary>`,
    }],
    timestamp: Date.now(),
  };

  return {
    messages: [summaryMessage, ...recentMessages],
    summary,
  };
}

/**
 * Simple text truncation (fallback when summarizer unavailable)
 */
function truncateText(text: string, targetTokens: number): string {
  const targetChars = targetTokens * 4;
  if (text.length <= targetChars) return text;

  // Take from end (most recent context is most relevant)
  return '...' + text.slice(-targetChars);
}

/**
 * Check if messages will fit in agent's context
 */
export function willFitInContext(
  messages: UnifiedMessage[],
  agent: string,
  model?: string,
  systemPrompt?: string
): { fits: boolean; tokensNeeded: number; contextLimit: number } {
  const contextLimit = getContextLimit(agent, model);
  const systemTokens = systemPrompt ? Math.ceil(systemPrompt.length / 4) : 0;
  const messageTokens = calculateConversationTokens(messages);
  const tokensNeeded = messageTokens + systemTokens;

  return {
    fits: tokensNeeded <= contextLimit - 4000, // Reserve for response
    tokensNeeded,
    contextLimit,
  };
}

/**
 * Get context usage percentage for a conversation
 */
export function getConversationContextUsage(
  messages: UnifiedMessage[],
  agent: string,
  model?: string
): { used: number; limit: number; percentage: number } {
  const limit = getContextLimit(agent, model);
  const used = calculateConversationTokens(messages);

  return {
    used,
    limit,
    percentage: Math.round((used / limit) * 100),
  };
}

/**
 * Estimate how many more messages can fit
 */
export function estimateRemainingCapacity(
  messages: UnifiedMessage[],
  agent: string,
  model?: string,
  avgMessageTokens: number = 500
): number {
  const { used, limit } = getConversationContextUsage(messages, agent, model);
  const remaining = limit - used - 4000; // Reserve for response
  return Math.max(0, Math.floor(remaining / avgMessageTokens));
}

/**
 * Find the optimal split point for compaction
 * (preserves complete conversation turns)
 */
export function findCompactionSplitPoint(
  messages: UnifiedMessage[],
  targetRecentTokens: number
): number {
  let tokenCount = 0;
  let splitIndex = messages.length;

  // Walk backwards until we exceed target
  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateMessageTokens(messages[i]);
    if (tokenCount + msgTokens > targetRecentTokens) {
      // Found split point - but adjust to keep complete turns
      // (assistant response should stay with its user prompt)
      if (i > 0 && messages[i].role === 'assistant' && messages[i - 1]?.role === 'user') {
        splitIndex = i - 1;
      } else {
        splitIndex = i;
      }
      break;
    }
    tokenCount += msgTokens;
  }

  return Math.max(0, splitIndex);
}
