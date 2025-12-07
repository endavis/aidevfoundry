import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  listSessions,
  loadSession,
  deleteSession,
  clearSessionHistory,
  getSessionStats,
  AgentSession
} from '../../memory';

const HIGHLIGHT_COLOR = '#8CA9FF';

type View = 'menu' | 'list' | 'session' | 'confirm-delete' | 'confirm-clear';

interface SessionsManagerProps {
  onBack: () => void;
  onLoadSession: (session: AgentSession) => void;
  currentAgent?: string;
}

export function SessionsManager({ onBack, onLoadSession, currentAgent }: SessionsManagerProps) {
  const [view, setView] = useState<View>('menu');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [filterAgent, setFilterAgent] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  // Full session loaded when entering session view
  const [fullSession, setFullSession] = useState<AgentSession | null>(null);

  // Memoize sessions list to avoid calling every render
  const sessions = useMemo(() => listSessions(filterAgent), [filterAgent, view]);

  // Load full session when entering session view
  useEffect(() => {
    if (view === 'session' && selectedSessionId) {
      const loaded = loadSession(selectedSessionId);
      if (loaded) {
        setFullSession(loaded);
        setError(null);
      } else {
        setFullSession(null);
        setError('Failed to load session');
      }
    } else {
      setFullSession(null);
    }
  }, [view, selectedSessionId]);

  // Menu items
  const menuItems = [
    { label: 'All Sessions', value: 'all', hint: 'View all sessions' },
    { label: `${currentAgent || 'Current'} Agent Sessions`, value: 'agent', hint: `Filter by ${currentAgent || 'current agent'}` }
  ];

  // Track indices
  const [menuIndex, setMenuIndex] = useState(0);
  const [listIndex, setListIndex] = useState(0);
  const [actionIndex, setActionIndex] = useState(0);
  const [confirmIndex, setConfirmIndex] = useState(1); // Default to "No"

  // Session actions
  const sessionActions = [
    { label: 'Resume', value: 'resume', hint: 'Continue this session' },
    { label: 'Clear History', value: 'clear', hint: 'Remove all messages' },
    { label: 'Delete', value: 'delete', hint: 'Remove session permanently' }
  ];

  // Handle Esc to go back
  useInput((input, key) => {
    if (key.escape) {
      if (view === 'menu') {
        onBack();
      } else if (view === 'list') {
        setView('menu');
        setListIndex(0);
      } else if (view === 'session') {
        setView('list');
        setSelectedSessionId(null);
        setActionIndex(0);
        setError(null);
      } else if (view === 'confirm-delete' || view === 'confirm-clear') {
        setView('session');
        setConfirmIndex(1);
      }
    }
  });

  // Handle menu keyboard
  useInput((input, key) => {
    if (view !== 'menu') return;
    if (key.upArrow) {
      setMenuIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setMenuIndex(i => Math.min(menuItems.length - 1, i + 1));
    } else if (key.return) {
      const item = menuItems[menuIndex];
      if (item.value === 'all') {
        setFilterAgent(undefined);
      } else {
        setFilterAgent(currentAgent);
      }
      setView('list');
      setListIndex(0);
    }
  }, { isActive: view === 'menu' });

  // Handle list keyboard
  useInput((input, key) => {
    if (view !== 'list') return;
    if (key.upArrow) {
      setListIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setListIndex(i => Math.min(sessions.length - 1, i + 1));
    } else if (key.return) {
      const session = sessions[listIndex];
      if (session) {
        setSelectedSessionId(session.id);
        setView('session');
        setActionIndex(0);
      }
    }
  }, { isActive: view === 'list' });

  // Handle session actions keyboard
  useInput((input, key) => {
    if (view !== 'session') return;
    if (key.upArrow) {
      setActionIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setActionIndex(i => Math.min(sessionActions.length - 1, i + 1));
    } else if (key.return) {
      const action = sessionActions[actionIndex];
      handleSessionAction(action.value);
    }
  }, { isActive: view === 'session' });

  // Handle confirm keyboard
  useInput((input, key) => {
    if (view !== 'confirm-delete' && view !== 'confirm-clear') return;
    if (key.upArrow || key.downArrow) {
      setConfirmIndex(i => i === 0 ? 1 : 0);
    } else if (key.return) {
      if (confirmIndex === 0) {
        // Yes
        if (view === 'confirm-delete' && selectedSessionId) {
          deleteSession(selectedSessionId);
          setView('list');
          setSelectedSessionId(null);
          setListIndex(0);
        } else if (view === 'confirm-clear' && fullSession) {
          clearSessionHistory(fullSession);
          setFullSession(loadSession(fullSession.id));
          setView('session');
        }
      } else {
        setView('session');
      }
      setConfirmIndex(1);
    }
  }, { isActive: view === 'confirm-delete' || view === 'confirm-clear' });

  // Handle session action
  const handleSessionAction = (action: string) => {
    if (!fullSession) return;

    switch (action) {
      case 'resume':
        onLoadSession(fullSession);
        break;
      case 'clear':
        setView('confirm-clear');
        setConfirmIndex(1);
        break;
      case 'delete':
        setView('confirm-delete');
        setConfirmIndex(1);
        break;
    }
  };

  // Format date
  const formatDate = (ts: number): string => {
    return new Date(ts).toLocaleString();
  };

  // Render based on current view
  const renderView = () => {
    switch (view) {
      case 'menu':
        return (
          <Box flexDirection="column">
            <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
              <Text bold>Manage Sessions</Text>
              <Text> </Text>
              {menuItems.map((item, idx) => {
                const isSelected = idx === menuIndex;
                return (
                  <Box key={item.value}>
                    <Text color={HIGHLIGHT_COLOR}>{isSelected ? '>' : ' '} </Text>
                    <Text color={isSelected ? HIGHLIGHT_COLOR : undefined} bold={isSelected}>
                      {idx + 1}. {item.label}
                    </Text>
                    <Text dimColor>  {item.hint}</Text>
                  </Box>
                );
              })}
              <Text> </Text>
              <Text dimColor>Arrow keys navigate | Enter select | Esc back</Text>
            </Box>
          </Box>
        );

      case 'list':
        return (
          <Box flexDirection="column">
            <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
              <Text bold>Sessions {filterAgent ? `(${filterAgent})` : '(all)'}</Text>
              <Text> </Text>
              {sessions.length === 0 ? (
                <Text dimColor>No sessions found</Text>
              ) : (
                sessions.map((session, idx) => {
                  const isSelected = idx === listIndex;
                  return (
                    <Box key={session.id} flexDirection="column">
                      <Box>
                        <Text color={HIGHLIGHT_COLOR}>{isSelected ? '>' : ' '} </Text>
                        <Text color={isSelected ? HIGHLIGHT_COLOR : undefined} bold={isSelected}>
                          {idx + 1}. {session.agent}
                        </Text>
                        <Text dimColor>  {session.messageCount} msgs | {session.totalTokens} tokens</Text>
                      </Box>
                      {isSelected && (
                        <Box marginLeft={3}>
                          <Text dimColor>{session.preview}</Text>
                        </Box>
                      )}
                    </Box>
                  );
                })
              )}
              <Text> </Text>
              <Text dimColor>Arrow keys navigate | Enter select | Esc back</Text>
            </Box>
          </Box>
        );

      case 'session': {
        if (!fullSession) {
          return (
            <Box flexDirection="column">
              <Text color="red">{error || 'Session not found'}</Text>
              <Text dimColor>Press Esc to go back</Text>
            </Box>
          );
        }

        const stats = getSessionStats(fullSession);
        return (
          <Box flexDirection="column">
            <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
              <Text bold>Session: {fullSession.agent}</Text>
              <Text dimColor>ID: {fullSession.id}</Text>
              <Text> </Text>
              <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1}>
                <Text>Messages: {stats.messageCount}</Text>
                <Text>Tokens: {stats.totalTokens} (recent: {stats.recentTokens}, summary: {stats.summaryTokens})</Text>
                <Text>Compression: {stats.compressionRatio}%</Text>
                <Text>Created: {formatDate(fullSession.createdAt)}</Text>
                <Text>Updated: {formatDate(fullSession.updatedAt)}</Text>
              </Box>
              {fullSession.summary && (
                <>
                  <Text> </Text>
                  <Text dimColor>Summary:</Text>
                  <Text>{fullSession.summary.slice(0, 200)}{fullSession.summary.length > 200 ? '...' : ''}</Text>
                </>
              )}
              <Text> </Text>
              {sessionActions.map((action, idx) => {
                const isSelected = idx === actionIndex;
                return (
                  <Box key={action.value}>
                    <Text color={HIGHLIGHT_COLOR}>{isSelected ? '>' : ' '} </Text>
                    <Text color={isSelected ? HIGHLIGHT_COLOR : undefined} bold={isSelected}>
                      {action.label}
                    </Text>
                    <Text dimColor>  {action.hint}</Text>
                  </Box>
                );
              })}
              <Text> </Text>
              <Text dimColor>Arrow keys navigate | Enter select | Esc back</Text>
            </Box>
          </Box>
        );
      }

      case 'confirm-delete':
        return (
          <Box flexDirection="column">
            <Box borderStyle="round" borderColor="red" flexDirection="column" paddingX={1}>
              <Text bold color="red">Delete Session?</Text>
              <Text dimColor>This cannot be undone.</Text>
              <Text> </Text>
              {['Yes, delete', 'No, cancel'].map((label, idx) => {
                const isSelected = idx === confirmIndex;
                return (
                  <Box key={idx}>
                    <Text color={HIGHLIGHT_COLOR}>{isSelected ? '>' : ' '} </Text>
                    <Text color={isSelected ? HIGHLIGHT_COLOR : undefined} bold={isSelected}>
                      {label}
                    </Text>
                  </Box>
                );
              })}
            </Box>
          </Box>
        );

      case 'confirm-clear':
        return (
          <Box flexDirection="column">
            <Box borderStyle="round" borderColor="yellow" flexDirection="column" paddingX={1}>
              <Text bold color="yellow">Clear Session History?</Text>
              <Text dimColor>All messages will be removed. Session will remain.</Text>
              <Text> </Text>
              {['Yes, clear', 'No, cancel'].map((label, idx) => {
                const isSelected = idx === confirmIndex;
                return (
                  <Box key={idx}>
                    <Text color={HIGHLIGHT_COLOR}>{isSelected ? '>' : ' '} </Text>
                    <Text color={isSelected ? HIGHLIGHT_COLOR : undefined} bold={isSelected}>
                      {label}
                    </Text>
                  </Box>
                );
              })}
            </Box>
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      {renderView()}
    </Box>
  );
}
