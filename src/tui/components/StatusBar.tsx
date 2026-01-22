import { memo } from 'react';
import { Box, Text } from 'ink';

export type McpStatus = 'connected' | 'disconnected' | 'local' | 'checking';
export type ApprovalMode = 'default' | 'plan' | 'accept' | 'yolo';

interface StatusBarProps {
  agent: string;
  messageCount?: number;
  tokens?: number;
  mcpStatus?: McpStatus;
  approvalMode?: ApprovalMode;
  sessionName?: string;
  isLoading?: boolean;
}

export const StatusBar = memo(function StatusBar({
  agent,
  messageCount = 0,
  tokens = 0,
  mcpStatus = 'local',
  approvalMode = 'default',
  sessionName,
  isLoading = false
}: StatusBarProps) {
  // Format tokens with K suffix for thousands
  const formatTokens = (t: number): string => {
    if (t >= 1000) {
      return (t / 1000).toFixed(1) + 'k';
    }
    return t.toString();
  };

  // MCP status display
  const getMcpDisplay = () => {
    switch (mcpStatus) {
      case 'connected':
        return <Text color="green">●</Text>;
      case 'disconnected':
        return <Text color="red">○</Text>;
      case 'checking':
        return <Text color="yellow">◐</Text>;
      case 'local':
      default:
        return <Text dimColor>○</Text>;
    }
  };

  // Approval mode display with color coding
  const getApprovalDisplay = () => {
    switch (approvalMode) {
      case 'yolo':
        return <Text color="red" bold>YOLO</Text>;
      case 'accept':
        return <Text color="green">AUTO</Text>;
      case 'plan':
        return <Text color="cyan">PLAN</Text>;
      case 'default':
      default:
        return <Text dimColor>ASK</Text>;
    }
  };

  // Keyboard hints based on context
  const getKeyHints = () => {
    if (isLoading) {
      return (
        <Text dimColor>
          <Text color="gray">esc</Text>
          <Text dimColor>:stop </Text>
          <Text color="gray">^S</Text>
          <Text dimColor>:tools</Text>
        </Text>
      );
    }
    return (
      <Text dimColor>
        <Text color="gray">tab</Text>
        <Text dimColor>:complete </Text>
        <Text color="gray">↑↓</Text>
        <Text dimColor>:history</Text>
      </Text>
    );
  };

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1} justifyContent="space-between">
      {/* Left section: Agent + Session */}
      <Box>
        <Text color="yellow" bold>{agent}</Text>
        {sessionName && (
          <>
            <Text dimColor> @ </Text>
            <Text color="cyan">{sessionName.length > 12 ? sessionName.slice(0, 12) + '…' : sessionName}</Text>
          </>
        )}
      </Box>

      {/* Center section: Stats */}
      <Box>
        <Text dimColor>msgs:</Text>
        <Text>{messageCount}</Text>
        <Text dimColor> │ </Text>
        <Text dimColor>tok:</Text>
        <Text color={tokens > 50000 ? 'yellow' : undefined}>{formatTokens(tokens)}</Text>
      </Box>

      {/* Mode indicators */}
      <Box>
        <Text dimColor>mode:</Text>
        {getApprovalDisplay()}
        <Text dimColor> │ mcp:</Text>
        {getMcpDisplay()}
      </Box>

      {/* Right section: Key hints */}
      <Box>
        {getKeyHints()}
        <Text dimColor> │ </Text>
        <Text color="gray">/help</Text>
      </Box>
    </Box>
  );
});
