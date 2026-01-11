import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'path';
import { orchestrate } from '../orchestrator';
import { adapters, getAvailableAdapters } from '../adapters';
import { TaskQueue, TaskStatus, MAX_CONCURRENT_TASKS } from './task-queue';
import * as persistence from './task-persistence';

interface ServerOptions {
  port: number;
  host: string;
}

interface TaskEntry {
  prompt: string;
  agent?: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  model?: string;
  startedAt: number;
  completedAt?: number;
}

const tasks: Map<string, TaskEntry> = new Map();
const taskQueue = new TaskQueue();

function generateId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Sync cache with persistence layer
function syncTaskToCache(id: string, entry: TaskEntry): void {
  tasks.set(id, entry);
}

function removeTaskFromCache(id: string): void {
  tasks.delete(id);
}

// Evict completed/failed tasks from cache to prevent memory leaks (Fix #4)
function evictFromCache(id: string): void {
  const task = tasks.get(id);
  if (task && (task.status === 'completed' || task.status === 'failed')) {
    tasks.delete(id);
    console.log(`[server] Evicted task ${id} from cache (status: ${task.status})`);
  }
}

// Cleanup tasks older than 1 hour (from database + cache)
setInterval(() => {
  // Clean database
  const dbDeleted = persistence.deleteOldTasks(3600000);

  // Clean cache
  const oneHourAgo = Date.now() - 3600000;
  for (const [id, task] of tasks) {
    if (task.completedAt && task.completedAt < oneHourAgo) {
      removeTaskFromCache(id);
    }
  }
}, 60000);

export async function startServer(options: ServerOptions): Promise<void> {
  const fastify = Fastify({ logger: false });

  // Restore active tasks from database on startup
  const activeTasks = persistence.loadActiveTasks();
  let restoredCount = 0;
  let failedCount = 0;

  for (const task of activeTasks) {
    const taskId = task.startedAt.toString(); // Use startedAt as ID since we need the original
    if (task.status === 'queued') {
      syncTaskToCache(taskId, task);

      // Fix #3: Re-enqueue the task so it actually executes
      taskQueue.enqueue(taskId, async () => {
        const taskForRun = tasks.get(taskId);
        if (taskForRun) {
          taskForRun.status = 'running';
          try {
            persistence.updateTask(taskId, { status: 'running' });
          } catch (dbError) {
            console.error(`[server] Failed to update task status in DB:`, dbError);
          }
        }

        try {
          // Fix #10: Wrap orchestrate in try-catch to handle unexpected errors
          const result = await orchestrate(task.prompt, { agent: task.agent });

          const currentTask = tasks.get(taskId);
          if (currentTask) {
            if (result.error) {
              currentTask.status = 'failed';
              currentTask.error = result.error;
              try {
                persistence.updateTask(taskId, { status: 'failed', error: result.error, completedAt: Date.now() });
              } catch (dbError) {
                console.error(`[server] Failed to persist task failure:`, dbError);
              }
            } else {
              currentTask.status = 'completed';
              currentTask.result = result.content;
              currentTask.model = result.model;
              try {
                persistence.updateTask(taskId, { status: 'completed', result: result.content, model: result.model, completedAt: Date.now() });
              } catch (dbError) {
                console.error(`[server] Failed to persist task completion:`, dbError);
              }
            }

            // Fix #4: Evict completed/failed tasks from cache
            evictFromCache(taskId);
          }
          return result;
        } catch (orchestrateError) {
          // Fix #10: Handle unexpected errors from orchestrate
          const errorMessage = orchestrateError instanceof Error
            ? orchestrateError.message
            : 'Unknown orchestrate error';

          console.error(`[server] Orchestrate error for task ${taskId}:`, errorMessage);

          const currentTask = tasks.get(taskId);
          if (currentTask) {
            currentTask.status = 'failed';
            currentTask.error = errorMessage;
            try {
              persistence.updateTask(taskId, {
                status: 'failed',
                error: errorMessage,
                completedAt: Date.now()
              });
            } catch (dbError) {
              console.error(`[server] Failed to persist orchestrate error:`, dbError);
            }

            // Fix #4: Evict failed tasks from cache
            evictFromCache(taskId);
          }

          throw orchestrateError; // Re-throw for task queue error handling
        }
      });

      restoredCount++;
    } else if (task.status === 'running') {
      try {
        persistence.updateTask(taskId, {
          status: 'failed',
          error: 'Server restarted during task execution',
          completedAt: Date.now(),
        });
      } catch (dbError) {
        console.error(`[server] Failed to mark running task as failed:`, dbError);
      }
      failedCount++;
    }
  }

  if (restoredCount > 0 || failedCount > 0) {
    console.log(`[server] Restored ${restoredCount} queued tasks, ${failedCount} running tasks marked failed`);
  }

  // Serve static web UI
  await fastify.register(fastifyStatic, {
    root: resolve(process.cwd(), 'web'),
    prefix: '/'
  });

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // List agents
  fastify.get('/agents', async () => {
    const available = await getAvailableAdapters();
    return {
      agents: Object.keys(adapters),
      available: available.map(a => a.name)
    };
  });

  // Submit task
  fastify.post<{ Body: { prompt: string; agent?: string } }>('/task', async (request, reply) => {
    const { prompt, agent } = request.body || {};

    if (!prompt) {
      return reply.status(400).send({ error: 'prompt is required' });
    }

    const id = generateId();
    const now = Date.now();

    // Get queue position BEFORE enqueuing (Fix #2: prevent race conditions)
    const queuePosition = taskQueue.metrics.pending + 1;

    const entry: TaskEntry = {
      prompt,
      agent,
      status: 'queued',
      startedAt: now,
    };

    // Save to database WITH queue position (Fix #2: atomic save)
    persistence.saveTask(id, entry, queuePosition);
    syncTaskToCache(id, entry);

    // Use task queue with concurrency limit (max 5)
    taskQueue.enqueue(id, async () => {
      const taskForRun = tasks.get(id);
      if (taskForRun) {
        taskForRun.status = 'running';
        // Fix #6: Add error handling for DB update
        try {
          persistence.updateTask(id, { status: 'running' });
        } catch (dbError) {
          console.error(`[server] Failed to update task status in DB:`, dbError);
        }
      }

      try {
        // Fix #10: Wrap orchestrate in try-catch to handle unexpected errors
        const result = await orchestrate(prompt, { agent });

        const currentTask = tasks.get(id);
        if (currentTask) {
          if (result.error) {
            currentTask.status = 'failed';
            currentTask.error = result.error;
            // Fix #2 & #6: Wrap DB update in try-catch, only evict on success
            try {
              persistence.updateTask(id, { status: 'failed', error: result.error, completedAt: Date.now() });
              evictFromCache(id); // ✅ Only evict after successful DB update
            } catch (dbError) {
              console.error(`[server] Failed to persist task failure:`, dbError);
              // Keep in cache so user can still see it
            }
          } else {
            currentTask.status = 'completed';
            currentTask.result = result.content;
            currentTask.model = result.model;
            // Fix #2 & #6: Wrap DB update in try-catch, only evict on success
            try {
              persistence.updateTask(id, { status: 'completed', result: result.content, model: result.model, completedAt: Date.now() });
              evictFromCache(id); // ✅ Only evict after successful DB update
            } catch (dbError) {
              console.error(`[server] Failed to persist task completion:`, dbError);
              // Keep in cache so user can still see it
            }
          }
        }
        return result;
      } catch (orchestrateError) {
        // Fix #10: Handle unexpected errors from orchestrate
        const errorMessage = orchestrateError instanceof Error
          ? orchestrateError.message
          : 'Unknown orchestrate error';

        console.error(`[server] Orchestrate error for task ${id}:`, errorMessage);

        const currentTask = tasks.get(id);
        if (currentTask) {
          currentTask.status = 'failed';
          currentTask.error = errorMessage;
          // Fix #2 & #6: Wrap DB update in try-catch, only evict on success
          try {
            persistence.updateTask(id, {
              status: 'failed',
              error: errorMessage,
              completedAt: Date.now()
            });
            evictFromCache(id); // ✅ Only evict after successful DB update
          } catch (dbError) {
            console.error(`[server] Failed to persist orchestrate error:`, dbError);
            // Keep in cache so user can still see it
          }
        }

        throw orchestrateError; // Re-throw for task queue error handling
      }
    });

    return { id, status: 'queued', queuePosition };
  });

  // Get task status
  fastify.get<{ Params: { id: string } }>('/task/:id', async (request, reply) => {
    const { id } = request.params;

    // Try cache first
    let task = tasks.get(id);

    // Fallback to database if not in cache
    if (!task) {
      const dbTask = persistence.getTask(id);
      if (dbTask) {
        syncTaskToCache(id, dbTask);
        task = dbTask;
      }
    }

    if (!task) {
      return reply.status(404).send({ error: 'task not found' });
    }

    return {
      id,
      ...task,
      duration: task.completedAt ? task.completedAt - task.startedAt : Date.now() - task.startedAt,
      queueMetrics: taskQueue.metrics,
    };
  });

  // SSE stream for task
  fastify.get<{ Params: { id: string } }>('/task/:id/stream', async (request, reply) => {
    const { id } = request.params;

    let task = tasks.get(id);
    if (!task) {
      const dbTask = persistence.getTask(id);
      if (dbTask) {
        syncTaskToCache(id, dbTask);
        task = dbTask;
      }
    }

    if (!task) {
      return reply.status(404).send({ error: 'task not found' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const sendEvent = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const interval = setInterval(() => {
      const current = tasks.get(id);
      if (!current) {
        sendEvent('error', { id, error: 'Task not found' });
        clearInterval(interval);
        reply.raw.end();
        return;
      }

      if (current.status === 'completed') {
        sendEvent('complete', { id, result: current.result, model: current.model });
        clearInterval(interval);
        reply.raw.end();
      } else if (current.status === 'failed') {
        sendEvent('error', { id, error: current.error });
        clearInterval(interval);
        reply.raw.end();
      } else {
        sendEvent('status', { id, status: current.status });
      }
    }, 100);

    // Fix #5: Handle client disconnect to prevent resource leaks
    reply.raw.on('close', () => {
      clearInterval(interval);
      console.log(`[server] SSE client disconnected for task ${id}`);
    });

    reply.raw.on('error', (err) => {
      clearInterval(interval);
      console.error(`[server] SSE error for task ${id}:`, err);
    });
  });

  await fastify.listen({ port: options.port, host: options.host });
}
