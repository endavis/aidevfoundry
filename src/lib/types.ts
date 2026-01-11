export interface ModelResponse {
  content: string;
  model: string;
  tokens?: {
    input: number;
    output: number;
  };
  duration?: number;
  error?: string;
  /** Game state for game adapters (resumable gameplay) */
  state?: unknown;
}

export interface RalphWiggumOptions {
  /** Enable Ralph Wiggum loop (keep retrying until task is done) */
  enabled?: boolean;
  /** Maximum number of iterations (default: 10) */
  maxIterations?: number;
  /** Completion criteria phrase that signals success (e.g., "task completed", "all tests pass") */
  completionCriteria?: string | string[];
  /** Callback for each iteration */
  onIteration?: (iteration: number, result: ModelResponse) => void;
  /** Whether to require explicit completion promise (default: true) */
  requireCompletionPromise?: boolean;
}

export interface RunOptions {
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
  onToolEvent?: (event: import('./stream-parser').StreamEvent) => void;
  model?: string;
  /** Disable native tools (for agentic mode - LLM returns JSON, we apply files) */
  disableTools?: boolean;
  /** Game state for game adapters (resumable gameplay) */
  state?: unknown;
  /** Ralph Wiggum loop options for persistent retry until completion */
  ralphWiggum?: RalphWiggumOptions;
}

export interface Adapter {
  name: string;
  run(prompt: string, options?: RunOptions): Promise<ModelResponse>;
  isAvailable(): Promise<boolean>;
}

export interface RouteResult {
  agent: 'claude' | 'gemini' | 'codex' | 'ollama' | 'factory' | 'crush' | 'mistral';
  confidence: number;
  reasoning?: string;
  taskType?: string;
  /** Human-readable reason why fallback occurred (if taskType === 'fallback') */
  fallbackReason?: string;
}

export interface CheckResult {
  name: string;
  available: boolean;
  version?: string;
  error?: string;
}

export interface TaskRecord {
  id: string;
  prompt: string;
  agent: string;
  response: string;
  timestamp: string;
  duration?: number;
}

export enum ErrorCode {
  ADAPTER_NOT_FOUND = 'ADAPTER_NOT_FOUND',
  ADAPTER_UNAVAILABLE = 'ADAPTER_UNAVAILABLE',
  ADAPTER_TIMEOUT = 'ADAPTER_TIMEOUT',
  ADAPTER_CRASHED = 'ADAPTER_CRASHED',
  ROUTER_FAILED = 'ROUTER_FAILED',
  ROUTER_INVALID_JSON = 'ROUTER_INVALID_JSON',
  OLLAMA_NOT_RUNNING = 'OLLAMA_NOT_RUNNING',
  CONFIG_INVALID = 'CONFIG_INVALID',
  TASK_CANCELLED = 'TASK_CANCELLED',
}

export interface PulzdError {
  code: ErrorCode;
  message: string;
  suggestion?: string;
  recoverable: boolean;
}
