/**
 * Debate Orchestrator (Phase 13)
 *
 * Wraps debate execution with:
 * - Winner tracking via signal detection
 * - Pattern extraction from winning arguments
 * - Historical debate retrieval
 */

import type { AgentName, ExecutionResult } from '../executor';
import { buildDebatePlan, execute } from '../executor';
import { addMemory } from '../memory/vector-store';
import { retrieve } from '../memory/retriever';
import { summarizeIfNeeded, isSummarizerAvailable } from '../context/summarizer';
import {
  detectContinuedWith,
  detectImplemented,
  detectExplicitPreference,
  type SignalResult,
  type AgentOutput
} from '../memory/signals';

export interface DebateOptions {
  agents: AgentName[];
  rounds?: number;
  moderator?: AgentName;
  includeHistory?: boolean;
}

export interface DebateResult {
  execution: ExecutionResult;
  finalPositions: Array<{ agent: string; position: string }>;
  pastDebates?: PastDebate[];
}

export interface PastDebate {
  topic: string;
  agents: string[];
  winner?: string;
  winningPattern?: string;
  timestamp: number;
}

interface DebateOutcome {
  topic: string;
  agents: string[];
  rounds: number;
  finalPositions: Array<{ agent: string; position: string }>;
}

// Module-level state for winner detection
let lastDebateOutcome: DebateOutcome | null = null;

/**
 * Run a debate between agents
 */
export async function debate(
  topic: string,
  options: DebateOptions
): Promise<DebateResult> {
  const { agents, rounds = 2, moderator, includeHistory = true } = options;

  // 1. Retrieve past debates on similar topics
  let pastDebates: PastDebate[] = [];
  if (includeHistory) {
    try {
      const results = await retrieve(topic, {
        types: ['decision'],
        limit: 5
      });

      pastDebates = results.items
        .filter(r => r.metadata?.mode === 'debate')
        .map(r => ({
          topic: (r.metadata?.topic as string) || '',
          agents: JSON.parse((r.metadata?.agents as string) || '[]'),
          winner: r.metadata?.winner as string | undefined,
          winningPattern: r.metadata?.winningPattern as string | undefined,
          timestamp: r.createdAt || 0
        }));
    } catch {
      // Continue without history
    }
  }

  // 2. Build & execute plan
  const plan = buildDebatePlan(topic, { agents, rounds, moderator });
  const execution = await execute(plan);

  // 3. Extract final positions
  const finalRound = rounds - 1;
  const finalPositions = agents.map(agent => {
    // Find the result for this agent's final round
    const outputKey = `${agent}_round${finalRound}`;
    const step = plan.steps.find(s => s.outputAs === outputKey);
    const result = step ? execution.results.find(r => r.stepId === step.id) : null;

    return {
      agent,
      position: result?.content || ''
    };
  });

  // 4. Store for signal detection
  lastDebateOutcome = { topic, agents, rounds, finalPositions };

  // 5. Store debate in memory
  const debateSummary = await summarizeDebate(topic, finalPositions);
  await addMemory({
    type: 'decision',
    content: debateSummary,
    metadata: {
      mode: 'debate',
      topic,
      agents: JSON.stringify(agents),
      rounds: String(rounds)
    }
  });

  return { execution, finalPositions, pastDebates };
}

/**
 * Record which agent won the debate
 * Call this on the next user message after a debate
 */
export async function recordDebateWinner(
  userMessage: string
): Promise<SignalResult | null> {
  if (!lastDebateOutcome) return null;

  const { topic, agents, finalPositions } = lastDebateOutcome;

  // First check for explicit preference
  const explicit = detectExplicitPreference(userMessage, agents);
  if (explicit) {
    await storeDebateWinner(explicit.agent, explicit.confidence, topic, finalPositions);
    clearState();
    return {
      winner: explicit.agent,
      confidence: explicit.confidence,
      signal: 'continued_with',
      scores: agents.map(a => ({
        agent: a,
        score: a === explicit.agent ? explicit.confidence : 0
      }))
    };
  }

  // Otherwise use signal detection
  const outputs: AgentOutput[] = finalPositions.map(p => ({
    agent: p.agent,
    content: p.position
  }));

  const signal = await detectContinuedWith(userMessage, outputs);

  if (signal.winner) {
    await storeDebateWinner(signal.winner, signal.confidence, topic, finalPositions);
  }

  clearState();
  return signal;
}

/**
 * Record winner based on code implementation
 * Call this when user makes file changes after a code-related debate
 */
export async function recordDebateImplementation(
  fileChanges: string
): Promise<SignalResult | null> {
  if (!lastDebateOutcome) return null;

  const { topic, finalPositions } = lastDebateOutcome;

  const outputs: AgentOutput[] = finalPositions.map(p => ({
    agent: p.agent,
    content: p.position
  }));

  const signal = await detectImplemented(fileChanges, outputs);

  if (signal.winner) {
    await storeDebateWinner(signal.winner, signal.confidence, topic, finalPositions);
  }

  clearState();
  return signal;
}

/**
 * Store debate winner in memory with pattern extraction
 */
async function storeDebateWinner(
  winner: string,
  confidence: number,
  topic: string,
  finalPositions: Array<{ agent: string; position: string }>
): Promise<void> {
  const winningPosition = finalPositions.find(p => p.agent === winner)?.position || '';
  const winningPattern = extractArgumentPattern(winningPosition);

  await addMemory({
    type: 'decision',
    content: `Debate on "${topic}": ${winner} won. ${winningPattern}`,
    metadata: {
      mode: 'debate',
      topic,
      winner,
      winningPattern,
      confidence: String(confidence),
      agents: JSON.stringify(finalPositions.map(p => p.agent))
    }
  });
}

/**
 * Extract argument patterns from winning position
 */
function extractArgumentPattern(position: string): string {
  const patterns: string[] = [];
  const lower = position.toLowerCase();

  if (lower.includes('performance')) patterns.push('performance-focused');
  if (lower.includes('maintainab')) patterns.push('maintainability-focused');
  if (lower.includes('secur')) patterns.push('security-focused');
  if (lower.includes('simple') || lower.includes('simpl')) patterns.push('simplicity-focused');
  if (lower.includes('scal')) patterns.push('scalability-focused');
  if (lower.includes('test')) patterns.push('testability-focused');
  if (lower.includes('readab')) patterns.push('readability-focused');
  if (lower.includes('type') && lower.includes('safe')) patterns.push('type-safety-focused');
  if (lower.includes('memory') || lower.includes('effici')) patterns.push('efficiency-focused');
  if (lower.includes('user') && lower.includes('experience')) patterns.push('ux-focused');

  return patterns.length > 0 ? patterns.join(', ') : 'general';
}

/**
 * Summarize debate outcome
 */
async function summarizeDebate(
  topic: string,
  finalPositions: Array<{ agent: string; position: string }>
): Promise<string> {
  const positionSummaries = finalPositions
    .map(p => `${p.agent}: ${p.position.slice(0, 200)}...`)
    .join('\n');

  const fullText = `Debate on "${topic}"\n\nFinal positions:\n${positionSummaries}`;

  if (await isSummarizerAvailable()) {
    try {
      return await summarizeIfNeeded(fullText, 300);
    } catch {
      // Fall through to default
    }
  }

  return `Debate on "${topic}" with ${finalPositions.length} participants`;
}

/**
 * Clear module state
 */
function clearState(): void {
  lastDebateOutcome = null;
}

/**
 * Check if there's a pending debate to record winner for
 */
export function hasPendingDebate(): boolean {
  return lastDebateOutcome !== null;
}

/**
 * Get last debate agents (for display)
 */
export function getLastDebateAgents(): string[] {
  return lastDebateOutcome?.agents || [];
}

/**
 * Get debate stats per agent
 */
export async function getDebateStats(): Promise<Record<string, {
  wins: number;
  patterns: string[];
}>> {
  try {
    const results = await retrieve('debate winner', {
      types: ['decision'],
      limit: 100
    });

    const stats: Record<string, { wins: number; patterns: string[] }> = {};

    for (const item of results.items) {
      if (item.metadata?.mode !== 'debate' || !item.metadata?.winner) continue;

      const winner = item.metadata.winner as string;
      const pattern = item.metadata.winningPattern as string | undefined;

      if (!stats[winner]) {
        stats[winner] = { wins: 0, patterns: [] };
      }

      stats[winner].wins++;

      if (pattern && !stats[winner].patterns.includes(pattern)) {
        stats[winner].patterns.push(pattern);
      }
    }

    return stats;
  } catch {
    return {};
  }
}

/**
 * Get debate history
 */
export async function getDebateHistory(limit: number = 10): Promise<PastDebate[]> {
  try {
    const results = await retrieve('debate mode', {
      types: ['decision'],
      limit: limit * 2
    });

    const debates = new Map<string, PastDebate>();

    for (const item of results.items) {
      if (item.metadata?.mode !== 'debate') continue;

      const topic = item.metadata?.topic as string;
      if (!topic) continue;

      const existing = debates.get(topic);
      if (!existing) {
        debates.set(topic, {
          topic,
          agents: JSON.parse((item.metadata?.agents as string) || '[]'),
          winner: item.metadata?.winner as string | undefined,
          winningPattern: item.metadata?.winningPattern as string | undefined,
          timestamp: item.createdAt || 0
        });
      } else if (item.metadata?.winner && !existing.winner) {
        existing.winner = item.metadata.winner as string;
        existing.winningPattern = item.metadata.winningPattern as string | undefined;
      }
    }

    return [...debates.values()]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  } catch {
    return [];
  }
}

