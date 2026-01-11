/**
 * Codex adapter with file backup for safe rollback
 *
 * Since Codex exec mode doesn't support approval interception,
 * we backup files BEFORE running and allow rollback after.
 */

import { execa } from 'execa';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync } from 'fs';
import { join, dirname, relative } from 'path';
import { tmpdir } from 'os';
import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import { getConfig } from '../lib/config';

export interface FileChange {
  path: string;
  kind: 'add' | 'modify' | 'delete';
  originalContent: string | null;
  newContent: string | null;
}

export interface CodexSafeOptions extends RunOptions {
  /** Callback to review changes and get approval */
  onChangesReview?: (changes: FileChange[]) => Promise<boolean>;
}

// File patterns to backup (common source files)
const BACKUP_PATTERNS = [
  /\.(ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|rb|php|swift|kt)$/,
  /\.(json|yaml|yml|toml|xml|md|txt|css|scss|html)$/,
  /^(Makefile|Dockerfile|\.env.*)$/,
];

// Directories to skip
const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '__pycache__', 'target', 'vendor'];

export const codexSafeAdapter: Adapter & {
  runWithApproval: (prompt: string, options?: CodexSafeOptions) => Promise<ModelResponse>;
} = {
  name: 'codex',

  async isAvailable(): Promise<boolean> {
    const config = getConfig();
    if (!config.adapters.codex.enabled) return false;

    try {
      const command = process.platform === 'win32' ? 'where' : 'which';
      await execa(command, [config.adapters.codex.path]);
      return true;
    } catch {
      return false;
    }
  },

  // Standard run - no approval
  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const { codexAdapter } = await import('./codex');
    return codexAdapter.run(prompt, options);
  },

  // Safe mode with backup and rollback
  async runWithApproval(prompt: string, options?: CodexSafeOptions): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();
    const model = options?.model ?? config.adapters.codex.model;
    const modelName = model ? `codex/${model}` : 'codex';
    const cwd = process.cwd();

    // Create backup directory
    const backupDir = join(tmpdir(), `puzldai-backup-${Date.now()}`);
    mkdirSync(backupDir, { recursive: true });

    // Backup existing files BEFORE running Codex
    const backups: Map<string, string> = new Map(); // original path -> content
    try {
      backupDirectory(cwd, cwd, backups);
    } catch {
      // Continue even if backup fails
    }

    try {
      // Run Codex exec with workspace-write
      const args = ['exec', '--skip-git-repo-check', '--json', '--sandbox', 'workspace-write'];
      if (model) {
        args.push('-m', model);
      }
      args.push(prompt);

      const { stdout, stderr } = await execa(config.adapters.codex.path, args, {
        timeout: config.timeout,
        cancelSignal: options?.signal,
        reject: false,
        stdin: 'ignore',
        cwd
      });

      // Parse response for content and tokens
      const contentParts: string[] = [];
      let inputTokens = 0;
      let outputTokens = 0;

      if (stdout) {
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
              const text = json.item.text;
              if (text) {
                contentParts.push(text);
              }
            }
            if (json.type === 'turn.completed' && json.usage) {
              inputTokens += json.usage.input_tokens || 0;
              outputTokens += json.usage.output_tokens || 0;
            }
          } catch (lineErr) {
            // Skip invalid JSON lines but continue parsing
            if (config.logLevel === 'debug') {
              console.warn(`[codex-safe] Failed to parse JSONL line: ${(lineErr as Error).message}`);
            }
          }
        }
      }

      // Join all content parts
      const content = contentParts.join('\n');

      // Detect file changes by comparing current files with backups
      const fileChanges: FileChange[] = [];
      const currentFiles: Map<string, string> = new Map();

      // Scan directory AFTER Codex ran to find current state
      try {
        scanDirectory(cwd, cwd, currentFiles);
      } catch {
        // Continue even if scan fails
      }

      // Find modified files (content differs from backup)
      for (const [filePath, originalContent] of backups) {
        if (currentFiles.has(filePath)) {
          const newContent = currentFiles.get(filePath)!;
          if (newContent !== originalContent) {
            fileChanges.push({
              path: filePath,
              kind: 'modify',
              originalContent,
              newContent
            });
          }
        } else {
          // File was deleted
          fileChanges.push({
            path: filePath,
            kind: 'delete',
            originalContent,
            newContent: null
          });
        }
      }

      // Find new files (exist now but weren't in backup)
      for (const [filePath, newContent] of currentFiles) {
        if (!backups.has(filePath)) {
          fileChanges.push({
            path: filePath,
            kind: 'add',
            originalContent: null,
            newContent
          });
        }
      }

      // If files were changed and we have a review callback
      if (fileChanges.length > 0 && options?.onChangesReview) {
        const approved = await options.onChangesReview(fileChanges);

        if (!approved) {
          // Rollback all changes
          for (const change of fileChanges) {
            try {
              if (change.kind === 'add') {
                // Delete new file
                if (existsSync(change.path)) {
                  unlinkSync(change.path);
                }
              } else if (change.kind === 'modify' && change.originalContent !== null) {
                // Restore original content
                writeFileSync(change.path, change.originalContent, 'utf-8');
              } else if (change.kind === 'delete' && change.originalContent !== null) {
                // Restore deleted file
                const dir = dirname(change.path);
                if (!existsSync(dir)) {
                  mkdirSync(dir, { recursive: true });
                }
                writeFileSync(change.path, change.originalContent, 'utf-8');
              }
            } catch {
              // Ignore rollback errors
            }
          }

          content = `[Changes rolled back]\n\nCodex proposed:\n${fileChanges.map(c => `- ${c.kind}: ${c.path}`).join('\n')}\n\nOriginal response: ${content}`;
        }
      }

      // Cleanup backup dir
      try {
        rmSync(backupDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

      return {
        content: content || stderr || 'No response',
        model: modelName,
        duration: Date.now() - startTime,
        tokens: (inputTokens || outputTokens) ? { input: inputTokens, output: outputTokens } : undefined,
        error: stderr && !stdout ? stderr : undefined
      };

    } catch (err: unknown) {
      // Cleanup on error
      try {
        rmSync(backupDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }

      const error = err as Error;
      return {
        content: '',
        model: modelName,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }
};

/**
 * Recursively backup source files in a directory
 */
function backupDirectory(dir: string, rootDir: string, backups: Map<string, string>, depth = 0): void {
  if (depth > 5) return; // Limit depth

  try {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);

      // Skip certain directories
      if (SKIP_DIRS.includes(entry)) continue;

      try {
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          backupDirectory(fullPath, rootDir, backups, depth + 1);
        } else if (stat.isFile() && stat.size < 100000) { // Only backup files < 100KB
          // Check if file matches backup patterns
          const shouldBackup = BACKUP_PATTERNS.some(p => p.test(entry));
          if (shouldBackup) {
            try {
              const content = readFileSync(fullPath, 'utf-8');
              backups.set(fullPath, content);
            } catch {
              // Skip files that can't be read
            }
          }
        }
      } catch {
        // Skip entries that can't be stat'd
      }
    }
  } catch {
    // Skip directories that can't be read
  }
}

/**
 * Scan directory to get current file contents (for comparison after Codex)
 */
function scanDirectory(dir: string, rootDir: string, files: Map<string, string>, depth = 0): void {
  if (depth > 5) return;

  try {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      if (SKIP_DIRS.includes(entry)) continue;

      try {
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          scanDirectory(fullPath, rootDir, files, depth + 1);
        } else if (stat.isFile() && stat.size < 100000) {
          const shouldScan = BACKUP_PATTERNS.some(p => p.test(entry));
          if (shouldScan) {
            try {
              const content = readFileSync(fullPath, 'utf-8');
              files.set(fullPath, content);
            } catch {
              // Skip files that can't be read
            }
          }
        }
      } catch {
        // Skip entries that can't be stat'd
      }
    }
  } catch {
    // Skip directories that can't be read
  }
}
