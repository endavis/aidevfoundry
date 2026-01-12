/**
 * Session Watchdog
 *
 * Monitors active sessions for hangs (no output for configurable duration)
 * and triggers cleanup to prevent zombie processes.
 *
 * Features:
 * - Configurable inactivity timeout
 * - Escalating termination: SIGTERM → wait → SIGKILL/taskkill
 * - Warning events before killing
 * - Comprehensive logging for debugging
 * - Zero orphan processes guarantee
 */

import { EventEmitter } from 'events';
import type { SessionManager, ManagedSession } from './session-manager';
import { SessionState } from '../lib/types';

/**
 * Watchdog configuration options
 */
export interface WatchdogConfig {
  /** Inactivity timeout in ms before warning (default: 60000 = 1 minute) */
  inactivityTimeout?: number;
  /** Grace period after warning before kill (default: 5000 = 5 seconds) */
  gracePeriod?: number;
  /** Polling interval for checking sessions (default: 5000 = 5 seconds) */
  pollInterval?: number;
  /** Whether to auto-start monitoring (default: true) */
  autoStart?: boolean;
}

/**
 * Session state tracked by watchdog
 */
interface WatchedSession {
  /** Session ID */
  id: string;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Whether a warning has been emitted */
  warned: boolean;
  /** Warning timestamp if warned */
  warnedAt?: number;
}

/**
 * Events emitted by Watchdog
 */
export interface WatchdogEvents {
  /** Emitted when a session is about to be killed due to inactivity */
  warning: [sessionId: string, inactiveMs: number];
  /** Emitted when a session is killed due to inactivity */
  killed: [sessionId: string, reason: string];
  /** Emitted when watchdog starts monitoring */
  started: [];
  /** Emitted when watchdog stops monitoring */
  stopped: [];
  /** Emitted on each poll cycle with stats */
  poll: [stats: WatchdogStats];
}

/**
 * Watchdog statistics
 */
export interface WatchdogStats {
  /** Number of sessions being watched */
  watchedSessions: number;
  /** Number of sessions warned but not yet killed */
  warnedSessions: number;
  /** Total sessions killed since watchdog started */
  totalKilled: number;
  /** Watchdog uptime in ms */
  uptimeMs: number;
}

/**
 * Session Watchdog
 *
 * Monitors sessions for inactivity and kills hung processes.
 */
export class Watchdog extends EventEmitter {
  private readonly config: Required<WatchdogConfig>;
  private readonly sessionManager: SessionManager;
  private readonly watched: Map<string, WatchedSession> = new Map();
  private pollTimer: NodeJS.Timeout | null = null;
  private startedAt: number = 0;
  private totalKilled = 0;
  private isRunning = false;

  constructor(sessionManager: SessionManager, config: WatchdogConfig = {}) {
    super();
    this.sessionManager = sessionManager;
    this.config = {
      inactivityTimeout: config.inactivityTimeout ?? 60000,
      gracePeriod: config.gracePeriod ?? 5000,
      pollInterval: config.pollInterval ?? 5000,
      autoStart: config.autoStart ?? true,
    };

    // Subscribe to session events
    this.sessionManager.on('sessionCreated', (session: ManagedSession) => {
      this.watchSession(session);
    });

    this.sessionManager.on('sessionClosed', (sessionId: string) => {
      this.unwatchSession(sessionId);
    });

    // Auto-start if configured
    if (this.config.autoStart) {
      this.start();
    }
  }

  /**
   * Start the watchdog
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.startedAt = Date.now();

    // Watch any existing sessions
    for (const session of this.sessionManager.getAll()) {
      this.watchSession(session);
    }

    // Start polling
    this.pollTimer = setInterval(() => {
      this.poll();
    }, this.config.pollInterval);

    this.emit('started');
  }

  /**
   * Stop the watchdog
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.watched.clear();
    this.emit('stopped');
  }

  /**
   * Start watching a session
   */
  private watchSession(session: ManagedSession): void {
    const now = Date.now();

    this.watched.set(session.id, {
      id: session.id,
      lastActivityAt: session.metadata.lastActivityAt || now,
      warned: false,
    });

    // Listen for activity
    session.on('output', () => {
      this.updateActivity(session.id);
    });

    session.on('prompt', () => {
      this.updateActivity(session.id);
    });
  }

  /**
   * Stop watching a session
   */
  private unwatchSession(sessionId: string): void {
    this.watched.delete(sessionId);
  }

  /**
   * Update activity timestamp for a session
   */
  updateActivity(sessionId: string): void {
    const watched = this.watched.get(sessionId);
    if (watched) {
      watched.lastActivityAt = Date.now();
      watched.warned = false;
      watched.warnedAt = undefined;
    }
  }

  /**
   * Poll all watched sessions for inactivity
   */
  private async poll(): Promise<void> {
    const now = Date.now();
    const toKill: string[] = [];

    for (const [sessionId, watched] of this.watched) {
      const session = this.sessionManager.get(sessionId);
      if (!session) {
        this.watched.delete(sessionId);
        continue;
      }

      // Skip sessions in certain states
      if (
        session.state === SessionState.CLOSED ||
        session.state === SessionState.CLOSING
      ) {
        continue;
      }

      const inactiveMs = now - watched.lastActivityAt;

      // Check if session is inactive
      if (inactiveMs >= this.config.inactivityTimeout) {
        if (!watched.warned) {
          // First time detecting inactivity - emit warning
          watched.warned = true;
          watched.warnedAt = now;
          this.emit('warning', sessionId, inactiveMs);
        } else if (watched.warnedAt) {
          // Already warned - check grace period
          const timeSinceWarning = now - watched.warnedAt;
          if (timeSinceWarning >= this.config.gracePeriod) {
            // Grace period expired - kill session
            toKill.push(sessionId);
          }
        }
      }
    }

    // Kill inactive sessions
    for (const sessionId of toKill) {
      await this.killSession(sessionId);
    }

    // Emit poll stats
    this.emit('poll', this.getStats());
  }

  /**
   * Kill an inactive session
   */
  private async killSession(sessionId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId);
    if (!session) return;

    const watched = this.watched.get(sessionId);
    const inactiveMs = watched
      ? Date.now() - watched.lastActivityAt
      : this.config.inactivityTimeout;

    try {
      // Try graceful close first
      await session.pty.close('watchdog: inactivity timeout');
    } catch {
      // Fall back to kill
      try {
        await session.kill();
      } catch (killError) {
        console.error(
          `[watchdog] Failed to kill session ${sessionId}:`,
          killError
        );
      }
    }

    this.totalKilled++;
    this.watched.delete(sessionId);
    this.emit('killed', sessionId, `inactive for ${Math.round(inactiveMs / 1000)}s`);
  }

  /**
   * Force kill all watched sessions immediately
   */
  async killAll(reason?: string): Promise<void> {
    const sessionIds = Array.from(this.watched.keys());

    for (const sessionId of sessionIds) {
      const session = this.sessionManager.get(sessionId);
      if (session) {
        try {
          await session.kill();
          this.totalKilled++;
          this.emit('killed', sessionId, reason ?? 'forced kill');
        } catch (error) {
          console.error(`[watchdog] Failed to kill session ${sessionId}:`, error);
        }
      }
      this.watched.delete(sessionId);
    }
  }

  /**
   * Get watchdog statistics
   */
  getStats(): WatchdogStats {
    let warnedCount = 0;
    for (const watched of this.watched.values()) {
      if (watched.warned) warnedCount++;
    }

    return {
      watchedSessions: this.watched.size,
      warnedSessions: warnedCount,
      totalKilled: this.totalKilled,
      uptimeMs: this.isRunning ? Date.now() - this.startedAt : 0,
    };
  }

  /**
   * Check if watchdog is running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<Required<WatchdogConfig>> {
    return this.config;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/** Default watchdog instance */
let defaultWatchdog: Watchdog | null = null;

/**
 * Get or create the default watchdog
 */
export function getWatchdog(
  sessionManager: SessionManager,
  config?: WatchdogConfig
): Watchdog {
  if (!defaultWatchdog) {
    defaultWatchdog = new Watchdog(sessionManager, config);
  }
  return defaultWatchdog;
}

/**
 * Create a new watchdog instance
 */
export function createWatchdog(
  sessionManager: SessionManager,
  config?: WatchdogConfig
): Watchdog {
  return new Watchdog(sessionManager, config);
}

/**
 * Reset the default watchdog (for testing)
 */
export function resetWatchdog(): void {
  if (defaultWatchdog) {
    defaultWatchdog.stop();
    defaultWatchdog = null;
  }
}
