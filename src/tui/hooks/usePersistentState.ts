import { useState, useCallback } from 'react';

export function usePersistentState<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = localStorage?.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

const setValue = useCallback((value: T | ((val: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      localStorage?.setItem(key, JSON.stringify(valueToStore));
      setStoredValue(valueToStore);
    } catch {
      // Silently fail for localStorage errors
    }
  }, [key, storedValue]);

  return [storedValue, setValue] as const;
}
