import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput, { ItemProps } from 'ink-select-input';
import TextInput from 'ink-text-input';
import {
  listTemplates,
  loadTemplate,
  createTemplate,
  saveTemplate,
  deleteTemplate
} from '../../executor/templates';
import { parsePipelineString } from '../../executor';

const HIGHLIGHT_COLOR = '#a78bfa';

// Custom item component with purple highlight
function CustomItem({ isSelected, label }: ItemProps) {
  return (
    <Text color={isSelected ? HIGHLIGHT_COLOR : undefined} bold={isSelected}>
      {label}
    </Text>
  );
}

// Custom indicator
function CustomIndicator({ isSelected }: { isSelected: boolean }) {
  return (
    <Box marginRight={1}>
      <Text color={HIGHLIGHT_COLOR}>{isSelected ? '❯' : ' '}</Text>
    </Box>
  );
}

type View = 'list' | 'workflow' | 'create' | 'edit' | 'run' | 'confirm-delete';

interface WorkflowsManagerProps {
  onBack: () => void;
  onRun: (workflowName: string, task: string) => void;
}

export function WorkflowsManager({ onBack, onRun }: WorkflowsManagerProps) {
  const [view, setView] = useState<View>('list');
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [createStep, setCreateStep] = useState<'name' | 'pipeline' | 'description'>('name');
  const [newWorkflow, setNewWorkflow] = useState({ name: '', pipeline: '', description: '' });
  const [error, setError] = useState<string | null>(null);

  // Handle Esc to go back
  useInput((input, key) => {
    if (key.escape) {
      if (view === 'list') {
        onBack();
      } else {
        setView('list');
        setSelectedWorkflow(null);
        setError(null);
      }
    }
  });

  // Get workflows list
  const workflows = listTemplates();

  // Build items for the main list
  const listItems = [
    ...workflows.map(name => {
      const t = loadTemplate(name);
      const isBuiltIn = t?.createdAt === 0;
      return {
        label: name,
        value: name,
        isBuiltIn
      };
    }),
    { label: '+ Create new workflow', value: '__create__', isBuiltIn: false },
    { label: '← Back', value: '__back__', isBuiltIn: false }
  ];

  // Handle selection from main list
  const handleListSelect = (item: { value: string }) => {
    if (item.value === '__back__') {
      onBack();
    } else if (item.value === '__create__') {
      setView('create');
      setCreateStep('name');
      setNewWorkflow({ name: '', pipeline: '', description: '' });
      setInputValue('');
    } else {
      setSelectedWorkflow(item.value);
      setView('workflow');
    }
  };

  // Workflow action items
  const workflowActions = [
    { label: '▶ Run', value: 'run' },
    { label: '✎ Edit', value: 'edit' },
    { label: '✕ Delete', value: 'delete' },
    { label: '← Back', value: 'back' }
  ];

  // Handle workflow action
  const handleWorkflowAction = (item: { value: string }) => {
    const template = selectedWorkflow ? loadTemplate(selectedWorkflow) : null;
    const isBuiltIn = template?.createdAt === 0;

    switch (item.value) {
      case 'run':
        setView('run');
        setInputValue('');
        break;
      case 'edit':
        if (isBuiltIn) {
          setError('Cannot edit built-in workflow. Create a copy instead.');
        } else {
          setView('edit');
          setInputValue(template?.steps.map(s => s.agent + ':' + s.action).join(',') || '');
        }
        break;
      case 'delete':
        if (isBuiltIn) {
          setError('Cannot delete built-in workflow.');
        } else {
          setView('confirm-delete');
        }
        break;
      case 'back':
        setView('list');
        setSelectedWorkflow(null);
        setError(null);
        break;
    }
  };

  // Handle run submit
  const handleRunSubmit = (task: string) => {
    if (task.trim() && selectedWorkflow) {
      onRun(selectedWorkflow, task.trim());
    }
  };

  // Handle create workflow steps
  const handleCreateSubmit = (value: string) => {
    if (createStep === 'name') {
      if (!value.trim()) {
        setError('Name cannot be empty');
        return;
      }
      if (workflows.includes(value.trim())) {
        setError('Workflow already exists');
        return;
      }
      setNewWorkflow(prev => ({ ...prev, name: value.trim() }));
      setCreateStep('pipeline');
      setInputValue('');
      setError(null);
    } else if (createStep === 'pipeline') {
      if (!value.trim()) {
        setError('Pipeline cannot be empty');
        return;
      }
      try {
        parsePipelineString(value.trim()); // Validate
        setNewWorkflow(prev => ({ ...prev, pipeline: value.trim() }));
        setCreateStep('description');
        setInputValue('');
        setError(null);
      } catch {
        setError('Invalid pipeline format. Use: agent:action,agent:action');
      }
    } else if (createStep === 'description') {
      const opts = parsePipelineString(newWorkflow.pipeline);
      const template = createTemplate(newWorkflow.name, opts.steps, value.trim() || undefined);
      saveTemplate(template);
      setView('list');
      setError(null);
    }
  };

  // Handle edit submit
  const handleEditSubmit = (value: string) => {
    if (!value.trim() || !selectedWorkflow) return;
    try {
      const existing = loadTemplate(selectedWorkflow);
      if (!existing) return;

      const opts = parsePipelineString(value.trim());
      const updated = {
        ...existing,
        steps: opts.steps,
        updatedAt: Date.now()
      };
      saveTemplate(updated);
      setView('workflow');
      setError(null);
    } catch {
      setError('Invalid pipeline format');
    }
  };

  // Handle delete confirm
  const handleDeleteConfirm = (item: { value: string }) => {
    if (item.value === 'yes' && selectedWorkflow) {
      deleteTemplate(selectedWorkflow);
      setView('list');
      setSelectedWorkflow(null);
    } else {
      setView('workflow');
    }
  };

  // Render based on current view
  const renderView = () => {
    switch (view) {
      case 'list':
        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold>Manage Workflows</Text>
            </Box>
            <SelectInput
              items={listItems.map(item => ({
                label: item.isBuiltIn
                  ? item.label + '  (built-in)'
                  : item.label,
                value: item.value
              }))}
              onSelect={handleListSelect}
              itemComponent={CustomItem}
              indicatorComponent={CustomIndicator}
            />
            <Box marginTop={1}>
              <Text dimColor>↑↓ navigate · Enter select · Esc back</Text>
            </Box>
          </Box>
        );

      case 'workflow': {
        const template = selectedWorkflow ? loadTemplate(selectedWorkflow) : null;
        const steps = template?.steps.map((s, i) => (i + 1) + '. ' + s.agent + ':' + s.action).join('\n') || '';
        return (
          <Box flexDirection="column">
            <Box marginBottom={1} flexDirection="column">
              <Text bold color="cyan">{selectedWorkflow}</Text>
              {template?.description && <Text dimColor>{template.description}</Text>}
            </Box>
            <Box marginBottom={1} flexDirection="column">
              <Text dimColor>Steps:</Text>
              <Text>{steps}</Text>
            </Box>
            {error && (
              <Box marginBottom={1}>
                <Text color="red">{error}</Text>
              </Box>
            )}
            <SelectInput
              items={workflowActions}
              onSelect={handleWorkflowAction}
              itemComponent={CustomItem}
              indicatorComponent={CustomIndicator}
            />
          </Box>
        );
      }

      case 'run':
        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold>Run: </Text>
              <Text color="cyan">{selectedWorkflow}</Text>
            </Box>
            <Box>
              <Text>Task: </Text>
              <TextInput
                value={inputValue}
                onChange={setInputValue}
                onSubmit={handleRunSubmit}
                placeholder="Enter task to run..."
              />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Enter to run · Esc to cancel</Text>
            </Box>
          </Box>
        );

      case 'create':
        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold>Create New Workflow</Text>
            </Box>
            {error && (
              <Box marginBottom={1}>
                <Text color="red">{error}</Text>
              </Box>
            )}
            {createStep === 'name' && (
              <Box>
                <Text>Name: </Text>
                <TextInput
                  value={inputValue}
                  onChange={setInputValue}
                  onSubmit={handleCreateSubmit}
                  placeholder="my-workflow"
                />
              </Box>
            )}
            {createStep === 'pipeline' && (
              <Box flexDirection="column">
                <Box marginBottom={1}>
                  <Text dimColor>Name: {newWorkflow.name}</Text>
                </Box>
                <Box>
                  <Text>Pipeline: </Text>
                  <TextInput
                    value={inputValue}
                    onChange={setInputValue}
                    onSubmit={handleCreateSubmit}
                    placeholder="claude:plan,codex:code"
                  />
                </Box>
              </Box>
            )}
            {createStep === 'description' && (
              <Box flexDirection="column">
                <Box marginBottom={1}>
                  <Text dimColor>Name: {newWorkflow.name}</Text>
                </Box>
                <Box marginBottom={1}>
                  <Text dimColor>Pipeline: {newWorkflow.pipeline}</Text>
                </Box>
                <Box>
                  <Text>Description (optional): </Text>
                  <TextInput
                    value={inputValue}
                    onChange={setInputValue}
                    onSubmit={handleCreateSubmit}
                    placeholder="What does this workflow do?"
                  />
                </Box>
              </Box>
            )}
            <Box marginTop={1}>
              <Text dimColor>Enter to continue · Esc to cancel</Text>
            </Box>
          </Box>
        );

      case 'edit':
        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold>Edit: </Text>
              <Text color="cyan">{selectedWorkflow}</Text>
            </Box>
            {error && (
              <Box marginBottom={1}>
                <Text color="red">{error}</Text>
              </Box>
            )}
            <Box>
              <Text>Pipeline: </Text>
              <TextInput
                value={inputValue}
                onChange={setInputValue}
                onSubmit={handleEditSubmit}
                placeholder="claude:plan,codex:code"
              />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Enter to save · Esc to cancel</Text>
            </Box>
          </Box>
        );

      case 'confirm-delete':
        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold color="red">Delete workflow: </Text>
              <Text>{selectedWorkflow}</Text>
            </Box>
            <Text>Are you sure?</Text>
            <SelectInput
              items={[
                { label: 'Yes, delete', value: 'yes' },
                { label: 'No, cancel', value: 'no' }
              ]}
              onSelect={handleDeleteConfirm}
              itemComponent={CustomItem}
              indicatorComponent={CustomIndicator}
            />
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
