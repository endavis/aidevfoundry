import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface InputBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function InputBox({ value, onChange, onSubmit, placeholder = 'Type a message...', disabled = false }: InputBoxProps) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray">╭──────────────────────────────────────────────────────────────────╮</Text>
      </Box>
      <Box>
        <Text color="gray">│ </Text>
        <Text color="green" bold>{'> '}</Text>
        {disabled ? (
          <Text dimColor>{placeholder}</Text>
        ) : (
          <TextInput
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            placeholder={placeholder}
          />
        )}
        <Text color="gray">{' '.repeat(Math.max(0, 60 - value.length))}│</Text>
      </Box>
      <Box>
        <Text color="gray">╰──────────────────────────────────────────────────────────────────╯</Text>
      </Box>
    </Box>
  );
}
