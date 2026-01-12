import * as readline from 'readline';
import { spawn } from 'child_process';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import pc from 'picocolors';
import { orchestrate } from '../../orchestrator';
import { discoverAgents, getAgent, formatAgentList } from '../../lib/agent-discovery';
import { getConfig } from '../../lib/config';
import {
  interactiveStream,
  runUnified,
  extractUnified,
  runAutonomous,
  getDefaultModel,
  getFastModel,
  getBestModel,
  type UnifiedCLIOptions,
} from '../../lib/unified-cli';
import type { AgentName } from '../../executor/types';

interface AgentCommandOptions {
  agent?: string;
  model?: string;
  stream?: boolean;
}

/**
 * Interactive Agent Mode
 *
 * Provides a unified CLI experience that wraps multiple backends
 * (Claude, Gemini, etc.) with consistent streaming and commands.
 *
 * Uses unified-cli.ts for consistent I/O patterns across all backends.
 */
export async function agentCommand(options: AgentCommandOptions): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });

  // Session state
  let currentAgent: AgentName = (options.agent as AgentName) || 'claude';
  let currentModel = options.model || getDefaultModel(currentAgent);
  let streamMode = options.stream ?? true;
  let sessionId: string | undefined;
  let appendPrompt: string | undefined;
  let totalCost = 0;
  let totalTokens = { input: 0, output: 0 };

  // Display header
  console.log(pc.bold('\n' + pc.cyan('╔══════════════════════════════════════╗')));
  console.log(pc.bold(pc.cyan('║')) + '     PuzldAI Interactive Agent       ' + pc.bold(pc.cyan('║')));
  console.log(pc.bold(pc.cyan('╚══════════════════════════════════════╝')));
  console.log('');
  console.log(pc.dim(`Agent: ${currentAgent} | Model: ${currentModel} | Stream: ${streamMode ? 'on' : 'off'}`));
  console.log(pc.dim('Type /help for commands, exit to quit\n'));

  const prompt = () => {
    rl.question(pc.cyan('> '), async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed === 'exit' || trimmed === 'quit') {
        console.log(pc.dim('Goodbye!'));
        rl.close();
        process.exit(0);
      }

      // Handle special commands
      if (trimmed.startsWith('/')) {
        const parts = trimmed.slice(1).split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const cmdArgs = parts.slice(1);

        if (cmd === 'help') {
          console.log(pc.cyan('\n=== Commands ===\n'));
          console.log(pc.bold('Agent & Model:'));
          console.log(pc.dim('  /agent [name]      - Show or switch agent (claude, gemini)'));
          console.log(pc.dim('  /model [name]      - Show or switch model (haiku, sonnet, opus, flash, pro)'));
          console.log(pc.dim('  /fast              - Switch to fast model (haiku/flash)'));
          console.log(pc.dim('  /best              - Switch to best model (opus/pro)'));
          console.log(pc.dim('  /stream [on|off]   - Toggle streaming mode'));
          console.log('');
          console.log(pc.bold('Session:'));
          console.log(pc.dim('  /new               - Start fresh session (clear context)'));
          console.log(pc.dim('  /persona <style>   - Set persona (borris, dax, brief, teacher)'));
          console.log(pc.dim('  /status            - Show session stats (tokens, cost)'));
          console.log('');
          console.log(pc.bold('Agents & Tasks:'));
          console.log(pc.dim('  /agents            - List custom agents (.claude/agents/)'));
          console.log(pc.dim('  /spawn <name>      - Spawn custom agent(s)'));
          console.log(pc.dim('  /continue-plan     - Execute temp-plan.txt'));
          console.log(pc.dim('  /auto <task>       - Run task autonomously (full tool access)'));
          console.log(pc.dim('  /extract <schema>  - Extract structured data'));
          console.log('');
          console.log(pc.bold('Other:'));
          console.log(pc.dim('  exit, quit         - Exit interactive mode'));
          console.log('');
          prompt();
          return;
        }

        // /agent - show or switch
        if (cmd === 'agent') {
          if (cmdArgs.length === 0) {
            console.log(pc.dim(`Current agent: ${currentAgent}`));
            console.log(pc.dim('Available: claude, gemini\n'));
          } else {
            const newAgent = cmdArgs[0].toLowerCase() as AgentName;
            if (['claude', 'gemini'].includes(newAgent)) {
              currentAgent = newAgent;
              currentModel = getDefaultModel(newAgent);
              console.log(pc.green(`Switched to ${newAgent} (model: ${currentModel})\n`));
            } else {
              console.log(pc.yellow(`Unknown agent: ${newAgent}. Available: claude, gemini\n`));
            }
          }
          prompt();
          return;
        }

        // /model - show or switch
        if (cmd === 'model') {
          if (cmdArgs.length === 0) {
            console.log(pc.dim(`Current model: ${currentModel}`));
            if (currentAgent === 'claude') {
              console.log(pc.dim('Available: haiku (fast), sonnet (balanced), opus (best)\n'));
            } else {
              console.log(pc.dim('Available: gemini-2.0-flash (fast), gemini-2.0-pro (best)\n'));
            }
          } else {
            currentModel = cmdArgs[0];
            console.log(pc.green(`Switched to model: ${currentModel}\n`));
          }
          prompt();
          return;
        }

        // /fast - switch to fast model
        if (cmd === 'fast') {
          currentModel = getFastModel(currentAgent);
          console.log(pc.green(`Switched to fast model: ${currentModel}\n`));
          prompt();
          return;
        }

        // /best - switch to best model
        if (cmd === 'best') {
          currentModel = getBestModel(currentAgent);
          console.log(pc.green(`Switched to best model: ${currentModel}\n`));
          prompt();
          return;
        }

        // /stream - toggle streaming
        if (cmd === 'stream') {
          if (cmdArgs.length === 0) {
            streamMode = !streamMode;
          } else {
            streamMode = cmdArgs[0].toLowerCase() === 'on';
          }
          console.log(pc.dim(`Streaming: ${streamMode ? 'on' : 'off'}\n`));
          prompt();
          return;
        }

        // /new - fresh session
        if (cmd === 'new') {
          sessionId = undefined;
          appendPrompt = undefined;
          totalCost = 0;
          totalTokens = { input: 0, output: 0 };
          console.log(pc.green('Started fresh session\n'));
          prompt();
          return;
        }

        // /persona - set persona
        if (cmd === 'persona') {
          const personas: Record<string, string> = {
            borris: 'Be extremely concise. No fluff. Just answer directly.',
            dax: 'Be a helpful mentor. Explain your reasoning step by step.',
            brief: 'Minimal output only. Facts and code, no explanations.',
            teacher: 'Teach the user. Break down concepts. Use examples.',
          };
          if (cmdArgs.length === 0) {
            console.log(pc.dim('Available personas: borris, dax, brief, teacher'));
            console.log(pc.dim(`Current: ${appendPrompt ? 'custom' : 'default'}\n`));
          } else {
            const p = cmdArgs[0].toLowerCase();
            if (personas[p]) {
              appendPrompt = personas[p];
              console.log(pc.green(`Persona set to: ${p}\n`));
            } else {
              // Custom persona
              appendPrompt = cmdArgs.join(' ');
              console.log(pc.green(`Custom persona set\n`));
            }
          }
          prompt();
          return;
        }

        // /status - show stats
        if (cmd === 'status') {
          console.log(pc.cyan('\n=== Session Status ==='));
          console.log(pc.dim(`Agent: ${currentAgent} | Model: ${currentModel}`));
          console.log(pc.dim(`Stream: ${streamMode ? 'on' : 'off'} | Session: ${sessionId ? sessionId.slice(0, 8) + '...' : 'ephemeral'}`));
          console.log(pc.dim(`Tokens: ${totalTokens.input} in / ${totalTokens.output} out`));
          console.log(pc.dim(`Cost: $${totalCost.toFixed(4)}\n`));
          prompt();
          return;
        }

        // /auto - autonomous mode
        if (cmd === 'auto') {
          if (cmdArgs.length === 0) {
            console.log(pc.yellow('Usage: /auto <task>\n'));
            prompt();
            return;
          }
          const task = cmdArgs.join(' ');
          console.log(pc.cyan(`Running autonomously: ${task}\n`));
          try {
            const result = await runAutonomous(currentAgent, task, {
              model: currentModel,
              appendSystemPrompt: appendPrompt,
            });
            console.log(result.content);
            if (result.usage) {
              totalTokens.input += result.usage.input_tokens;
              totalTokens.output += result.usage.output_tokens;
            }
            if (result.cost) totalCost += result.cost;
            console.log(pc.dim(`\n[${result.model} | ${(result.duration / 1000).toFixed(1)}s]\n`));
          } catch (err) {
            console.error(pc.red(`Error: ${(err as Error).message}\n`));
          }
          prompt();
          return;
        }

        // /extract - structured extraction
        if (cmd === 'extract') {
          if (cmdArgs.length < 2) {
            console.log(pc.yellow('Usage: /extract <json-schema> <prompt>'));
            console.log(pc.dim('Example: /extract \'{"type":"object","properties":{"answer":{"type":"string"}}}\' What is 2+2?\n'));
            prompt();
            return;
          }
          try {
            const schema = JSON.parse(cmdArgs[0]);
            const extractPrompt = cmdArgs.slice(1).join(' ');
            console.log(pc.cyan('Extracting...\n'));
            const result = await extractUnified(currentAgent, extractPrompt, schema, {
              model: currentModel,
            });
            console.log(pc.bold('Result:'), result.content);
            if (result.data) {
              console.log(pc.bold('Structured:'), JSON.stringify(result.data, null, 2));
            }
            console.log('');
          } catch (err) {
            console.error(pc.red(`Error: ${(err as Error).message}\n`));
          }
          prompt();
          return;
        }
        if (cmd === 'agents') {
          const agents = await discoverAgents();
          console.log('\n' + formatAgentList(agents) + '\n');
          prompt();
          return;
        }
        if (cmd === 'spawn') {
          if (cmdArgs.length === 0) {
            console.log(pc.yellow('Usage: /spawn <agent-name> [agent-name2 ...]\n'));
            const agents = await discoverAgents();
            if (agents.length > 0) {
              console.log(formatAgentList(agents) + '\n');
            }
            prompt();
            return;
          }

          // Spawn one or more agents
          await spawnAgents(cmdArgs, rl);
          prompt();
          return;
        }
        if (cmd === 'continue-plan' || cmd === 'plan') {
          // Execute temp-plan.txt with parallel agents
          await executePlan(cmdArgs, rl);
          prompt();
          return;
        }
        console.log(pc.yellow(`Unknown command: ${trimmed}\n`));
        prompt();
        return;
      }

      // Create abort controller for Ctrl+C during task
      const controller = new AbortController();
      let aborted = false;

      const abortHandler = () => {
        aborted = true;
        controller.abort();
        console.log(pc.yellow('\n[Cancelled]'));
      };

      process.once('SIGINT', abortHandler);

      const startTime = Date.now();

      try {
        // Use unified CLI interface for consistent experience
        if (streamMode && currentAgent !== 'auto') {
          // Streaming mode with unified interface
          const stream = interactiveStream(currentAgent, trimmed, {
            model: currentModel,
            appendSystemPrompt: appendPrompt,
            sessionId,
            signal: controller.signal,
            disableTools: true,
          });

          let content = '';
          for await (const chunk of stream) {
            if (aborted) break;
            process.stdout.write(chunk);
            content += chunk;
          }

          // Get final result (returned from generator)
          const result = await stream.next();
          if (result.done && result.value) {
            const finalResult = result.value;
            if (finalResult.usage) {
              totalTokens.input += finalResult.usage.input_tokens;
              totalTokens.output += finalResult.usage.output_tokens;
            }
            if (finalResult.cost) totalCost += finalResult.cost;
            if (finalResult.sessionId) sessionId = finalResult.sessionId;

            if (!aborted) {
              const duration = Date.now() - startTime;
              console.log(pc.dim(`\n[${finalResult.model} | ${(duration / 1000).toFixed(1)}s | ${totalTokens.input + totalTokens.output} tokens]\n`));
            }
          }
        } else {
          // Non-streaming or auto-routing mode
          const result = await runUnified(
            currentAgent === 'auto' ? 'claude' : currentAgent,
            trimmed,
            {
              model: currentModel,
              appendSystemPrompt: appendPrompt,
              sessionId,
              signal: controller.signal,
              disableTools: true,
              outputFormat: 'json',
            }
          );

          if (!aborted) {
            if (result.error) {
              console.error(pc.red(`\nError: ${result.error}`));
            } else {
              console.log(result.content);
            }

            if (result.usage) {
              totalTokens.input += result.usage.input_tokens;
              totalTokens.output += result.usage.output_tokens;
            }
            if (result.cost) totalCost += result.cost;
            if (result.sessionId) sessionId = result.sessionId;

            const duration = Date.now() - startTime;
            console.log(pc.dim(`\n[${result.model} | ${(duration / 1000).toFixed(1)}s | ${totalTokens.input + totalTokens.output} tokens]\n`));
          }
        }
      } catch (err: unknown) {
        if (!aborted) {
          const error = err as Error;
          console.error(pc.red(`\nError: ${error.message}\n`));
        }
      }

      process.removeListener('SIGINT', abortHandler);

      if (!aborted) {
        prompt();
      } else {
        // Re-prompt after abort
        console.log('');
        prompt();
      }
    });
  };

  // Handle Ctrl+C when no task is running
  rl.on('close', () => {
    console.log(pc.dim('\nGoodbye!'));
    process.exit(0);
  });

  prompt();
}

/**
 * Spawn one or more custom agents from .claude/agents/
 * If multiple agents are specified, they run in parallel.
 */
async function spawnAgents(
  agentNames: string[],
  _rl: readline.Interface
): Promise<void> {
  const config = getConfig();
  const claudePath = config.adapters.claude?.path || 'claude';

  // Validate all agents exist
  const validAgents: Array<{ name: string; agent: Awaited<ReturnType<typeof getAgent>> }> = [];
  for (const name of agentNames) {
    const agent = await getAgent(name);
    if (!agent) {
      console.log(pc.red(`Agent not found: ${name}`));
      const available = await discoverAgents();
      if (available.length > 0) {
        console.log(pc.dim('Available: ' + available.map(a => a.name).join(', ')));
      }
      return;
    }
    validAgents.push({ name, agent });
  }

  if (validAgents.length === 1) {
    // Single agent - run in foreground
    const { name, agent } = validAgents[0];
    console.log(pc.cyan(`\nSpawning agent: ${name}`));
    console.log(pc.dim(agent!.description));
    console.log(pc.dim('─'.repeat(50)));
    console.log('');

    const args = ['--agent', name];
    if (agent!.model) {
      args.push('--model', agent!.model);
    }

    const proc = spawn(claudePath, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    await new Promise<void>((resolve) => {
      proc.on('close', () => resolve());
      proc.on('error', (err) => {
        console.error(pc.red(`Failed to spawn agent: ${err.message}`));
        resolve();
      });
    });
  } else {
    // Multiple agents - run in parallel
    console.log(pc.cyan(`\nSpawning ${validAgents.length} agents in parallel:`));
    for (const { name, agent } of validAgents) {
      console.log(pc.dim(`  - ${name}: ${agent!.description}`));
    }
    console.log(pc.dim('─'.repeat(50)));
    console.log('');

    const processes: Array<{ name: string; proc: ReturnType<typeof spawn> }> = [];

    for (const { name, agent } of validAgents) {
      const args = ['--agent', name];
      if (agent!.model) {
        args.push('--model', agent!.model);
      }

      // Run in background with output prefixed
      const proc = spawn(claudePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        detached: false,
      });

      // Prefix output with agent name
      proc.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            console.log(pc.cyan(`[${name}]`), line);
          }
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            console.log(pc.yellow(`[${name}]`), line);
          }
        }
      });

      processes.push({ name, proc });
    }

    // Wait for all to complete
    await Promise.all(
      processes.map(
        ({ name, proc }) =>
          new Promise<void>((resolve) => {
            proc.on('close', (code) => {
              console.log(
                code === 0
                  ? pc.green(`[${name}] completed`)
                  : pc.red(`[${name}] exited with code ${code}`)
              );
              resolve();
            });
            proc.on('error', (err) => {
              console.error(pc.red(`[${name}] error: ${err.message}`));
              resolve();
            });
          })
      )
    );

    console.log(pc.dim('\nAll agents completed.'));
  }
}

/**
 * Execute temp-plan.txt with parallel PK-Poet agents
 */
async function executePlan(
  args: string[],
  _rl: readline.Interface
): Promise<void> {
  const planPath = join(process.cwd(), 'temp-plan.txt');

  // Check if plan exists
  try {
    await stat(planPath);
  } catch {
    console.log(pc.red('temp-plan.txt not found in current directory.\n'));
    console.log(pc.dim('Create a plan first or navigate to a directory with temp-plan.txt'));
    return;
  }

  // Read and display plan summary
  const planContent = await readFile(planPath, 'utf-8');
  console.log(pc.cyan('\n=== Executing Plan ==='));
  console.log(pc.dim('Source: temp-plan.txt'));
  console.log(pc.dim('─'.repeat(50)));

  // Extract steps from plan
  const stepMatches = planContent.match(/^\d+\)\s+\*\*(.+?)\*\*/gm) || [];
  if (stepMatches.length > 0) {
    console.log(pc.dim('\nPlan steps:'));
    for (const step of stepMatches.slice(0, 8)) {
      const title = step.replace(/^\d+\)\s+\*\*/, '').replace(/\*\*$/, '');
      console.log(pc.dim(`  • ${title}`));
    }
  }
  console.log('');

  // Parse arguments
  const isSequential = args.includes('--sequential') || args.includes('-s');
  const agentIdx = args.findIndex(a => a === '--agent' || a === '-a');
  const singleAgent = agentIdx >= 0 ? args[agentIdx + 1] : null;

  // Define the core agents for the plan
  const coreAgents = [
    'ui-components-agent',
    'input-commands-agent',
    'rich-render-agent',
    'magic-attach-agent'
  ];

  // Validate agents exist
  const available = await discoverAgents();
  const availableNames = available.map(a => a.name);
  const missingAgents = coreAgents.filter(a => !availableNames.includes(a));

  if (missingAgents.length > 0) {
    console.log(pc.yellow(`Missing agents: ${missingAgents.join(', ')}`));
    console.log(pc.dim('Run from project root with .claude/agents/ directory\n'));
    return;
  }

  if (singleAgent) {
    // Run single agent
    if (!availableNames.includes(singleAgent)) {
      console.log(pc.red(`Agent not found: ${singleAgent}`));
      console.log(pc.dim('Available: ' + availableNames.join(', ')));
      return;
    }
    console.log(pc.cyan(`Running single agent: ${singleAgent}`));
    await spawnAgents([singleAgent], _rl);
  } else if (isSequential) {
    // Run sequentially in dependency order
    console.log(pc.cyan('Running agents sequentially...'));
    const order = [
      'rich-render-agent',      // No dependencies
      'magic-attach-agent',     // Uses rich-render
      'input-commands-agent',   // Independent
      'ui-components-agent'     // Integrates all
    ];
    for (const agent of order) {
      console.log(pc.dim(`\n>>> Starting ${agent}...`));
      await spawnAgents([agent], _rl);
    }
  } else {
    // Run all in parallel (default)
    console.log(pc.cyan('Spawning 4 agents in parallel...'));
    console.log(pc.dim('Each agent works on its portion of the plan.\n'));
    await spawnAgents(coreAgents, _rl);
  }

  console.log(pc.green('\n=== Plan Execution Complete ==='));
  console.log(pc.dim('Check temp-plan.txt for progress notes.'));
  console.log(pc.dim('Run verification steps to confirm implementation.\n'));
}
