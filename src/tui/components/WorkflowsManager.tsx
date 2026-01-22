import { useState } from 'react';
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

const HIGHLIGHT_COLOR = '#8CA9FF';

// Custom item component with blue highlight
function CustomItem({ isSelected, label }: ItemProps) {
  return (
    <Text color={isSelected ? HIGHLIGHT_COLOR : undefined} bold={isSelected}>
      {label}
    </Text>
  );
}

// Custom indicator
function CustomIndicator({ isSelected }: { isSelected?: boolean }) {
  return (
    <Box marginRight={1}>
      <Text color={HIGHLIGHT_COLOR}>{isSelected ? '❯' : ' '}</Text>
    </Box>
  );
}

type View = 'menu' | 'list' | 'workflow' | 'create' | 'edit' | 'run' | 'confirm-delete';

interface WorkflowsManagerProps {
  onBack: () => void;
  onRun: (workflowName: string, task: string) => void;
}

export function WorkflowsManager({ onBack, onRun }: WorkflowsManagerProps) {
  const [view, setView] = useState<View>('menu');
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [createStep, setCreateStep] = useState<'name' | 'pipeline' | 'description'>('name');
  const [newWorkflow, setNewWorkflow] = useState({ name: '', pipeline: '', description: '' });
  const [error, setError] = useState<string | null>(null);

  // Edit mode state
  const [editSteps, setEditSteps] = useState<Array<{ agent: string; action: string }>>([]);
  const [originalPipeline, setOriginalPipeline] = useState('');
  const [editPhase, setEditPhase] = useState<'menu' | 'agent' | 'role'>('menu');
  const [editAgent, setEditAgent] = useState('');
  const [editActionIndex, setEditActionIndex] = useState(0);

  // Edit menu actions
  const editActions = [
    { label: 'Add step', value: 'add', hint: 'Enter to add agent:role' },
    { label: 'Clear all', value: 'clear', hint: 'Remove all steps' },
    { label: 'Remove last', value: 'remove-last', hint: '' }
  ];

  // Handle edit keyboard (menu navigation)
  useInput((_, key) => {
    if (view !== 'edit' || editPhase !== 'menu') return;

    if (key.upArrow) {
      setEditActionIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setEditActionIndex(i => Math.min(editActions.length - 1, i + 1));
    } else if (key.return) {
      const action = editActions[editActionIndex];
      if (action.value === 'add') {
        setEditPhase('agent');
        setInputValue('');
        setError(null);
      } else if (action.value === 'clear') {
        if (editSteps.length === 0) {
          setError('New pipeline is empty. Add steps first.');
        } else {
          setEditSteps([]);
          setError(null);
        }
      } else if (action.value === 'remove-last') {
        if (editSteps.length === 0) {
          setError('New pipeline is empty. Add steps first.');
        } else {
          setEditSteps(prev => prev.slice(0, -1));
          setError(null);
        }
      }
    }
  }, { isActive: view === 'edit' && editPhase === 'menu' });

  // Handle Esc to go back
  useInput((_, key) => {
    if (key.escape) {
      if (view === 'menu') {
        onBack();
      } else if (view === 'list') {
        setView('menu');
      } else if (view === 'edit') {
        if (editPhase === 'menu') {
          // Save and go back to workflow
          handleEditSave();
        } else {
          // Go back to menu
          setEditPhase('menu');
          setEditAgent('');
          setInputValue('');
        }
      } else {
        setView('list');
        setSelectedWorkflow(null);
        setError(null);
      }
    }
  });

  // Get workflows list
  const workflows = listTemplates();

  // Menu items
  const menuItems = [
    { label: 'Workflows List', value: 'list', hint: 'Enter to view' },
    { label: 'Create new workflow', value: 'create', hint: 'Enter to create' }
  ];

  // Track menu selection index
  const [menuIndex, setMenuIndex] = useState(0);

  // Handle menu keyboard
  useInput((_, key) => {
    if (view !== 'menu') return;
    if (key.upArrow) {
      setMenuIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setMenuIndex(i => Math.min(menuItems.length - 1, i + 1));
    } else if (key.return) {
      const item = menuItems[menuIndex];
      if (item.value === 'create') {
        setView('create');
        setCreateStep('name');
        setNewWorkflow({ name: '', pipeline: '', description: '' });
        setInputValue('');
      } else if (item.value === 'list') {
        setView('list');
      }
    }
  }, { isActive: view === 'menu' });

  // Build items for the workflows list - built-in first, then custom
  const listItems = workflows.map(name => {
    const t = loadTemplate(name);
    const isBuiltIn = t?.createdAt === 0;
    return {
      label: name,
      value: name,
      isBuiltIn
    };
  }).sort((a, b) => {
    if (a.isBuiltIn && !b.isBuiltIn) return -1;
    if (!a.isBuiltIn && b.isBuiltIn) return 1;
    return a.label.localeCompare(b.label);
  });

  // Track list selection index
  const [listIndex, setListIndex] = useState(0);

  // Handle list keyboard
  useInput((_, key) => {
    if (view !== 'list') return;
    if (key.upArrow) {
      setListIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setListIndex(i => Math.min(listItems.length - 1, i + 1));
    } else if (key.return) {
      const item = listItems[listIndex];
      if (item) {
        setSelectedWorkflow(item.value);
        setView('workflow');
      }
    }
  }, { isActive: view === 'list' });

  // Workflow action items
  const workflowActions = [
    { label: 'Edit', value: 'edit', hint: 'Enter to modify' },
    { label: 'Delete', value: 'delete', hint: 'Enter to remove' }
  ];

  // Track workflow action index
  const [actionIndex, setActionIndex] = useState(0);

  // Handle workflow keyboard
  useInput((_, key) => {
    if (view !== 'workflow') return;
    if (key.upArrow) {
      setActionIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setActionIndex(i => Math.min(workflowActions.length - 1, i + 1));
    } else if (key.return) {
      const item = workflowActions[actionIndex];
      if (item) {
        handleWorkflowAction({ value: item.value });
      }
    }
  }, { isActive: view === 'workflow' });

  // Handle workflow action
  const handleWorkflowAction = (item: { value: string }) => {
    const template = selectedWorkflow ? loadTemplate(selectedWorkflow) : null;
    const isBuiltIn = template?.createdAt === 0;

    switch (item.value) {
      case 'edit':
        if (isBuiltIn) {
          setError('Cannot edit built-in workflow. Create a copy instead.');
        } else {
          setView('edit');
          const steps = template?.steps || [];
          setOriginalPipeline(steps.map(s => s.agent + ':' + s.action).join(','));
          // Initialize editSteps with current steps (copy them)
          setEditSteps(steps.map(s => ({ agent: s.agent, action: s.action })));
          setEditPhase('menu');
          setEditAgent('');
          setInputValue('');
          setEditActionIndex(0);
        }
        break;
      case 'delete':
        if (isBuiltIn) {
          setError('Cannot delete built-in workflow.');
        } else {
          setView('confirm-delete');
        }
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

  // Handle edit submit - agent then role, then back to menu
  const handleEditSubmit = (value: string) => {
    if (!value.trim()) return;

    if (editPhase === 'agent') {
      setEditAgent(value.trim());
      setEditPhase('role');
      setInputValue('');
    } else if (editPhase === 'role') {
      // Add the step and go back to menu
      setEditSteps(prev => [...prev, { agent: editAgent, action: value.trim() }]);
      setEditPhase('menu');
      setEditAgent('');
      setInputValue('');
    }
  };

  // Save edit and go back
  const handleEditSave = () => {
    if (!selectedWorkflow) return;
    const existing = loadTemplate(selectedWorkflow);
    if (!existing) return;

    if (editSteps.length === 0) {
      setError('Cannot save workflow with no steps. Add at least one step.');
      return;
    }

    const pipelineStr = editSteps.map(s => `${s.agent}:${s.action}`).join(',');
    let parsed;
    try {
      parsed = parsePipelineString(pipelineStr);
    } catch {
      setError('Invalid pipeline steps. Use format: agent:role');
      return;
    }

    const updated = {
      ...existing,
      steps: parsed.steps,
      updatedAt: Date.now()
    };
    saveTemplate(updated);
    setView('workflow');
    setError(null);
  };

  // Handle delete confirm
  const handleDeleteConfirm = (item: { value: string }) => {
    if (item.value === 'yes' && selectedWorkflow) {
      deleteTemplate(selectedWorkflow);
      setView('list');
      setSelectedWorkflow(null);
      setListIndex(0); // Reset to first item after deletion
    } else {
      setView('workflow');
    }
  };

  // Render based on current view
  const renderView = () => {
    switch (view) {
      case 'menu':
        return (
          <Box flexDirection="column">
            <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
              <Text bold>Manage Workflows</Text>
              <Text> </Text>
              {menuItems.map((item, idx) => {
                const isSelected = idx === menuIndex;
                return (
                  <Box key={item.value}>
                    <Text color={HIGHLIGHT_COLOR}>{isSelected ? '❯' : ' '} </Text>
                    <Text color={isSelected ? HIGHLIGHT_COLOR : undefined} bold={isSelected}>
                      {idx + 1}. {item.label}
                    </Text>
                    <Text dimColor>  {item.hint}</Text>
                  </Box>
                );
              })}
            </Box>
          </Box>
        );

      case 'list':
        return (
          <Box flexDirection="column">
            <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
              <Text bold>Workflows List</Text>
              <Text> </Text>
              {listItems.map((item, idx) => {
                const isSelected = idx === listIndex;
                return (
                  <Box key={item.value}>
                    <Text color={HIGHLIGHT_COLOR}>{isSelected ? '❯' : ' '} </Text>
                    <Text color={isSelected ? HIGHLIGHT_COLOR : undefined} bold={isSelected}>
                      {idx + 1}. {item.label}
                    </Text>
                    <Text dimColor>  {item.isBuiltIn ? '(built-in)' : '(custom)'}</Text>
                    <Text dimColor>  Enter to view</Text>
                  </Box>
                );
              })}
            </Box>
          </Box>
        );

      case 'workflow': {
        const template = selectedWorkflow ? loadTemplate(selectedWorkflow) : null;
        return (
          <Box flexDirection="column">
            <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
              <Text bold>{selectedWorkflow}</Text>
              {template?.description && <Text dimColor>{template.description}</Text>}
              <Text> </Text>
              <Text dimColor>Steps:</Text>
              <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1}>
                {template?.steps && template.steps.length > 0 ? (
                  template.steps.map((s, i) => (
                    <Text key={i}>{i + 1}. {s.action} ({s.agent})</Text>
                  ))
                ) : (
                  <Text color="yellow">⚠ No steps defined - edit to add steps</Text>
                )}
              </Box>
              <Text> </Text>
              {error && (
                <Box>
                  <Text color="red">{error}</Text>
                </Box>
              )}
              {workflowActions.map((action, idx) => {
                const isSelected = idx === actionIndex;
                return (
                  <Box key={action.value}>
                    <Text color={HIGHLIGHT_COLOR}>{isSelected ? '❯' : ' '} </Text>
                    <Text color={isSelected ? HIGHLIGHT_COLOR : undefined} bold={isSelected}>
                      {action.label}
                    </Text>
                    <Text dimColor>  {action.hint}</Text>
                  </Box>
                );
              })}
            </Box>
          </Box>
        );
      }

      case 'run':
        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold>Run: </Text>
              <Text>{selectedWorkflow}</Text>
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

      case 'create': {
        return (
          <Box flexDirection="column">
            <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
              <Text bold>Create New Workflow</Text>
              <Text> </Text>
              {/* Step 1: Name */}
              <Box>
                <Text color={createStep === 'name' ? HIGHLIGHT_COLOR : undefined}>{createStep === 'name' ? '❯' : ' '} </Text>
                <Text color={createStep === 'name' ? HIGHLIGHT_COLOR : undefined} bold={createStep === 'name'}>1. Name</Text>
                {newWorkflow.name ? (
                  <Text color="green">  ✓ {newWorkflow.name}</Text>
                ) : createStep === 'name' ? (
                  <Text dimColor>  </Text>
                ) : (
                  <Text dimColor>  pending</Text>
                )}
              </Box>
              {/* Step 2: Pipeline */}
              <Box>
                <Text color={createStep === 'pipeline' ? HIGHLIGHT_COLOR : undefined}>{createStep === 'pipeline' ? '❯' : ' '} </Text>
                <Text color={createStep === 'pipeline' ? HIGHLIGHT_COLOR : undefined} bold={createStep === 'pipeline'}>2. Pipeline</Text>
                {newWorkflow.pipeline ? (
                  <Text color="green">  ✓ {newWorkflow.pipeline}</Text>
                ) : createStep === 'pipeline' ? (
                  <Text dimColor>  </Text>
                ) : (
                  <Text dimColor>  pending</Text>
                )}
              </Box>
              {/* Step 3: Description */}
              <Box>
                <Text color={createStep === 'description' ? HIGHLIGHT_COLOR : undefined}>{createStep === 'description' ? '❯' : ' '} </Text>
                <Text color={createStep === 'description' ? HIGHLIGHT_COLOR : undefined} bold={createStep === 'description'}>3. Description</Text>
                <Text dimColor>  (optional)</Text>
              </Box>
              <Text> </Text>
              {error && (
                <Box>
                  <Text color="red">{error}</Text>
                </Box>
              )}
              <Box>
                {createStep === 'name' && (
                  <>
                    <Text>Name: </Text>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleCreateSubmit}
                      placeholder="my-workflow"
                    />
                  </>
                )}
                {createStep === 'pipeline' && (
                  <>
                    <Text>Pipeline: </Text>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleCreateSubmit}
                      placeholder="claude:plan,codex:code"
                    />
                  </>
                )}
                {createStep === 'description' && (
                  <>
                    <Text>Description: </Text>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleCreateSubmit}
                      placeholder="What does this workflow do?"
                    />
                  </>
                )}
              </Box>
              <Text> </Text>
              <Text dimColor>
                {createStep === 'description' ? 'Enter to save · Esc to cancel' : 'Enter to continue · Esc to cancel'}
              </Text>
            </Box>
          </Box>
        );
      }

      case 'edit': {
        const newPipelineStr = editSteps.map(s => s.agent + ':' + s.action).join(',');
        const lastStep = editSteps.length > 0 ? editSteps[editSteps.length - 1] : null;
        return (
          <Box flexDirection="column">
            <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
              <Box>
                <Text bold>Edit: </Text>
                <Text>{selectedWorkflow}</Text>
              </Box>
              <Text> </Text>
              <Box>
                <Text dimColor>Current: </Text>
                <Text dimColor>{originalPipeline || '(empty)'}</Text>
              </Box>
              <Box>
                <Text>New:     </Text>
                <Text color="green">{newPipelineStr || '(empty)'}</Text>
              </Box>
              <Text> </Text>
              {editPhase === 'menu' && (
                <>
                  {editActions.map((action, idx) => {
                    const isSelected = idx === editActionIndex;
                    const hint = action.value === 'remove-last' && lastStep
                      ? `Remove ${lastStep.agent}:${lastStep.action}`
                      : action.hint;
                    const isDisabled = action.value === 'remove-last' && editSteps.length === 0;
                    return (
                      <Box key={action.value}>
                        <Text color={HIGHLIGHT_COLOR}>{isSelected ? '❯' : ' '} </Text>
                        <Text
                          color={isSelected ? HIGHLIGHT_COLOR : undefined}
                          bold={isSelected}
                          dimColor={isDisabled}
                        >
                          {action.label}
                        </Text>
                        <Text dimColor>  {hint}</Text>
                      </Box>
                    );
                  })}
                  <Text> </Text>
                  {error && (
                    <>
                      <Text color="red">{error}</Text>
                      <Text> </Text>
                    </>
                  )}
                  <Text dimColor>↑↓ navigate · Enter select · Esc to save & exit</Text>
                </>
              )}
              {editPhase === 'agent' && (
                <>
                  <Text dimColor>Add step:</Text>
                  <Box>
                    <Text>  Agent: </Text>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleEditSubmit}
                      placeholder="claude, gemini, codex..."
                    />
                  </Box>
                  <Text> </Text>
                  <Text dimColor>Enter to set role · Esc to cancel</Text>
                </>
              )}
              {editPhase === 'role' && (
                <>
                  <Text dimColor>Add step:</Text>
                  <Box>
                    <Text>  Agent: </Text>
                    <Text color="green">✓ {editAgent}</Text>
                  </Box>
                  <Box>
                    <Text>  Role: </Text>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleEditSubmit}
                      placeholder="code, review, plan..."
                    />
                  </Box>
                  <Text> </Text>
                  <Text dimColor>Enter to add step · Esc to cancel</Text>
                </>
              )}
            </Box>
          </Box>
        );
      }

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
