export const MAX_CONCURRENT_TASKS = 5;

export enum TaskStatus {
  Queued = 'queued',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
}

type TaskFn<T> = () => Promise<T> | T;

interface TaskQueueItem<T> {
  taskId: string;
  taskFn: TaskFn<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  status: TaskStatus;
}

class Semaphore {
  private current = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  get available(): number {
    return this.max - this.current;
  }

  async acquire(): Promise<() => void> {
    if (this.current < this.max) {
      this.current++;
      return this.createRelease();
    }

    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.current++;
        resolve(this.createRelease());
      });
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.current--;
      const next = this.waiters.shift();
      if (next) next();
    };
  }
}

export class TaskQueue {
  private readonly semaphore = new Semaphore(MAX_CONCURRENT_TASKS);
  private readonly pending: Array<TaskQueueItem<unknown>> = [];
  private runningCount = 0;

  enqueue<T>(taskId: string, taskFn: TaskFn<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const item: TaskQueueItem<T> = {
        taskId,
        taskFn,
        resolve,
        reject,
        status: TaskStatus.Queued,
      };

      this.pending.push(item as TaskQueueItem<unknown>);
      this._processQueue();
    });
  }

  get metrics(): { running: number; pending: number; total: number } {
    const pending = this.pending.length;
    const running = this.runningCount;
    return {
      running,
      pending,
      total: running + pending,
    };
  }

  private _processQueue(): void {
    while (this.pending.length > 0 && this.semaphore.available > 0) {
      const item = this.pending.shift();
      if (!item) return;
      void this.runTask(item);
    }
  }

  private async runTask(item: TaskQueueItem<unknown>): Promise<void> {
    const release = await this.semaphore.acquire();
    this.runningCount++;
    item.status = TaskStatus.Running;

    try {
      const result = await item.taskFn();
      item.status = TaskStatus.Completed;
      item.resolve(result);
    } catch (error) {
      item.status = TaskStatus.Failed;
      item.reject(error);
    } finally {
      this.runningCount--;
      release();
      this._processQueue();
    }
  }
}
