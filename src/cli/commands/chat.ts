/**
 * Chat REPL Command
 *
 * Conversational interface for pk-puzldai that feels like Claude Code.
 * Features:
 * - Persistent chat loop with history
 * - Slash commands (/help, /model, /clear, /compact, etc.)
 * - Streaming output
 * - Session persistence
 * - Context awareness
 */

import pc from 'picocolors';
import * as readline from 'readline';
import { orchestrate } from '../../orchestrator';
import { adapters } from '../../adapters';
import { getConfig } from '../../lib/config';
import { runAgentLoop } from '../../agentic/agent-loop';
import {
  type PermissionRequest,
  type PermissionResult,
  type ToolCall
} from '../../agentic/tools';
import {
  createSessionCompat,
  loadUnifiedSession,
  addMessageCompat,
  listUnifiedSessions,
  clearUnifiedSessionMessages,
  type UnifiedSession,
  type MessagePart,
  type TextPart
} from '../../context';
import type { AgentName } from '../../executor/types';
import type { Adapter } from '../../lib/types';

// Helper to extract text content from MessagePart[]
function extractText(parts: MessagePart[]): string {
  return parts
    .filter((p): p is TextPart => p.type === 'text')
    .map(p => p.content)
    .join('\n');
}

// Slash command definitions
interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  handler: (args: string, state: ChatState) => Promise<boolean>; // returns true to continue, false to exit
}

// Chat state
interface ChatState {
  agent: AgentName;
  model?: string;
  session: UnifiedSession | null;
  sessionId: string | null;
  messages: ChatMessage[];
  agentic: boolean;
  streaming: boolean;
  verbose: boolean;
  cwd: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agent?: string;
  timestamp: number;
}

// Slash commands registry
const slashCommands: SlashCommand[] = [
  {
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show available commands',
    handler: async (_args, _state) => {
      console.log();
      console.log(pc.bold(pc.cyan('Available Commands:')));
      console.log();
      for (const cmd of slashCommands) {
        const aliases = cmd.aliases ? ` (${cmd.aliases.map(a => '/' + a).join(', ')})` : '';
        console.log(`  ${pc.green('/' + cmd.name)}${pc.dim(aliases)}`);
        console.log(`    ${pc.dim(cmd.description)}`);
        if (cmd.usage) {
          console.log(`    ${pc.dim('Usage: ' + cmd.usage)}`);
        }
      }
      console.log();
      console.log(pc.dim('Tip: Just type naturally to chat with the AI.'));
      console.log();
      return true;
    }
  },
  {
    name: 'model',
    aliases: ['m'],
    description: 'Show or switch the current model/agent',
    usage: '/model [agent] [model]',
    handler: async (args, state) => {
      const parts = args.trim().split(/\s+/);

      if (!args.trim()) {
        console.log();
        console.log(pc.bold('Current Model:'));
        console.log(`  Agent: ${pc.green(state.agent)}`);
        console.log(`  Model: ${pc.green(state.model || 'default')}`);
        console.log();
        console.log(pc.dim('Available agents: claude, gemini, codex, ollama, mistral, factory'));
        console.log(pc.dim('Usage: /model claude opus'));
        console.log();
        return true;
      }

      const [newAgent, newModel] = parts;

      if (newAgent && adapters[newAgent]) {
        state.agent = newAgent as AgentName;
        console.log(pc.green(`✓ Switched to ${newAgent}`));
      } else if (newAgent) {
        console.log(pc.red(`Unknown agent: ${newAgent}`));
        console.log(pc.dim('Available: claude, gemini, codex, ollama, mistral, factory'));
        return true;
      }

      if (newModel) {
        state.model = newModel;
        console.log(pc.green(`✓ Model set to ${newModel}`));
      }

      return true;
    }
  },
  {
    name: 'clear',
    aliases: ['c'],
    description: 'Clear conversation history',
    handler: async (_args, state) => {
      state.messages = [];
      if (state.session) {
        state.session = clearUnifiedSessionMessages(state.session);
      }
      console.clear();
      printBanner();
      console.log(pc.green('✓ Conversation cleared'));
      console.log();
      return true;
    }
  },
  {
    name: 'compact',
    description: 'Summarize and compress conversation context',
    handler: async (_args, state) => {
      if (state.messages.length < 3) {
        console.log(pc.yellow('Not enough messages to compact.'));
        return true;
      }

      console.log(pc.dim('Compacting conversation...'));

      // Create a summary prompt
      const historyText = state.messages
        .map(m => `${m.role}: ${m.content.slice(0, 500)}`)
        .join('\n\n');

      const summaryPrompt = `Summarize this conversation in 2-3 sentences, preserving key context and decisions:\n\n${historyText}`;

      try {
        const result = await orchestrate(summaryPrompt, {
          agent: 'ollama', // Use fast local model for summarization
        });

        if (result.content) {
          // Replace history with summary
          state.messages = [{
            role: 'system',
            content: `[Conversation summary: ${result.content}]`,
            timestamp: Date.now()
          }];

          console.log(pc.green('✓ Conversation compacted'));
          console.log(pc.dim(`Summary: ${result.content.slice(0, 200)}...`));
        }
      } catch (err) {
        console.log(pc.yellow('Could not compact (ollama may not be available).'));
      }

      return true;
    }
  },
  {
    name: 'agentic',
    aliases: ['a', 'tools'],
    description: 'Toggle agentic mode (tool access)',
    handler: async (_args, state) => {
      state.agentic = !state.agentic;
      const status = state.agentic ? pc.green('enabled') : pc.yellow('disabled');
      console.log(`Agentic mode: ${status}`);
      if (state.agentic) {
        console.log(pc.dim('AI can now use tools: view, glob, grep, bash, write, edit'));
      }
      return true;
    }
  },
  {
    name: 'session',
    aliases: ['s'],
    description: 'Manage chat sessions',
    usage: '/session [list|new|load <id>]',
    handler: async (args, state) => {
      const parts = args.trim().split(/\s+/);
      const action = parts[0] || 'info';

      if (action === 'list') {
        const sessions = listUnifiedSessions();
        console.log();
        console.log(pc.bold('Sessions:'));
        if (sessions.length === 0) {
          console.log(pc.dim('  No sessions found.'));
        } else {
          for (const s of sessions.slice(0, 10)) {
            const current = s.id === state.sessionId ? pc.green(' (current)') : '';
            const agent = s.agentsUsed[0] || 'auto';
            console.log(`  ${s.id}${current} - ${agent} - ${new Date(s.createdAt).toLocaleDateString()}`);
          }
        }
        console.log();
        return true;
      }

      if (action === 'new') {
        const session = createSessionCompat(state.agent);
        state.session = session;
        state.sessionId = session.id;
        state.messages = [];
        console.log(pc.green(`✓ New session created: ${session.id.slice(0, 8)}`));
        return true;
      }

      if (action === 'load' && parts[1]) {
        try {
          const session = loadUnifiedSession(parts[1]);
          if (session) {
            state.session = session;
            state.sessionId = session.id;
            // Load messages from session, converting MessagePart[] to string
            state.messages = (session.messages || [])
              .filter(m => m.role === 'user' || m.role === 'assistant')
              .map(m => ({
                role: m.role as 'user' | 'assistant',
                content: extractText(m.content),
                timestamp: m.timestamp
              }));
            console.log(pc.green(`✓ Loaded session: ${session.id.slice(0, 8)} (${state.messages.length} messages)`));
          } else {
            console.log(pc.red('Session not found.'));
          }
        } catch {
          console.log(pc.red('Failed to load session.'));
        }
        return true;
      }

      // Default: show current session info
      console.log();
      console.log(pc.bold('Current Session:'));
      console.log(`  ID: ${state.sessionId || 'none'}`);
      console.log(`  Messages: ${state.messages.length}`);
      console.log(`  Agent: ${state.agent}`);
      console.log();
      console.log(pc.dim('Usage: /session list | /session new | /session load <id>'));
      console.log();
      return true;
    }
  },
  {
    name: 'compare',
    description: 'Run last/current prompt on multiple agents',
    usage: '/compare [agents]',
    handler: async (args, state) => {
      const agents = args.trim() || 'claude,gemini';
      const lastUserMsg = [...state.messages].reverse().find(m => m.role === 'user');

      if (!lastUserMsg) {
        console.log(pc.yellow('No previous prompt to compare.'));
        return true;
      }

      console.log(pc.dim(`Comparing on: ${agents}`));
      console.log(pc.dim(`Prompt: ${lastUserMsg.content.slice(0, 50)}...`));
      console.log();

      const agentList = agents.split(',').map(a => a.trim());

      for (const agent of agentList) {
        if (!adapters[agent]) {
          console.log(pc.yellow(`Skipping unknown agent: ${agent}`));
          continue;
        }

        console.log(pc.bold(pc.cyan(`--- ${agent.toUpperCase()} ---`)));
        try {
          const result = await orchestrate(lastUserMsg.content, {
            agent,
            onChunk: (chunk) => process.stdout.write(chunk)
          });
          if (!result.content) {
            console.log(result.content);
          }
          console.log();
        } catch (err) {
          console.log(pc.red(`Error: ${(err as Error).message}`));
        }
        console.log();
      }

      return true;
    }
  },
  {
    name: 'history',
    description: 'Show conversation history',
    handler: async (_args, state) => {
      console.log();
      console.log(pc.bold('Conversation History:'));
      console.log();

      if (state.messages.length === 0) {
        console.log(pc.dim('  No messages yet.'));
      } else {
        for (const msg of state.messages.slice(-10)) {
          const prefix = msg.role === 'user' ? pc.green('You: ') : pc.cyan('AI:  ');
          const content = msg.content.length > 100
            ? msg.content.slice(0, 100) + '...'
            : msg.content;
          console.log(`${prefix}${content}`);
        }
      }
      console.log();
      return true;
    }
  },
  {
    name: 'exit',
    aliases: ['quit', 'q'],
    description: 'Exit chat',
    handler: async () => {
      console.log(pc.dim('Goodbye!'));
      return false;
    }
  }
];

// Parse and execute slash commands
async function handleSlashCommand(input: string, state: ChatState): Promise<boolean> {
  const match = input.match(/^\/(\w+)\s*(.*)/);
  if (!match) return true;

  const [, cmdName, args] = match;

  const cmd = slashCommands.find(c =>
    c.name === cmdName || c.aliases?.includes(cmdName)
  );

  if (!cmd) {
    console.log(pc.red(`Unknown command: /${cmdName}`));
    console.log(pc.dim('Type /help for available commands.'));
    return true;
  }

  return cmd.handler(args, state);
}

// Print welcome banner
function printBanner() {
  console.log();
  console.log(pc.bold(pc.cyan('  pk-puzldai chat')));
  console.log(pc.dim('  Multi-LLM orchestration • Type /help for commands'));
  console.log();
}

// Main chat function
async function runChat(state: ChatState): Promise<void> {
  const _prompt = state.messages.length > 0
    ? state.messages.map(m => `${m.role}: ${m.content}`).join('\n\n') + '\n\nuser: '
    : '';

  // Get user input from readline
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const getUserInput = (): Promise<string> => {
    return new Promise((resolve) => {
      const agentLabel = pc.dim(`[${state.agent}${state.agentic ? '+tools' : ''}]`);
      rl.question(`${agentLabel} ${pc.green('>')} `, (answer) => {
        resolve(answer);
      });
    });
  };

  printBanner();

  // Show current agent
  console.log(pc.dim(`Agent: ${state.agent} | Mode: ${state.agentic ? 'agentic' : 'chat'}`));
  console.log();

  // Main loop
  while (true) {
    const input = await getUserInput();

    // Handle empty input
    if (!input.trim()) {
      continue;
    }

    // Handle slash commands
    if (input.startsWith('/')) {
      const shouldContinue = await handleSlashCommand(input, state);
      if (!shouldContinue) {
        rl.close();
        return;
      }
      continue;
    }

    // Add user message
    state.messages.push({
      role: 'user',
      content: input,
      timestamp: Date.now()
    });

    // Save to session if exists
    if (state.session) {
      await addMessageCompat(state.session, 'user', input);
    }

    // Show thinking indicator
    process.stdout.write(pc.dim('thinking...'));

    const startTime = Date.now();
    let response = '';

    try {
      if (state.agentic) {
        // Agentic mode with tools
        process.stdout.write('\r' + ' '.repeat(20) + '\r');

        // Get the adapter for the current agent
        const adapter = adapters[state.agent] as Adapter;
        if (!adapter) {
          throw new Error(`Unknown agent: ${state.agent}`);
        }

        const result = await runAgentLoop(adapter, input, {
          model: state.model,
          cwd: state.cwd,
          onChunk: (chunk: string) => {
            process.stdout.write(chunk);
            response += chunk;
          },
          onToolCall: (call: ToolCall) => {
            console.log(pc.dim(`\n[tool: ${call.name}]`));
          },
          onPermissionRequest: async (request: PermissionRequest): Promise<PermissionResult> => {
            // Simple permission prompt
            return new Promise((resolve) => {
              rl.question(
                pc.yellow(`\nAllow ${request.tool}? [y/n] `),
                (answer) => {
                  const allowed = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
                  resolve({
                    decision: allowed ? 'allow' : 'deny'
                  });
                }
              );
            });
          }
        });

        response = result.content || '';
      } else {
        // Standard chat mode with streaming
        process.stdout.write('\r' + ' '.repeat(20) + '\r');

        const result = await orchestrate(input, {
          agent: state.agent,
          model: state.model,
          onChunk: (chunk: string) => {
            process.stdout.write(chunk);
            response += chunk;
          }
        });

        if (!response && result.content) {
          console.log(result.content);
          response = result.content;
        }
      }

      console.log(); // New line after response

      // Add assistant message
      state.messages.push({
        role: 'assistant',
        content: response,
        agent: state.agent,
        timestamp: Date.now()
      });

      // Save to session
      if (state.session) {
        await addMessageCompat(state.session, 'assistant', response, state.agent);
      }

      // Show stats
      const duration = (Date.now() - startTime) / 1000;
      console.log(pc.dim(`[${state.agent} • ${duration.toFixed(1)}s]`));
      console.log();

    } catch (err) {
      process.stdout.write('\r' + ' '.repeat(20) + '\r');
      console.log(pc.red(`Error: ${(err as Error).message}`));
      console.log();
    }
  }
}

// Command options
interface ChatCommandOptions {
  agent?: string;
  model?: string;
  agentic?: boolean;
  session?: string;
  verbose?: boolean;
}

// Main export
export async function chatCommand(options: ChatCommandOptions = {}): Promise<void> {
  const config = getConfig();

  // Initialize state
  const state: ChatState = {
    agent: (options.agent || config.defaultAgent || 'claude') as AgentName,
    model: options.model,
    session: null,
    sessionId: options.session || null,
    messages: [],
    agentic: options.agentic || false,
    streaming: true,
    verbose: options.verbose || false,
    cwd: process.cwd()
  };

  // Load existing session if specified
  if (state.sessionId) {
    try {
      const session = loadUnifiedSession(state.sessionId);
      if (session) {
        state.session = session;
        state.messages = (session.messages || [])
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({
            role: m.role as 'user' | 'assistant',
            content: extractText(m.content),
            timestamp: m.timestamp
          }));
        console.log(pc.dim(`Loaded session: ${state.sessionId.slice(0, 8)}`));
      }
    } catch {
      // Session doesn't exist, will create new one
    }
  }

  // Create new session if needed
  if (!state.session) {
    state.session = createSessionCompat(state.agent);
    state.sessionId = state.session.id;
  }

  // Run chat loop
  await runChat(state);
}
