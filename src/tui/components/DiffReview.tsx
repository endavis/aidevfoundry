/**
 * DiffReview Component (Phase 9.2)
 *
 * Displays proposed file edits with diffs for review.
 * User can Accept, Reject, or Skip each edit using vertical menu.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  type ProposedEdit,
  generateDiff,
  getDiffStats,
  applyEdit,
  formatDiffForDisplay
} from '../../lib/edit-review';

// Colors
const ADD_COLOR = 'green';
const REMOVE_COLOR = 'red';
const HEADER_COLOR = 'cyan';
const HIGHLIGHT_COLOR = '#8CA9FF';

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

  // Generate diff for current edit
  const diff = currentEdit ? generateDiff(currentEdit) : '';
  const diffSegments = currentEdit ? formatDiffForDisplay(diff) : [];
  // Limit diff lines
  const terminalRows = process.stdout.rows || 40;
  const maxLines = Math.max(15, terminalRows - 20);

  // Handle keyboard input
  useInput((input, key) => {
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

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="yellow">{operationLabel} file </Text>
        <Text bold>{currentEdit.filePath}</Text>
        {totalEdits > 1 && (
          <Text color="gray"> ({currentIndex + 1}/{totalEdits})</Text>
        )}
      </Box>

      {/* Diff content */}
      <Box flexDirection="column" marginBottom={1}>
        {displaySegments.map((segment, i) => (
          <Text
            key={i}
            color={
              segment.color === 'green' ? ADD_COLOR :
              segment.color === 'red' ? REMOVE_COLOR :
              segment.color === 'cyan' ? HEADER_COLOR :
              undefined
            }
            dimColor={!segment.color}
          >
            {segment.text}
          </Text>
        ))}
        {hasMore && (
          <Text dimColor>  ... ({diffSegments.length - maxLines} more lines)</Text>
        )}
      </Box>

      {/* Stats */}
      <Box marginBottom={1}>
        {stats.isNew ? (
          <Text color={ADD_COLOR}>+{stats.additions} (new file)</Text>
        ) : (
          <>
            <Text color={ADD_COLOR}>+{stats.additions} </Text>
            <Text color={REMOVE_COLOR}>-{stats.deletions}</Text>
          </>
        )}
      </Box>

      {/* Question */}
      <Box marginBottom={0}>
        <Text>Do you want to apply this edit?</Text>
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
