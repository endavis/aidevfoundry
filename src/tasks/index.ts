/**
 * Task Management Module
 *
 * Provides Claude Code-level subprocess control for PuzldAI.
 *
 * Features:
 * - Background task execution (runInBackground)
 * - Task resumption with preserved context (resumeFrom)
 * - Task output retrieval (blocking/non-blocking)
 * - Process termination (killTask)
 *
 * Usage:
 * ```typescript
 * import { launchTask, getTaskOutput, killTask, resumeTask } from './tasks';
 *
 * // Launch background task
 * const task = await launchTask({
 *   description: 'Analyze codebase',
 *   prompt: 'Find all TypeScript files',
 *   agent: 'claude',
 *   runInBackground: true
 * });
 *
 * // Get output later
 * const output = await getTaskOutput({ taskId: task.id, block: true });
 *
 * // Resume with context
 * const resumed = await resumeTask(task.id, 'Now refactor them');
 *
 * // Kill if needed
 * killTask(task.id);
 * ```
 */

export * from './types';
export * from './registry';
export {
  launchTask,
  launchShell,
  getTaskOutput,
  killTask,
  resumeTask,
  listTasks,
  getTask,
  deleteTask,
  clearCompletedTasks,
  getTaskCounts,
  setTaskEvents
} from './manager';
