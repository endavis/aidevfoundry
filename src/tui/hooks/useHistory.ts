import { useState, useCallback } from 'react';

export function useHistory(maxSize = 50) {
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempInput, setTempInput] = useState('');

  const addToHistory = useCallback((command: string) => {
    if (command.trim()) {
      setHistory(prev => {
        // Don't add duplicates consecutively
        if (prev[prev.length - 1] === command) return prev;
        const newHistory = [...prev, command];
        if (newHistory.length > maxSize) {
          return newHistory.slice(-maxSize);
        }
        return newHistory;
      });
    }
    setHistoryIndex(-1);
    setTempInput('');
  }, [maxSize]);

  const navigateHistory = useCallback((direction: 'up' | 'down', currentInput: string): string => {
    if (history.length === 0) return currentInput;

    if (direction === 'up') {
      if (historyIndex === -1) {
        // Save current input before navigating
        setTempInput(currentInput);
        setHistoryIndex(history.length - 1);
        return history[history.length - 1];
      } else if (historyIndex > 0) {
        setHistoryIndex(historyIndex - 1);
        return history[historyIndex - 1];
      }
      return history[historyIndex];
    } else {
      if (historyIndex === -1) {
        return currentInput;
      } else if (historyIndex < history.length - 1) {
        setHistoryIndex(historyIndex + 1);
        return history[historyIndex + 1];
      } else {
        // Return to current input
        setHistoryIndex(-1);
        return tempInput;
      }
    }
  }, [history, historyIndex, tempInput]);

  return {
    history,
    addToHistory,
    navigateHistory,
    historyIndex,
  };
}
