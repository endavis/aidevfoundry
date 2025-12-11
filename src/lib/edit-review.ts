/**
 * Edit Review Mode (Phase 9.2)
 *
 * Extracts proposed edits from Claude CLI dry-run output and
 * provides utilities for reviewing and applying changes.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { createTwoFilesPatch, diffLines } from 'diff';
import type { ResultEvent } from './stream-parser';

/**
 * A proposed file edit from Claude
 */
export interface ProposedEdit {
  filePath: string;
  operation: 'Write' | 'Edit' | 'Delete';
  proposedContent: string;
  originalContent: string | null;  // null if new file
  // Edit-specific fields
  oldString?: string;
  newString?: string;
}

/**
 * Result of edit review
 */
export interface EditReviewResult {
  accepted: ProposedEdit[];
  rejected: ProposedEdit[];
  skipped: ProposedEdit[];
}

/**
 * Permission denial from Claude CLI
 */
interface PermissionDenial {
  tool_name: string;
  tool_use_id?: string;
  tool_input: {
    file_path?: string;
    content?: string;
    old_string?: string;
    new_string?: string;
  };
}

/**
 * Extract proposed edits from Claude CLI result event
 */
export function extractProposedEdits(result: ResultEvent): ProposedEdit[] {
  const edits: ProposedEdit[] = [];

  if (!result.permissionDenials || result.permissionDenials.length === 0) {
    return edits;
  }

  for (const denial of result.permissionDenials as PermissionDenial[]) {
    if (denial.tool_name !== 'Write' && denial.tool_name !== 'Edit') {
      continue;
    }

    const filePath = denial.tool_input.file_path;
    if (!filePath) continue;

    // Read original content if file exists
    let originalContent: string | null = null;
    try {
      if (existsSync(filePath)) {
        originalContent = readFileSync(filePath, 'utf-8');
      }
    } catch {
      // File doesn't exist or can't be read
    }

    if (denial.tool_name === 'Write') {
      edits.push({
        filePath,
        operation: 'Write',
        proposedContent: denial.tool_input.content || '',
        originalContent
      });
    } else if (denial.tool_name === 'Edit') {
      // For Edit, we need to compute the proposed content
      const oldString = denial.tool_input.old_string || '';
      const newString = denial.tool_input.new_string || '';

      let proposedContent = originalContent || '';
      if (originalContent && oldString) {
        proposedContent = originalContent.replace(oldString, newString);
      }

      edits.push({
        filePath,
        operation: 'Edit',
        proposedContent,
        originalContent,
        oldString,
        newString
      });
    }
  }

  return edits;
}

/**
 * Generate unified diff for a proposed edit
 */
export function generateDiff(edit: ProposedEdit): string {
  const original = edit.originalContent || '';
  const proposed = edit.proposedContent;

  return createTwoFilesPatch(
    edit.filePath,
    edit.filePath,
    original,
    proposed,
    'original',
    'proposed'
  );
}

/**
 * Get diff stats (additions/deletions) using actual diff
 */
export function getDiffStats(edit: ProposedEdit): { additions: number; deletions: number; isNew: boolean } {
  const isNew = edit.originalContent === null;

  if (isNew) {
    return {
      additions: edit.proposedContent.split('\n').length,
      deletions: 0,
      isNew
    };
  }

  const changes = diffLines(edit.originalContent || '', edit.proposedContent);
  let additions = 0;
  let deletions = 0;

  for (const change of changes) {
    const lines = change.value.split('\n').filter(l => l !== '').length;
    if (change.added) additions += lines;
    if (change.removed) deletions += lines;
  }

  return { additions, deletions, isNew };
}

/**
 * Apply a single edit to the filesystem
 */
export function applyEdit(edit: ProposedEdit): { success: boolean; error?: string } {
  try {
    // Ensure parent directory exists
    mkdirSync(dirname(edit.filePath), { recursive: true });
    writeFileSync(edit.filePath, edit.proposedContent, 'utf-8');
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message
    };
  }
}

/**
 * Apply multiple edits
 */
export function applyEdits(edits: ProposedEdit[]): { applied: string[]; failed: Array<{ path: string; error: string }> } {
  const applied: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];

  for (const edit of edits) {
    const result = applyEdit(edit);
    if (result.success) {
      applied.push(edit.filePath);
    } else {
      failed.push({ path: edit.filePath, error: result.error || 'Unknown error' });
    }
  }

  return { applied, failed };
}

/**
 * Format diff for terminal display with colors
 * Returns array of { text, color } segments
 */
export interface DiffSegment {
  text: string;
  color: 'green' | 'red' | 'cyan' | 'gray' | 'white';
}

export function formatDiffForDisplay(diff: string): DiffSegment[] {
  const segments: DiffSegment[] = [];
  const lines = diff.split('\n');

  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      segments.push({ text: line, color: 'cyan' });
    } else if (line.startsWith('@@')) {
      segments.push({ text: line, color: 'cyan' });
    } else if (line.startsWith('+')) {
      segments.push({ text: line, color: 'green' });
    } else if (line.startsWith('-')) {
      segments.push({ text: line, color: 'red' });
    } else {
      segments.push({ text: line, color: 'gray' });
    }
  }

  return segments;
}

/**
 * Truncate diff for preview (show first N lines)
 */
export function truncateDiff(diff: string, maxLines: number = 20): { truncated: string; totalLines: number; shown: number } {
  const lines = diff.split('\n');
  const totalLines = lines.length;

  if (totalLines <= maxLines) {
    return { truncated: diff, totalLines, shown: totalLines };
  }

  const truncated = lines.slice(0, maxLines).join('\n') + '\n...';
  return { truncated, totalLines, shown: maxLines };
}
