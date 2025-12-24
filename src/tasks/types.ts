/**
 * Task Management Types
 *
 * Provides Claude Code-level subprocess control for background execution,
 * task resumption, and process management.
 */

import type { AgentName } from '../executor/types';
import type { UnifiedMessage } from '../context/unified-message';

/**
 * Task execution status
 */
export type TaskStatus =
  | 'pending'      // Created but not started
  | 'running'      // Currently executing
  | 'completed'    // Finished successfully
  | 'failed'       // Finished with error
  | 'cancelled';   // Terminated by user

/**
 * Task type - determines execution behavior
 */
export type TaskType =
  | 'agent'        // Agent loop execution (LLM with tools)
  | 'shell'        // Background shell command
  | 'plan'         // Execution plan (compare/pipeline/etc)
  | 'remote';      // Remote session (future)

/**
 * Task configuration options
 */
export interface TaskOptions {
  /** Task description (3-5 words) */
  description: string;
  /** The prompt or command to execute */
  prompt: string;
  /** Agent to use (for agent tasks) */
  agent?: AgentName | 'auto';
  /** Model override */
  model?: string;
  /** Run in background (non-blocking) */
  runInBackground?: boolean;
  /** Working directory */
  cwd?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Resume from previous task ID */
  resumeFrom?: string;
  /** Conversation history for context */
  history?: UnifiedMessage[];
}

/**
 * Task output chunk for streaming
 */
export interface TaskChunk {
  taskId: string;
  timestamp: number;
  type: 'stdout' | 'stderr' | 'content' | 'tool_call' | 'tool_result';
  content: string;
}

/**
 * Tool call record for task transcript
 */
export interface TaskToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  timestamp: number;
}

/**
 * Task execution result
 */
export interface TaskResult {
  /** Final output content */
  content: string;
  /** Model used */
  model?: string;
  /** Duration in milliseconds */
  duration: number;
  /** Number of iterations (for agent tasks) */
  iterations?: number;
  /** Tool calls made */
  toolCalls?: TaskToolCall[];
  /** Token usage */
  tokens?: { input: number; output: number };
  /** Error message if failed */
  error?: string;
}

/**
 * Task state - full task record
 */
export interface TaskState {
  /** Unique task ID */
  id: string;
  /** Task type */
  type: TaskType;
  /** Current status */
  status: TaskStatus;
  /** Task description */
  description: string;
  /** Original prompt */
  prompt: string;
  /** Agent used */
  agent?: AgentName | 'auto';
  /** Model used */
  model?: string;
  /** Working directory */
  cwd: string;
  /** When task was created */
  createdAt: number;
  /** When task started executing */
  startedAt?: number;
  /** When task completed */
  completedAt?: number;
  /** Task result (when completed) */
  result?: TaskResult;
  /** Accumulated output chunks */
  output: string;
  /** Conversation history (for resumption) */
  history: UnifiedMessage[];
  /** Parent task ID (if resumed from another) */
  parentTaskId?: string;
  /** AbortController signal for cancellation */
  abortController?: AbortController;
}

/**
 * Task output request options
 */
export interface TaskOutputOptions {
  /** Task ID to get output from */
  taskId: string;
  /** Wait for completion (default: true) */
  block?: boolean;
  /** Max wait time in ms (default: 30000) */
  timeout?: number;
}

/**
 * Task output response
 */
export interface TaskOutput {
  /** Task ID */
  taskId: string;
  /** Current status */
  status: TaskStatus;
  /** Output content so far */
  output: string;
  /** Full result (if completed) */
  result?: TaskResult;
  /** Duration so far */
  duration: number;
}

/**
 * Task list entry (summary for listing)
 */
export interface TaskListEntry {
  id: string;
  type: TaskType;
  status: TaskStatus;
  description: string;
  agent?: string;
  createdAt: number;
  duration?: number;
}

/**
 * Task manager events
 */
export interface TaskEvents {
  onStart?: (task: TaskState) => void;
  onChunk?: (chunk: TaskChunk) => void;
  onComplete?: (task: TaskState) => void;
  onError?: (task: TaskState, error: Error) => void;
}
