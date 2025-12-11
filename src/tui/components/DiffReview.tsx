/**
 * DiffReview Component (Phase 9.2)
 *
 * Displays proposed file edits with diffs for review.
 * User can Accept, Reject, or Skip each edit.
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
const BORDER_COLOR = '#fc8657';
const ACCENT_COLOR = '#06ba9e';
const ADD_COLOR = 'green';
const REMOVE_COLOR = 'red';
const HEADER_COLOR = 'cyan';

export interface DiffReviewProps {
  edits: ProposedEdit[];
  onComplete: (result: { accepted: string[]; rejected: string[]; skipped: string[] }) => void;
  onCancel: () => void;
}

export function DiffReview({ edits, onComplete, onCancel }: DiffReviewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decisions, setDecisions] = useState<Map<string, 'accept' | 'reject' | 'skip'>>(new Map());
  const [scrollOffset, setScrollOffset] = useState(0);
  const [notification, setNotification] = useState<string | null>(null);

  const currentEdit = edits[currentIndex];
  const totalEdits = edits.length;

  // Generate diff for current edit
  const diff = currentEdit ? generateDiff(currentEdit) : '';
  const diffSegments = currentEdit ? formatDiffForDisplay(diff) : [];
  // Use most of terminal height for diff (leave room for header, footer, controls)
  const terminalRows = process.stdout.rows || 40;
  const maxLines = Math.max(20, terminalRows - 15);
  const maxScrollOffset = Math.max(0, diffSegments.length - maxLines);

  // Handle keyboard input
  useInput((input, key) => {
    // Clear notification on any key
    setNotification(null);

    // Navigation between files
    if (key.leftArrow) {
      if (currentIndex > 0) {
        setCurrentIndex(currentIndex - 1);
        setScrollOffset(0);
      }
    }
    if (key.rightArrow) {
      if (currentIndex < totalEdits - 1) {
        setCurrentIndex(currentIndex + 1);
        setScrollOffset(0);
      }
    }

    // Scroll diff (capped)
    if (key.upArrow) {
      setScrollOffset(Math.max(0, scrollOffset - 1));
    }
    if (key.downArrow) {
      setScrollOffset(Math.min(maxScrollOffset, scrollOffset + 1));
    }

    // Actions
    if (input === 'a' || input === 'A') {
      // Accept current edit
      const newDecisions = new Map(decisions);
      newDecisions.set(currentEdit.filePath, 'accept');
      setDecisions(newDecisions);

      // Apply immediately
      const result = applyEdit(currentEdit);
      if (result.success) {
        setNotification(`Applied: ${currentEdit.filePath}`);
      } else {
        setNotification(`Failed: ${result.error}`);
      }

      // Move to next or finish
      if (currentIndex < totalEdits - 1) {
        setCurrentIndex(currentIndex + 1);
        setScrollOffset(0);
      } else {
        finishReview(newDecisions);
      }
    }

    if (input === 'r' || input === 'R') {
      // Reject current edit
      const newDecisions = new Map(decisions);
      newDecisions.set(currentEdit.filePath, 'reject');
      setDecisions(newDecisions);
      setNotification(`Rejected: ${currentEdit.filePath}`);

      if (currentIndex < totalEdits - 1) {
        setCurrentIndex(currentIndex + 1);
        setScrollOffset(0);
      } else {
        finishReview(newDecisions);
      }
    }

    if (input === 's' || input === 'S') {
      // Skip current edit
      const newDecisions = new Map(decisions);
      newDecisions.set(currentEdit.filePath, 'skip');
      setDecisions(newDecisions);

      if (currentIndex < totalEdits - 1) {
        setCurrentIndex(currentIndex + 1);
        setScrollOffset(0);
      } else {
        finishReview(newDecisions);
      }
    }

    // Accept all remaining
    if (input === 'Y') {
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
        // Small delay to show notification before finishing
        setTimeout(() => finishReview(newDecisions), 500);
      } else {
        finishReview(newDecisions);
      }
    }

    // Reject all remaining
    if (input === 'N') {
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

    // Cancel/Escape
    if (key.escape || input === 'q') {
      onCancel();
    }
  });

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

  // Truncate diff for display
  const displaySegments = diffSegments.slice(scrollOffset, scrollOffset + maxLines);
  const hasMore = diffSegments.length > scrollOffset + maxLines;
  const canScrollUp = scrollOffset > 0;

  // Determine status badge
  const decision = decisions.get(currentEdit.filePath);
  let statusBadge = '';
  let statusColor: string = 'gray';
  if (decision === 'accept') {
    statusBadge = ' [ACCEPTED]';
    statusColor = 'green';
  } else if (decision === 'reject') {
    statusBadge = ' [REJECTED]';
    statusColor = 'red';
  } else if (decision === 'skip') {
    statusBadge = ' [SKIPPED]';
    statusColor = 'yellow';
  }

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={BORDER_COLOR} bold>Edit Review</Text>
        <Text color="gray"> - </Text>
        <Text color={ACCENT_COLOR}>{currentIndex + 1}/{totalEdits}</Text>
        <Text color={statusColor}>{statusBadge}</Text>
      </Box>

      {/* File info */}
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color="gray">File: </Text>
          <Text color={HEADER_COLOR} bold>{currentEdit.filePath}</Text>
        </Box>
        <Box>
          <Text color="gray">Operation: </Text>
          <Text color="white">{currentEdit.operation}</Text>
          <Text color="gray"> | </Text>
          {stats.isNew ? (
            <Text color={ADD_COLOR}>new file (+{stats.additions})</Text>
          ) : (
            <>
              <Text color={ADD_COLOR}>+{stats.additions}</Text>
              <Text color="gray"> </Text>
              <Text color={REMOVE_COLOR}>-{stats.deletions}</Text>
            </>
          )}
        </Box>
      </Box>

      {/* Diff display */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        paddingY={0}
      >
        {canScrollUp && (
          <Text color="gray" dimColor>... ({scrollOffset} lines above)</Text>
        )}
        {displaySegments.map((segment, i) => (
          <Text
            key={i}
            color={
              segment.color === 'green' ? ADD_COLOR :
              segment.color === 'red' ? REMOVE_COLOR :
              segment.color === 'cyan' ? HEADER_COLOR :
              'gray'
            }
          >
            {segment.text}
          </Text>
        ))}
        {hasMore && (
          <Text color="gray" dimColor>... ({diffSegments.length - scrollOffset - maxLines} more lines)</Text>
        )}
      </Box>

      {/* Notification */}
      {notification && (
        <Box marginTop={1}>
          <Text color="yellow">{notification}</Text>
        </Box>
      )}

      {/* Controls */}
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color="gray">[</Text>
          <Text color={ADD_COLOR}>A</Text>
          <Text color="gray">]ccept  [</Text>
          <Text color={REMOVE_COLOR}>R</Text>
          <Text color="gray">]eject  [</Text>
          <Text color="yellow">S</Text>
          <Text color="gray">]kip  [</Text>
          <Text color={ADD_COLOR}>Y</Text>
          <Text color="gray">]es All  [</Text>
          <Text color={REMOVE_COLOR}>N</Text>
          <Text color="gray">]o All  [</Text>
          <Text color="white">Q</Text>
          <Text color="gray">]uit</Text>
        </Box>
        <Box>
          <Text color="gray">Navigate: </Text>
          <Text color="white">←/→</Text>
          <Text color="gray"> files  </Text>
          <Text color="white">↑/↓</Text>
          <Text color="gray"> scroll</Text>
        </Box>
      </Box>
    </Box>
  );
}
