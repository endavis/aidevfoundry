/**
 * SingleFileDiff Component
 *
 * Shows a diff preview for a single file edit/create operation.
 * User can Accept or Reject with arrow keys and Enter.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { createTwoFilesPatch } from 'diff';
import { basename } from 'path';

// Colors
const ADD_COLOR = 'green';
const REMOVE_COLOR = 'red';
const HEADER_COLOR = 'cyan';
const HIGHLIGHT_COLOR = '#8CA9FF';

export type DiffDecision = 'yes' | 'yes-all' | 'no';

interface SingleFileDiffProps {
  filePath: string;
  operation: 'create' | 'edit' | 'overwrite';
  originalContent: string | null;
  newContent: string;
  onDecision: (decision: DiffDecision) => void;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header';
  content: string;
  lineNum?: number;
}

// Format diff for display with line numbers
function formatDiff(originalContent: string | null, newContent: string, filePath: string): DiffLine[] {
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

const OPTIONS = [
  { label: 'Yes', value: 'yes' as DiffDecision },
  { label: 'Yes, allow all edits during this session', value: 'yes-all' as DiffDecision },
  { label: 'No', value: 'no' as DiffDecision },
];

export function SingleFileDiff({ filePath, operation, originalContent, newContent, onDecision }: SingleFileDiffProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const diffSegments = formatDiff(originalContent, newContent, filePath);
  const terminalCols = process.stdout.columns || 80;

  // Calculate stats
  const additions = diffSegments.filter(s => s.type === 'add').length;
  const deletions = diffSegments.filter(s => s.type === 'remove').length;

  // Calculate max line number width for padding
  const maxLineNum = Math.max(...diffSegments.filter(s => s.lineNum).map(s => s.lineNum!), 0);
  const lineNumWidth = String(maxLineNum).length;

  useInput((input, key) => {
    // Up/down to navigate options
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex(i => Math.min(OPTIONS.length - 1, i + 1));
    }

    // Enter to confirm
    if (key.return) {
      onDecision(OPTIONS[selectedIndex].value);
    }

    // Escape to reject
    if (key.escape) {
      onDecision('no');
    }
  });

  const operationLabel = operation === 'create' ? 'Create' : operation === 'overwrite' ? 'Overwrite' : 'Edit';

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
        <Text bold>{filePath}</Text>
      </Box>

      {/* Diff content with line numbers */}
      <Box flexDirection="column" marginBottom={1}>
        {diffSegments.map((segment, i) => {
          const color = segment.type === 'add' ? ADD_COLOR :
                       segment.type === 'remove' ? REMOVE_COLOR :
                       segment.type === 'header' ? HEADER_COLOR : undefined;

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
              <Text key={i} color={color}>
                {segment.content}
              </Text>
            );
          }

          return (
            <Box key={i}>
              <Text dimColor>{lineNumStr} </Text>
              <Text color={color} dimColor={segment.type === 'context'}>
                {prefix} {displayContent}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Stats */}
      <Box marginBottom={1}>
        <Text color={ADD_COLOR}>+{additions} </Text>
        <Text color={REMOVE_COLOR}>-{deletions}</Text>
      </Box>

      {/* Question */}
      <Box marginBottom={0}>
        <Text>Do you want to apply this edit to </Text>
        <Text bold>{basename(filePath)}</Text>
        <Text>?</Text>
      </Box>

      {/* Options */}
      {OPTIONS.map((option, i) => (
        <Box key={i}>
          <Text color={i === selectedIndex ? HIGHLIGHT_COLOR : undefined} bold={i === selectedIndex}>
            {i === selectedIndex ? '> ' : '  '}{i + 1}. {option.label}
          </Text>
        </Box>
      ))}

      {/* Hint */}
      <Box marginTop={1}>
        <Text dimColor>Esc to cancel</Text>
      </Box>
    </Box>
  );
}
