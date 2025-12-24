/**
 * Task Manager
 *
 * Provides Claude Code-level subprocess control:
 * - Background task execution
 * - Task resumption with preserved context
 * - Task output retrieval (blocking/non-blocking)
 * - Process termination
 */

import { execa, type ResultPromise } from 'execa';
import type {
  TaskState,
  TaskOptions,
  TaskResult,
  TaskOutput,
  TaskOutputOptions,
  TaskEvents,
  TaskChunk
} from './types';
import { taskRegistry } from './registry';
import { adapters } from '../adapters';
import { runAgentLoop } from '../agentic/agent-loop';
import type { AgentName } from '../executor/types';
import { createTextMessage, type UnifiedMessage } from '../context/unified-message';

// Active shell processes (for KillShell)
const activeShells: Map<string, ResultPromise> = new Map();

// Event handlers
let globalEvents: TaskEvents = {};

/**
 * Set global event handlers
 */
export function setTaskEvents(events: TaskEvents): void {
  globalEvents = events;
}

/**
 * Launch a new task
 */
export async function launchTask(options: TaskOptions): Promise<TaskState> {
  const taskId = taskRegistry.generateId();
  const cwd = options.cwd || process.cwd();

  // Check for resumption
  let history: UnifiedMessage[] = options.history || [];
  let parentTaskId: string | undefined;

  if (options.resumeFrom) {
    const parentTask = taskRegistry.get(options.resumeFrom);
    if (parentTask) {
      // Inherit history from parent task
      history = [...parentTask.history];
      parentTaskId = parentTask.id;

      // Add parent's result to history if completed
      if (parentTask.result?.content) {
        history.push(createTextMessage(
          parentTask.id, // Use task ID as session ID
          'assistant',
          parentTask.result.content,
          parentTask.agent,
          parentTask.model
        ));
      }
    }
  }

  // Create task state
  const task: TaskState = {
    id: taskId,
    type: 'agent',
    status: 'pending',
    description: options.description,
    prompt: options.prompt,
    agent: options.agent || 'auto',
    model: options.model,
    cwd,
    createdAt: Date.now(),
    output: '',
    history,
    parentTaskId,
    abortController: new AbortController()
  };

  // Register task
  taskRegistry.register(task);

  // Execute immediately or in background
  if (options.runInBackground) {
    // Start execution without awaiting
    executeTask(task, options).catch(err => {
      taskRegistry.update(taskId, {
        status: 'failed',
        result: {
          content: '',
          duration: Date.now() - task.createdAt,
          error: err.message
        }
      });
      globalEvents.onError?.(task, err);
    });
    return task;
  } else {
    // Wait for completion
    return executeTask(task, options);
  }
}

/**
 * Execute a task
 */
async function executeTask(task: TaskState, options: TaskOptions): Promise<TaskState> {
  const startTime = Date.now();

  // Update status
  taskRegistry.setStatus(task.id, 'running');
  task.status = 'running';
  task.startedAt = startTime;
  globalEvents.onStart?.(task);

  try {
    // Resolve agent
    let agentName: AgentName = 'claude';
    if (task.agent && task.agent !== 'auto') {
      agentName = task.agent;
    }

    const adapter = adapters[agentName];
    if (!adapter) {
      throw new Error(`Unknown agent: ${agentName}`);
    }

    if (!(await adapter.isAvailable())) {
      throw new Error(`Agent ${agentName} not available`);
    }

    // Run agent loop with tools
    const result = await runAgentLoop(adapter, task.prompt, {
      model: options.model,
      cwd: task.cwd,
      signal: task.abortController?.signal,
      unifiedHistory: task.history,
      onIteration: (_iteration, response) => {
        const chunk: TaskChunk = {
          taskId: task.id,
          timestamp: Date.now(),
          type: 'content',
          content: response
        };
        taskRegistry.appendOutput(task.id, chunk);
        globalEvents.onChunk?.(chunk);
      },
      onToolCall: (call) => {
        const chunk: TaskChunk = {
          taskId: task.id,
          timestamp: Date.now(),
          type: 'tool_call',
          content: JSON.stringify({ name: call.name, arguments: call.arguments })
        };
        globalEvents.onChunk?.(chunk);
      },
      onToolResult: (result) => {
        const chunk: TaskChunk = {
          taskId: task.id,
          timestamp: Date.now(),
          type: 'tool_result',
          content: result.content
        };
        globalEvents.onChunk?.(chunk);
      }
    });

    // Build task result
    const taskResult: TaskResult = {
      content: result.content,
      model: result.model,
      duration: Date.now() - startTime,
      iterations: result.iterations,
      toolCalls: result.toolCalls?.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
        timestamp: Date.now()
      })),
      tokens: result.tokens
    };

    // Update task history with this interaction
    const updatedHistory: UnifiedMessage[] = [
      ...task.history,
      createTextMessage(task.id, 'user', task.prompt),
      createTextMessage(task.id, 'assistant', result.content, agentName, result.model)
    ];

    // Update task state
    const updatedTask = taskRegistry.update(task.id, {
      status: 'completed',
      completedAt: Date.now(),
      result: taskResult,
      output: result.content,
      history: updatedHistory
    });

    globalEvents.onComplete?.(updatedTask || task);
    return updatedTask || task;

  } catch (err) {
    const error = err as Error;

    // Check if aborted
    if (error.name === 'AbortError' || task.abortController?.signal.aborted) {
      taskRegistry.setStatus(task.id, 'cancelled');
      return taskRegistry.get(task.id) || task;
    }

    const taskResult: TaskResult = {
      content: '',
      duration: Date.now() - startTime,
      error: error.message
    };

    const updatedTask = taskRegistry.update(task.id, {
      status: 'failed',
      completedAt: Date.now(),
      result: taskResult
    });

    globalEvents.onError?.(updatedTask || task, error);
    return updatedTask || task;
  }
}

/**
 * Launch a background shell command
 */
export async function launchShell(
  command: string,
  options: { description?: string; cwd?: string; timeout?: number; runInBackground?: boolean }
): Promise<TaskState> {
  const taskId = taskRegistry.generateId();
  const cwd = options.cwd || process.cwd();

  const task: TaskState = {
    id: taskId,
    type: 'shell',
    status: 'pending',
    description: options.description || command.slice(0, 50),
    prompt: command,
    cwd,
    createdAt: Date.now(),
    output: '',
    history: [],
    abortController: new AbortController()
  };

  taskRegistry.register(task);

  if (options.runInBackground) {
    executeShell(task, command, options).catch(err => {
      taskRegistry.update(taskId, {
        status: 'failed',
        result: {
          content: '',
          duration: Date.now() - task.createdAt,
          error: err.message
        }
      });
    });
    return task;
  } else {
    return executeShell(task, command, options);
  }
}

/**
 * Execute a shell command
 */
async function executeShell(
  task: TaskState,
  command: string,
  options: { timeout?: number }
): Promise<TaskState> {
  const startTime = Date.now();

  taskRegistry.setStatus(task.id, 'running');
  globalEvents.onStart?.(task);

  try {
    // Parse command
    const [cmd, ...args] = command.split(/\s+/);

    const subprocess = execa(cmd, args, {
      cwd: task.cwd,
      timeout: options.timeout,
      cancelSignal: task.abortController?.signal,
      reject: false,
      stdin: 'ignore'
    });

    // Track for KillShell
    activeShells.set(task.id, subprocess);

    // Stream output
    subprocess.stdout?.on('data', (data: Buffer) => {
      const chunk: TaskChunk = {
        taskId: task.id,
        timestamp: Date.now(),
        type: 'stdout',
        content: data.toString()
      };
      taskRegistry.appendOutput(task.id, chunk);
      globalEvents.onChunk?.(chunk);
    });

    subprocess.stderr?.on('data', (data: Buffer) => {
      const chunk: TaskChunk = {
        taskId: task.id,
        timestamp: Date.now(),
        type: 'stderr',
        content: data.toString()
      };
      taskRegistry.appendOutput(task.id, chunk);
      globalEvents.onChunk?.(chunk);
    });

    const result = await subprocess;
    activeShells.delete(task.id);

    const taskResult: TaskResult = {
      content: result.stdout || '',
      duration: Date.now() - startTime,
      error: result.stderr || undefined
    };

    const status = result.exitCode === 0 ? 'completed' : 'failed';
    const updatedTask = taskRegistry.update(task.id, {
      status,
      completedAt: Date.now(),
      result: taskResult
    });

    if (status === 'completed') {
      globalEvents.onComplete?.(updatedTask || task);
    }

    return updatedTask || task;

  } catch (err) {
    activeShells.delete(task.id);
    const error = err as Error;

    const taskResult: TaskResult = {
      content: '',
      duration: Date.now() - startTime,
      error: error.message
    };

    const updatedTask = taskRegistry.update(task.id, {
      status: 'failed',
      completedAt: Date.now(),
      result: taskResult
    });

    globalEvents.onError?.(updatedTask || task, error);
    return updatedTask || task;
  }
}

/**
 * Get task output (blocking or non-blocking)
 */
export async function getTaskOutput(options: TaskOutputOptions): Promise<TaskOutput> {
  const { taskId, block = true, timeout = 30000 } = options;

  let task = taskRegistry.get(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  if (block && (task.status === 'running' || task.status === 'pending')) {
    // Wait for completion
    task = await taskRegistry.waitFor(taskId, timeout);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
  }

  return {
    taskId: task.id,
    status: task.status,
    output: task.output,
    result: task.result,
    duration: task.completedAt
      ? task.completedAt - (task.startedAt || task.createdAt)
      : task.startedAt
        ? Date.now() - task.startedAt
        : 0
  };
}

/**
 * Kill a running shell/task
 */
export function killTask(taskId: string): boolean {
  // Try to kill shell process first
  const shell = activeShells.get(taskId);
  if (shell) {
    shell.kill('SIGTERM');
    activeShells.delete(taskId);
  }

  // Cancel in registry
  return taskRegistry.cancel(taskId);
}

/**
 * Resume a task with additional prompt
 */
export async function resumeTask(
  taskId: string,
  prompt: string,
  options: Partial<TaskOptions> = {}
): Promise<TaskState> {
  return launchTask({
    ...options,
    description: options.description || 'Resume task',
    prompt,
    resumeFrom: taskId,
    runInBackground: options.runInBackground
  });
}

/**
 * List all tasks
 */
export function listTasks(filter?: { status?: TaskState['status']; type?: TaskState['type'] }) {
  return taskRegistry.list(filter);
}

/**
 * Get task by ID
 */
export function getTask(taskId: string): TaskState | undefined {
  return taskRegistry.get(taskId);
}

/**
 * Delete a task
 */
export function deleteTask(taskId: string): boolean {
  return taskRegistry.delete(taskId);
}

/**
 * Clear completed tasks
 */
export function clearCompletedTasks(): number {
  return taskRegistry.clearCompleted();
}

/**
 * Get task counts
 */
export function getTaskCounts() {
  return taskRegistry.counts();
}
