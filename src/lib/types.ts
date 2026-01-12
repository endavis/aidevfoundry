export interface ModelResponse {
  /** The text content of the response */
  content: string;
  /** The specific model that generated the response */
  model: string;
  /** Token usage statistics */
  tokens?: {
    input: number;
    output: number;
  };
  /** Execution duration in milliseconds */
  duration?: number;
  /** Error message if execution failed */
  error?: string;
  /** Updated game state for game adapters (resumable gameplay) */
  state?: unknown;
}

export type GameStatus = 'playing' | 'won' | 'lost' | 'invalid';

export interface GameState {
  /** Current status of the game */
  status: GameStatus;
  /** History of moves made */
  moves?: string[];
  /** Current score */
  score?: number;
  /** Message to display to the user */
  message?: string;
  /** Custom game-specific data */
  data?: unknown;
}

export type GameDifficulty = 'easy' | 'medium' | 'hard';

export interface GameOptions {
  /** Difficulty level of the game */
  difficulty: GameDifficulty;
}

export interface GameCommandValidation {
  /** Whether the command is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
}

export interface GameAdapter extends Adapter {
  /**
   * Initializes a new game state.
   * @param options - Game configuration options (difficulty, etc.).
   * @returns The initial GameState.
   */
  initializeGame(options: GameOptions): GameState;

  /**
   * Renders the current game state into a string representation.
   * @param state - The current game state.
   * @returns A string visualization of the state.
   */
  renderState(state: GameState): string;

  /**
   * Optional: Validates a user command before execution.
   * @param command - The command string to validate.
   * @param state - The current game state.
   * @returns Validation result (valid boolean and optional error).
   */
  validateCommand?(command: string, state: GameState): GameCommandValidation;
}

export interface GameSession {
  id: string;
  gameName: string;
  state: GameState;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
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
  /** Signal to abort the operation */
  signal?: AbortSignal;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Callback for streaming response chunks */
  onChunk?: (chunk: string) => void;
  /** Callback for tool use events */
  onToolEvent?: (event: import('./stream-parser').StreamEvent) => void;
  /** Specific model identifier to use (e.g., 'gpt-4', 'claude-3-opus') */
  model?: string;
  /** Disable native tools (for agentic mode - LLM returns JSON, we apply files) */
  disableTools?: boolean;
  /** Initial state for game adapters */
  state?: unknown;
  /** Ralph Wiggum loop options for persistent retry until completion */
  ralphWiggum?: RalphWiggumOptions;
}

export interface Adapter {
  /**
   * The unique name of the adapter (e.g., 'claude', 'gemini', 'ollama').
   * Used for configuration and routing.
   */
  name: string;

  /**
   * Executes a prompt against the adapter's underlying model or engine.
   * @param prompt - The input text or command to process.
   * @param options - Optional configuration for this specific run.
   * @returns A promise resolving to the model's response.
   */
  run(prompt: string, options?: RunOptions): Promise<ModelResponse>;

  /**
   * Checks if the adapter is currently available (e.g., binary installed, API reachable).
   * @returns A promise resolving to true if available, false otherwise.
   */
  isAvailable(): Promise<boolean>;
}

export interface RouteResult {
  agent: 'claude' | 'gemini' | 'codex' | 'ollama' | 'factory' | 'crush' | 'mistral';
  confidence: number;
  reasoning?: string;
  taskType?: string;
  /** Human-readable reason why fallback occurred (if taskType === 'fallback') */
  fallbackReason?: string;
  /** Suggested harness for complex tasks (pkpoet, codereason, discover, etc.) */
  suggestedHarness?: string;
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