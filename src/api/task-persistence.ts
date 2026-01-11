/**
 * Task Persistence Layer
 *
 * SQLite-backed storage for API tasks with persistence across server restarts.
 * Uses better-sqlite3 for synchronous, fast SQLite operations.
 */

import { getDatabase } from '../memory/database';
import { createLogger } from '../lib/logger';

export interface TaskEntry {
  prompt: string;
  agent?: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  model?: string;
  startedAt: number;
  completedAt?: number;
  queuePosition?: number;
}

// Create module-specific logger
const logger = createLogger({ module: 'persistence' });

// Prepared statements for performance
let saveTaskStmt: any | null = null;
let updateTaskStmt: any | null = null;
let getTaskStmt: any | null = null;
let getAllTasksStmt: any | null = null;
let deleteTaskStmt: any | null = null;
let deleteOldTasksStmt: any | null = null;
let getActiveTasksStmt: any | null = null;

/**
 * Initialize prepared statements
 */
function initStatements(): void {
  const db = getDatabase();

  saveTaskStmt = db.prepare(`
    INSERT INTO api_tasks (id, prompt, agent, status, result, error, model, started_at, completed_at, updated_at, queue_position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  updateTaskStmt = db.prepare(`
    UPDATE api_tasks
    SET status = ?,
        result = ?,
        error = ?,
        model = ?,
        completed_at = ?,
        updated_at = ?
    WHERE id = ?
  `);

  getTaskStmt = db.prepare('SELECT * FROM api_tasks WHERE id = ?');

  getAllTasksStmt = db.prepare('SELECT * FROM api_tasks ORDER BY started_at DESC');

  deleteTaskStmt = db.prepare('DELETE FROM api_tasks WHERE id = ?');

  deleteOldTasksStmt = db.prepare('DELETE FROM api_tasks WHERE updated_at < ?');

  getActiveTasksStmt = db.prepare(
    "SELECT * FROM api_tasks WHERE status IN ('queued', 'running') ORDER BY started_at ASC"
  );
}

/**
 * Ensure statements are initialized
 */
function ensureStatements(): void {
  if (!saveTaskStmt) {
    initStatements();
  }
}

/**
 * Save a new task to the database
 */
export function saveTask(id: string, entry: TaskEntry, queuePosition?: number): void {
  ensureStatements();
  const now = Date.now();

  // Fix #5: Validate queue position
  const validatedQueuePosition = (queuePosition !== undefined && queuePosition >= 0)
    ? queuePosition
    : 0;

  try {
    saveTaskStmt!.run([
      id,
      entry.prompt,
      entry.agent || null,
      entry.status,
      entry.result || null,
      entry.error || null,
      entry.model || null,
      entry.startedAt,
      entry.completedAt || null,
      now,
      validatedQueuePosition,
    ]);
  } catch (error) {
    logger.error({ taskId: id, error }, 'Failed to save task');
    throw error;
  }
}

/**
 * Update an existing task
 */
export function updateTask(
  id: string,
  updates: Partial<Pick<TaskEntry, 'status' | 'result' | 'error' | 'model' | 'completedAt'>>
): void {
  ensureStatements();
  const now = Date.now();

  try {
    updateTaskStmt!.run([
      updates.status,
      updates.result || null,
      updates.error || null,
      updates.model || null,
      updates.completedAt || null,
      now,
      id,
    ]);
  } catch (error) {
    logger.error({ taskId: id, error }, 'Failed to update task');
    throw error;
  }
}

/**
 * Get a single task by ID
 */
export function getTask(id: string): TaskEntry | null {
  ensureStatements();

  try {
    const row = getTaskStmt!.get(id) as any | undefined;
    return row ? mapRowToTaskEntry(row) : null;
  } catch (error) {
    logger.error({ taskId: id, error }, 'Failed to get task');
    return null;
  }
}

/**
 * Get all tasks
 */
export function getAllTasks(): TaskEntry[] {
  ensureStatements();

  try {
    const rows = getAllTasksStmt!.all() as any[];
    return rows.map(mapRowToTaskEntry);
  } catch (error) {
    logger.error({ error }, 'Failed to get all tasks');
    return [];
  }
}

/**
 * Delete a task by ID
 */
export function deleteTask(id: string): boolean {
  ensureStatements();

  try {
    const result = deleteTaskStmt!.run(id);
    return (result.changes ?? 0) > 0;
  } catch (error) {
    console.error(`[task-persistence] Failed to delete task ${id}:`, error);
    return false;
  }
}

/**
 * Delete tasks older than specified milliseconds
 */
export function deleteOldTasks(olderThanMs: number): number {
  ensureStatements();
  const cutoff = Date.now() - olderThanMs;

  try {
    const result = deleteOldTasksStmt!.run(cutoff);
    const deleted = result.changes ?? 0;
    if (deleted > 0) {
      console.log(`[task-persistence] Cleaned up ${deleted} tasks older than ${olderThanMs}ms`);
    }
    return deleted;
  } catch (error) {
    console.error('[task-persistence] Failed to delete old tasks:', error);
    return 0;
  }
}

/**
 * Load active tasks (queued or running) for server restart restoration
 */
export function loadActiveTasks(): TaskEntry[] {
  ensureStatements();

  try {
    const rows = getActiveTasksStmt!.all() as any[];
    const tasks = rows.map(mapRowToTaskEntry);

    if (tasks.length > 0) {
      console.log(`[task-persistence] Loaded ${tasks.length} active tasks from database`);
    }

    return tasks;
  } catch (error) {
    console.error('[task-persistence] Failed to load active tasks:', error);
    return [];
  }
}

/**
 * Map database row to TaskEntry interface
 */
function mapRowToTaskEntry(row: any): TaskEntry {
  return {
    prompt: row.prompt as string,
    agent: (row.agent as string | null) ?? undefined,
    status: row.status as 'queued' | 'running' | 'completed' | 'failed',
    result: (row.result as string | null) ?? undefined,
    error: (row.error as string | null) ?? undefined,
    model: (row.model as string | null) ?? undefined,
    startedAt: row.started_at as number,
    completedAt: (row.completed_at as number | null) ?? undefined,
    queuePosition: (row.queue_position as number | null) ?? 0,
  };
}

/**
 * Reset statement cache (useful for testing)
 */
export function resetStatements(): void {
  saveTaskStmt = null;
  updateTaskStmt = null;
  getTaskStmt = null;
  getAllTasksStmt = null;
  deleteTaskStmt = null;
  deleteOldTasksStmt = null;
  getActiveTasksStmt = null;
}
