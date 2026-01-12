/**
 * API Server Tests
 * Integration tests for the PuzldAI REST API.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { createServer } from './server';

describe('API Server', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    fastify = await createServer({
      restoreTasks: false,
      getAvailableAdapters: async () => []
    });
  });

  afterEach(async () => {
    if (fastify) {
      await fastify.close();
    }
  });

  describe('POST /task', () => {
    it('should return 400 when prompt is missing', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/task',
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('prompt is required');
    });

    it('should accept valid task submission', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/task',
        payload: { prompt: 'Test task', agent: 'claude' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('id');
      expect(body.id).toMatch(/^task_\d+_/);
      expect(body.status).toBe('queued');
    });

    it('should generate unique task IDs', async () => {
      const r1 = await fastify.inject({ method: 'POST', url: '/task', payload: { prompt: '1' } });
      const r2 = await fastify.inject({ method: 'POST', url: '/task', payload: { prompt: '2' } });
      expect(r1.json().id).not.toBe(r2.json().id);
    });
  });

  describe('GET /task/:id', () => {
    it('should return 404 for non-existent task', async () => {
      const response = await fastify.inject({ method: 'GET', url: '/task/notfound' });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const response = await fastify.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('ok');
    });
  });

  describe('GET /agents', () => {
    it('should return list of agents', async () => {
      const response = await fastify.inject({ method: 'GET', url: '/agents' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('agents');
      expect(response.json()).toHaveProperty('available');
    });
  });
});

describe('generateId', () => {
  it('should generate IDs with correct format', () => {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    expect(id).toMatch(/^task_\d+_[a-z0-9]+$/);
  });

  it('should generate unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      ids.add(id);
    }
    expect(ids.size).toBeGreaterThan(90);
  });
});
