import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

export type ConfirmAction = 'yes' | 'yes_all' | 'skip' | 'abort';

interface StepConfirmationProps {
  stepNumber: number;
  totalSteps: number;
  agent: string;
  role: string;
  prompt: string;
  onConfirm: (action: ConfirmAction, editedPrompt?: string) => void;
  isActive?: boolean;
}

export function StepConfirmation({
  stepNumber,
  totalSteps,
  agent,
  role,
  prompt,
  onConfirm,
  isActive = true
}: StepConfirmationProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(prompt);

  useInput((input, key) => {
    // Escape cancels edit mode
    if (isEditing && key.escape) {
      setIsEditing(false);
      setEditedPrompt(prompt); // Reset to original
      return;
    }

    if (isEditing) return; // Let TextInput handle input when editing

    const lower = input.toLowerCase();
    if (lower === 'y') {
      onConfirm('yes');
    } else if (lower === 'a') {
      onConfirm('yes_all');
    } else if (lower === 's') {
      onConfirm('skip');
    } else if (lower === 'e') {
      setIsEditing(true);
    } else if (lower === 'x' || key.escape) {
      onConfirm('abort');
    }
  }, { isActive });

  const handleEditSubmit = () => {
    setIsEditing(false);
    onConfirm('yes', editedPrompt);
  };

  // Truncate prompt for display (when not editing)
  const maxPromptLength = 60;
  const displayPrompt = prompt.length > maxPromptLength
    ? prompt.slice(0, maxPromptLength) + '...'
    : prompt;

  return (
    <Box flexDirection="column" marginY={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
      >
        {/* Header */}
        <Text>
          <Text color="cyan" bold>Step {stepNumber}/{totalSteps}</Text>
          <Text>: </Text>
          <Text color="green">{agent}</Text>
          <Text color="gray">:</Text>
          <Text color="yellow">{role}</Text>
        </Text>

        {/* Prompt preview or edit mode */}
        <Box marginTop={1}>
          {isEditing ? (
            <Box flexDirection="column">
              <Text color="magenta">Edit prompt (Enter to confirm, Esc to cancel):</Text>
              <Box marginTop={1}>
                <TextInput
                  value={editedPrompt}
                  onChange={setEditedPrompt}
                  onSubmit={handleEditSubmit}
                />
              </Box>
            </Box>
          ) : (
            <>
              <Text color="gray">Prompt: </Text>
              <Text>{displayPrompt}</Text>
            </>
          )}
        </Box>

        {/* Separator */}
        <Box marginY={1}>
          <Text color="gray">{'─'.repeat(50)}</Text>
        </Box>

        {/* Actions */}
        {!isEditing && (
          <Text>
            <Text color="green">[Y]</Text>
            <Text> Yes  </Text>
            <Text color="blue">[A]</Text>
            <Text> Yes All  </Text>
            <Text color="yellow">[S]</Text>
            <Text> Skip  </Text>
            <Text color="magenta">[E]</Text>
            <Text> Edit  </Text>
            <Text color="red">[X]</Text>
            <Text> Abort</Text>
          </Text>
        )}
      </Box>
    </Box>
  );
}
