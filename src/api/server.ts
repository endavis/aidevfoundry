import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'path';
import { orchestrate } from '../orchestrator';
import { adapters, getAvailableAdapters } from '../adapters';

interface ServerOptions {
  port: number;
  host: string;
}

interface TaskEntry {
  prompt: string;
  agent?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  model?: string;
  startedAt: number;
  completedAt?: number;
}

const tasks: Map<string, TaskEntry> = new Map();

function generateId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Cleanup tasks older than 1 hour
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  for (const [id, task] of tasks) {
    if (task.completedAt && task.completedAt < oneHourAgo) {
      tasks.delete(id);
    }
  }
}, 60000);

export async function startServer(options: ServerOptions): Promise<void> {
  const fastify = Fastify({ logger: false });

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
    tasks.set(id, {
      prompt,
      agent,
      status: 'pending',
      startedAt: Date.now()
    });

    setImmediate(async () => {
      const task = tasks.get(id)!;
      task.status = 'running';

      const result = await orchestrate(prompt, { agent });

      if (result.error) {
        task.status = 'failed';
        task.error = result.error;
      } else {
        task.status = 'completed';
        task.result = result.content;
      }
      task.model = result.model;
      task.completedAt = Date.now();
    });

    return { id, status: 'pending' };
  });

  // Get task status
  fastify.get<{ Params: { id: string } }>('/task/:id', async (request, reply) => {
    const { id } = request.params;
    const task = tasks.get(id);

    if (!task) {
      return reply.status(404).send({ error: 'task not found' });
    }

    return {
      id,
      ...task,
      duration: task.completedAt ? task.completedAt - task.startedAt : Date.now() - task.startedAt
    };
  });

  // SSE stream for task
  fastify.get<{ Params: { id: string } }>('/task/:id/stream', async (request, reply) => {
    const { id } = request.params;
    const task = tasks.get(id);

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
      const current = tasks.get(id)!;
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

    request.raw.on('close', () => {
      clearInterval(interval);
    });
  });

  await fastify.listen({ port: options.port, host: options.host });
}
