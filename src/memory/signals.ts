/**
 * Signal Detection (Phase 13)
 *
 * Detect which agent's output the user actually used:
 * - continued_with: User's follow-up references one agent's response
 * - implemented: User's code changes match one agent's suggestion
 *
 * Uses semantic similarity (Ollama) with keyword fallback.
 */

import { embed, cosineSimilarity, isOllamaAvailable } from './embeddings';

export interface AgentOutput {
  agent: string;
  content: string;
  round?: number;
}

export interface SignalResult {
  winner: string | null;
  confidence: number;
  signal: 'continued_with' | 'implemented' | 'none';
  scores: Array<{ agent: string; score: number }>;
}

// Minimum margin required to declare a winner
const MIN_MARGIN = 0.15;
// Minimum score required for winner
const MIN_SCORE = 0.5;
// Minimum score for keyword fallback
const MIN_KEYWORD_SCORE = 0.2;

/**
 * Extract keywords from text (for fallback similarity)
 */
function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3);

  // Remove common stop words
  const stopWords = new Set([
    'this', 'that', 'with', 'from', 'have', 'will', 'would', 'could', 'should',
    'they', 'their', 'them', 'then', 'than', 'what', 'when', 'where', 'which',
    'there', 'here', 'just', 'only', 'also', 'very', 'been', 'being', 'were',
    'some', 'other', 'more', 'most', 'such', 'into', 'over', 'after', 'before'
  ]);

  return new Set(words.filter(w => !stopWords.has(w)));
}

/**
 * Jaccard similarity between two sets of keywords
 */
function keywordSimilarity(textA: string, textB: string): number {
  const setA = extractKeywords(textA);
  const setB = extractKeywords(textB);

  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Score agent outputs against user content
 */
async function scoreAgentOutputs(
  userContent: string,
  agentOutputs: AgentOutput[]
): Promise<Array<{ agent: string; score: number }>> {
  // Try embedding-based scoring (Ollama)
  if (await isOllamaAvailable()) {
    const userEmbedding = await embed(userContent);

    if (userEmbedding) {
      const scores = await Promise.all(
        agentOutputs.map(async (output) => {
          const outputEmbedding = await embed(output.content);
          if (!outputEmbedding) {
            return { agent: output.agent, score: 0 };
          }
          return {
            agent: output.agent,
            score: cosineSimilarity(userEmbedding, outputEmbedding)
          };
        })
      );
      return scores;
    }
  }

  // Fallback: keyword-based Jaccard similarity
  return agentOutputs.map(output => ({
    agent: output.agent,
    score: keywordSimilarity(userContent, output.content)
  }));
}

/**
 * Determine winner from scores
 */
function determineWinner(
  scores: Array<{ agent: string; score: number }>,
  signal: 'continued_with' | 'implemented',
  useKeywordThreshold: boolean
): SignalResult {
  if (scores.length === 0) {
    return { winner: null, confidence: 0, signal: 'none', scores };
  }

  // Sort by score descending
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  const runnerUp = sorted[1];

  // Calculate margin
  const margin = runnerUp ? winner.score - runnerUp.score : winner.score;

  // Check thresholds
  const minScore = useKeywordThreshold ? MIN_KEYWORD_SCORE : MIN_SCORE;

  if (margin >= MIN_MARGIN && winner.score >= minScore) {
    return {
      winner: winner.agent,
      confidence: Math.min(margin * 2, 1), // Scale margin to confidence
      signal,
      scores
    };
  }

  return { winner: null, confidence: 0, signal: 'none', scores };
}

/**
 * Detect which agent's response the user continued with
 *
 * Call this after a compare/debate when user sends their next message.
 * It checks if the user's message semantically references one agent's response.
 */
export async function detectContinuedWith(
  userMessage: string,
  agentOutputs: AgentOutput[]
): Promise<SignalResult> {
  if (agentOutputs.length < 2) {
    return { winner: null, confidence: 0, signal: 'none', scores: [] };
  }

  // Skip very short messages (likely just acknowledgments)
  if (userMessage.trim().length < 20) {
    return { winner: null, confidence: 0, signal: 'none', scores: [] };
  }

  const scores = await scoreAgentOutputs(userMessage, agentOutputs);
  const useKeyword = !(await isOllamaAvailable());

  return determineWinner(scores, 'continued_with', useKeyword);
}

/**
 * Detect which agent's code the user implemented
 *
 * Call this when user makes file changes after a code-related compare/debate.
 * It checks if the changes match one agent's suggested code.
 */
export async function detectImplemented(
  fileChanges: string,
  agentOutputs: AgentOutput[]
): Promise<SignalResult> {
  if (agentOutputs.length < 2) {
    return { winner: null, confidence: 0, signal: 'none', scores: [] };
  }

  // Skip if no meaningful changes
  if (fileChanges.trim().length < 50) {
    return { winner: null, confidence: 0, signal: 'none', scores: [] };
  }

  // Extract code blocks from agent outputs for comparison
  const codeOutputs = agentOutputs.map(output => ({
    agent: output.agent,
    content: extractCodeBlocks(output.content)
  }));

  // If no code blocks found, compare full content
  const outputs = codeOutputs.some(o => o.content.length > 0)
    ? codeOutputs
    : agentOutputs;

  const scores = await scoreAgentOutputs(fileChanges, outputs);
  const useKeyword = !(await isOllamaAvailable());

  return determineWinner(scores, 'implemented', useKeyword);
}

/**
 * Extract code blocks from markdown content
 */
function extractCodeBlocks(content: string): string {
  const codeBlockRegex = /```[\s\S]*?```/g;
  const blocks = content.match(codeBlockRegex) || [];

  return blocks
    .map(block => block.replace(/```\w*\n?/g, '').replace(/```/g, ''))
    .join('\n');
}

/**
 * Check if user message indicates explicit preference
 * (e.g., "I prefer Claude's approach", "Gemini's answer is better")
 */
export function detectExplicitPreference(
  userMessage: string,
  agents: string[]
): { agent: string; confidence: number } | null {
  const lower = userMessage.toLowerCase();

  const preferencePatterns = [
    /i(?:'ll| will)? (?:go with|use|try|prefer|like|choose) (\w+)/i,
    /(\w+)(?:'s)? (?:answer|response|approach|solution|code|suggestion) is (?:better|clearer|simpler|correct)/i,
    /(?:prefer|like|choose) (\w+)/i
  ];

  for (const pattern of preferencePatterns) {
    const match = lower.match(pattern);
    if (match) {
      const mentioned = match[1].toLowerCase();
      const matchedAgent = agents.find(a =>
        a.toLowerCase().includes(mentioned) ||
        mentioned.includes(a.toLowerCase())
      );

      if (matchedAgent) {
        return { agent: matchedAgent, confidence: 0.9 };
      }
    }
  }

  return null;
}
