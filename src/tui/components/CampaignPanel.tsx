import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CampaignState, CampaignTask } from '../../orchestrator/campaign/campaign-state.js';
import type { DriftDetectionResult } from '../../orchestrator/campaign/campaign-types.js';

const COLORS = {
  primary: '#8CA9FF',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  muted: 'gray',
  info: 'cyan'
};

interface CampaignPanelProps {
  state: CampaignState;
  driftResult?: DriftDetectionResult;
  onRefresh?: () => void;
  onBack?: () => void;
}

interface TaskCounts {
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  blocked: number;
}

function countTasks(tasks: CampaignTask[]): TaskCounts {
  return {
    pending: tasks.filter(t => t.status === 'pending').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    failed: tasks.filter(t => t.status === 'failed').length,
    blocked: tasks.filter(t => t.status === 'blocked').length
  };
}

function getStatusIcon(status: CampaignTask['status']): string {
  switch (status) {
    case 'completed': return '✓';
    case 'in_progress': return '●';
    case 'failed': return '✗';
    case 'blocked': return '⊘';
    default: return '○';
  }
}

function getStatusColor(status: CampaignTask['status']): string {
  switch (status) {
    case 'completed': return COLORS.success;
    case 'in_progress': return COLORS.warning;
    case 'failed': return COLORS.error;
    case 'blocked': return 'magenta';
    default: return COLORS.muted;
  }
}

function getCampaignStatusColor(status: CampaignState['status']): string {
  switch (status) {
    case 'completed': return COLORS.success;
    case 'running': return COLORS.warning;
    case 'failed': return COLORS.error;
    case 'paused': return COLORS.info;
    default: return COLORS.muted;
  }
}

function ProgressBar({ percent, width = 20 }: { percent: number; width?: number }) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  return (
    <Box>
      <Text>[</Text>
      <Text color={COLORS.success}>{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(empty)}</Text>
      <Text>] </Text>
      <Text bold>{percent}%</Text>
    </Box>
  );
}

function TaskList({
  tasks,
  maxVisible = 10,
  scrollOffset,
  selectedIndex
}: {
  tasks: CampaignTask[];
  maxVisible?: number;
  scrollOffset: number;
  selectedIndex: number;
}) {
  const visibleTasks = tasks.slice(scrollOffset, scrollOffset + maxVisible);

  return (
    <Box flexDirection="column">
      {visibleTasks.map((task, idx) => {
        const globalIdx = scrollOffset + idx;
        const isSelected = globalIdx === selectedIndex;
        const icon = getStatusIcon(task.status);
        const color = getStatusColor(task.status);

        return (
          <Box key={task.id}>
            <Text color={COLORS.primary}>{isSelected ? '>' : ' '} </Text>
            <Text color={color}>{icon} </Text>
            <Box width={12}>
              <Text color={isSelected ? COLORS.primary : undefined} bold={isSelected}>
                {task.id.slice(0, 10)}
              </Text>
            </Box>
            <Text> </Text>
            <Text dimColor={!isSelected}>
              {task.title.slice(0, 40)}{task.title.length > 40 ? '...' : ''}
            </Text>
            {task.attempts > 0 && (
              <Text color={COLORS.warning}> ({task.attempts})</Text>
            )}
          </Box>
        );
      })}
      {tasks.length > maxVisible && (
        <Text dimColor>
          {' '}  ... {tasks.length - maxVisible} more tasks (scroll with ↑↓)
        </Text>
      )}
    </Box>
  );
}

function DriftIndicator({ driftResult }: { driftResult?: DriftDetectionResult }) {
  if (!driftResult) {
    return (
      <Text dimColor>No drift check performed</Text>
    );
  }

  const severityColor = driftResult.severity === 'severe' ? COLORS.error :
    driftResult.severity === 'moderate' ? COLORS.warning : COLORS.success;

  const severityIcon = driftResult.severity === 'severe' ? '🔴' :
    driftResult.severity === 'moderate' ? '🟡' : '🟢';

  return (
    <Box flexDirection="column">
      <Box>
        <Text>Drift: </Text>
        <Text color={driftResult.drifted ? COLORS.error : COLORS.success}>
          {driftResult.drifted ? 'Detected' : 'None'}
        </Text>
        <Text> {severityIcon} </Text>
        <Text color={severityColor}>{driftResult.severity}</Text>
      </Box>
      {driftResult.drift_areas.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {driftResult.drift_areas.slice(0, 3).map((area, idx) => (
            <Box key={idx}>
              <Text dimColor>  • </Text>
              <Text color={getStatusColor(area.severity === 'severe' ? 'failed' : area.severity === 'moderate' ? 'in_progress' : 'pending')}>
                {area.domain}
              </Text>
              <Text dimColor>: {area.description.slice(0, 40)}...</Text>
            </Box>
          ))}
          {driftResult.drift_areas.length > 3 && (
            <Text dimColor>  ... {driftResult.drift_areas.length - 3} more areas</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

type ViewMode = 'overview' | 'tasks' | 'drift';

export function CampaignPanel({ state, driftResult, onRefresh, onBack }: CampaignPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [selectedTask, setSelectedTask] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [, setTick] = useState(0);

  const counts = countTasks(state.tasks);
  const progress = state.tasks.length > 0
    ? Math.round((counts.completed / state.tasks.length) * 100)
    : 0;

  // Auto-refresh timer indicator
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const maxVisibleTasks = 10;

  const scrollTasks = useCallback((direction: 'up' | 'down') => {
    if (direction === 'up') {
      setSelectedTask(prev => {
        const newIdx = Math.max(0, prev - 1);
        if (newIdx < scrollOffset) {
          setScrollOffset(Math.max(0, scrollOffset - 1));
        }
        return newIdx;
      });
    } else {
      setSelectedTask(prev => {
        const newIdx = Math.min(state.tasks.length - 1, prev + 1);
        if (newIdx >= scrollOffset + maxVisibleTasks) {
          setScrollOffset(Math.min(state.tasks.length - maxVisibleTasks, scrollOffset + 1));
        }
        return newIdx;
      });
    }
  }, [scrollOffset, state.tasks.length]);

  useInput((input, key) => {
    if (key.escape) {
      if (viewMode !== 'overview') {
        setViewMode('overview');
      } else if (onBack) {
        onBack();
      }
    } else if (input === 'r' && onRefresh) {
      onRefresh();
    } else if (input === 't') {
      setViewMode('tasks');
    } else if (input === 'd') {
      setViewMode('drift');
    } else if (input === 'o') {
      setViewMode('overview');
    } else if (key.upArrow && viewMode === 'tasks') {
      scrollTasks('up');
    } else if (key.downArrow && viewMode === 'tasks') {
      scrollTasks('down');
    }
  });

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={COLORS.muted} flexDirection="column" paddingX={2} paddingY={1}>
        {/* Header */}
        <Box>
          <Text bold color={COLORS.primary}>Campaign: </Text>
          <Text>{state.campaignId.slice(0, 20)}</Text>
          <Text dimColor> | </Text>
          <Text color={getCampaignStatusColor(state.status)} bold>
            {state.status.toUpperCase()}
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Goal: </Text>
          <Text>{state.goal.slice(0, 60)}{state.goal.length > 60 ? '...' : ''}</Text>
        </Box>

        <Text> </Text>

        {/* Progress Bar */}
        <Box>
          <Text bold>Progress: </Text>
          <ProgressBar percent={progress} />
        </Box>

        <Text> </Text>

        {/* Task Summary */}
        <Box>
          <Text color={COLORS.success}>✓ {counts.completed}</Text>
          <Text dimColor> | </Text>
          <Text color={COLORS.warning}>● {counts.in_progress}</Text>
          <Text dimColor> | </Text>
          <Text dimColor>○ {counts.pending}</Text>
          <Text dimColor> | </Text>
          <Text color={COLORS.error}>✗ {counts.failed}</Text>
          <Text dimColor> | </Text>
          <Text color="magenta">⊘ {counts.blocked}</Text>
          <Text dimColor> | </Text>
          <Text dimColor>Total: {state.tasks.length}</Text>
        </Box>

        <Text> </Text>

        {/* View-specific content */}
        {viewMode === 'overview' && (
          <Box flexDirection="column">
            <Text bold>Quick Info:</Text>
            <Box marginTop={1} flexDirection="column">
              <Box>
                <Text dimColor>Version: </Text>
                <Text>{state.version}</Text>
                <Text dimColor> | </Text>
                <Text dimColor>Checkpoints: </Text>
                <Text>{state.checkpoints.length}</Text>
                <Text dimColor> | </Text>
                <Text dimColor>Decisions: </Text>
                <Text>{state.decisions.length}</Text>
              </Box>
              <Box marginTop={1}>
                <DriftIndicator driftResult={driftResult} />
              </Box>
            </Box>
          </Box>
        )}

        {viewMode === 'tasks' && (
          <Box flexDirection="column">
            <Text bold>Tasks:</Text>
            <Box marginTop={1}>
              <TaskList
                tasks={state.tasks}
                maxVisible={maxVisibleTasks}
                scrollOffset={scrollOffset}
                selectedIndex={selectedTask}
              />
            </Box>
          </Box>
        )}

        {viewMode === 'drift' && (
          <Box flexDirection="column">
            <Text bold>Drift Analysis:</Text>
            <Box marginTop={1}>
              <DriftIndicator driftResult={driftResult} />
            </Box>
          </Box>
        )}

        <Text> </Text>

        {/* Footer with keybindings */}
        <Box borderStyle="single" borderColor={COLORS.muted} borderTop borderBottom={false} borderLeft={false} borderRight={false}>
          <Text dimColor>
            [o]verview [t]asks [d]rift | [r]efresh | Esc back
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

export default CampaignPanel;
