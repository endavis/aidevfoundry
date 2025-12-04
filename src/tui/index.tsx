import React, { useState, useMemo, useEffect } from 'react';
import { render, Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { orchestrate } from '../orchestrator';
import { Banner, WelcomeMessage } from './components/Banner';
import { useHistory } from './hooks/useHistory';
import { getCommandSuggestions } from './components/Autocomplete';
import { StatusBar } from './components/StatusBar';
import {
  buildComparePlan,
  buildPipelinePlan,
  parseAgentsString,
  parsePipelineString,
  execute,
  type AgentName
} from '../executor';
import { listTemplates, loadTemplate } from '../executor/templates';
import { WorkflowsManager } from './components/WorkflowsManager';
import { generatePlan } from '../executor/planner';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agent?: string;
  duration?: number;
}

let messageId = 0;
const nextId = () => String(++messageId);

type AppMode = 'chat' | 'workflows';

function App() {
  // Disable mouse tracking to prevent scroll events from triggering input
  useEffect(() => {
    process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l');
    return () => {
      process.stdout.write('\x1b[?1000h');
    };
  }, []);

  const [input, setInput] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('thinking...');
  const [mode, setMode] = useState<AppMode>('chat');

  // Value options
  const [currentAgent, setCurrentAgent] = useState('auto');
  const [currentRouter, setCurrentRouter] = useState('ollama');

  // Toggle options
  const [sequential, setSequential] = useState(false);
  const [pick, setPick] = useState(false);
  const [executeMode, setExecuteMode] = useState(false);
  const [interactive, setInteractive] = useState(false);

  const { addToHistory, navigateHistory } = useHistory();

  // Handle workflow run from WorkflowsManager
  const handleWorkflowRun = async (workflowName: string, task: string) => {
    setMode('chat');
    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: '/workflow ' + workflowName + ' "' + task + '"' }]);
    setLoading(true);
    setLoadingText('running ' + workflowName + '...');

    try {
      const template = loadTemplate(workflowName);
      if (!template) throw new Error('Workflow not found');

      const plan = buildPipelinePlan(task, { steps: template.steps });
      const result = await execute(plan);

      let output = 'Workflow: ' + workflowName + '\n';
      for (const stepResult of result.results) {
        const step = plan.steps.find(s => s.id === stepResult.stepId);
        output += '\n── ' + (step?.agent || 'auto') + ': ' + step?.action + ' ──\n';
        output += (stepResult.content || stepResult.error || 'No output') + '\n';
      }
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: output, agent: workflowName }]);
    } catch (err) {
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: 'Error: ' + (err as Error).message }]);
    }

    setLoading(false);
  };

  // Memoize autocomplete items
  const autocompleteItems = useMemo(() => {
    if (!input.startsWith('/')) return [];
    return getCommandSuggestions(input).map(cmd => ({
      label: cmd.label + '  ' + cmd.description,
      value: cmd.value
    }));
  }, [input]);

  // Autocomplete selection index
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);

  // Reset index when input changes
  useEffect(() => {
    setAutocompleteIndex(0);
  }, [input]);

  // Handle autocomplete selection
  const handleAutocompleteSelect = (item: { value: string; label: string }) => {
    setInput(item.value);
    setInputKey(k => k + 1);
  };

  // Handle keyboard shortcuts
  useInput((char, key) => {
    // When autocomplete is showing, handle navigation
    if (autocompleteItems.length > 0) {
      if (key.upArrow) {
        setAutocompleteIndex(i => Math.max(0, i - 1));
        return;
      } else if (key.downArrow) {
        setAutocompleteIndex(i => Math.min(autocompleteItems.length - 1, i + 1));
        return;
      } else if (key.return) {
        handleAutocompleteSelect(autocompleteItems[autocompleteIndex]);
        return;
      } else if (key.escape) {
        setInput('');
        return;
      }
      return;
    }

    if (key.upArrow) {
      setInput(navigateHistory('up', input));
    } else if (key.downArrow) {
      setInput(navigateHistory('down', input));
    } else if (key.escape) {
      setInput('');
    }
  });

  const handleSubmit = async (value: string) => {
    if (!value.trim()) return;

    // Add to history
    addToHistory(value);

    // Handle slash commands
    if (value.startsWith('/')) {
      setInput('');
      await handleSlashCommand(value);
      return;
    }

    // Add user message
    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: value }]);
    setInput('');
    setLoading(true);
    setLoadingText('thinking...');

    try {
      const result = await orchestrate(value, { agent: currentAgent });
      setMessages(prev => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          content: result.content || result.error || 'No response',
          agent: result.model,
          duration: result.duration
        }
      ]);
    } catch (err) {
      setMessages(prev => [
        ...prev,
        { id: nextId(), role: 'assistant', content: 'Error: ' + (err as Error).message }
      ]);
    }

    setLoading(false);
  };

  const handleSlashCommand = async (cmd: string) => {
    // Parse command - handle quoted strings
    const match = cmd.slice(1).match(/^(\S+)\s*(.*)/);
    const command = match?.[1] || '';
    const rest = match?.[2] || '';

    const addMessage = (content: string, agent?: string) => {
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content, agent }]);
    };

    switch (command) {
      // === UTILITY ===
      case 'help':
        addMessage(`Commands:
  /compare <agents> <task>  - Compare agents side-by-side
  /autopilot <task>         - AI-generated execution plan
  /workflow <name> <task>   - Run a saved workflow
  /workflows                - Manage workflows (interactive)

Options:
  /agent [name]     - Show/set agent (claude, gemini, codex, ollama, auto)
  /router [name]    - Show/set routing agent
  /sequential       - Toggle: compare one-at-a-time
  /pick             - Toggle: select best from compare
  /execute          - Toggle: auto-run autopilot plans
  /interactive      - Toggle: pause between steps

Utility:
  /help   - Show this help
  /clear  - Clear chat history
  /exit   - Exit`);
        break;

      case 'clear':
        setMessages([]);
        break;

      case 'exit':
        process.exit(0);
        break;

      // === VALUE OPTIONS ===
      case 'agent':
        if (rest) {
          setCurrentAgent(rest);
          addMessage('Agent set to: ' + rest);
        } else {
          addMessage('Current agent: ' + currentAgent);
        }
        break;

      case 'router':
        if (rest) {
          setCurrentRouter(rest);
          addMessage('Router set to: ' + rest);
        } else {
          addMessage('Current router: ' + currentRouter);
        }
        break;

      // === TOGGLE OPTIONS ===
      case 'sequential':
        setSequential(s => !s);
        addMessage('Sequential mode: ' + (!sequential ? 'ON' : 'OFF'));
        break;

      case 'pick':
        setPick(p => !p);
        addMessage('Pick mode: ' + (!pick ? 'ON' : 'OFF'));
        break;

      case 'execute':
        setExecuteMode(e => !e);
        addMessage('Execute mode: ' + (!executeMode ? 'ON' : 'OFF'));
        break;

      case 'interactive':
        setInteractive(i => !i);
        addMessage('Interactive mode: ' + (!interactive ? 'ON' : 'OFF'));
        break;

      // === WORKFLOWS ===
      case 'workflows':
        setMode('workflows');
        break;

      // === COMMANDS ===
      case 'compare': {
        // Parse: /compare agents "task" or /compare agents task
        const compareMatch = rest.match(/^(\S+)\s+(?:"([^"]+)"|(.+))$/);
        if (!compareMatch) {
          addMessage('Usage: /compare <agents> <task>\nExample: /compare claude,gemini "explain async"');
          break;
        }
        const agentsStr = compareMatch[1];
        const task = compareMatch[2] || compareMatch[3];
        const agents = parseAgentsString(agentsStr);

        if (agents.length < 2) {
          addMessage('Compare needs at least 2 agents.\nExample: /compare claude,gemini "task"');
          break;
        }

        setMessages(prev => [...prev, { id: nextId(), role: 'user', content: '/compare ' + agentsStr + ' "' + task + '"' }]);
        setLoading(true);
        setLoadingText('comparing ' + agents.join(', ') + '...');

        try {
          const plan = buildComparePlan(task, {
            agents: agents as AgentName[],
            sequential,
            pick
          });

          const result = await execute(plan);

          // Format results
          let output = '';
          for (let i = 0; i < agents.length; i++) {
            const agent = agents[i];
            const stepResult = result.results.find(r => r.stepId === 'step_' + i);
            output += '── ' + agent + ' ──\n';
            output += (stepResult?.content || stepResult?.error || 'No response') + '\n\n';
          }

          if (pick && result.finalOutput) {
            output += '── Selected (best) ──\n' + result.finalOutput;
          }

          addMessage(output.trim(), 'compare');
        } catch (err) {
          addMessage('Error: ' + (err as Error).message);
        }

        setLoading(false);
        break;
      }

      case 'autopilot': {
        // Parse: /autopilot "task" or /autopilot task
        const taskMatch = rest.match(/^(?:"([^"]+)"|(.+))$/);
        if (!taskMatch) {
          addMessage('Usage: /autopilot <task>\nExample: /autopilot "build a REST API"');
          break;
        }
        const task = taskMatch[1] || taskMatch[2];

        setMessages(prev => [...prev, { id: nextId(), role: 'user', content: '/autopilot "' + task + '"' }]);
        setLoading(true);
        setLoadingText('generating plan...');

        try {
          const plan = await generatePlan(task);

          // Format plan display
          let planDisplay = 'Plan: ' + plan.name + '\n\n';
          plan.steps.forEach((step, i) => {
            planDisplay += (i + 1) + '. [' + (step.agent || 'auto') + '] ' + step.action + '\n';
            planDisplay += '   ' + step.prompt.slice(0, 80) + (step.prompt.length > 80 ? '...' : '') + '\n';
          });

          if (executeMode) {
            addMessage(planDisplay + '\nExecuting...', 'autopilot');
            setLoadingText('executing plan...');

            const result = await execute(plan);

            let output = '\nResults:\n';
            for (const stepResult of result.results) {
              const step = plan.steps.find(s => s.id === stepResult.stepId);
              output += '\n── ' + (step?.agent || 'auto') + ': ' + step?.action + ' ──\n';
              output += (stepResult.content || stepResult.error || 'No output') + '\n';
            }
            addMessage(output, 'autopilot');
          } else {
            addMessage(planDisplay + '\nUse /execute to enable auto-execution', 'autopilot');
          }
        } catch (err) {
          addMessage('Error: ' + (err as Error).message);
        }

        setLoading(false);
        break;
      }

      case 'workflow': {
        // Parse: /workflow name "task" or /workflow name task
        const wfMatch = rest.match(/^(\S+)\s+(?:"([^"]+)"|(.+))$/);
        if (!wfMatch) {
          addMessage('Usage: /workflow <name> <task>\nExample: /workflow code-review "my code here"');
          break;
        }
        const wfName = wfMatch[1];
        const task = wfMatch[2] || wfMatch[3];

        const template = loadTemplate(wfName);
        if (!template) {
          addMessage('Workflow not found: ' + wfName + '\nUse /workflows to see available workflows.');
          break;
        }

        setMessages(prev => [...prev, { id: nextId(), role: 'user', content: '/workflow ' + wfName + ' "' + task + '"' }]);
        setLoading(true);
        setLoadingText('running ' + wfName + '...');

        try {
          const plan = buildPipelinePlan(task, { steps: template.steps });
          const result = await execute(plan);

          let output = 'Workflow: ' + wfName + '\n';
          for (const stepResult of result.results) {
            const step = plan.steps.find(s => s.id === stepResult.stepId);
            output += '\n── ' + (step?.agent || 'auto') + ': ' + step?.action + ' ──\n';
            output += (stepResult.content || stepResult.error || 'No output') + '\n';
          }
          addMessage(output, wfName);
        } catch (err) {
          addMessage('Error: ' + (err as Error).message);
        }

        setLoading(false);
        break;
      }

      default:
        addMessage('Unknown command: /' + command + '\nType /help for available commands.');
    }
  };

  const isFirstMessage = messages.length === 0;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Banner */}
      <Banner />
      {mode === 'chat' && (
        isFirstMessage ? (
          <WelcomeMessage />
        ) : (
          <Box marginBottom={1}>
            <Text dimColor>agent: </Text>
            <Text color="yellow">{currentAgent}</Text>
          </Box>
        )
      )}

      {/* Workflows Mode */}
      {mode === 'workflows' && (
        <WorkflowsManager
          onBack={() => setMode('chat')}
          onRun={handleWorkflowRun}
        />
      )}

      {/* Chat Mode */}
      {mode === 'chat' && (
        <>
          {/* Messages */}
          <Box flexDirection="column" marginBottom={1}>
            {messages.map((msg) => (
              <Box key={msg.id} marginBottom={1}>
                {msg.role === 'user' ? (
                  <Text>
                    <Text color="green" bold>{'> '}</Text>
                    <Text>{msg.content}</Text>
                  </Text>
                ) : (
                  <Box flexDirection="column">
                    {msg.agent && (
                      <Text dimColor>── {msg.agent} {msg.duration ? '(' + (msg.duration / 1000).toFixed(1) + 's)' : ''} ──</Text>
                    )}
                    <Text>{msg.content}</Text>
                  </Box>
                )}
              </Box>
            ))}
          </Box>

          {/* Loading */}
          {loading && (
            <Box marginBottom={1}>
              <Text color="yellow">● {loadingText}</Text>
            </Box>
          )}

          {/* Input */}
          <Box borderStyle="round" borderColor="gray" paddingX={1}>
            <Text color="green" bold>{'> '}</Text>
            <TextInput
              key={inputKey}
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              placeholder="Type a message or /help"
            />
          </Box>

          {/* Autocomplete suggestions - aligned with input text (border + padding + "> ") */}
          {autocompleteItems.length > 0 && !loading && (
            <Box flexDirection="column" marginTop={1} marginLeft={4}>
              {autocompleteItems.map((item, i) => {
                const isSelected = i === autocompleteIndex;
                const parts = item.label.split('  ');
                const cmd = parts[0];
                const desc = parts.slice(1).join('  ');
                return (
                  <Box key={item.value}>
                    <Text bold={isSelected} color={isSelected ? '#a78bfa' : undefined} dimColor={!isSelected}>{cmd}</Text>
                    <Text color={isSelected ? '#a78bfa' : undefined} dimColor={!isSelected}> - {desc}</Text>
                  </Box>
                );
              })}
              <Box marginTop={1}>
                <Text dimColor>↑↓ navigate · Enter select · Esc cancel</Text>
              </Box>
            </Box>
          )}
        </>
      )}

      {/* Status Bar */}
      <StatusBar agent={currentAgent} messageCount={messages.length} />
    </Box>
  );
}

export function startTUI() {
  render(<App />);
}
