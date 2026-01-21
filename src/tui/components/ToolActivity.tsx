import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

export interface ToolCallInfo {
  id: string;
  name: string;
  args: string;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: string;
  startTime?: number;
  endTime?: number;
}

// Animated dots for running status
const RUNNING_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];
const FRAME_INTERVAL = 100;

interface ToolActivityProps {
  calls: ToolCallInfo[];
  iteration: number;
  expanded?: boolean;
}

// Format tool display name and target
function formatToolCall(name: string, args: string): { displayName: string; target: string } {
  const parsed = tryParseArgs(args);

  switch (name) {
    case 'view':
      return { displayName: 'Read', target: parsed.path || parsed.file || args };
    case 'glob':
      return { displayName: 'Glob', target: parsed.pattern || args };
    case 'grep':
      return { displayName: 'Grep', target: parsed.pattern || args };
    case 'bash':
      return { displayName: 'Bash', target: parsed.command || args };
    case 'write':
      return { displayName: 'Write', target: parsed.path || parsed.file || args };
    case 'edit':
      return { displayName: 'Update', target: parsed.path || parsed.file || args };
    default:
      return { displayName: name, target: args };
  }
}

// Try to parse args string to extract values
function tryParseArgs(args: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Parse "key=value, key2=value2" format
  const parts = args.split(', ');
  for (const part of parts) {
    const [key, ...valueParts] = part.split('=');
    if (key && valueParts.length > 0) {
      result[key.trim()] = valueParts.join('=').trim();
    }
  }
  return result;
}

// Truncate and format result for display
function formatResult(result: string, maxLines: number = 3): { lines: string[]; truncated: boolean } {
  const allLines = result.split('\n').filter(l => l.trim());
  const truncated = allLines.length > maxLines;
  const lines = allLines.slice(0, maxLines);
  return { lines, truncated };
}

// Format milliseconds to human readable
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const remainingMs = ms % 1000;
  if (seconds < 60) return `${seconds}.${Math.floor(remainingMs / 100)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

// Individual tool item component with animation
function ToolItem({
  call,
  expanded,
  maxLines,
  maxLineLength,
  maxTargetLen
}: {
  call: ToolCallInfo;
  expanded: boolean;
  maxLines: number;
  maxLineLength: number;
  maxTargetLen: number;
}) {
  const [frame, setFrame] = useState(0);
  const [runningElapsed, setRunningElapsed] = useState(0);

  // Animate spinner for running tools
  useEffect(() => {
    if (call.status !== 'running') {
      setFrame(0);
      return;
    }
    const interval = setInterval(() => {
      setFrame(f => (f + 1) % RUNNING_FRAMES.length);
    }, FRAME_INTERVAL);
    return () => clearInterval(interval);
  }, [call.status]);

  // Track elapsed time for running tools
  useEffect(() => {
    if (call.status !== 'running' || !call.startTime) {
      return;
    }
    const interval = setInterval(() => {
      setRunningElapsed(Date.now() - call.startTime!);
    }, 100);
    return () => clearInterval(interval);
  }, [call.status, call.startTime]);

  const { displayName, target } = formatToolCall(call.name, call.args);
  const displayTarget = target.length > maxTargetLen ? target.slice(0, maxTargetLen - 3) + '...' : target;

  // Status icon with animation
  const getStatusIcon = () => {
    switch (call.status) {
      case 'pending':
        return <Text dimColor>○ </Text>;
      case 'running':
        return <Text color="yellow">{RUNNING_FRAMES[frame]} </Text>;
      case 'done':
        return <Text color="green">✓ </Text>;
      case 'error':
        return <Text color="red">✗ </Text>;
    }
  };

  // Calculate duration for completed tools
  const getDuration = () => {
    if (call.status === 'running' && call.startTime) {
      return runningElapsed;
    }
    if (call.startTime && call.endTime) {
      return call.endTime - call.startTime;
    }
    return null;
  };

  const duration = getDuration();
  const nameColor = call.status === 'error' ? 'red' : call.status === 'done' ? 'green' : 'white';

  return (
    <Box flexDirection="column">
      {/* Main line: ○/⣾/✓/✗ ToolName(target) [duration] */}
      <Box>
        {getStatusIcon()}
        <Text color={nameColor} bold>{displayName}</Text>
        <Text dimColor>(</Text>
        <Text>{displayTarget}</Text>
        <Text dimColor>)</Text>
        {duration !== null && (
          <Text dimColor> [{formatDuration(duration)}]</Text>
        )}
      </Box>

      {/* Result lines with tree character */}
      {call.status === 'done' && call.result && (
        <Box flexDirection="column" marginLeft={2}>
          {(() => {
            const { lines, truncated } = formatResult(call.result, maxLines);
            return (
              <>
                {lines.map((line, i) => (
                  <Box key={i}>
                    <Text dimColor>{i === lines.length - 1 && !truncated ? '└ ' : '│ '}</Text>
                    <Text dimColor>{line.slice(0, maxLineLength)}{line.length > maxLineLength ? '...' : ''}</Text>
                  </Box>
                ))}
                {truncated && (
                  <Box>
                    <Text dimColor>└ </Text>
                    <Text dimColor>... +{call.result.split('\n').length - maxLines} lines </Text>
                    <Text color="gray">(ctrl+s to {expanded ? 'collapse' : 'expand'})</Text>
                  </Box>
                )}
              </>
            );
          })()}
        </Box>
      )}

      {/* Error display */}
      {call.status === 'error' && call.result && (
        <Box marginLeft={2}>
          <Text dimColor>└ </Text>
          <Text color="red">{call.result.slice(0, maxLineLength)}</Text>
        </Box>
      )}
    </Box>
  );
}

export function ToolActivity({ calls, iteration, expanded = false }: ToolActivityProps) {
  if (calls.length === 0) return null;

  // Show more calls when expanded
  const maxCalls = expanded ? 20 : 6;
  const maxLines = expanded ? 15 : 3;
  const maxLineLength = expanded ? 120 : 60;
  const maxTargetLen = expanded ? 100 : 50;
  const recentCalls = calls.slice(-maxCalls);

  // Count stats
  const doneCount = calls.filter(c => c.status === 'done').length;
  const runningCount = calls.filter(c => c.status === 'running').length;
  const pendingCount = calls.filter(c => c.status === 'pending').length;
  const errorCount = calls.filter(c => c.status === 'error').length;

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Summary header */}
      <Box marginBottom={1}>
        <Text dimColor>Tools: </Text>
        {doneCount > 0 && <Text color="green">{doneCount} done </Text>}
        {runningCount > 0 && <Text color="yellow">{runningCount} running </Text>}
        {pendingCount > 0 && <Text dimColor>{pendingCount} pending </Text>}
        {errorCount > 0 && <Text color="red">{errorCount} error </Text>}
        {iteration > 1 && <Text dimColor>(iter {iteration})</Text>}
      </Box>

      {recentCalls.map((call) => (
        <ToolItem
          key={call.id}
          call={call}
          expanded={expanded}
          maxLines={maxLines}
          maxLineLength={maxLineLength}
          maxTargetLen={maxTargetLen}
        />
      ))}

      {calls.length > maxCalls && (
        <Box marginLeft={2}>
          <Text dimColor>... and {calls.length - maxCalls} more </Text>
          <Text color="gray">(ctrl+s to {expanded ? 'collapse' : 'expand'})</Text>
        </Box>
      )}
    </Box>
  );
}
