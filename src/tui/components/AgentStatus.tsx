import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

export type AgentPhase = 'thinking' | 'tool_pending' | 'tool_running' | 'analyzing' | 'writing';

interface AgentStatusProps {
  agentName: string;
  isLoading: boolean;
  startTime?: number;
  tokens?: number;
  phase?: AgentPhase;
  toolCount?: number;
  iteration?: number;
}

// Animated spinner frames
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL = 80; // ms per frame

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return String(tokens);
}

function getPhaseDisplay(phase: AgentPhase): { text: string; color: string } {
  switch (phase) {
    case 'thinking':
      return { text: 'thinking...', color: 'cyan' };
    case 'tool_pending':
      return { text: 'awaiting permission', color: 'yellow' };
    case 'tool_running':
      return { text: 'executing tool', color: 'green' };
    case 'analyzing':
      return { text: 'analyzing results', color: 'magenta' };
    case 'writing':
      return { text: 'writing response', color: 'blue' };
    default:
      return { text: 'working...', color: 'gray' };
  }
}

export function AgentStatus({
  agentName,
  isLoading,
  startTime,
  tokens,
  phase = 'thinking',
  toolCount = 0,
  iteration = 1
}: AgentStatusProps) {
  const [elapsed, setElapsed] = useState(0);
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // Update elapsed time every second
  useEffect(() => {
    if (!isLoading || !startTime) {
      setElapsed(0);
      return;
    }

    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 1000);

    return () => clearInterval(interval);
  }, [isLoading, startTime]);

  // Animate spinner
  useEffect(() => {
    if (!isLoading) {
      setSpinnerFrame(0);
      return;
    }

    const interval = setInterval(() => {
      setSpinnerFrame(f => (f + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL);

    return () => clearInterval(interval);
  }, [isLoading]);

  if (!isLoading) return null;

  const spinner = SPINNER_FRAMES[spinnerFrame];
  const phaseInfo = getPhaseDisplay(phase);

  return (
    <Box marginTop={1} flexDirection="column">
      <Box>
        <Text color="magenta">{spinner} </Text>
        <Text color="magenta" bold>{agentName}</Text>
        {iteration > 1 && (
          <Text dimColor> (iter {iteration})</Text>
        )}
        <Text dimColor> · </Text>
        <Text color={phaseInfo.color}>{phaseInfo.text}</Text>
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>⏱ </Text>
        <Text color="yellow">{formatDuration(elapsed)}</Text>
        {toolCount > 0 && (
          <>
            <Text dimColor> · </Text>
            <Text color="green">🔧 {toolCount} tool{toolCount !== 1 ? 's' : ''}</Text>
          </>
        )}
        {tokens !== undefined && tokens > 0 && (
          <>
            <Text dimColor> · </Text>
            <Text color="cyan">↓ {formatTokens(tokens)} tokens</Text>
          </>
        )}
        <Text dimColor> · </Text>
        <Text dimColor>esc to interrupt</Text>
      </Box>
    </Box>
  );
}
