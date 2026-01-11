/**
 * Task Persistence Layer
 *
 * SQLite-backed storage for API tasks with persistence across server restarts.
 * Uses better-sqlite3 for synchronous, fast SQLite operations.
 */

import { getDatabase } from '../memory/database';
import { persistenceLogger, createLogger } from '../lib/logger';

export interface TaskEntry {
  prompt: string;
  agent?: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  model?: string;
  startedAt: number;
  completedAt?: number;
}

// Create module-specific logger
const logger = createLogger({ module: 'persistence' });

// Prepared statements for performance
let saveTaskStmt: Database.Statement | null = null;
let updateTaskStmt: Database.Statement | null = null;
let getTaskStmt: Database.Statement | null = null;
let getAllTasksStmt: Database.Statement | null = null;
let deleteTaskStmt: Database.Statement | null = null;
let deleteOldTasksStmt: Database.Statement | null = null;
let getActiveTasksStmt: Database.Statement | null = null;

/**
 * Initialize prepared statements
 */
function initStatements(): void {
  const db = getDatabase();

  saveTaskStmt = db.prepare(`
    INSERT INTO api_tasks (id, prompt, agent, status, result, error, model, started_at, completed_at, updated_at, queue_position)
    VALUES (@id, @prompt, @agent, @status, @result, @error, @model, @startedAt, @completedAt, @updatedAt, @queuePosition)
  `);

  updateTaskStmt = db.prepare(`
    UPDATE api_tasks
    SET status = @status,
        result = @result,
        error = @error,
        model = @model,
        completed_at = @completedAt,
        updated_at = @updatedAt
    WHERE id = @id
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
  const db = getDatabase();
  const now = Date.now();

  // Fix #5: Validate queue position
  const validatedQueuePosition = (queuePosition !== undefined && queuePosition >= 0)
    ? queuePosition
    : 0;

  try {
    saveTaskStmt!.run({
      id,
      prompt: entry.prompt,
      agent: entry.agent || null,
      status: entry.status,
      result: entry.result || null,
      error: entry.error || null,
      model: entry.model || null,
      startedAt: entry.startedAt,
      completedAt: entry.completedAt || null,
      updatedAt: now,
      queuePosition: validatedQueuePosition,
    });
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
  const db = getDatabase();
  const now = Date.now();

  try {
    updateTaskStmt!.run({
      id,
      status: updates.status,
      result: updates.result || null,
      error: updates.error || null,
      model: updates.model || null,
      completedAt: updates.completedAt || null,
      updatedAt: now,
    });
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
    const row = getTaskStmt!.get(id) as Database.Row | undefined;
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
    const rows = getAllTasksStmt!.all() as Database.Row[];
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
    const rows = getActiveTasksStmt!.all() as Database.Row[];
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
function mapRowToTaskEntry(row: Database.Row): TaskEntry {
  return {
    prompt: row.prompt as string,
    agent: row.agent as string | undefined,
    status: row.status as 'queued' | 'running' | 'completed' | 'failed',
    result: row.result as string | undefined,
    error: row.error as string | undefined,
    model: row.model as string | undefined,
    startedAt: row.started_at as number,
    completedAt: row.completed_at as number | undefined,
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
