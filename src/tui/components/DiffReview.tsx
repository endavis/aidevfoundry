/**
 * DiffReview Component (Phase 9.2)
 *
 * Displays proposed file edits with diffs for review.
 * User can Accept, Reject, or Skip each edit using vertical menu.
 */

import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { createTwoFilesPatch } from 'diff';
import { basename } from 'path';
import {
  type ProposedEdit,
  getDiffStats,
  applyEdit,
} from '../../lib/edit-review';

// Colors - using background colors for highlighted text effect
const ADD_BG = '#1a3d1a';      // Dark green background
const REMOVE_BG = '#3d1a1a';   // Dark red background
const ADD_COLOR = '#4ade80';   // Light green text
const REMOVE_COLOR = '#f87171'; // Light red text
const HEADER_COLOR = 'cyan';
const HIGHLIGHT_COLOR = '#8CA9FF';

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header';
  content: string;
  lineNum?: number;
}

// Format diff for display with line numbers
function formatDiffWithLineNumbers(originalContent: string | null, newContent: string, filePath: string): DiffLine[] {
  const segments: DiffLine[] = [];

  if (originalContent === null) {
    // New file - show all as additions with line numbers
    const lines = newContent.split('\n').slice(0, 50);
    lines.forEach((line, i) => {
      segments.push({ type: 'add', content: line, lineNum: i + 1 });
    });
    if (newContent.split('\n').length > 50) {
      segments.push({ type: 'context', content: `... +${newContent.split('\n').length - 50} more lines` });
    }
  } else {
    // Generate unified diff
    const diff = createTwoFilesPatch(filePath, filePath, originalContent, newContent, 'original', 'modified');
    const lines = diff.split('\n');

    let oldLine = 0;
    let newLine = 0;
    let count = 0;

    for (const line of lines) {
      if (count > 60) {
        segments.push({ type: 'context', content: '... (diff truncated)' });
        break;
      }

      // Parse hunk header for line numbers: @@ -start,count +start,count @@
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          oldLine = parseInt(match[1], 10);
          newLine = parseInt(match[2], 10);
        }
        segments.push({ type: 'header', content: line });
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        segments.push({ type: 'add', content: line.slice(1), lineNum: newLine });
        newLine++;
        count++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        segments.push({ type: 'remove', content: line.slice(1), lineNum: oldLine });
        oldLine++;
        count++;
      } else if (line.startsWith('---') || line.startsWith('+++')) {
        // Skip file headers
      } else if (line.trim() !== '' || segments.length > 0) {
        const content = line.startsWith(' ') ? line.slice(1) : line;
        segments.push({ type: 'context', content, lineNum: newLine });
        oldLine++;
        newLine++;
        count++;
      }
    }
  }

  return segments;
}

// Menu options
const MENU_OPTIONS = [
  { label: 'Accept', action: 'accept' as const },
  { label: 'Reject', action: 'reject' as const },
  { label: 'Skip', action: 'skip' as const },
  { label: 'Yes to all', action: 'yes-all' as const },
  { label: 'No to all', action: 'no-all' as const },
];

export interface DiffReviewProps {
  edits: ProposedEdit[];
  onComplete: (result: { accepted: string[]; rejected: string[]; skipped: string[] }) => void;
  onCancel: () => void;
}

export function DiffReview({ edits, onComplete, onCancel }: DiffReviewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState(0);
  const [decisions, setDecisions] = useState<Map<string, 'accept' | 'reject' | 'skip'>>(new Map());
  const [notification, setNotification] = useState<string | null>(null);

  const currentEdit = edits[currentIndex];
  const totalEdits = edits.length;

  // Generate diff for current edit with line numbers
  // Use proposedContent (from ProposedEdit interface) - fallback to newContent for compatibility
  const newContent = currentEdit?.proposedContent ?? (currentEdit as any)?.newContent ?? '';
  const diffSegments = currentEdit
    ? formatDiffWithLineNumbers(currentEdit.originalContent ?? null, newContent, currentEdit.filePath)
    : [];

  // Terminal dimensions
  const terminalRows = process.stdout.rows || 40;
  const terminalCols = process.stdout.columns || 80;
  const maxLines = Math.max(15, terminalRows - 20);

  // Calculate max line number width for padding
  const maxLineNum = Math.max(...diffSegments.filter(s => s.lineNum).map(s => s.lineNum!), 0);
  const lineNumWidth = String(maxLineNum).length || 3;

  // Handle keyboard input
  useInput((_, key) => {
    // Clear notification on any key
    setNotification(null);

    // Navigate menu with up/down
    if (key.upArrow) {
      setSelectedOption(i => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedOption(i => Math.min(MENU_OPTIONS.length - 1, i + 1));
    }

    // Navigate files with left/right
    if (key.leftArrow && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setSelectedOption(0);
    }
    if (key.rightArrow && currentIndex < totalEdits - 1) {
      setCurrentIndex(currentIndex + 1);
      setSelectedOption(0);
    }

    // Enter to confirm selection
    if (key.return) {
      const action = MENU_OPTIONS[selectedOption].action;
      handleAction(action);
    }

    // Escape to cancel
    if (key.escape) {
      onCancel();
    }
  });

  const handleAction = (action: 'accept' | 'reject' | 'skip' | 'yes-all' | 'no-all') => {
    if (action === 'accept') {
      const newDecisions = new Map(decisions);
      newDecisions.set(currentEdit.filePath, 'accept');
      setDecisions(newDecisions);

      const result = applyEdit(currentEdit);
      if (result.success) {
        setNotification(`Applied: ${currentEdit.filePath}`);
      } else {
        setNotification(`Failed: ${result.error}`);
      }

      if (currentIndex < totalEdits - 1) {
        setCurrentIndex(currentIndex + 1);
        setSelectedOption(0);
      } else {
        finishReview(newDecisions);
      }
    } else if (action === 'reject') {
      const newDecisions = new Map(decisions);
      newDecisions.set(currentEdit.filePath, 'reject');
      setDecisions(newDecisions);
      setNotification(`Rejected: ${currentEdit.filePath}`);

      if (currentIndex < totalEdits - 1) {
        setCurrentIndex(currentIndex + 1);
        setSelectedOption(0);
      } else {
        finishReview(newDecisions);
      }
    } else if (action === 'skip') {
      const newDecisions = new Map(decisions);
      newDecisions.set(currentEdit.filePath, 'skip');
      setDecisions(newDecisions);

      if (currentIndex < totalEdits - 1) {
        setCurrentIndex(currentIndex + 1);
        setSelectedOption(0);
      } else {
        finishReview(newDecisions);
      }
    } else if (action === 'yes-all') {
      const newDecisions = new Map(decisions);
      const failures: string[] = [];

      for (let i = currentIndex; i < totalEdits; i++) {
        const edit = edits[i];
        if (!newDecisions.has(edit.filePath)) {
          newDecisions.set(edit.filePath, 'accept');
          const result = applyEdit(edit);
          if (!result.success) {
            failures.push(edit.filePath);
          }
        }
      }

      setDecisions(newDecisions);
      if (failures.length > 0) {
        setNotification(`Applied ${totalEdits - currentIndex - failures.length} files, ${failures.length} failed`);
        setTimeout(() => finishReview(newDecisions), 500);
      } else {
        finishReview(newDecisions);
      }
    } else if (action === 'no-all') {
      const newDecisions = new Map(decisions);
      for (let i = currentIndex; i < totalEdits; i++) {
        const edit = edits[i];
        if (!newDecisions.has(edit.filePath)) {
          newDecisions.set(edit.filePath, 'reject');
        }
      }
      setDecisions(newDecisions);
      finishReview(newDecisions);
    }
  };

  const finishReview = (finalDecisions: Map<string, 'accept' | 'reject' | 'skip'>) => {
    const accepted: string[] = [];
    const rejected: string[] = [];
    const skipped: string[] = [];

    for (const [path, decision] of finalDecisions) {
      if (decision === 'accept') accepted.push(path);
      else if (decision === 'reject') rejected.push(path);
      else skipped.push(path);
    }

    onComplete({ accepted, rejected, skipped });
  };

  if (!currentEdit) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">No edits to review.</Text>
      </Box>
    );
  }

  const stats = getDiffStats(currentEdit);
  const operationLabel = currentEdit.operation === 'Write' ? 'Create' :
    currentEdit.operation === 'Delete' ? 'Delete' : 'Edit';

  // Truncate diff for display
  const displaySegments = diffSegments.slice(0, maxLines);
  const hasMore = diffSegments.length > maxLines;

  // Calculate stats from segments
  const additions = diffSegments.filter(s => s.type === 'add').length;
  const deletions = diffSegments.filter(s => s.type === 'remove').length;

  // Generate separator line
  const separatorWidth = Math.min(terminalCols - 2, 80);
  const separator = '─'.repeat(separatorWidth);

  return (
    <Box flexDirection="column">
      {/* Separator line */}
      <Text dimColor>{separator}</Text>

      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="yellow">{operationLabel} file </Text>
        <Text bold>{currentEdit.filePath}</Text>
        {totalEdits > 1 && (
          <Text color="gray"> ({currentIndex + 1}/{totalEdits})</Text>
        )}
      </Box>

      {/* Diff content with line numbers and background colors */}
      <Box flexDirection="column" marginBottom={1}>
        {displaySegments.map((segment, i) => {
          // Format line number
          const lineNumStr = segment.lineNum !== undefined
            ? String(segment.lineNum).padStart(lineNumWidth, ' ')
            : ' '.repeat(lineNumWidth);

          // Prefix based on type
          const prefix = segment.type === 'add' ? '+' :
            segment.type === 'remove' ? '-' :
              segment.type === 'header' ? '' : ' ';

          const maxContentWidth = terminalCols - lineNumWidth - 4;
          const displayContent = segment.content.slice(0, maxContentWidth);

          if (segment.type === 'header') {
            return (
              <Text key={i} color={HEADER_COLOR}>
                {segment.content}
              </Text>
            );
          }

          // Use background colors for add/remove lines
          const bgColor = segment.type === 'add' ? ADD_BG :
            segment.type === 'remove' ? REMOVE_BG : undefined;
          const textColor = segment.type === 'add' ? ADD_COLOR :
            segment.type === 'remove' ? REMOVE_COLOR : undefined;

          return (
            <Box key={i}>
              <Text dimColor>{lineNumStr} </Text>
              <Text
                color={textColor}
                backgroundColor={bgColor}
                dimColor={segment.type === 'context'}
              >
                {prefix} {displayContent}
              </Text>
            </Box>
          );
        })}
        {hasMore && (
          <Text dimColor>  ... ({diffSegments.length - maxLines} more lines)</Text>
        )}
      </Box>

      {/* Stats */}
      <Box marginBottom={1}>
        {stats.isNew ? (
          <Text color={ADD_COLOR}>+{additions} (new file)</Text>
        ) : (
          <>
            <Text color={ADD_COLOR}>+{additions} </Text>
            <Text color={REMOVE_COLOR}>-{deletions}</Text>
          </>
        )}
      </Box>

      {/* Question */}
      <Box marginBottom={0}>
        <Text>Do you want to apply this edit to </Text>
        <Text bold>{basename(currentEdit.filePath)}</Text>
        <Text>?</Text>
      </Box>

      {/* Notification */}
      {notification && (
        <Box>
          <Text color="yellow">{notification}</Text>
        </Box>
      )}

      {/* Vertical menu */}
      {MENU_OPTIONS.map((option, i) => (
        <Box key={i}>
          <Text color={i === selectedOption ? HIGHLIGHT_COLOR : undefined} bold={i === selectedOption}>
            {i === selectedOption ? '> ' : '  '}{i + 1}. {option.label}
          </Text>
        </Box>
      ))}

      {/* Hints */}
      <Box marginTop={1}>
        <Text dimColor>Esc to cancel</Text>
        {totalEdits > 1 && (
          <Text dimColor> | ←/→ navigate files</Text>
        )}
      </Box>
    </Box>
  );
}
