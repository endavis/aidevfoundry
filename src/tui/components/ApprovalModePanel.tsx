import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

const HIGHLIGHT_COLOR = '#8CA9FF';

export type ApprovalMode = 'default' | 'plan' | 'accept' | 'yolo';

interface ModeOption {
  id: ApprovalMode;
  name: string;
  description: string;
  permissions: string;
  edits: string;
}

interface ApprovalModePanelProps {
  currentMode: ApprovalMode;
  onSelect: (mode: ApprovalMode) => void;
  onBack: () => void;
}

export function ApprovalModePanel({ currentMode, onSelect, onBack }: ApprovalModePanelProps) {
  const modes: ModeOption[] = [
    {
      id: 'default',
      name: 'Default',
      description: 'Normal development',
      permissions: 'Ask for each',
      edits: 'Diff review'
    },
    {
      id: 'plan',
      name: 'Plan',
      description: 'Planning/reviewing',
      permissions: 'Ask for each',
      edits: 'Show plan only'
    },
    {
      id: 'accept',
      name: 'Accept Edits',
      description: 'Faster iteration',
      permissions: 'Ask for each',
      edits: 'Auto-apply'
    },
    {
      id: 'yolo',
      name: 'YOLO',
      description: 'Full trust, max speed',
      permissions: 'Auto-approve',
      edits: 'Auto-apply'
    },
  ];

  const currentIndex = modes.findIndex(m => m.id === currentMode);
  const [selectedIndex, setSelectedIndex] = useState(currentIndex >= 0 ? currentIndex : 0);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
    } else if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(modes.length - 1, i + 1));
    } else if (key.return) {
      const selected = modes[selectedIndex];
      // Show warning for YOLO mode
      if (selected.id === 'yolo') {
        onSelect(selected.id);
      } else {
        onSelect(selected.id);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>Approval Mode</Text>
        <Text> </Text>
        {modes.map((mode, idx) => {
          const isSelected = idx === selectedIndex;
          const isCurrent = mode.id === currentMode;
          return (
            <Box key={mode.id} flexDirection="column">
              <Box>
                <Text color={HIGHLIGHT_COLOR}>{isSelected ? '❯' : ' '} </Text>
                <Box width={14}>
                  <Text color={isSelected ? HIGHLIGHT_COLOR : undefined} bold={isSelected}>
                    {mode.name}
                  </Text>
                </Box>
                <Text dimColor>  {mode.description}</Text>
                {isCurrent && <Text color="#fbbf24">  (current)</Text>}
                {mode.id === 'yolo' && <Text color="#fc3855">  ⚡</Text>}
              </Box>
              {isSelected && (
                <Box marginLeft={3} flexDirection="column">
                  <Text dimColor>  Permissions: <Text color="gray">{mode.permissions}</Text></Text>
                  <Text dimColor>  File Edits: <Text color="gray">{mode.edits}</Text></Text>
                </Box>
              )}
            </Box>
          );
        })}
        <Text> </Text>
        <Text dimColor>↑↓ navigate · Enter select · Esc back</Text>
      </Box>
    </Box>
  );
}
