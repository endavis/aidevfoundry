/**
 * File Executor (Phase 9.2)
 *
 * Applies ProposedEdit[] to the filesystem.
 * Handles create, edit (overwrite), and delete operations.
 */

import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { ProposedEdit } from '../lib/edit-review';

export interface ExecuteResult {
  success: boolean;
  error?: string;
}

export interface BatchExecuteResult {
  applied: string[];
  failed: Array<{ path: string; error: string }>;
  skipped: string[];
}

/**
 * Ensures parent directory exists
 */
function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Executes a single file operation
 */
export function executeEdit(edit: ProposedEdit): ExecuteResult {
  try {
    switch (edit.operation) {
      case 'Write':
      case 'Edit': {
        ensureDir(edit.filePath);
        writeFileSync(edit.filePath, edit.proposedContent, 'utf-8');
        return { success: true };
      }

      case 'Delete': {
        if (!existsSync(edit.filePath)) {
          return {
            success: false,
            error: `File does not exist: ${edit.filePath}`
          };
        }
        unlinkSync(edit.filePath);
        return { success: true };
      }

      default:
        return {
          success: false,
          error: `Unknown operation: ${edit.operation}`
        };
    }
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message
    };
  }
}

/**
 * Executes multiple file operations
 */
export function executeEdits(
  edits: ProposedEdit[],
  skipPaths?: Set<string>
): BatchExecuteResult {
  const applied: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];
  const skipped: string[] = [];

  for (const edit of edits) {
    // Skip if in skip list
    if (skipPaths?.has(edit.filePath)) {
      skipped.push(edit.filePath);
      continue;
    }

    const result = executeEdit(edit);

    if (result.success) {
      applied.push(edit.filePath);
    } else {
      failed.push({
        path: edit.filePath,
        error: result.error || 'Unknown error'
      });
    }
  }

  return { applied, failed, skipped };
}

/**
 * Executes only accepted edits from a review result
 */
export function executeAccepted(
  edits: ProposedEdit[],
  acceptedPaths: string[]
): BatchExecuteResult {
  const acceptedSet = new Set(acceptedPaths);
  const toExecute = edits.filter(e => acceptedSet.has(e.filePath));
  const skipped = edits
    .filter(e => !acceptedSet.has(e.filePath))
    .map(e => e.filePath);

  const result = executeEdits(toExecute);
  result.skipped = skipped;

  return result;
}

/**
 * Dry run - validates without applying
 * Note: Some errors can only be detected during actual execution
 */
export function validateEdits(
  edits: ProposedEdit[]
): { valid: boolean; errors: Array<{ path: string; error: string }> } {
  const errors: Array<{ path: string; error: string }> = [];

  for (const edit of edits) {
    // Check for delete of non-existent file
    if (edit.operation === 'Delete' && !existsSync(edit.filePath)) {
      errors.push({
        path: edit.filePath,
        error: 'Cannot delete non-existent file'
      });
    }

    // Check for edit of non-existent file
    if (edit.operation === 'Edit' && edit.originalContent === null) {
      errors.push({
        path: edit.filePath,
        error: 'Cannot edit non-existent file'
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Gets operation counts for display
 */
export function getOperationCounts(edits: ProposedEdit[]): {
  create: number;
  edit: number;
  delete: number;
  overwrite: number;
} {
  let create = 0;
  let edit = 0;
  let deleteCount = 0;
  let overwrite = 0;

  for (const e of edits) {
    switch (e.operation) {
      case 'Write':
        if (e.originalContent === null) {
          create++;
        } else {
          overwrite++;
        }
        break;
      case 'Edit':
        edit++;
        break;
      case 'Delete':
        deleteCount++;
        break;
    }
  }

  return { create, edit, delete: deleteCount, overwrite };
}
