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

// Dynamic Memory Injection (Phase 7)
export {
  assembleStepContext,
  getDefaultRules,
  mergeRules,
  getAgentTokenBudget,
  inferStepRole,
  DEFAULT_RULES
} from './injection';

// Unified Message Format (Multi-Model Context)
export {
  type MessagePart,
  type MessagePartType,
  type TextPart,
  type ReasoningPart,
  type ToolCallPart,
  type ToolResultPart,
  type FilePart,
  type MessageRole,
  type UnifiedMessage,
  CONTEXT_LIMITS,
  getContextLimit,
  createTextMessage,
  getTextContent,
  hasToolCalls,
  getToolCalls,
  getToolResults,
  estimateMessageTokens,
  calculateConversationTokens,
} from './unified-message';

// Provider Translation Layer
export {
  type ProviderTranslator,
  type OpenAIMessage,
  type AnthropicMessage,
  type OllamaMessage,
  type GeminiMessage,
  openaiTranslator,
  anthropicTranslator,
  ollamaTranslator,
  geminiTranslator,
  getTranslator,
  translateForAgent,
} from './provider-translator';

// Context Window Manager (Multi-Model)
export {
  type ContextOptions,
  type PreparedContext,
  prepareContextForAgent,
  willFitInContext,
  getConversationContextUsage,
  estimateRemainingCapacity,
  findCompactionSplitPoint,
} from './context-manager';

// Unified Session Storage
export {
  type UnifiedSession,
  type UnifiedSessionMeta,
  initUnifiedMessagesTable,
  createUnifiedSession,
  loadUnifiedSession,
  saveUnifiedSession,
  addUnifiedMessage,
  listUnifiedSessions,
  deleteUnifiedSession,
  getLatestUnifiedSession,
  clearUnifiedSessionMessages,
  updateUnifiedSessionSummary,
  getUnifiedSessionStats,
} from './unified-session';
