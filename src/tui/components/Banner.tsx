import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import figlet from 'figlet';

// Logo colors
const RED = '#fc3855';
const BORDER = 'gray';
const GRAY = 'gray';

// Generate ASCII art banner for PK-puzld using figlet with Small font
function generateBannerArt(): { pkLines: string[]; puzldLines: string[] } {
  const pkArt = figlet.textSync('PK', { font: 'Small' });
  const puzldArt = figlet.textSync('puzld', { font: 'Small' });

  return {
    pkLines: pkArt.split('\n'),
    puzldLines: puzldArt.split('\n')
  };
}

// Box drawing characters - rounded corners
const BOX = {
  tl: '╭', tr: '╮', bl: '╰', br: '╯',
  h: '─', v: '│',
  lt: '├', rt: '┤', tt: '┬', bt: '┴',
};

// Column widths - wider left, narrower right
const LEFT_WIDTH = 54;
const RIGHT_WIDTH = 20;
const INNER_WIDTH = LEFT_WIDTH + 1 + RIGHT_WIDTH; // +1 for middle separator = 75, total 77 with borders

interface AgentStatus {
  name: string;
  ready: boolean;
}

interface ChangelogItem {
  text: string;
}

interface BannerProps {
  version?: string;
  minimal?: boolean;
  agents?: AgentStatus[];
  changelog?: ChangelogItem[];
}

// Pad string to width
const pad = (str: string, width: number) => str + ' '.repeat(Math.max(0, width - str.length));
const center = (str: string, width: number) => {
  const left = Math.floor((width - str.length) / 2);
  return ' '.repeat(left) + str + ' '.repeat(width - str.length - left);
};

// Parse changelog to get latest version items
function getLatestChangelog(): ChangelogItem[] {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const changelogPath = join(__dirname, '..', '..', '..', 'CHANGELOG.md');
    const content = readFileSync(changelogPath, 'utf-8');

    const lines = content.split('\n');
    const items: ChangelogItem[] = [];
    let inVersion = false;

    for (const line of lines) {
      if (line.startsWith('## [') && !line.includes('[Unreleased]')) {
        if (inVersion) break; // Stop after first version
        inVersion = true;
        continue;
      }
      if (inVersion && line.startsWith('- ')) {
        const text = line.slice(2).trim();
        // Truncate long lines
        items.push({ text: text.length > 50 ? text.slice(0, 47) + '...' : text });
        if (items.length >= 2) break; // Only get 2 items
      }
    }
    return items;
  } catch {
    return [
      { text: 'Check /changelog for updates' }
    ];
  }
}

export function Banner({ version = '0.1.0', minimal = false, agents = [], changelog }: BannerProps) {
  if (minimal) {
    return (
      <Box marginBottom={1}>
        <Text bold color="white">PK-Puzld</Text>
        <Text dimColor> v{version}</Text>
      </Box>
    );
  }

  // Get changelog items
  const changelogItems = changelog || getLatestChangelog();

  // Default order for display: claude, gemini, codex, ollama, mistral, factory
  const agentOrder = ['claude', 'gemini', 'codex', 'ollama', 'mistral', 'factory'];
  const defaultAgents: AgentStatus[] = agents.length > 0
    ? agentOrder.map(name => agents.find(a => a.name === name) || { name, ready: false })
    : agentOrder.map(name => ({ name, ready: false }));

  const versionLine = `v${version} - Multi-LLM Orchestrator`;
  const versionPadded = center(versionLine, INNER_WIDTH);

  // Divider lines
  const midLine = BOX.lt + BOX.h.repeat(LEFT_WIDTH) + BOX.tt + BOX.h.repeat(RIGHT_WIDTH) + BOX.rt;
  const botLine = BOX.bl + BOX.h.repeat(LEFT_WIDTH) + BOX.bt + BOX.h.repeat(RIGHT_WIDTH) + BOX.br;

  // Floating divider for left panel (1 space gap on each side)
  const floatingDivider = ' ' + BOX.h.repeat(LEFT_WIDTH - 2) + ' ';

  // Quick start commands
  const commands = [
    ' /compare claude,gemini "task"',
    ' /autopilot "complex task"',
    ' /workflow code-review "code"',
  ];

  // Helper to render a row with left and right content
  const renderRow = (leftContent: string, rightContent: string, key: string, leftDim?: boolean) => (
    <Box key={key}>
      <Text color={BORDER}>{BOX.v}</Text>
      {leftDim ? (
        <Text dimColor>{pad(leftContent, LEFT_WIDTH)}</Text>
      ) : (
        <Text>{pad(leftContent, LEFT_WIDTH)}</Text>
      )}
      <Text color={BORDER}>{BOX.v}</Text>
      <Text>{pad(rightContent, RIGHT_WIDTH)}</Text>
      <Text color={BORDER}>{BOX.v}</Text>
    </Box>
  );

  // Helper to render agent status row (centered in right panel)
  const renderAgentRow = (leftContent: string, agent: AgentStatus, leftDim?: boolean) => {
    const bullet = agent.ready ? '●' : '○';
    const statusText = agent.ready ? 'ready' : 'off';
    // Format: " ● name    status " - bullet colored, rest normal, centered
    const nameAndStatus = `${agent.name.padEnd(7)} ${statusText}`;
    const contentLen = 1 + 1 + nameAndStatus.length; // bullet + space + rest
    const totalPad = RIGHT_WIDTH - contentLen;
    const leftPad = Math.floor(totalPad / 2);
    const rightPad = totalPad - leftPad;

    return (
      <Box key={`agent-${agent.name}`}>
        <Text color={BORDER}>{BOX.v}</Text>
        <Text dimColor={leftDim}>{pad(leftContent, LEFT_WIDTH)}</Text>
        <Text color={BORDER}>{BOX.v}</Text>
        <Text>{' '.repeat(leftPad)}</Text>
        <Text color={agent.ready ? 'green' : GRAY}>{bullet}</Text>
        <Text> {nameAndStatus}</Text>
        <Text>{' '.repeat(Math.max(0, rightPad))}</Text>
        <Text color={BORDER}>{BOX.v}</Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Top border with version tag */}
      <Box>
        <Text color={BORDER}>{BOX.tl + BOX.h.repeat(3)}</Text>
        <Text color={RED}> PK-Puzld</Text>
        <Text dimColor> v{version} </Text>
        <Text color={BORDER}>{BOX.h.repeat(INNER_WIDTH - 3 - ` PK-Puzld v${version} `.length) + BOX.tr}</Text>
      </Box>

      {/* Empty padding line */}
      <Box>
        <Text color={BORDER}>{BOX.v}</Text>
        <Text>{' '.repeat(INNER_WIDTH)}</Text>
        <Text color={BORDER}>{BOX.v}</Text>
      </Box>

      {/* ASCII Art Logo section using figlet */}
      {(() => {
        const { pkLines, puzldLines } = generateBannerArt();
        const maxPkWidth = Math.max(...pkLines.map(l => l.length));
        const maxPuzldWidth = Math.max(...puzldLines.map(l => l.length));
        const totalWidth = maxPkWidth + maxPuzldWidth;
        const logoPadLeft = Math.floor((INNER_WIDTH - totalWidth) / 2);

        return (
          <>
            {pkLines.map((line, index) => (
              <Box key={`pk-${index}`}>
                <Text color={BORDER}>{BOX.v}</Text>
                <Text>{' '.repeat(logoPadLeft)}</Text>
                <Text bold color="white">{line}</Text>
                <Text>{' '.repeat(maxPuzldWidth)}</Text>
                <Text color={BORDER}>{BOX.v}</Text>
              </Box>
            ))}
            {puzldLines.map((line, index) => (
              <Box key={`puzld-${index}`}>
                <Text color={BORDER}>{BOX.v}</Text>
                <Text>{' '.repeat(logoPadLeft)}</Text>
                <Text>{' '.repeat(maxPkWidth)}</Text>
                <Text bold color={RED}>{line}</Text>
                <Text color={BORDER}>{BOX.v}</Text>
              </Box>
            ))}
          </>
        );
      })()}

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
        <Text bold color="white">{center('Status', RIGHT_WIDTH)}</Text>
        <Text color={BORDER}>{BOX.v}</Text>
      </Box>

      {/* Command 1 + empty right (offsets agents down) */}
      {renderRow(commands[0] || '', '', 'cmd-1', true)}

      {/* Command 2 + Agent 1 */}
      {renderAgentRow(commands[1] || '', defaultAgents[0], true)}

      {/* Command 3 + Agent 2 */}
      {renderAgentRow(commands[2] || '', defaultAgents[1], true)}

      {/* Floating divider + Agent 3 */}
      {(() => {
        const agent = defaultAgents[2];
        const bullet = agent.ready ? '●' : '○';
        const statusText = agent.ready ? 'ready' : 'off';
        const nameAndStatus = `${agent.name.padEnd(7)} ${statusText}`;
        const contentLen = 1 + 1 + nameAndStatus.length;
        const totalPad = RIGHT_WIDTH - contentLen;
        const leftPadAmt = Math.floor(totalPad / 2);
        const rightPadAmt = totalPad - leftPadAmt;
        return (
          <Box key={`agent-${agent.name}`}>
            <Text color={BORDER}>{BOX.v}</Text>
            <Text color={BORDER}>{floatingDivider}</Text>
            <Text color={BORDER}>{BOX.v}</Text>
            <Text>{' '.repeat(leftPadAmt)}</Text>
            <Text color={agent.ready ? 'green' : GRAY}>{bullet}</Text>
            <Text> {nameAndStatus}</Text>
            <Text>{' '.repeat(Math.max(0, rightPadAmt))}</Text>
            <Text color={BORDER}>{BOX.v}</Text>
          </Box>
        );
      })()}

      {/* What's new + Agent 4 */}
      {(() => {
        const agent = defaultAgents[3];
        const bullet = agent.ready ? '●' : '○';
        const statusText = agent.ready ? 'ready' : 'off';
        const nameAndStatus = `${agent.name.padEnd(7)} ${statusText}`;
        const contentLen = 1 + 1 + nameAndStatus.length;
        const totalPad = RIGHT_WIDTH - contentLen;
        const leftPadAmt = Math.floor(totalPad / 2);
        const rightPadAmt = totalPad - leftPadAmt;
        return (
          <Box key="whatsnew-agent4">
            <Text color={BORDER}>{BOX.v}</Text>
            <Text bold color="white">{pad(` What's new in v${version}`, LEFT_WIDTH)}</Text>
            <Text color={BORDER}>{BOX.v}</Text>
            <Text>{' '.repeat(leftPadAmt)}</Text>
            <Text color={agent.ready ? 'green' : GRAY}>{bullet}</Text>
            <Text> {nameAndStatus}</Text>
            <Text>{' '.repeat(Math.max(0, rightPadAmt))}</Text>
            <Text color={BORDER}>{BOX.v}</Text>
          </Box>
        );
      })()}

      {/* Changelog item 1 + Agent 5 (mistral) */}
      {(() => {
        const agent = defaultAgents[4];
        const bullet = agent.ready ? '●' : '○';
        const statusText = agent.ready ? 'ready' : 'off';
        const nameAndStatus = `${agent.name.padEnd(7)} ${statusText}`;
        const contentLen = 1 + 1 + nameAndStatus.length;
        const totalPad = RIGHT_WIDTH - contentLen;
        const leftPadAmt = Math.floor(totalPad / 2);
        const rightPadAmt = totalPad - leftPadAmt;
        const item = changelogItems[0];
        return (
          <Box key="changelog-0-agent5">
            <Text color={BORDER}>{BOX.v}</Text>
            <Text dimColor>{pad('  - ' + (item?.text || ''), LEFT_WIDTH)}</Text>
            <Text color={BORDER}>{BOX.v}</Text>
            <Text>{' '.repeat(leftPadAmt)}</Text>
            <Text color={agent.ready ? 'green' : GRAY}>{bullet}</Text>
            <Text> {nameAndStatus}</Text>
            <Text>{' '.repeat(Math.max(0, rightPadAmt))}</Text>
            <Text color={BORDER}>{BOX.v}</Text>
          </Box>
        );
      })()}

      {/* Changelog item 2 (or blank) + Agent 6 (factory) */}
      {defaultAgents[5] ? renderAgentRow(
        changelogItems[1] ? '  - ' + changelogItems[1].text : '',
        defaultAgents[5],
        true
      ) : null}

      {/* Remaining changelog items (from item 3 onward) */}
      {changelogItems.slice(2).map((item, i) => (
        <Box key={`changelog-${i + 2}`}>
          <Text color={BORDER}>{BOX.v}</Text>
          <Text dimColor>{pad('  - ' + item.text, LEFT_WIDTH)}</Text>
          <Text color={BORDER}>{BOX.v}</Text>
          <Text>{' '.repeat(RIGHT_WIDTH)}</Text>
          <Text color={BORDER}>{BOX.v}</Text>
        </Box>
      ))}

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
