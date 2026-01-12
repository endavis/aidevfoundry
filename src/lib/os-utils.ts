/**
 * OS-specific utilities for cross-platform compatibility
 */

/**
 * Get the default shell for the current platform
 */
export function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

/**
 * Get shell-specific arguments for running a command
 */
export function getShellArgs(command: string): string[] {
  if (process.platform === 'win32') {
    return ['/c', command];
  }
  return ['-c', command];
}

/**
 * Kill a process with appropriate method for the platform
 */
export async function killProcess(pid: number, force = false): Promise<void> {
  if (process.platform === 'win32') {
    // Windows: use taskkill
    const args = force ? ['/T', '/F', '/PID', pid.toString()] : ['/PID', pid.toString()];
    const { execa } = await import('execa');
    await execa('taskkill', args, { reject: false });
  } else {
    // Unix: use kill
    const { spawn } = await import('child_process');
    
    if (force) {
      process.kill(pid, 'SIGKILL');
    } else {
      process.kill(pid, 'SIGTERM');
      // Give process time to terminate gracefully
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Check if process is still running
      try {
        process.kill(pid, 0);
        // Process still running, force kill
        process.kill(pid, 'SIGKILL');
      } catch {
        // Process already terminated
      }
    }
  }
}

/**
 * Normalize line endings in text (CRLF -> LF)
 */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Check if Windows ConPTY is available (Windows 10 1809+)
 */
export async function isConPtyAvailable(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return false;
  }

  try {
    const { execa } = await import('execa');
    await execa('powershell', ['$PSVersionTable.PSVersion.Major'], { reject: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get platform-specific PTY type
 */
export function getPtyType(): string {
  if (process.platform === 'win32') {
    return 'conpty';
  }
  return 'pty';
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Check if running on macOS
 */
export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  return process.platform === 'linux';
}

/**
 * Get the home directory for the current user
 */
export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH || '';
}

/**
 * Get the temp directory
 */
export function getTempDir(): string {
  return process.env.TMP || process.env.TEMP || '/tmp';
}

/**
 * Check if a path is absolute
 */
export function isAbsolutePath(path: string): boolean {
  if (process.platform === 'win32') {
    return /^[a-zA-Z]:/.test(path) || path.startsWith('\\\\');
  }
  return path.startsWith('/');
}

/**
 * Join path segments (cross-platform)
 */
export function joinPath(...segments: string[]): string {
  if (process.platform === 'win32') {
    return segments.join('\\');
  }
  return segments.join('/');
}

/**
 * Get the platform-specific newline character
 */
export function getNewline(): string {
  return process.platform === 'win32' ? '\r\n' : '\n';
}
