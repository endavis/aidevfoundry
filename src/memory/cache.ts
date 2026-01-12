// Simple cache implementation for pk-puzldai

/** Sync cache interface (for simple in-memory operations) */
export interface ICache<T = any> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  clear(): void;
  has(key: string): boolean;
}

/** Async cache interface (for API server with TTL support) */
export interface IAsyncCache<T = any> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  disconnect(): Promise<void>;
}

export class MemoryCache<T = any> implements ICache<T> {
  private cache = new Map<string, T>();

  get(key: string): T | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: T): void {
    this.cache.set(key, value);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }
}

/** Async memory cache with TTL support for API server */
export class AsyncMemoryCache<T = any> implements IAsyncCache<T> {
  private cache = new Map<string, { value: T; expiresAt?: number }>();

  async get(key: string): Promise<T | undefined> {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  async set(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.cache.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async disconnect(): Promise<void> {
    this.cache.clear();
  }
}

export class RedisCache<T = any> implements ICache<T> {
  private client: any;

  constructor(redisClient: any) {
    this.client = redisClient;
  }

  get(key: string): T | undefined {
    const value = this.client.get(key);
    return value ? JSON.parse(value) : undefined;
  }

  set(key: string, value: T): void {
    this.client.set(key, JSON.stringify(value));
  }

  delete(key: string): void {
    this.client.del(key);
  }

  clear(): void {
    this.client.flushAll?.();
  }

  has(key: string): boolean {
    return this.client.exists(key) === 1;
  }
}

export interface CacheOptions {
  ttl?: number;
  maxSize?: number;
  redisUrl?: string;
}

/** Create a sync cache (for simple in-memory operations) */
export function createCache<T = any>(options?: CacheOptions): ICache<T> {
  return new MemoryCache<T>();
}

/** Create an async cache (for API server with TTL support) */
export function createAsyncCache<T = any>(options?: CacheOptions): IAsyncCache<T> {
  // TODO: Add Redis support when redisUrl is provided
  return new AsyncMemoryCache<T>();
}

export type TaskEntry = {
  id: string;
  status: string;
  result?: string;
  createdAt: number;
  updatedAt: number;
};
