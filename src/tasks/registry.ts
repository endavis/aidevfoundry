/**
 * Task Registry
 *
 * In-memory registry for tracking running and completed tasks.
 * Provides task lookup, status tracking, and cleanup.
 */

import type {
  TaskState,
  TaskStatus,
  TaskType,
  TaskListEntry,
  TaskChunk
} from './types';

// Maximum tasks to keep in history
const MAX_HISTORY_SIZE = 100;

// Task expiry time (24 hours)
const TASK_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Task Registry - singleton for managing task state
 */
class TaskRegistry {
  private tasks: Map<string, TaskState> = new Map();
  private taskOrder: string[] = []; // For LRU eviction

  /**
   * Generate unique task ID
   */
  generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `task_${timestamp}_${random}`;
  }

  /**
   * Register a new task
   */
  register(task: TaskState): void {
    this.tasks.set(task.id, task);
    this.taskOrder.push(task.id);
    this.cleanup();
  }

  /**
   * Get task by ID
   */
  get(taskId: string): TaskState | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Update task state
   */
  update(taskId: string, updates: Partial<TaskState>): TaskState | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    const updated = { ...task, ...updates };
    this.tasks.set(taskId, updated);
    return updated;
  }

  /**
   * Append output chunk to task
   */
  appendOutput(taskId: string, chunk: TaskChunk): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.output += chunk.content;
  }

  /**
   * Set task status
   */
  setStatus(taskId: string, status: TaskStatus): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = status;

    if (status === 'running' && !task.startedAt) {
      task.startedAt = Date.now();
    }

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      task.completedAt = Date.now();
    }
  }

  /**
   * Get all tasks (optionally filtered by status)
   */
  list(filter?: { status?: TaskStatus; type?: TaskType }): TaskListEntry[] {
    const entries: TaskListEntry[] = [];

    for (const task of this.tasks.values()) {
      if (filter?.status && task.status !== filter.status) continue;
      if (filter?.type && task.type !== filter.type) continue;

      entries.push({
        id: task.id,
        type: task.type,
        status: task.status,
        description: task.description,
        agent: task.agent,
        createdAt: task.createdAt,
        duration: task.completedAt
          ? task.completedAt - (task.startedAt || task.createdAt)
          : task.startedAt
            ? Date.now() - task.startedAt
            : undefined
      });
    }

    // Sort by creation time (newest first)
    return entries.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get running tasks
   */
  getRunning(): TaskState[] {
    return Array.from(this.tasks.values()).filter(t => t.status === 'running');
  }

  /**
   * Get pending tasks
   */
  getPending(): TaskState[] {
    return Array.from(this.tasks.values()).filter(t => t.status === 'pending');
  }

  /**
   * Cancel a task
   */
  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.status !== 'running' && task.status !== 'pending') {
      return false; // Can only cancel running/pending tasks
    }

    // Trigger abort signal if available
    if (task.abortController) {
      task.abortController.abort();
    }

    task.status = 'cancelled';
    task.completedAt = Date.now();
    return true;
  }

  /**
   * Delete a task
   */
  delete(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // Cancel if running
    if (task.status === 'running' || task.status === 'pending') {
      this.cancel(taskId);
    }

    this.tasks.delete(taskId);
    this.taskOrder = this.taskOrder.filter(id => id !== taskId);
    return true;
  }

  /**
   * Clear all completed/failed/cancelled tasks
   */
  clearCompleted(): number {
    let cleared = 0;
    for (const [id, task] of this.tasks) {
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        this.tasks.delete(id);
        cleared++;
      }
    }
    this.taskOrder = this.taskOrder.filter(id => this.tasks.has(id));
    return cleared;
  }

  /**
   * Cleanup old tasks (LRU eviction and expiry)
   */
  private cleanup(): void {
    const now = Date.now();

    // Remove expired tasks
    for (const [id, task] of this.tasks) {
      if (task.completedAt && now - task.completedAt > TASK_EXPIRY_MS) {
        this.tasks.delete(id);
      }
    }

    // LRU eviction if over limit
    while (this.tasks.size > MAX_HISTORY_SIZE) {
      const oldestId = this.taskOrder.shift();
      if (oldestId) {
        const task = this.tasks.get(oldestId);
        // Don't evict running tasks
        if (task && task.status !== 'running') {
          this.tasks.delete(oldestId);
        } else if (task) {
          // Put running task back at end
          this.taskOrder.push(oldestId);
        }
      }
    }

    // Update order array
    this.taskOrder = this.taskOrder.filter(id => this.tasks.has(id));
  }

  /**
   * Get task count by status
   */
  counts(): Record<TaskStatus, number> {
    const counts: Record<TaskStatus, number> = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0
    };

    for (const task of this.tasks.values()) {
      counts[task.status]++;
    }

    return counts;
  }

  /**
   * Wait for task completion (blocking)
   */
  async waitFor(taskId: string, timeout: number = 30000): Promise<TaskState | undefined> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const task = this.tasks.get(taskId);
      if (!task) return undefined;

      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        return task;
      }

      // Poll every 100ms
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Timeout - return current state
    return this.tasks.get(taskId);
  }
}

// Singleton instance
export const taskRegistry = new TaskRegistry();
