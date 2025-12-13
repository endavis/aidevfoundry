/**
 * Compare Orchestrator (Phase 13)
 *
 * Wraps compare execution with:
 * - Preference tracking via signal detection
 * - Memory storage for comparisons
 * - Historical preference retrieval
 */

import type { AgentName, ExecutionResult } from '../executor';
import { buildComparePlan, execute } from '../executor';
import { addMemory } from '../memory/vector-store';
import { retrieve } from '../memory/retriever';
import { detectContinuedWith, detectExplicitPreference, type SignalResult, type AgentOutput } from '../memory/signals';

export interface CompareOptions {
  agents: AgentName[];
  sequential?: boolean;
  includeHistory?: boolean;
}

export interface CompareResult {
  execution: ExecutionResult;
  pastPreferences?: Array<{ agent: string; count: number }>;
}

// Module-level state for preference detection
let lastCompareOutputs: AgentOutput[] = [];
let lastCompareQuery: string = '';
let lastCompareAgents: string[] = [];

/**
 * Run a comparison between agents
 */
export async function compare(
  query: string,
  options: CompareOptions
): Promise<CompareResult> {
  const { agents, sequential = false, includeHistory = true } = options;

  // 1. Retrieve past preferences (for context)
  let pastPreferences: Array<{ agent: string; count: number }> = [];
  if (includeHistory) {
    const prefs = await getAgentPreferences();
    pastPreferences = Object.entries(prefs)
      .map(([agent, count]) => ({ agent, count }))
      .sort((a, b) => b.count - a.count);
  }

  // 2. Build & execute plan
  const plan = buildComparePlan(query, { agents, sequential });
  const execution = await execute(plan);

  // 3. Store outputs for preference detection
  lastCompareQuery = query;
  lastCompareAgents = agents;
  lastCompareOutputs = agents.map((agent, i) => {
    const stepId = `step_${i}`;
    const result = execution.results.find(r => r.stepId === stepId);
    return {
      agent,
      content: result?.content || ''
    };
  });

  // 4. Store comparison in memory
  await addMemory({
    type: 'decision',
    content: `Compared ${agents.join(' vs ')} on: ${query}`,
    metadata: {
      mode: 'compare',
      query,
      agents: JSON.stringify(agents)
    }
  });

  return { execution, pastPreferences };
}

/**
 * Record which agent the user preferred
 * Call this on the next user message after a compare
 */
export async function recordComparePreference(
  userMessage: string
): Promise<SignalResult | null> {
  if (lastCompareOutputs.length === 0) return null;

  // First check for explicit preference
  const explicit = detectExplicitPreference(userMessage, lastCompareAgents);
  if (explicit) {
    await storePreference(explicit.agent, explicit.confidence, lastCompareQuery);
    clearState();
    return {
      winner: explicit.agent,
      confidence: explicit.confidence,
      signal: 'continued_with',
      scores: lastCompareAgents.map(a => ({
        agent: a,
        score: a === explicit.agent ? explicit.confidence : 0
      }))
    };
  }

  // Otherwise use signal detection
  const signal = await detectContinuedWith(userMessage, lastCompareOutputs);

  if (signal.winner) {
    await storePreference(signal.winner, signal.confidence, lastCompareQuery);
  }

  clearState();
  return signal;
}

/**
 * Store a preference in memory
 */
async function storePreference(
  agent: string,
  confidence: number,
  query: string
): Promise<void> {
  await addMemory({
    type: 'pattern',
    content: `User preferred ${agent}'s response when comparing: ${query}`,
    metadata: {
      mode: 'compare',
      preferredAgent: agent,
      confidence: String(confidence),
      query
    }
  });
}

/**
 * Clear module state
 */
function clearState(): void {
  lastCompareOutputs = [];
  lastCompareQuery = '';
  lastCompareAgents = [];
}

/**
 * Check if there's a pending comparison to record preference for
 */
export function hasPendingComparison(): boolean {
  return lastCompareOutputs.length > 0;
}

/**
 * Get last comparison agents (for display)
 */
export function getLastCompareAgents(): string[] {
  return [...lastCompareAgents];
}

/**
 * Get agent preference counts from memory
 */
export async function getAgentPreferences(): Promise<Record<string, number>> {
  try {
    const results = await retrieve('compare preference', {
      types: ['pattern'],
      limit: 100
    });

    const counts: Record<string, number> = {};
    for (const item of results.items) {
      const agent = item.metadata?.preferredAgent as string;
      if (agent && item.metadata?.mode === 'compare') {
        counts[agent] = (counts[agent] || 0) + 1;
      }
    }

    return counts;
  } catch {
    return {};
  }
}

/**
 * Get comparison history
 */
export async function getCompareHistory(limit: number = 10): Promise<Array<{
  query: string;
  agents: string[];
  preferredAgent?: string;
  timestamp: number;
}>> {
  try {
    const results = await retrieve('compare mode', {
      types: ['decision', 'pattern'],
      limit: limit * 2
    });

    const comparisons = new Map<string, {
      query: string;
      agents: string[];
      preferredAgent?: string;
      timestamp: number;
    }>();

    for (const item of results.items) {
      if (item.metadata?.mode !== 'compare') continue;

      const query = item.metadata?.query as string;
      if (!query) continue;

      const existing = comparisons.get(query);
      if (!existing) {
        comparisons.set(query, {
          query,
          agents: JSON.parse((item.metadata?.agents as string) || '[]'),
          preferredAgent: item.metadata?.preferredAgent as string | undefined,
          timestamp: item.createdAt || 0
        });
      } else if (item.metadata?.preferredAgent && !existing.preferredAgent) {
        existing.preferredAgent = item.metadata.preferredAgent as string;
      }
    }

    return [...comparisons.values()]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  } catch {
    return [];
  }
}

