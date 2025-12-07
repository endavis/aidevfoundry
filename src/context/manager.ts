/**
 * Context Window Manager
 *
 * Intelligent context assembly per agent.
 * Decides what to include, drop, summarize, or compress.
 */

import { estimateTokens, getTokenConfig, truncateForAgent } from './tokens';
import { summarizeIfNeeded } from './summarizer';

export type ContextItemType = 'system' | 'history' | 'result' | 'code' | 'summary' | 'user';

export interface ContextItem {
  id: string;
  type: ContextItemType;
  content: string;
  tokens: number;
  priority: number;        // Higher = keep longer (1-10)
  source?: string;         // Which step/agent produced this
  timestamp: number;       // Unix timestamp for recency scoring
  metadata?: Record<string, string>;
}

export interface ContextConfig {
  agent: string;
  maxTokens?: number;      // Override adapter default
  includeHistory: boolean;
  includePreviousResults: boolean;
  summarizeThreshold: number;  // Auto-summarize above this token count
}

export interface AgentContextRules {
  prefersSummaries: boolean;
  maxHistoryItems: number;
  codeHandling: 'full' | 'truncate' | 'summarize';
  contextStyle: 'minimal' | 'balanced' | 'verbose';
}

// Agent-specific context rules
const AGENT_RULES: Record<string, AgentContextRules> = {
  claude: {
    prefersSummaries: false,
    maxHistoryItems: 20,
    codeHandling: 'full',
    contextStyle: 'verbose'
  },
  gemini: {
    prefersSummaries: false,
    maxHistoryItems: 30,
    codeHandling: 'full',
    contextStyle: 'balanced'
  },
  codex: {
    prefersSummaries: true,
    maxHistoryItems: 5,
    codeHandling: 'full',
    contextStyle: 'minimal'
  },
  ollama: {
    prefersSummaries: true,
    maxHistoryItems: 3,
    codeHandling: 'truncate',
    contextStyle: 'minimal'
  }
};

/**
 * Get agent-specific rules
 */
export function getAgentRules(agent: string): AgentContextRules {
  return AGENT_RULES[agent] || AGENT_RULES.ollama;
}

/**
 * Create a context item with auto token count
 */
export function createContextItem(
  type: ContextItemType,
  content: string,
  options: Partial<ContextItem> = {}
): ContextItem {
  return {
    id: options.id || `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    content,
    tokens: estimateTokens(content),
    priority: options.priority ?? getPriorityForType(type),
    source: options.source,
    timestamp: options.timestamp ?? Date.now(),
    metadata: options.metadata
  };
}

/**
 * Default priority by type
 */
function getPriorityForType(type: ContextItemType): number {
  switch (type) {
    case 'system': return 10;
    case 'user': return 9;
    case 'code': return 8;
    case 'result': return 6;
    case 'history': return 4;
    case 'summary': return 3;
    default: return 5;
  }
}

/**
 * Context Window Manager
 */
export class ContextWindowManager {
  private items: ContextItem[] = [];
  private config: ContextConfig;

  constructor(config: ContextConfig) {
    this.config = config;
  }

  /**
   * Add item to context
   */
  addItem(item: ContextItem): void {
    this.items.push(item);
  }

  /**
   * Add multiple items
   */
  addItems(items: ContextItem[]): void {
    this.items.push(...items);
  }

  /**
   * Get current token usage
   */
  getTokenUsage(): number {
    return this.items.reduce((sum, item) => sum + item.tokens, 0);
  }

  /**
   * Get available tokens for agent
   */
  getAvailableTokens(): number {
    const tokenConfig = getTokenConfig(this.config.agent);
    const max = this.config.maxTokens || (tokenConfig.maxTokens - tokenConfig.reserveTokens);
    return max - this.getTokenUsage();
  }

  /**
   * Build optimized context for agent
   */
  async buildContext(): Promise<string> {
    const rules = getAgentRules(this.config.agent);
    let workingItems = [...this.items];

    // Filter by config
    if (!this.config.includeHistory) {
      workingItems = workingItems.filter(i => i.type !== 'history');
    }
    if (!this.config.includePreviousResults) {
      workingItems = workingItems.filter(i => i.type !== 'result');
    }

    // Limit history items
    const historyItems = workingItems.filter(i => i.type === 'history');
    if (historyItems.length > rules.maxHistoryItems) {
      const keepHistory = historyItems.slice(-rules.maxHistoryItems);
      workingItems = workingItems.filter(i => i.type !== 'history').concat(keepHistory);
    }

    // Sort by priority (high first)
    workingItems.sort((a, b) => b.priority - a.priority);

    // Calculate total tokens
    let totalTokens = workingItems.reduce((sum, i) => sum + i.tokens, 0);
    const tokenConfig = getTokenConfig(this.config.agent);
    const maxTokens = this.config.maxTokens || (tokenConfig.maxTokens - tokenConfig.reserveTokens);

    // Compress if over limit
    if (totalTokens > maxTokens) {
      workingItems = await this.compressItems(workingItems, maxTokens, rules);
    }

    // Format for agent
    return this.formatContext(workingItems, rules);
  }

  /**
   * Compress items to fit limit
   */
  private async compressItems(
    items: ContextItem[],
    maxTokens: number,
    rules: AgentContextRules
  ): Promise<ContextItem[]> {
    const result: ContextItem[] = [];
    let usedTokens = 0;

    for (const item of items) {
      const remaining = maxTokens - usedTokens;

      if (remaining <= 0) break;

      if (item.tokens <= remaining) {
        // Fits as-is
        result.push(item);
        usedTokens += item.tokens;
      } else if (item.priority >= 8) {
        // High priority: truncate instead of drop
        const truncated = truncateForAgent(item.content, this.config.agent, usedTokens);
        const newItem = { ...item, content: truncated, tokens: estimateTokens(truncated) };
        result.push(newItem);
        usedTokens += newItem.tokens;
      } else if (item.tokens > this.config.summarizeThreshold && rules.prefersSummaries) {
        // Medium priority: summarize
        const summarized = await summarizeIfNeeded(item.content, remaining);
        const newItem = { ...item, content: summarized, tokens: estimateTokens(summarized), type: 'summary' as ContextItemType };
        result.push(newItem);
        usedTokens += newItem.tokens;
      }
      // Low priority items that don't fit are dropped
    }

    return result;
  }

  /**
   * Format context for agent
   */
  private formatContext(items: ContextItem[], rules: AgentContextRules): string {
    const sections: string[] = [];

    // Group by type
    const system = items.filter(i => i.type === 'system');
    const code = items.filter(i => i.type === 'code');
    const results = items.filter(i => i.type === 'result' || i.type === 'summary');
    const history = items.filter(i => i.type === 'history');
    const user = items.filter(i => i.type === 'user');

    // Build sections based on style
    if (rules.contextStyle === 'minimal') {
      // Minimal: just essentials
      if (system.length) sections.push(system.map(i => i.content).join('\n'));
      if (code.length) sections.push(code.map(i => i.content).join('\n'));
      if (user.length) sections.push(user.map(i => i.content).join('\n'));
    } else {
      // Balanced/Verbose: include all with labels
      if (system.length) {
        sections.push(system.map(i => i.content).join('\n'));
      }
      if (results.length) {
        sections.push('<previous_context>\n' + results.map(i => i.content).join('\n\n') + '\n</previous_context>');
      }
      if (code.length) {
        sections.push('<code_context>\n' + code.map(i => i.content).join('\n\n') + '\n</code_context>');
      }
      if (history.length && rules.contextStyle === 'verbose') {
        sections.push('<history>\n' + history.map(i => i.content).join('\n') + '\n</history>');
      }
      if (user.length) {
        sections.push('<current_task>\n' + user.map(i => i.content).join('\n') + '\n</current_task>');
      }
    }

    return sections.join('\n\n');
  }

  /**
   * Clear all items
   */
  clear(): void {
    this.items = [];
  }

  /**
   * Get items by type
   */
  getItemsByType(type: ContextItemType): ContextItem[] {
    return this.items.filter(i => i.type === type);
  }

  /**
   * Remove items by source
   */
  removeBySource(source: string): void {
    this.items = this.items.filter(i => i.source !== source);
  }
}

/**
 * Quick helper to build context for a single request
 */
export async function buildContextForAgent(
  agent: string,
  items: ContextItem[],
  options: Partial<ContextConfig> = {}
): Promise<string> {
  const config: ContextConfig = {
    agent,
    includeHistory: options.includeHistory ?? true,
    includePreviousResults: options.includePreviousResults ?? true,
    summarizeThreshold: options.summarizeThreshold ?? 2000,
    ...options
  };

  const manager = new ContextWindowManager(config);
  manager.addItems(items);
  return manager.buildContext();
}
