import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyJwt from '@fastify/jwt';
import { resolve } from 'path';
import { orchestrate } from '../orchestrator';
import { adapters, getAvailableAdapters } from '../adapters';
import type { Adapter } from '../lib/types';
import { TaskQueue } from './task-queue';
import * as persistence from './task-persistence';
import { authRoutes } from './auth/routes';
import { createLogger, generateRequestId, apiLogger } from '../lib/logger';
import {
  taskSubmissionSchema,
  taskResponseSchema,
  taskStatusResponseSchema,
  healthResponseSchema,
  agentsResponseSchema,
  errorResponseSchema
} from './schema';
import { getSummaryGenerator } from '../lib/summary-generator';
import { AppError } from './errors';
import { type IAsyncCache, createAsyncCache } from '../memory/cache';
import type { TaskEntry } from './task-persistence';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: any;
  }
}

interface ServerOptions {
  port: number;
  host: string;
}

export interface CreateServerOptions extends Partial<ServerOptions> {
  restoreTasks?: boolean;
  redisUrl?: string;
  getAvailableAdapters?: () => Promise<Adapter[]>;
}

let taskCache: IAsyncCache<TaskEntry>;
const taskQueue = new TaskQueue();

function generateId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Sync cache with persistence layer
async function syncTaskToCache(id: string, entry: TaskEntry): Promise<void> {
  // Default TTL 24h for active tasks
  await taskCache.set(id, entry, 86400);
}

async function removeTaskFromCache(id: string): Promise<void> {
  await taskCache.del(id);
}

// Evict completed/failed tasks from cache to prevent memory leaks (Fix #4)
async function evictFromCache(id: string): Promise<void> {
  const task = await taskCache.get(id);
  if (task && (task.status === 'completed' || task.status === 'failed')) {
    await taskCache.del(id);
    apiLogger.info({ taskId: id, status: task.status }, 'Evicted task from cache');
  }
}

// Cleanup tasks older than 1 hour (from database)
// Cache cleanup is handled by TTLs or explicit eviction.
setInterval(() => {
  // Clean database
  persistence.deleteOldTasks(3600000);
}, 60000);

export async function createServer(options: CreateServerOptions = {}): Promise<ReturnType<typeof Fastify>> {
  const fastify = Fastify({ logger: false });
  const getAvailableAdaptersFn = options.getAvailableAdapters ?? getAvailableAdapters;

  // Initialize Cache
  taskCache = createAsyncCache<TaskEntry>({ redisUrl: options.redisUrl });

  // Add request ID tracing middleware
  fastify.addHook('onRequest', async (request, reply) => {
    const requestId = request.headers['x-request-id'] as string || generateRequestId();
    const req = request as any;
    req.requestId = requestId;
    req.log = createLogger({ module: 'api', requestId });
    reply.header('x-request-id', requestId);
  });

  fastify.addHook('onClose', async () => {
    await taskCache.disconnect();
  });

  // Centralized Error Handler
  fastify.setErrorHandler((error, request, reply) => {
    const requestId = (request as any).requestId;
    const log = (request as any).log || apiLogger;

    if (error instanceof AppError) {
      log.error({ error, requestId }, `API Error: ${error.message}`);
      reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
        details: error.details,
      });
    } else if (error && typeof error === 'object' && 'validation' in error) {
      // Fastify validation error
      const validationError = error as { validation: unknown };
      log.warn({ error, requestId }, 'Validation Error');
      reply.status(400).send({
        error: 'Validation Error',
        code: 'VALIDATION_ERROR',
        details: validationError.validation,
      });
    } else {
      // Unknown error
      log.error({ error, requestId }, 'Unhandled Server Error');
      reply.status(500).send({
        error: 'Internal Server Error',
        code: 'INTERNAL_SERVER_ERROR',
      });
    }
  });

  if (options.restoreTasks ?? true) {
    // Restore active tasks from database on startup
    const activeTasks = persistence.loadActiveTasks();
    let restoredCount = 0;
    let failedCount = 0;

    for (const task of activeTasks) {
      const taskId = task.startedAt.toString(); // Use startedAt as ID since we need the original
      if (task.status === 'queued') {
        await syncTaskToCache(taskId, task);

        // Fix #3: Re-enqueue the task so it actually executes
        taskQueue.enqueue(taskId, async () => {
          const taskForRun = await taskCache.get(taskId);
          if (taskForRun) {
            taskForRun.status = 'running';
            await syncTaskToCache(taskId, taskForRun);
            try {
              persistence.updateTask(taskId, { status: 'running' });
            } catch (dbError) {
              apiLogger.error({ taskId, error: dbError }, 'Failed to update task status in DB');
            }
          }

          try {
            // Fix #10: Wrap orchestrate in try-catch to handle unexpected errors
            const result = await orchestrate(task.prompt, { agent: task.agent });

            const currentTask = await taskCache.get(taskId);
            if (currentTask) {
              if (result.error) {
                currentTask.status = 'failed';
                currentTask.error = result.error;
                try {
                  persistence.updateTask(taskId, { status: 'failed', error: result.error, completedAt: Date.now() });
                } catch (dbError) {
                  apiLogger.error({ taskId, error: dbError }, 'Failed to persist task failure');
                }
              } else {
                currentTask.status = 'completed';
                currentTask.result = result.content;
                currentTask.model = result.model;
                try {
                  persistence.updateTask(taskId, { status: 'completed', result: result.content, model: result.model, completedAt: Date.now() });
                } catch (dbError) {
                  apiLogger.error({ taskId, error: dbError }, 'Failed to persist task completion');
                }
              }

              // Fix #4: Evict completed/failed tasks from cache
              await evictFromCache(taskId);
            }
            return result;
          } catch (orchestrateError) {
            // Fix #10: Handle unexpected errors from orchestrate
            const errorMessage = orchestrateError instanceof Error
              ? orchestrateError.message
              : 'Unknown orchestrate error';

            apiLogger.error({ taskId, error: errorMessage }, 'Orchestrate error');

            const currentTask = await taskCache.get(taskId);
            if (currentTask) {
              currentTask.status = 'failed';
              currentTask.error = errorMessage;
              try {
                persistence.updateTask(taskId, {
                  status: 'failed',
                  error: errorMessage,
                  completedAt: Date.now()
                });
                await evictFromCache(taskId);
              } catch (dbError) {
                apiLogger.error({ taskId, error: dbError }, 'Failed to persist orchestrate error');
              }
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
          apiLogger.error({ taskId, error: dbError }, 'Failed to mark running task as failed');
        }
        failedCount++;
      }
    }

    if (restoredCount > 0 || failedCount > 0) {
      apiLogger.info({ restoredCount, failedCount }, 'Restored tasks on startup');
    }
  }

  // Register JWT
  await fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'dev-secret-do-not-use-in-prod'
  });

  // Decorate with authenticate
  fastify.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.send(err);
    }
  });

  // Register Auth Routes
  await fastify.register(authRoutes);

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
    const available = await getAvailableAdaptersFn();
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
    await syncTaskToCache(id, entry);

    // Use task queue with concurrency limit (max 5)
    taskQueue.enqueue(id, async () => {
      const taskForRun = await taskCache.get(id);
      if (taskForRun) {
        taskForRun.status = 'running';
        // Fix #6: Add error handling for DB update
        await syncTaskToCache(id, taskForRun);
        try {
          persistence.updateTask(id, { status: 'running' });
        } catch (dbError) {
          apiLogger.error({ taskId: id, error: dbError }, 'Failed to update task status in DB');
        }
      }

      try {
        // Fix #10: Wrap orchestrate in try-catch to handle unexpected errors
        const result = await orchestrate(prompt, { agent });

        const currentTask = await taskCache.get(id);
        if (currentTask) {
          if (result.error) {
            currentTask.status = 'failed';
            currentTask.error = result.error;
            // Fix #2 & #6: Wrap DB update in try-catch, only evict on success
            try {
              persistence.updateTask(id, { status: 'failed', error: result.error, completedAt: Date.now() });
              await evictFromCache(id); // ✅ Only evict after successful DB update
            } catch (dbError) {
              apiLogger.error({ taskId: id, error: dbError }, 'Failed to persist task failure');
              // Keep in cache so user can still see it
            }
          } else {
            currentTask.status = 'completed';
            currentTask.result = result.content;
            currentTask.model = result.model;
            // Fix #2 & #6: Wrap DB update in try-catch, only evict on success
            try {
              persistence.updateTask(id, { status: 'completed', result: result.content, model: result.model, completedAt: Date.now() });
              await evictFromCache(id); // ✅ Only evict after successful DB update
            } catch (dbError) {
              apiLogger.error({ taskId: id, error: dbError }, 'Failed to persist task completion');
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

        apiLogger.error({ taskId: id, error: errorMessage }, 'Orchestrate error');

        const currentTask = await taskCache.get(id);
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
            await evictFromCache(id); // ✅ Only evict after successful DB update
          } catch (dbError) {
            apiLogger.error({ taskId: id, error: dbError }, 'Failed to persist orchestrate error');
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
    let task = await taskCache.get(id);

    // Fallback to database if not in cache
    if (!task) {
      const dbTask = persistence.getTask(id);
      if (dbTask) {
        await syncTaskToCache(id, dbTask);
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

    let task = await taskCache.get(id);
    if (!task) {
      const dbTask = persistence.getTask(id);
      if (dbTask) {
        await syncTaskToCache(id, dbTask);
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

    let timeoutId: NodeJS.Timeout;
    let isClosed = false;

    const checkStatus = async () => {
      if (isClosed) return;

      const current = await taskCache.get(id);
      if (!current) {
        sendEvent('error', { id, error: 'Task not found' });
        reply.raw.end();
        return;
      }

      if (current.status === 'completed') {
        sendEvent('complete', { id, result: current.result, model: current.model });
        reply.raw.end();
      } else if (current.status === 'failed') {
        sendEvent('error', { id, error: current.error });
        reply.raw.end();
      } else {
        // Generate AI summary for status updates
        const elapsed = Date.now() - current.startedAt;
        let summary: string;
        try {
          summary = await getSummaryGenerator().summarizeStatus(current.status);
        } catch {
          summary = '⚙️ Processing...';
        }
        sendEvent('status', { id, status: current.status, summary, elapsed });
        timeoutId = setTimeout(checkStatus, 500); // Reduced frequency for smoother UX
      }
    };

    checkStatus();

    // Fix #5: Handle client disconnect to prevent resource leaks
    reply.raw.on('close', () => {
      isClosed = true;
      if (timeoutId) clearTimeout(timeoutId);
      apiLogger.info({ taskId: id }, 'SSE client disconnected');
    });

    reply.raw.on('error', (err) => {
      isClosed = true;
      if (timeoutId) clearTimeout(timeoutId);
      apiLogger.error({ taskId: id, error: err }, 'SSE error');
    });
  });

  return fastify;
}

export async function startServer(options: ServerOptions): Promise<void> {
  // Structured logging for server startup
  apiLogger.info({ port: options.port, host: options.host }, 'Starting PuzldAI API server');
  const redisUrl = process.env.REDIS_URL;
  const fastify = await createServer({ ...options, restoreTasks: true, redisUrl });
  await fastify.listen({ port: options.port, host: options.host });
}
