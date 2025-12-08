/**
 * Context Management
 *
 * Token management, summarization, and context window control.
 */

// Token Management
export {
  estimateTokens,
  getTokenConfig,
  getAvailableTokens,
  fitsInContext,
  truncateForAgent,
  splitIntoChunks,
  getContextUsage,
  isNearLimit,
  ADAPTER_LIMITS,
  type TokenConfig
} from './tokens';

// Summarization
export {
  summarize,
  summarizeIfNeeded,
  extractKeyPoints,
  isSummarizerAvailable,
  type SummaryOptions
} from './summarizer';

// Context Window Manager
export {
  ContextWindowManager,
  createContextItem,
  getAgentRules,
  buildContextForAgent,
  type ContextItem,
  type ContextItemType,
  type ContextConfig,
  type AgentContextRules
} from './manager';

// Pipeline Memory
export {
  createMemoryContext,
  addStepResultWithMemory,
  injectVariablesTokenSafe,
  getMemoryStats,
  getStepOutputForBudget,
  clearMemory,
  type StepOutput,
  type MemoryContext,
  type MemoryConfig
} from './pipeline-memory';

// Semantic Relevance Scoring
export {
  scoreRelevance,
  filterByRelevance,
  getTopRelevant,
  isEmbeddingAvailable,
  type RelevanceScore,
  type ScoringConfig
} from './relevance';

// Scaffolded Context Windows
export {
  ContextScaffolder,
  getScaffolder,
  scaffoldIfNeeded,
  getContentWithinLimit,
  type Scaffold,
  type ScaffoldChunk,
  type ScaffoldOptions,
  type ReconstructOptions,
  type ChunkType
} from './scaffolding';
