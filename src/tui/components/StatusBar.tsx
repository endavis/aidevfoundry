import React, { useState, useEffect, memo } from 'react';
import { Box, Text } from 'ink';

// Isolated timer component - disabled for testing
const SessionTimer = memo(function SessionTimer() {
  return <Text>0:00</Text>;
});

interface StatusBarProps {
  agent: string;
  messageCount?: number;
}

export const StatusBar = memo(function StatusBar({ agent, messageCount = 0 }: StatusBarProps) {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1} justifyContent="space-between">
      <Box>
        <Text dimColor>agent: </Text>
        <Text color="yellow">{agent}</Text>
      </Box>
      <Box>
        <Text dimColor>messages: </Text>
        <Text>{messageCount}</Text>
      </Box>
      <Box>
        <Text dimColor>session: </Text>
        <SessionTimer />
      </Box>
      <Box>
        <Text dimColor>/help for commands</Text>
      </Box>
    </Box>
  );
});
