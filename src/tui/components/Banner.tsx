import React from 'react';
import { Box, Text } from 'ink';

// Logo colors
const RED = '#fc3855';
const PURPLE = '#8b5cf6';

// Compact 3-line PULZd banner
const BANNER = [
  { pulz: '█████▄ ██  ██ ██     ██████ ', d: '▄▄▄▄  ' },
  { pulz: '██▄▄█▀ ██  ██ ██      ▄▄▀▀  ', d: '██▀██ ' },
  { pulz: '██     ▀████▀ ██████ ██████ ', d: '████▀ ' },
];

interface BannerProps {
  version?: string;
  minimal?: boolean;
}

export function Banner({ version = '0.1.0', minimal = false }: BannerProps) {
  if (minimal) {
    return (
      <Box marginBottom={1}>
        <Text bold color="white">PULZ</Text>
        <Text bold color={RED}>d</Text>
        <Text bold color="white">AI</Text>
        <Text dimColor> v{version}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column">
        {BANNER.map((line, index) => (
          <Box key={index}>
            <Text bold color="white">{line.pulz}</Text>
            <Text bold color={RED}>{line.d}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>v{version} - Multi-LLM Orchestrator</Text>
      </Box>
    </Box>
  );
}

export function WelcomeMessage() {
  return (
    <Box marginBottom={1} flexDirection="column">
      <Text dimColor>Type a message or use /help for commands</Text>
    </Box>
  );
}
