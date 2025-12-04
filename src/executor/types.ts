/**
 * Core types for the ExecutionPlan system
 *
 * ExecutionPlan for everything. One universal executor, multiple plan builders.
 */

// Agent types
export type AgentName = 'claude' | 'gemini' | 'codex' | 'ollama';

// Step action types
export type StepAction =
  | 'prompt'      // Send prompt to agent
  | 'analyze'     // Analyze previous results
  | 'combine'     // Combine multiple results
  | 'transform'   // Transform data
  | 'validate'    // Validate output
  | 'route';      // Dynamic routing decision

// Step execution status
export type StepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

// Result from a single step
export interface StepResult {
  stepId: string;
  status: StepStatus;
  content?: string;
  error?: string;
  model?: string;
  duration?: number;       // ms
  metadata?: Record<string, unknown>;
}

// Single step in a plan
export interface PlanStep {
  id: string;
  agent: AgentName | 'auto';
  action: StepAction;
  prompt: string;                  // Can contain {{variables}}
  dependsOn?: string[];            // Step IDs this depends on
  fallback?: AgentName;            // Fallback agent if primary fails
  retries?: number;                // Max retry attempts (default: 0)
  timeout?: number;                // Step-specific timeout (ms)
  condition?: string;              // Expression to evaluate (e.g., "{{step1.success}}")
  outputAs?: string;               // Variable name to store result
}

// Execution plan - the universal unit
export interface ExecutionPlan {
  id: string;
  mode: PlanMode;
  prompt: string;                  // Original user prompt
  steps: PlanStep[];
  createdAt: number;               // Unix timestamp
  context?: Record<string, unknown>; // Initial context variables
}

// Plan mode determines execution behavior
export type PlanMode =
  | 'single'      // Single agent, single step
  | 'compare'     // Parallel execution, compare results
  | 'pipeline'    // Sequential with dependencies
  | 'auto';       // LLM-generated plan

// Execution timeline event for UI/logging
export interface TimelineEvent {
  timestamp: number;
  stepId: string;
  type: 'start' | 'progress' | 'complete' | 'error' | 'retry' | 'skip';
  message?: string;
  data?: unknown;
}

// Full execution result
export interface ExecutionResult {
  planId: string;
  status: 'completed' | 'failed' | 'partial' | 'cancelled';
  results: StepResult[];
  timeline: TimelineEvent[];
  finalOutput?: string;
  duration: number;                // Total duration in ms
}

// Executor configuration
export interface ExecutorConfig {
  maxConcurrency?: number;         // Max parallel steps (default: 3)
  defaultTimeout?: number;         // Default step timeout (default: 120000)
  defaultRetries?: number;         // Default retries (default: 0)
  onEvent?: (event: TimelineEvent) => void;
  onChunk?: (stepId: string, chunk: string) => void;
  onBeforeStep?: (step: PlanStep, index: number, previousResults: StepResult[]) => Promise<boolean>; // Return false to skip
  signal?: AbortSignal;
}

// Compare mode options
export interface CompareOptions {
  agents: AgentName[];
  sequential?: boolean;            // Run one at a time
  pick?: boolean;                  // Select best response
  pickCriteria?: string;           // How to pick (e.g., "longest", "llm")
}

// Pipeline mode options
export interface PipelineOptions {
  steps: PipelineStep[];
  interactive?: boolean;           // Confirm between steps
}

// Pipeline step definition (user-friendly format)
export interface PipelineStep {
  agent: AgentName | 'auto';
  action: string;                  // e.g., "analyze", "code", "review"
  promptTemplate?: string;         // Override default prompt
}

// Template for saved pipelines
export interface PipelineTemplate {
  name: string;
  description?: string;
  steps: PipelineStep[];
  createdAt: number;
  updatedAt: number;
}
