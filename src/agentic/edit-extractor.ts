/**
 * Edit Extractor (Phase 9.2)
 *
 * Converts AgenticResponse to ProposedEdit[] for the DiffReview component.
 * Reads existing file content and computes proposed changes.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import type { AgenticResponse, FileOperation } from './response-parser';
import type { ProposedEdit } from '../lib/edit-review';

export interface ExtractOptions {
  /** Project root for resolving relative paths */
  projectRoot?: string;
}

export interface ExtractResult {
  edits: ProposedEdit[];
  errors: Array<{ path: string; error: string }>;
}

/**
 * Resolves a file path relative to project root
 */
function resolvePath(filePath: string, projectRoot?: string): string {
  if (isAbsolute(filePath)) {
    return filePath;
  }
  return resolve(projectRoot || process.cwd(), filePath);
}

/**
 * Reads file content, returns null if file doesn't exist
 */
function readFileContent(absolutePath: string): string | null {
  try {
    if (existsSync(absolutePath)) {
      return readFileSync(absolutePath, 'utf-8');
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Applies search/replace to content
 */
function applySearchReplace(
  content: string,
  search: string,
  replace: string
): { success: boolean; result: string; error?: string } {
  if (!content.includes(search)) {
    return {
      success: false,
      result: content,
      error: `Search string not found in file`
    };
  }

  // Replace first occurrence only (consistent with Claude's Edit tool)
  const result = content.replace(search, replace);
  return { success: true, result };
}

/**
 * Converts a single FileOperation to ProposedEdit
 */
function convertOperation(
  op: FileOperation,
  projectRoot?: string
): { edit?: ProposedEdit; error?: string } {
  const absolutePath = resolvePath(op.path, projectRoot);
  const originalContent = readFileContent(absolutePath);

  switch (op.operation) {
    case 'create': {
      return {
        edit: {
          filePath: absolutePath,
          operation: 'Write',
          proposedContent: op.content || '',
          originalContent // null if new file, existing content if overwrite
        }
      };
    }

    case 'edit': {
      if (!op.search || op.replace === undefined) {
        return { error: `Edit operation requires search and replace` };
      }

      if (originalContent === null) {
        return { error: `Cannot edit non-existent file: ${op.path}` };
      }

      const { success, result, error } = applySearchReplace(
        originalContent,
        op.search,
        op.replace
      );

      if (!success) {
        return { error: `${error}: ${op.path}` };
      }

      return {
        edit: {
          filePath: absolutePath,
          operation: 'Edit',
          proposedContent: result,
          originalContent,
          oldString: op.search,
          newString: op.replace
        }
      };
    }

    case 'delete': {
      if (originalContent === null) {
        return { error: `Cannot delete non-existent file: ${op.path}` };
      }

      return {
        edit: {
          filePath: absolutePath,
          operation: 'Delete',
          proposedContent: '', // Empty for delete
          originalContent
        }
      };
    }

    default:
      return { error: `Unknown operation: ${(op as FileOperation).operation}` };
  }
}

/**
 * Extracts ProposedEdit[] from AgenticResponse
 */
export function extractEdits(
  response: AgenticResponse,
  options: ExtractOptions = {}
): ExtractResult {
  const edits: ProposedEdit[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  for (const op of response.files) {
    const { edit, error } = convertOperation(op, options.projectRoot);

    if (error) {
      errors.push({ path: op.path, error });
    } else if (edit) {
      edits.push(edit);
    }
  }

  return { edits, errors };
}

/**
 * Checks if all operations can be applied (no errors)
 */
export function validateOperations(
  response: AgenticResponse,
  options: ExtractOptions = {}
): { valid: boolean; errors: Array<{ path: string; error: string }> } {
  const { errors } = extractEdits(response, options);
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Gets list of affected file paths
 */
export function getAffectedPaths(response: AgenticResponse): string[] {
  return response.files.map(f => f.path);
}

/**
 * Checks if any operation would overwrite an existing file
 */
export function hasOverwrites(
  response: AgenticResponse,
  options: ExtractOptions = {}
): string[] {
  const overwrites: string[] = [];

  for (const op of response.files) {
    if (op.operation === 'create') {
      const absolutePath = resolvePath(op.path, options.projectRoot);
      if (existsSync(absolutePath)) {
        overwrites.push(op.path);
      }
    }
  }

  return overwrites;
}
