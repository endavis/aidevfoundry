/**
 * Chat Orchestrator (Phase 13)
 *
 * Replaces direct orchestrate() calls with intelligent context assembly:
 * - History from session (sqlite-sessions)
 * - Memory injection (decisions, patterns, past conversations)
 * - Code context (Phase 12 indexing)
 * - Auto-summarization for long histories
 * - Scaffolding for very large contexts
 */

import type { ModelResponse, RunOptions } from '../lib/types';
import type { AgentSession, Message } from '../memory/sqlite-sessions';
import { adapters } from '../adapters';
import { addMessage } from '../memory/sqlite-sessions';
import { buildInjectionForAgent } from '../memory/injector';
import { addMemory } from '../memory/vector-store';
import { searchCode } from '../indexing/searcher';
import {
  ContextWindowManager,
  createContextItem,
  getAgentRules,
  type ContextItem
} from '../context/manager';
import { estimateTokens, getTokenConfig } from '../context/tokens';
import { summarizeIfNeeded, isSummarizerAvailable } from '../context/summarizer';
import { scaffoldIfNeeded } from '../context/scaffolding';

export interface ChatOptions extends RunOptions {
  /** Max messages to load from history */
  maxHistoryMessages?: number;
  /** Include memory context (decisions, patterns) */
  includeMemory?: boolean;
  /** Token budget for memory injection */
  memoryTokenBudget?: number;
  /** Summarize messages older than this count */
  summarizeAfter?: number;
  /** Auto-save to session after response */
  autoSave?: boolean;
  /** Include relevant code from index */
  includeCodeContext?: boolean;
  /** Max code results */
  maxCodeResults?: number;
}

export interface ChatResult {
  response: ModelResponse;
  context: ContextStats;
}

export interface ContextStats {
  historyTokens: number;
  memoryTokens: number;
  codeTokens: number;
  totalTokens: number;
  messagesSummarized: number;
  scaffolded: boolean;
  budgetUsed: number;
}

interface ProcessedHistory {
  items: ContextItem[];
  tokens: number;
  summarizedCount: number;
  scaffolded: boolean;
}

/**
 * Chat with context assembly
 *
 * Wires together all context infrastructure:
 * 1. Load session history
 * 2. Process history (summarize old, scaffold if huge)
 * 3. Retrieve relevant memory
 * 4. Retrieve code context (optional)
 * 5. Build context with ContextWindowManager
 * 6. Execute via adapter
 * 7. Save to session & memory (if autoSave)
 */
export async function chat(
  message: string,
  session: AgentSession,
  options: ChatOptions = {}
): Promise<ChatResult> {
  const agent = session.agent;
  const rules = getAgentRules(agent);
  const tokenConfig = getTokenConfig(agent);

  const {
    maxHistoryMessages = rules.maxHistoryItems,
    includeMemory = true,
    memoryTokenBudget = 1000,
    summarizeAfter = 6,
    autoSave = false,
    includeCodeContext = false,
    maxCodeResults = 5,
    ...runOptions
  } = options;

  // Calculate available budget
  const totalBudget = tokenConfig.maxTokens - tokenConfig.reserveTokens;
  const messageTokens = estimateTokens(message);
  let remainingBudget = totalBudget - messageTokens;

  const stats: ContextStats = {
    historyTokens: 0,
    memoryTokens: 0,
    codeTokens: 0,
    totalTokens: 0,
    messagesSummarized: 0,
    scaffolded: false,
    budgetUsed: 0
  };

  // ─────────────────────────────────────────────────────────────
  // 1. Load & Process History
  // ─────────────────────────────────────────────────────────────

  const historyResult = await processHistory(
    session.messages.slice(-maxHistoryMessages),
    agent,
    Math.floor(remainingBudget * 0.5),
    summarizeAfter,
    session.summary
  );

  stats.historyTokens = historyResult.tokens;
  stats.messagesSummarized = historyResult.summarizedCount;
  stats.scaffolded = historyResult.scaffolded;
  remainingBudget -= historyResult.tokens;

  // ─────────────────────────────────────────────────────────────
  // 2. Retrieve Relevant Memory
  // ─────────────────────────────────────────────────────────────

  let memoryContent = '';
  if (includeMemory && remainingBudget > memoryTokenBudget) {
    try {
      const injection = await buildInjectionForAgent(message, agent, {
        maxTokens: Math.min(memoryTokenBudget, Math.floor(remainingBudget * 0.3)),
        includeConversation: true,
        includeCode: true,
        includeDecisions: true,
        includePatterns: true
      });

      if (injection.itemCount > 0) {
        memoryContent = injection.content;
        stats.memoryTokens = injection.tokens;
        remainingBudget -= injection.tokens;
      }
    } catch {
      // Memory retrieval failed, continue without it
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Retrieve Code Context (Phase 12 integration)
  // ─────────────────────────────────────────────────────────────

  let codeContent = '';
  if (includeCodeContext && remainingBudget > 2000) {
    try {
      const codeResults = await searchCode(message, process.cwd(), {
        limit: maxCodeResults,
        includeContent: true,
        maxContentSize: Math.floor(remainingBudget * 0.3)
      });

      if (codeResults.length > 0) {
        codeContent = formatCodeContext(codeResults);
        stats.codeTokens = estimateTokens(codeContent);
        remainingBudget -= stats.codeTokens;
      }
    } catch {
      // Code search failed, continue without it
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 4. Build Context with ContextWindowManager
  // ─────────────────────────────────────────────────────────────

  const cwm = new ContextWindowManager({
    agent,
    maxTokens: totalBudget,
    includeHistory: true,
    includePreviousResults: true,
    summarizeThreshold: 2000
  });

  // Add items in priority order
  if (memoryContent) {
    cwm.addItem(createContextItem('summary', memoryContent, {
      priority: 7,
      source: 'memory'
    }));
  }

  if (codeContent) {
    cwm.addItem(createContextItem('code', codeContent, {
      priority: 8,
      source: 'indexed-code'
    }));
  }

  for (const item of historyResult.items) {
    cwm.addItem(item);
  }

  cwm.addItem(createContextItem('user', message, {
    priority: 10,
    source: 'current'
  }));

  // Build final context
  const assembledPrompt = await cwm.buildContext();
  stats.totalTokens = estimateTokens(assembledPrompt);
  stats.budgetUsed = Math.round((stats.totalTokens / totalBudget) * 100);

  // ─────────────────────────────────────────────────────────────
  // 5. Execute via Adapter
  // ─────────────────────────────────────────────────────────────

  const adapter = adapters[agent];
  if (!adapter) {
    return {
      response: { content: '', model: agent, error: `Unknown agent: ${agent}` },
      context: stats
    };
  }

  const response = await adapter.run(assembledPrompt, runOptions);

  // ─────────────────────────────────────────────────────────────
  // 6. Save to Session & Memory
  // ─────────────────────────────────────────────────────────────

  if (autoSave && response.content) {
    await addMessage(session, 'user', message);
    await addMessage(session, 'assistant', response.content);

    await addMemory({
      type: 'conversation',
      content: `User: ${message}\nAssistant: ${response.content}`,
      metadata: { agent, sessionId: session.id }
    });
  }

  return { response, context: stats };
}

/**
 * Process conversation history
 * - Recent messages: verbatim
 * - Older messages: summarize
 * - Very long history: scaffold
 */
async function processHistory(
  messages: Message[],
  _agent: string,
  tokenBudget: number,
  summarizeAfter: number,
  existingSummary?: string
): Promise<ProcessedHistory> {
  const items: ContextItem[] = [];
  let totalTokens = 0;
  let summarizedCount = 0;
  let scaffolded = false;

  // Add existing summary if present
  if (existingSummary) {
    const summaryTokens = estimateTokens(existingSummary);
    if (summaryTokens < tokenBudget * 0.2) {
      items.push(createContextItem('summary', `[Previous conversation summary]\n${existingSummary}`, {
        priority: 3,
        source: 'session-summary'
      }));
      totalTokens += summaryTokens;
    }
  }

  // Split into recent (verbatim) and older (summarize/scaffold)
  const recent = messages.slice(-summarizeAfter);
  const older = messages.slice(0, -summarizeAfter);

  // Process older messages
  if (older.length > 0) {
    const olderText = older
      .map(m => `${m.role}: ${m.content}`)
      .join('\n\n');

    const olderTokens = estimateTokens(olderText);
    const summaryBudget = Math.floor(tokenBudget * 0.3);

    // Scaffold very large histories (>15k tokens)
    if (olderTokens > 15000) {
      const scaffold = await scaffoldIfNeeded(olderText, summaryBudget);
      if (scaffold) {
        items.push(createContextItem('summary',
          `[Conversation history - ${older.length} messages]\n${scaffold.summary}`, {
            priority: 3,
            source: 'history-scaffold'
          }));
        totalTokens += estimateTokens(scaffold.summary);
        summarizedCount = older.length;
        scaffolded = true;
      }
    }

    // Otherwise try summarization (5k-15k tokens)
    if (!scaffolded && olderTokens > 2000 && await isSummarizerAvailable()) {
      try {
        const summary = await summarizeIfNeeded(olderText, summaryBudget);
        items.push(createContextItem('summary',
          `[Previous conversation - ${older.length} messages]\n${summary}`, {
            priority: 3,
            source: 'history-summary'
          }));
        totalTokens += estimateTokens(summary);
        summarizedCount = older.length;
      } catch {
        // Summarization failed, add truncated version
        const truncated = olderText.slice(0, summaryBudget * 4);
        items.push(createContextItem('summary',
          `[Previous conversation - ${older.length} messages, truncated]\n${truncated}`, {
            priority: 3,
            source: 'history-truncated'
          }));
        totalTokens += estimateTokens(truncated);
      }
    }
  }

  // Add recent messages verbatim
  for (const msg of recent) {
    const prefix = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
    const content = `${prefix}: ${msg.content}`;
    const tokens = estimateTokens(content);

    if (totalTokens + tokens > tokenBudget) break;

    items.push(createContextItem('history', content, {
      priority: msg.role === 'user' ? 5 : 4,
      source: 'history-recent'
    }));

    totalTokens += tokens;
  }

  return { items, tokens: totalTokens, summarizedCount, scaffolded };
}

/**
 * Format code search results for context
 */
function formatCodeContext(results: Array<{
  path: string;
  content?: string;
  matchReason: string;
  matchedSymbols?: string[];
}>): string {
  const lines: string[] = ['<relevant_code>'];

  for (const result of results) {
    lines.push(`\n## ${result.path}`);
    if (result.matchedSymbols && result.matchedSymbols.length > 0) {
      lines.push(`Matched: ${result.matchedSymbols.join(', ')}`);
    }
    lines.push(`(${result.matchReason})`);

    if (result.content) {
      lines.push('```');
      lines.push(result.content);
      lines.push('```');
    }
  }

  lines.push('\n</relevant_code>');
  return lines.join('\n');
}

/**
 * Quick chat without session (for simple one-offs)
 */
export async function quickChat(
  message: string,
  agent: string,
  options: Omit<ChatOptions, 'maxHistoryMessages' | 'autoSave'> = {}
): Promise<ModelResponse> {
  const adapter = adapters[agent];
  if (!adapter) {
    return { content: '', model: agent, error: `Unknown agent: ${agent}` };
  }

  // Build minimal context with memory if requested
  let prompt = message;

  if (options.includeMemory !== false) {
    try {
      const injection = await buildInjectionForAgent(message, agent, {
        maxTokens: options.memoryTokenBudget || 500,
        includeDecisions: true,
        includePatterns: true
      });

      if (injection.itemCount > 0) {
        prompt = `${injection.content}\n\n${message}`;
      }
    } catch {
      // Continue without memory
    }
  }

  return adapter.run(prompt, options);
}

