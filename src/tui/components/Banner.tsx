import React from 'react';
import { Box, Text } from 'ink';

// Logo colors
const RED = '#fc3855';
const BORDER = 'gray';
const GRAY = 'gray';

// Compact 3-line PULZd banner - each full line = 35 chars
const LOGO_WIDTH = 35;
const BANNER_RAW = [
  { pulz: '█████▄ ██  ██ ██     ██████ ', d: '▄▄▄▄  ' },
  { pulz: '██▄▄█▀ ██  ██ ██      ▄▄▀▀  ', d: '██▀██ ' },
  { pulz: '██     ▀████▀ ██████ ██████ ', d: '████▀ ' },
];
// Pad/truncate to make total exactly LOGO_WIDTH
const BANNER = BANNER_RAW.map(line => {
  const combined = line.pulz + line.d;
  const padded = (combined + ' '.repeat(LOGO_WIDTH)).slice(0, LOGO_WIDTH);
  return { pulz: padded.slice(0, line.pulz.length), d: padded.slice(line.pulz.length) };
});

// Box drawing characters - rounded corners
const BOX = {
  tl: '╭', tr: '╮', bl: '╰', br: '╯',
  h: '─', v: '│',
  lt: '├', rt: '┤', tt: '┬', bt: '┴',
};

// Column widths (extended)
const LEFT_WIDTH = 41;
const RIGHT_WIDTH = 31;
const INNER_WIDTH = LEFT_WIDTH + 1 + RIGHT_WIDTH; // +1 for middle separator = 73, total 75 with borders

interface AgentStatus {
  name: string;
  ready: boolean;
}

interface BannerProps {
  version?: string;
  minimal?: boolean;
  agents?: AgentStatus[];
}

// Pad string to width
const pad = (str: string, width: number) => str + ' '.repeat(Math.max(0, width - str.length));
const center = (str: string, width: number) => {
  const left = Math.floor((width - str.length) / 2);
  return ' '.repeat(left) + str + ' '.repeat(width - str.length - left);
};

export function Banner({ version = '0.1.0', minimal = false, agents = [] }: BannerProps) {
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

  const defaultAgents: AgentStatus[] = agents.length > 0 ? agents : [
    { name: 'claude', ready: true },
    { name: 'gemini', ready: true },
    { name: 'ollama', ready: false },
  ];

  // Top line with version tag in top right corner
  const versionTag = ` Pulzd v${version} `;
  const rightPadding = 3; // 3 dashes before closing corner
  const leftDashes = INNER_WIDTH - versionTag.length - rightPadding;
  const topLine = BOX.tl + BOX.h.repeat(leftDashes) + versionTag + BOX.h.repeat(rightPadding) + BOX.tr;
  const midLine = BOX.lt + BOX.h.repeat(LEFT_WIDTH) + BOX.tt + BOX.h.repeat(RIGHT_WIDTH) + BOX.rt;
  const botLine = BOX.bl + BOX.h.repeat(LEFT_WIDTH) + BOX.bt + BOX.h.repeat(RIGHT_WIDTH) + BOX.br;

  // Logo padding for centering
  const logoPadLeft = Math.floor((INNER_WIDTH - LOGO_WIDTH) / 2);
  const logoPadRight = INNER_WIDTH - LOGO_WIDTH - logoPadLeft;

  const versionLine = `v${version} - Multi-LLM Orchestrator`;
  const versionPadded = center(versionLine, INNER_WIDTH);

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Top border with version tag on left */}
      <Box>
        <Text color={BORDER}>{BOX.tl + BOX.h.repeat(3)}</Text>
        <Text color={RED}> Pulzd</Text>
        <Text dimColor> v{version} </Text>
        <Text color={BORDER}>{BOX.h.repeat(INNER_WIDTH - 3 - ` Pulzd v${version} `.length) + BOX.tr}</Text>
      </Box>

      {/* Empty padding line */}
      <Box>
        <Text color={BORDER}>{BOX.v}</Text>
        <Text>{' '.repeat(INNER_WIDTH)}</Text>
        <Text color={BORDER}>{BOX.v}</Text>
      </Box>

      {/* Logo section */}
      {BANNER.map((line, index) => {
        // Calculate right padding dynamically based on actual content
        const contentLen = line.pulz.length + line.d.length;
        const rightPad = INNER_WIDTH - logoPadLeft - contentLen;
        return (
          <Box key={index}>
            <Text color={BORDER}>{BOX.v}</Text>
            <Text>{' '.repeat(logoPadLeft)}</Text>
            <Text bold color="white">{line.pulz}</Text>
            <Text bold color={RED}>{line.d}</Text>
            <Text>{' '.repeat(Math.max(0, rightPad))}</Text>
            <Text color={BORDER}>{BOX.v}</Text>
          </Box>
        );
      })}

      {/* Version line */}
      <Box>
        <Text color={BORDER}>{BOX.v}</Text>
        <Text dimColor>{versionPadded}</Text>
        <Text color={BORDER}>{BOX.v}</Text>
      </Box>

      {/* Empty padding line */}
      <Box>
        <Text color={BORDER}>{BOX.v}</Text>
        <Text>{' '.repeat(INNER_WIDTH)}</Text>
        <Text color={BORDER}>{BOX.v}</Text>
      </Box>

      {/* Middle divider */}
      <Text color={BORDER}>{midLine}</Text>

      {/* Panel headers */}
      <Box>
        <Text color={BORDER}>{BOX.v}</Text>
        <Text bold color="white">{pad(' Quick start', LEFT_WIDTH)}</Text>
        <Text color={BORDER}>{BOX.v}</Text>
        <Text bold color="white">{pad(' Status', RIGHT_WIDTH)}</Text>
        <Text color={BORDER}>{BOX.v}</Text>
      </Box>

      {/* Agent rows */}
      {defaultAgents.map((agent, i) => {
        const commands = [
          ' /compare claude,gemini "task"',
          ' /workflow code-review "code"',
          ' /autopilot "complex task"'
        ];
        const bullet = agent.ready ? '●' : '○';
        const statusText = agent.ready ? 'ready' : 'offline';
        // Right column: space + bullet + space + name(10) + status = 1+1+1+10+X = RIGHT_WIDTH
        const statusPad = RIGHT_WIDTH - 13;
        return (
          <Box key={agent.name}>
            <Text color={BORDER}>{BOX.v}</Text>
            <Text dimColor>{pad(commands[i] || '', LEFT_WIDTH)}</Text>
            <Text color={BORDER}>{BOX.v}</Text>
            <Text> </Text>
            <Text color={agent.ready ? 'green' : GRAY}>{bullet}</Text>
            <Text> {pad(agent.name, 10)}</Text>
            <Text dimColor>{pad(statusText, statusPad)}</Text>
            <Text color={BORDER}>{BOX.v}</Text>
          </Box>
        );
      })}

      {/* Bottom border */}
      <Text color={BORDER}>{botLine}</Text>
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
