import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { getSessionStats, type AgentSession } from '../../memory';

const HIGHLIGHT = '#8CA9FF';

type SettingsTab = 'status' | 'session' | 'config';

interface SettingsPanelProps {
  onBack: () => void;
  version: string;
  currentAgent: string;
  routerAgent: string;
  plannerAgent: string;
  session: AgentSession | null;
  // Toggles
  sequential: boolean;
  pick: boolean;
  autoExecute: boolean;
  interactive: boolean;
  // Toggle setters
  onToggleSequential: () => void;
  onTogglePick: () => void;
  onToggleExecute: () => void;
  onToggleInteractive: () => void;
}

interface ConfigOption {
  key: string;
  label: string;
  value: boolean;
  onToggle: () => void;
}

export function SettingsPanel({
  onBack,
  version,
  currentAgent,
  routerAgent,
  plannerAgent,
  session,
  sequential,
  pick,
  autoExecute,
  interactive,
  onToggleSequential,
  onTogglePick,
  onToggleExecute,
  onToggleInteractive
}: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>('status');
  const [configIndex, setConfigIndex] = useState(0);

  const configOptions: ConfigOption[] = [
    { key: 'sequential', label: 'Sequential compare', value: sequential, onToggle: onToggleSequential },
    { key: 'pick', label: 'Pick best from compare', value: pick, onToggle: onTogglePick },
    { key: 'autoExecute', label: 'Auto-execute autopilot', value: autoExecute, onToggle: onToggleExecute },
    { key: 'interactive', label: 'Interactive mode', value: interactive, onToggle: onToggleInteractive }
  ];

  // Handle tab cycling and escape
  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.tab) {
      setTab(t => t === 'status' ? 'session' : t === 'session' ? 'config' : 'status');
    }
  });

  // Handle config navigation
  useInput((input, key) => {
    if (tab !== 'config') return;

    if (key.upArrow) {
      setConfigIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setConfigIndex(i => Math.min(configOptions.length - 1, i + 1));
    } else if (key.return || input === ' ') {
      configOptions[configIndex].onToggle();
    }
  }, { isActive: tab === 'config' });

  // Get session stats
  const sessionStats = session ? getSessionStats(session) : null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Tab bar */}
      <Box marginBottom={1}>
        <Text bold>Settings: </Text>
        <Text inverse={tab === 'status'} color={tab === 'status' ? HIGHLIGHT : undefined}> Status </Text>
        <Text>  </Text>
        <Text inverse={tab === 'session'} color={tab === 'session' ? HIGHLIGHT : undefined}> Session </Text>
        <Text>  </Text>
        <Text inverse={tab === 'config'} color={tab === 'config' ? HIGHLIGHT : undefined}> Config </Text>
        <Text dimColor>  (Tab to cycle)</Text>
      </Box>

      {/* Tab content */}
      <Box flexDirection="column" paddingLeft={1}>
        {tab === 'status' && (
          <StatusTab
            version={version}
            currentAgent={currentAgent}
            routerAgent={routerAgent}
            plannerAgent={plannerAgent}
          />
        )}
        {tab === 'session' && (
          <SessionTab session={session} stats={sessionStats} />
        )}
        {tab === 'config' && (
          <ConfigTab options={configOptions} selectedIndex={configIndex} />
        )}
      </Box>

      {/* Footer hint */}
      <Box marginTop={1}>
        <Text dimColor>
          {tab === 'config' ? 'Enter/Space to toggle · ' : ''}Esc to exit
        </Text>
      </Box>
    </Box>
  );
}

interface StatusTabProps {
  version: string;
  currentAgent: string;
  routerAgent: string;
  plannerAgent: string;
}

function StatusTab({ version, currentAgent, routerAgent, plannerAgent }: StatusTabProps) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{'Version:'.padEnd(20)}</Text>
        <Text>{version}</Text>
      </Box>
      <Box>
        <Text bold>{'Current Agent:'.padEnd(20)}</Text>
        <Text>{currentAgent}</Text>
      </Box>
      <Box>
        <Text bold>{'Router Agent:'.padEnd(20)}</Text>
        <Text>{routerAgent}</Text>
      </Box>
      <Box>
        <Text bold>{'Planner Agent:'.padEnd(20)}</Text>
        <Text>{plannerAgent}</Text>
      </Box>
    </Box>
  );
}

interface SessionTabProps {
  session: AgentSession | null;
  stats: ReturnType<typeof getSessionStats> | null;
}

function SessionTab({ session, stats }: SessionTabProps) {
  if (!session || !stats) {
    return <Text dimColor>No active session</Text>;
  }

  const formatDate = (ts: number) => new Date(ts).toLocaleString();

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{'Session ID:'.padEnd(20)}</Text>
        <Text dimColor>{session.id}</Text>
      </Box>
      <Box>
        <Text bold>{'Agent:'.padEnd(20)}</Text>
        <Text>{session.agent}</Text>
      </Box>
      <Box>
        <Text bold>{'Messages:'.padEnd(20)}</Text>
        <Text>{stats.messageCount}</Text>
      </Box>
      <Box>
        <Text bold>{'Tokens:'.padEnd(20)}</Text>
        <Text>{stats.totalTokens} </Text>
        <Text dimColor>(recent: {stats.recentTokens}, summary: {stats.summaryTokens})</Text>
      </Box>
      <Box>
        <Text bold>{'Compression:'.padEnd(20)}</Text>
        <Text>{stats.compressionRatio}%</Text>
      </Box>
      <Box>
        <Text bold>{'Created:'.padEnd(20)}</Text>
        <Text dimColor>{formatDate(session.createdAt)}</Text>
      </Box>
      <Box>
        <Text bold>{'Updated:'.padEnd(20)}</Text>
        <Text dimColor>{formatDate(session.updatedAt)}</Text>
      </Box>
      {session.summary && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Summary:</Text>
          <Text dimColor>{session.summary.slice(0, 200)}{session.summary.length > 200 ? '...' : ''}</Text>
        </Box>
      )}
    </Box>
  );
}

interface ConfigTabProps {
  options: ConfigOption[];
  selectedIndex: number;
}

function ConfigTab({ options, selectedIndex }: ConfigTabProps) {
  return (
    <Box flexDirection="column">
      <Text dimColor>Configure PulzdAI preferences</Text>
      <Box flexDirection="column" marginTop={1}>
        {options.map((opt, i) => {
          const isSelected = i === selectedIndex;
          return (
            <Box key={opt.key}>
              <Text color={isSelected ? HIGHLIGHT : undefined}>
                {isSelected ? '>' : ' '} {opt.label.padEnd(30)}
              </Text>
              <Text color={opt.value ? 'green' : 'gray'}>
                {opt.value ? 'true' : 'false'}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
