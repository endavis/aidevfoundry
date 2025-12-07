/**
 * Semantic Relevance Scoring
 *
 * Uses embeddings to find relevant old context.
 * Falls back to keyword matching if embeddings unavailable.
 */

import { Ollama } from 'ollama';
import { getConfig } from '../lib/config';
import type { ContextItem } from './manager';

/**
 * Relevance score for a context item
 */
export interface RelevanceScore {
  itemId: string;
  score: number;        // 0-1, higher = more relevant
  method: 'embedding' | 'keyword' | 'recency';
}

/**
 * Scoring configuration
 */
export interface ScoringConfig {
  // Weight for embedding similarity (0-1)
  embeddingWeight?: number;

  // Weight for keyword overlap (0-1)
  keywordWeight?: number;

  // Weight for recency (0-1)
  recencyWeight?: number;

  // Embedding model to use
  embeddingModel?: string;

  // Max age in ms for recency scoring (default: 1 hour)
  maxAge?: number;
}

const DEFAULT_CONFIG: Required<ScoringConfig> = {
  embeddingWeight: 0.6,
  keywordWeight: 0.3,
  recencyWeight: 0.1,
  embeddingModel: 'nomic-embed-text',
  maxAge: 3600000
};

/**
 * Get Ollama client
 */
function getOllama(): Ollama {
  const config = getConfig();
  return new Ollama({ host: config.adapters.ollama.host });
}

/**
 * Check if embedding model is available
 */
export async function isEmbeddingAvailable(): Promise<boolean> {
  const config = getConfig();
  if (!config.adapters.ollama.enabled) return false;

  try {
    const ollama = getOllama();
    const models = await ollama.list();
    return models.models.some(m =>
      m.name.includes('embed') || m.name.includes('nomic')
    );
  } catch {
    return false;
  }
}

/**
 * Generate embeddings for multiple texts (batched)
 */
async function getEmbeddings(
  texts: string[],
  model: string
): Promise<number[][]> {
  const ollama = getOllama();
  const response = await ollama.embed({
    model,
    input: texts
  });
  return response.embeddings;
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Extract keywords from text (simple tokenization)
 */
function extractKeywords(text: string): Set<string> {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'must', 'shall',
    'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in',
    'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
    'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'under', 'again', 'further', 'then', 'once',
    'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either',
    'neither', 'not', 'only', 'own', 'same', 'than', 'too',
    'very', 'just', 'also', 'now', 'here', 'there', 'when',
    'where', 'why', 'how', 'all', 'each', 'every', 'both',
    'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'any', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
    'she', 'it', 'we', 'they', 'what', 'which', 'who', 'whom'
  ]);

  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word))
  );
}

/**
 * Calculate keyword overlap score (Jaccard similarity)
 */
function keywordScore(taskKeywords: Set<string>, itemKeywords: Set<string>): number {
  if (taskKeywords.size === 0 || itemKeywords.size === 0) return 0;

  let overlap = 0;
  for (const word of taskKeywords) {
    if (itemKeywords.has(word)) overlap++;
  }

  const union = new Set([...taskKeywords, ...itemKeywords]);
  return overlap / union.size;
}

/**
 * Calculate recency score (linear decay)
 */
function recencyScore(timestamp: number, maxAge: number): number {
  const age = Date.now() - timestamp;
  if (age <= 0) return 1;
  if (age >= maxAge) return 0;

  return 1 - (age / maxAge);
}

/**
 * Score context items by relevance to current task
 */
export async function scoreRelevance(
  items: ContextItem[],
  currentTask: string,
  config: ScoringConfig = {}
): Promise<RelevanceScore[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (items.length === 0) return [];

  // Extract keywords from task
  const taskKeywords = extractKeywords(currentTask);

  // Pre-calculate keyword scores and recency scores
  const itemKeywords = items.map(item => extractKeywords(item.content));
  const kwScores = itemKeywords.map(kw => keywordScore(taskKeywords, kw));
  const recScores = items.map(item => recencyScore(item.timestamp, cfg.maxAge));

  // Try batch embedding
  let embeddingScores: number[] | null = null;
  let useEmbeddings = false;

  if (await isEmbeddingAvailable()) {
    try {
      // Batch: [task, item1, item2, ...]
      const texts = [currentTask, ...items.map(i => i.content)];
      const embeddings = await getEmbeddings(texts, cfg.embeddingModel);

      const taskEmbedding = embeddings[0];
      embeddingScores = embeddings.slice(1).map(itemEmb =>
        cosineSimilarity(taskEmbedding, itemEmb)
      );
      useEmbeddings = true;
    } catch {
      // Fall back to keyword-only
    }
  }

  // Calculate final scores
  const scores: RelevanceScore[] = items.map((item, i) => {
    let finalScore: number;
    let method: RelevanceScore['method'];

    if (useEmbeddings && embeddingScores) {
      finalScore =
        embeddingScores[i] * cfg.embeddingWeight +
        kwScores[i] * cfg.keywordWeight +
        recScores[i] * cfg.recencyWeight;
      method = 'embedding';
    } else {
      // No embeddings: redistribute weight between keyword and recency
      const totalWeight = cfg.keywordWeight + cfg.recencyWeight;
      finalScore =
        kwScores[i] * (cfg.keywordWeight / totalWeight) +
        recScores[i] * (cfg.recencyWeight / totalWeight);
      method = kwScores[i] > recScores[i] ? 'keyword' : 'recency';
    }

    return {
      itemId: item.id,
      score: Math.min(1, Math.max(0, finalScore)),
      method
    };
  });

  // Sort by score descending
  return scores.sort((a, b) => b.score - a.score);
}

/**
 * Filter items by relevance threshold
 */
export async function filterByRelevance(
  items: ContextItem[],
  currentTask: string,
  threshold: number = 0.3,
  config: ScoringConfig = {}
): Promise<ContextItem[]> {
  const scores = await scoreRelevance(items, currentTask, config);
  const scoreMap = new Map(scores.map(s => [s.itemId, s.score]));

  return items
    .filter(item => (scoreMap.get(item.id) ?? 0) >= threshold)
    .sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0));
}

/**
 * Get top N most relevant items
 */
export async function getTopRelevant(
  items: ContextItem[],
  currentTask: string,
  n: number = 5,
  config: ScoringConfig = {}
): Promise<ContextItem[]> {
  const scores = await scoreRelevance(items, currentTask, config);
  const scoreMap = new Map(scores.map(s => [s.itemId, s.score]));
  const topIds = new Set(scores.slice(0, n).map(s => s.itemId));

  return items
    .filter(item => topIds.has(item.id))
    .sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0));
}
