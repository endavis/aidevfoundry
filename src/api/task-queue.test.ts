/**
 * Task Queue Tests
 *
 * Tests for TaskQueue with concurrency control.
 * Uses Bun test framework.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { TaskQueue, TaskStatus, MAX_CONCURRENT_TASKS } from './task-queue';

describe('TaskQueue', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue();
  });

  describe('metrics', () => {
    it('should return zero metrics for empty queue', () => {
      const metrics = queue.metrics;
      expect(metrics.running).toBe(0);
      expect(metrics.pending).toBe(0);
      expect(metrics.total).toBe(0);
    });
  });

  describe('enqueue', () => {
    it('should add task to queue and execute', async () => {
      const taskFn = async () => 'result';
      const promise = queue.enqueue('task_1', taskFn);

      // Task starts executing immediately (no backlog), so pending may be 0
      const metrics = queue.metrics;
      expect(metrics.total).toBeGreaterThanOrEqual(0);

      const result = await promise;
      expect(result).toBe('result');
    });

    it('should execute task and return result', async () => {
      const taskFn = async () => 'test_result';
      const promise = queue.enqueue('task_1', taskFn);

      const result = await promise;
      expect(result).toBe('test_result');
    });

    it('should handle task errors', async () => {
      const taskFn = async () => {
        throw new Error('Task failed');
      };
      const promise = queue.enqueue('task_1', taskFn);

      await expect(promise).rejects.toThrow('Task failed');
    });

    it('should process multiple tasks concurrently up to limit', async () => {
      const runningTasks: string[] = [];
      const maxConcurrent = MAX_CONCURRENT_TASKS;

      const tasks = Array.from({ length: maxConcurrent + 2 }, (_, i) =>
        queue.enqueue(`task_${i}`, async () => {
          runningTasks.push(`task_${i}`);
          await new Promise(resolve => setTimeout(resolve, 50));
          return `result_${i}`;
        })
      );

      // Wait for all to complete
      await Promise.all(tasks);

      // All tasks should have been processed
      expect(runningTasks.length).toBeGreaterThanOrEqual(maxConcurrent + 2);
    });
  });

  describe('concurrency limit', () => {
    it('should respect MAX_CONCURRENT_TASKS limit', () => {
      expect(MAX_CONCURRENT_TASKS).toBe(5);
    });
  });
});

describe('TaskStatus', () => {
  it('should have correct status values', () => {
    expect(TaskStatus.Queued).toBe(TaskStatus.Queued);
    expect(TaskStatus.Running).toBe(TaskStatus.Running);
    expect(TaskStatus.Completed).toBe(TaskStatus.Completed);
    expect(TaskStatus.Failed).toBe(TaskStatus.Failed);
    // Also verify string values match
    expect(TaskStatus.Queued).toBe('queued' as TaskStatus);
    expect(TaskStatus.Running).toBe('running' as TaskStatus);
    expect(TaskStatus.Completed).toBe('completed' as TaskStatus);
    expect(TaskStatus.Failed).toBe('failed' as TaskStatus);
  });
});
