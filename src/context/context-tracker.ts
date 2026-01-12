/**
 * Context Tracker
 *
 * Tracks active files in the current session for status bar display.
 */

import pc from 'picocolors';
import { basename } from 'path';

export interface ActiveFile {
  path: string;
  accessedAt: number;
  accessCount: number;
}

/**
 * Active files tracker (singleton)
 */
class ContextTracker {
  private files: Map<string, ActiveFile> = new Map();
  private maxFiles = 50; // Keep track of last 50 files

  /**
   * Record a file access
   */
  access(filePath: string): void {
    const existing = this.files.get(filePath);

    if (existing) {
      existing.accessedAt = Date.now();
      existing.accessCount++;
    } else {
      // Remove oldest if at capacity
      if (this.files.size >= this.maxFiles) {
        const oldest = this.getOldestFile();
        if (oldest) {
          this.files.delete(oldest.path);
        }
      }

      this.files.set(filePath, {
        path: filePath,
        accessedAt: Date.now(),
        accessCount: 1,
      });
    }
  }

  /**
   * Get active files sorted by recent access
   */
  getActiveFiles(limit = 10): ActiveFile[] {
    return Array.from(this.files.values())
      .sort((a, b) => b.accessedAt - a.accessedAt)
      .slice(0, limit);
  }

  /**
   * Get file count
   */
  getCount(): number {
    return this.files.size;
  }

  /**
   * Get the oldest accessed file
   */
  private getOldestFile(): ActiveFile | undefined {
    let oldest: ActiveFile | undefined;
    for (const file of this.files.values()) {
      if (!oldest || file.accessedAt < oldest.accessedAt) {
        oldest = file;
      }
    }
    return oldest;
  }

  /**
   * Clear all tracked files
   */
  clear(): void {
    this.files.clear();
  }

  /**
   * Remove a specific file from tracking
   */
  remove(filePath: string): void {
    this.files.delete(filePath);
  }
}

// Singleton instance
export const contextTracker = new ContextTracker();

/**
 * Format active files for status bar display
 */
export function formatActiveFiles(limit = 3): string {
  const files = contextTracker.getActiveFiles(limit);
  const total = contextTracker.getCount();

  if (files.length === 0) {
    return pc.dim('[no active files]');
  }

  const names = files.map(f => basename(f.path));
  const displayed = names.slice(0, limit);
  const remaining = total - displayed.length;

  let result = pc.cyan(`[${total} files] `) + displayed.join(', ');

  if (remaining > 0) {
    result += pc.dim(` +${remaining} more`);
  }

  return result;
}

/**
 * Format active files as detailed list
 */
export function formatActiveFilesList(): string {
  const files = contextTracker.getActiveFiles(20);

  if (files.length === 0) {
    return 'No active files in context.';
  }

  const lines = ['Active files in context:', ''];

  for (const file of files) {
    const name = basename(file.path);
    const ago = formatTimeAgo(file.accessedAt);
    lines.push(`  ${pc.cyan(name)} - accessed ${ago} (${file.accessCount}x)`);
    lines.push(pc.dim(`    ${file.path}`));
  }

  return lines.join('\n');
}

/**
 * Format timestamp as "X ago"
 */
function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Create status bar component for active context
 */
export function createContextStatusBar(maxWidth = 50): string {
  const files = contextTracker.getActiveFiles(5);
  const total = contextTracker.getCount();

  if (files.length === 0) {
    return '';
  }

  const prefix = pc.dim('Context: ');
  const names = files.map(f => basename(f.path));

  // Fit names within width
  let display = '';
  let included = 0;

  for (const name of names) {
    if ((display + name).length > maxWidth - 15) break;
    if (display) display += ', ';
    display += name;
    included++;
  }

  const remaining = total - included;
  if (remaining > 0) {
    display += pc.dim(` +${remaining}`);
  }

  return prefix + pc.cyan(display);
}
