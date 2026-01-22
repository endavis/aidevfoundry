/**
 * Console Patching Utility for Ink TUI
 *
 * Intercepts console.log, console.warn, console.error to prevent
 * random output from breaking the Ink frame. Captured logs are
 * stored in a ring buffer and can be displayed in a dedicated panel.
 */

export interface CapturedLog {
    level: 'log' | 'warn' | 'error';
    message: string;
    timestamp: number;
}

const LOG_BUFFER_SIZE = 500;
let logBuffer: CapturedLog[] = [];
let isPatched = false;

// Store original console methods
const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
};

/**
 * Capture a log entry without writing to stdout
 */
function captureLog(level: 'log' | 'warn' | 'error', ...args: unknown[]): void {
    const message = args
        .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' ');

    logBuffer.push({
        level,
        message,
        timestamp: Date.now(),
    });

    // Trim buffer to max size
    if (logBuffer.length > LOG_BUFFER_SIZE) {
        logBuffer = logBuffer.slice(-LOG_BUFFER_SIZE);
    }
}

/**
 * Patch console methods to intercept output.
 * Call this before rendering the Ink app.
 */
export function patchConsole(): void {
    if (isPatched) return;

    console.log = (...args: unknown[]) => captureLog('log', ...args);
    console.warn = (...args: unknown[]) => captureLog('warn', ...args);
    console.error = (...args: unknown[]) => captureLog('error', ...args);

    isPatched = true;
}

/**
 * Restore original console methods.
 * Call this after the Ink app exits.
 */
export function restoreConsole(): void {
    if (!isPatched) return;

    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;

    isPatched = false;
}

/**
 * Get the captured log buffer (read-only copy)
 */
export function getCapturedLogs(): CapturedLog[] {
    return [...logBuffer];
}

/**
 * Get recent logs (last N entries)
 */
export function getRecentLogs(count: number = 50): CapturedLog[] {
    return logBuffer.slice(-count);
}

/**
 * Clear the log buffer
 */
export function clearLogBuffer(): void {
    logBuffer = [];
}

/**
 * Write directly to stdout bypassing the patch (for Ink internal use)
 */
export function writeRaw(message: string): void {
    originalConsole.log(message);
}
