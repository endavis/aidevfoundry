/**
 * Session Manager
 *
 * Manages PTY session lifecycle with concurrency limits, queue handling,
 * timeouts, and cleanup of orphaned sessions.
 *
 * Features:
 * - Singleton pattern for centralized session management
 * - Configurable max concurrent sessions with queue
 * - Timeout handling with configurable duration
 * - Graceful cleanup on shutdown
 * - Session registry with metadata tracking
 */

import { EventEmitter } from 'events';
import { PtySession, type PtySessionOptions } from './pty-session';
import { PromptDetector } from './prompt-detector';
import { filterCredentials } from './security';
import { SessionState, type PromptEvent } from '../lib/types';

/**
 * Session metadata stored in registry
 */
export interface SessionMetadata {
  /** Session ID */
  id: string;
  /** CLI tool name */
  tool: string;
  /** CLI tool version if detected */
  version?: string;
  /** Session state */
  state: SessionState;
  /** Creation timestamp */
  createdAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Timeout handle if active */
  timeoutHandle?: NodeJS.Timeout;
  /** Prompt detector for this session */
  promptDetector: PromptDetector;
}

/**
 * Configuration for the session manager
 */
export interface SessionManagerConfig {
  /** Maximum concurrent sessions (default: 5) */
  maxConcurrentSessions?: number;
  /** Maximum queue size for waiting sessions (default: 10) */
  maxQueueSize?: number;
  /** Session timeout in ms (default: 120000 = 2 minutes) */
  sessionTimeout?: number;
  /** Whether to filter credentials from output (default: true) */
  filterCredentials?: boolean;
}

/**
 * Request to create a new session
 */
export interface SessionRequest {
  /** CLI tool name */
  tool: string;
  /** Command and arguments */
  command: string;
  args?: string[];
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** PTY options */
  ptyOptions?: Partial<PtySessionOptions>;
}

/**
 * Queued session request
 */
interface QueuedRequest {
  request: SessionRequest;
  resolve: (session: ManagedSession) => void;
  reject: (error: Error) => void;
  queuedAt: number;
}

/**
 * Events emitted by SessionManager
 */
export interface SessionManagerEvents {
  /** Emitted when a session is created */
  sessionCreated: [session: ManagedSession];
  /** Emitted when a session is closed */
  sessionClosed: [sessionId: string, reason: string];
  /** Emitted when a session times out */
  sessionTimeout: [sessionId: string];
  /** Emitted when queue is full and request is rejected */
  queueFull: [request: SessionRequest];
  /** Emitted when all sessions are closed */
  allSessionsClosed: [];
}

/**
 * A managed session wrapping PtySession with additional functionality
 */
export class ManagedSession extends EventEmitter {
  private readonly manager: SessionManager;
  private readonly ptySession: PtySession;
  private readonly promptDetector: PromptDetector;
  private readonly _metadata: SessionMetadata;
  private readonly shouldFilterCredentials: boolean;

  constructor(
    manager: SessionManager,
    ptySession: PtySession,
    metadata: SessionMetadata,
    filterCreds: boolean
  ) {
    super();
    this.manager = manager;
    this.ptySession = ptySession;
    this._metadata = metadata;
    this.promptDetector = metadata.promptDetector;
    this.shouldFilterCredentials = filterCreds;

    // Forward events from PTY session
    this.ptySession.on('output', (data: string) => {
      this.handleOutput(data);
    });

    this.ptySession.on('error', (error: Error) => {
      this.emit('error', error);
    });

    this.ptySession.on('exit', (code: number, signal?: string) => {
      this._metadata.state = SessionState.CLOSED;
      this.emit('exit', code, signal);
    });

    this.ptySession.on('stateChange', (state: SessionState) => {
      this._metadata.state = state;
      this.emit('stateChange', state);
    });
  }

  /**
   * Handle output from PTY, filtering credentials and detecting prompts
   */
  private handleOutput(data: string): void {
    // Update activity timestamp
    this._metadata.lastActivityAt = Date.now();

    // Filter credentials if enabled
    const filtered = this.shouldFilterCredentials ? filterCredentials(data) : data;

    // Emit filtered output
    this.emit('output', filtered);

    // Check for prompts
    const prompt = this.promptDetector.addOutput(filtered);
    if (prompt) {
      this._metadata.state = SessionState.PROMPTING;
      this.emit('prompt', prompt);
    }
  }

  /** Get session ID */
  get id(): string {
    return this._metadata.id;
  }

  /** Get session metadata */
  get metadata(): Readonly<SessionMetadata> {
    return this._metadata;
  }

  /** Get current state */
  get state(): SessionState {
    return this._metadata.state;
  }

  /** Get the underlying PTY session */
  get pty(): PtySession {
    return this.ptySession;
  }

  /**
   * Send input to the session
   */
  async send(input: string): Promise<void> {
    this._metadata.lastActivityAt = Date.now();
    this.promptDetector.clearBuffer();
    await this.ptySession.send(input);
  }

  /**
   * Send input followed by newline
   */
  async sendLine(input: string): Promise<void> {
    await this.send(input + '\n');
  }

  /**
   * Close the session gracefully
   */
  async close(reason?: string): Promise<void> {
    await this.manager.closeSession(this.id, reason);
  }

  /**
   * Kill the session immediately
   */
  async kill(): Promise<void> {
    await this.ptySession.kill();
    this._metadata.state = SessionState.CLOSED;
  }

  /**
   * Extend the session timeout
   */
  extendTimeout(additionalMs: number): void {
    this.manager.extendSessionTimeout(this.id, additionalMs);
  }
}

/**
 * Session Manager
 *
 * Singleton that manages all interactive PTY sessions.
 */
export class SessionManager extends EventEmitter {
  private static instance: SessionManager | null = null;

  private readonly config: Required<SessionManagerConfig>;
  private readonly sessions: Map<string, ManagedSession> = new Map();
  private readonly queue: QueuedRequest[] = [];
  private isShuttingDown = false;

  private constructor(config: SessionManagerConfig = {}) {
    super();
    this.config = {
      maxConcurrentSessions: config.maxConcurrentSessions ?? 5,
      maxQueueSize: config.maxQueueSize ?? 10,
      sessionTimeout: config.sessionTimeout ?? 120000,
      filterCredentials: config.filterCredentials ?? true,
    };
  }

  /**
   * Get the singleton instance
   */
  static getInstance(config?: SessionManagerConfig): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager(config);
    }
    return SessionManager.instance;
  }

  /**
   * Reset the singleton (for testing)
   */
  static resetInstance(): void {
    if (SessionManager.instance) {
      SessionManager.instance.closeAll('manager reset').catch(() => {});
      SessionManager.instance = null;
    }
  }

  /**
   * Create a new managed session
   *
   * If max concurrent sessions reached, queues the request.
   * If queue is full, rejects with error.
   */
  async create(request: SessionRequest): Promise<ManagedSession> {
    if (this.isShuttingDown) {
      throw new Error('Session manager is shutting down');
    }

    // Check if we can create immediately
    if (this.sessions.size < this.config.maxConcurrentSessions) {
      return this.createSession(request);
    }

    // Check if queue is full
    if (this.queue.length >= this.config.maxQueueSize) {
      this.emit('queueFull', request);
      throw new Error(
        `Queue full (${this.config.maxQueueSize} pending). ` +
          `Max concurrent sessions: ${this.config.maxConcurrentSessions}`
      );
    }

    // Queue the request
    return new Promise((resolve, reject) => {
      this.queue.push({
        request,
        resolve,
        reject,
        queuedAt: Date.now(),
      });
    });
  }

  /**
   * Actually create a session
   */
  private async createSession(request: SessionRequest): Promise<ManagedSession> {
    const ptySession = new PtySession({
      command: request.command,
      args: request.args,
      cwd: request.cwd,
      env: request.env,
      ...request.ptyOptions,
    });

    const id = ptySession.sessionId;
    const promptDetector = new PromptDetector();
    promptDetector.setTool(request.tool);

    const metadata: SessionMetadata = {
      id,
      tool: request.tool,
      state: SessionState.IDLE,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      promptDetector,
    };

    const managed = new ManagedSession(
      this,
      ptySession,
      metadata,
      this.config.filterCredentials
    );

    // Set up timeout
    this.setupTimeout(managed);

    // Handle session close
    managed.on('exit', () => {
      this.handleSessionClosed(id, 'process exited');
    });

    // Store in registry
    this.sessions.set(id, managed);

    // Spawn the process
    await ptySession.spawn();

    this.emit('sessionCreated', managed);
    return managed;
  }

  /**
   * Set up session timeout
   */
  private setupTimeout(session: ManagedSession): void {
    const metadata = session.metadata as SessionMetadata;

    // Clear existing timeout
    if (metadata.timeoutHandle) {
      clearTimeout(metadata.timeoutHandle);
    }

    // Set new timeout
    metadata.timeoutHandle = setTimeout(() => {
      this.handleSessionTimeout(session.id);
    }, this.config.sessionTimeout);
  }

  /**
   * Handle session timeout
   */
  private async handleSessionTimeout(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Check if session is still active
    const timeSinceActivity = Date.now() - session.metadata.lastActivityAt;
    if (timeSinceActivity < this.config.sessionTimeout) {
      // Session had recent activity, reset timeout
      this.setupTimeout(session);
      return;
    }

    // Timeout expired
    this.emit('sessionTimeout', sessionId);
    await this.closeSession(sessionId, 'timeout');
  }

  /**
   * Extend a session's timeout
   */
  extendSessionTimeout(sessionId: string, additionalMs: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const metadata = session.metadata as SessionMetadata;
    metadata.lastActivityAt = Date.now() + additionalMs;
    this.setupTimeout(session);
  }

  /**
   * Handle session closed
   */
  private handleSessionClosed(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const metadata = session.metadata as SessionMetadata;

    // Clear timeout
    if (metadata.timeoutHandle) {
      clearTimeout(metadata.timeoutHandle);
    }

    // Remove from registry
    this.sessions.delete(sessionId);

    this.emit('sessionClosed', sessionId, reason);

    // Process queue
    this.processQueue();

    // Check if all sessions closed
    if (this.sessions.size === 0 && this.queue.length === 0) {
      this.emit('allSessionsClosed');
    }
  }

  /**
   * Process queued requests
   */
  private processQueue(): void {
    if (this.queue.length === 0) return;
    if (this.sessions.size >= this.config.maxConcurrentSessions) return;
    if (this.isShuttingDown) {
      // Reject all queued requests during shutdown
      while (this.queue.length > 0) {
        const queued = this.queue.shift()!;
        queued.reject(new Error('Session manager is shutting down'));
      }
      return;
    }

    const queued = this.queue.shift()!;
    this.createSession(queued.request).then(queued.resolve).catch(queued.reject);
  }

  /**
   * Get a session by ID
   */
  get(sessionId: string): ManagedSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  getAll(): ManagedSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session count
   */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get queue length
   */
  get queueLength(): number {
    return this.queue.length;
  }

  /**
   * Close a specific session
   */
  async closeSession(sessionId: string, reason?: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      await session.pty.close(reason);
    } catch {
      // Force kill if graceful close fails
      await session.kill();
    }

    this.handleSessionClosed(sessionId, reason ?? 'closed');
  }

  /**
   * Close all sessions
   */
  async closeAll(reason?: string): Promise<void> {
    this.isShuttingDown = true;

    // Reject all queued requests
    while (this.queue.length > 0) {
      const queued = this.queue.shift()!;
      queued.reject(new Error(reason ?? 'Session manager shutting down'));
    }

    // Close all active sessions
    const closePromises = Array.from(this.sessions.keys()).map((id) =>
      this.closeSession(id, reason)
    );

    await Promise.all(closePromises);
    this.isShuttingDown = false;
  }

  /**
   * Check if manager has capacity for new sessions
   */
  hasCapacity(): boolean {
    return (
      this.sessions.size < this.config.maxConcurrentSessions ||
      this.queue.length < this.config.maxQueueSize
    );
  }

  /**
   * Get manager statistics
   */
  getStats(): {
    activeSessions: number;
    maxConcurrent: number;
    queuedRequests: number;
    maxQueue: number;
    sessionTimeout: number;
  } {
    return {
      activeSessions: this.sessions.size,
      maxConcurrent: this.config.maxConcurrentSessions,
      queuedRequests: this.queue.length,
      maxQueue: this.config.maxQueueSize,
      sessionTimeout: this.config.sessionTimeout,
    };
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get the session manager instance
 */
export function getSessionManager(config?: SessionManagerConfig): SessionManager {
  return SessionManager.getInstance(config);
}

/**
 * Create a new managed session
 */
export async function createManagedSession(
  request: SessionRequest
): Promise<ManagedSession> {
  return getSessionManager().create(request);
}
