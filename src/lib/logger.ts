/**
 * Structured Logger for PuzldAI
 *
 * Uses pino for structured JSON logging with:
 * - Log levels (debug, info, warn, error)
 * - Request ID tracing
 * - Child loggers with context
 * - Production-ready configuration
 */

import pino from 'pino';
import { v4 as uuidv4 } from 'crypto';

// Create base logger with production-ready defaults
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
    req: (request) => ({
      method: request.method,
      url: request.url,
      headers: request.headers,
      remoteAddress: request.remoteAddress,
    }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // In production, use JSON formatting
  // In development, use pretty printing via pino-pretty
  ...(process.env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }),
});

// Types for log context
export interface LogContext {
  requestId?: string;
  taskId?: string;
  agent?: string;
  module?: string;
  operation?: string;
}

/**
 * Create a child logger with additional context
 */
export function createLogger(context: LogContext): pino.Logger {
  return logger.child(context);
}

/**
 * Generate a new request ID
 */
export function generateRequestId(): string {
  // Use crypto.randomUUID() if available (Node 14.17+)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback to simple UUID generation
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Get or create request ID from context
 */
export function getRequestId(context: LogContext): string {
  return context.requestId || generateRequestId();
}

// Convenience loggers for common modules
export const apiLogger = logger.child({ module: 'api' });
export const taskQueueLogger = logger.child({ module: 'task-queue' });
export const persistenceLogger = logger.child({ module: 'persistence' });
export const adapterLogger = logger.child({ module: 'adapter' });
export const orchestratorLogger = logger.child({ module: 'orchestrator' });

export { logger };
export default logger;
