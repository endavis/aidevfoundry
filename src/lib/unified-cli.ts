/**
 * Unified CLI Interface
 *
 * Abstracts the differences between Claude CLI and Gemini CLI,
 * providing a consistent interface for pk-puzldai interactive mode.
 *
 * Reference:
 * - .claude/docs/claude-cli-wrapper-guide.md
 * - .claude/docs/gemini-cli-wrapper-guide.md
 */

import { execa } from 'execa';

/** Type for execa subprocess with streaming capabilities */
type ExecaProcess = ReturnType<typeof execa>;
import { Readable } from 'stream';
import * as readline from 'readline';
import type { AgentName } from '../executor/types';
import { getConfig } from './config';

/**
 * Unified streaming event from any CLI
 */
export interface StreamEvent {
  type: 'init' | 'delta' | 'tool_use' | 'tool_result' | 'complete' | 'error';
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  result?: string;
  error?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  cost?: number;
  sessionId?: string;
}

/**
 * Unified CLI options that work across Claude and Gemini
 */
export interface UnifiedCLIOptions {
  /** Model to use */
  model?: string;
  /** Fallback model if primary fails (Claude only) */
  fallbackModel?: string;
  /** Output format */
  outputFormat?: 'text' | 'json' | 'stream-json';
  /** JSON schema for structured output */
  schema?: object;
  /** Append to system prompt */
  appendSystemPrompt?: string;
  /** Replace system prompt */
  systemPrompt?: string;
  /** Tool whitelist (e.g., "Bash,Read,Write") */
  tools?: string;
  /** Disable all tools */
  disableTools?: boolean;
  /** Session ID for multi-turn (Claude only) */
  sessionId?: string;
  /** Continue previous session */
  continueSession?: boolean;
  /** Bypass permissions (Claude) / auto_edit mode (Gemini) */
  autonomous?: boolean;
  /** No session persistence */
  ephemeral?: boolean;
  /** Timeout in ms */
  timeout?: number;
  /** Abort signal */
  signal?: AbortSignal;
  /** Agent name (Claude only) */
  agent?: string;
  /** Internal: send prompt via stdin instead of positional args */
  promptViaStdin?: boolean;
}

/**
 * Unified result from any CLI
 */
export interface UnifiedResult {
  content: string;
  structuredOutput?: unknown;
  model: string;
  duration: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  cost?: number;
  sessionId?: string;
  error?: string;
}

/**
 * CLI adapter configuration
 */
interface CLIConfig {
  command: string;
  buildArgs: (prompt: string, options: UnifiedCLIOptions) => string[];
  parseStreamEvent: (line: string) => StreamEvent | null;
  parseResult: (stdout: string) => UnifiedResult;
}

const GEMINI_MAX_PROMPT_CHARS = 30000;

/**
 * Claude CLI configuration
 */
const claudeConfig: CLIConfig = {
  command: 'claude',

  buildArgs(prompt: string, options: UnifiedCLIOptions): string[] {
    const args: string[] = ['-p'];
    const outputFormat = options.outputFormat ?? 'stream-json';

    args.push('--output-format', outputFormat);

    // stream-json REQUIRES --verbose for Claude
    if (outputFormat === 'stream-json') {
      args.push('--verbose');
    }

    // Tools
    if (options.disableTools) {
      args.push('--tools=');
    } else if (options.tools) {
      args.push('--tools', options.tools);
    }

    // Model with fallback
    if (options.model) {
      args.push('--model', options.model);
    }
    if (options.fallbackModel) {
      args.push('--fallback-model', options.fallbackModel);
    }

    // System prompt
    if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt);
    }
    if (options.appendSystemPrompt) {
      args.push('--append-system-prompt', options.appendSystemPrompt);
    }

    // Structured output
    if (options.schema) {
      args.push('--json-schema', JSON.stringify(options.schema));
    }

    // Session management
    if (options.sessionId) {
      args.push('--session-id', options.sessionId);
    }
    if (options.continueSession) {
      args.push('--continue');
    }
    if (options.ephemeral) {
      args.push('--no-session-persistence');
    }

    // Autonomous mode
    if (options.autonomous) {
      args.push('--permission-mode', 'bypassPermissions');
    }

    // Agent
    if (options.agent) {
      args.push('--agent', options.agent);
    }

    // Prompt must come last
    args.push(prompt);
    return args;
  },

  parseStreamEvent(line: string): StreamEvent | null {
    try {
      const event = JSON.parse(line);

      if (event.type === 'system' && event.subtype === 'init') {
        return { type: 'init', sessionId: event.session_id };
      }

      if (event.type === 'stream_event') {
        const delta = event.event?.delta?.text;
        if (delta) {
          return { type: 'delta', text: delta };
        }
      }

      if (event.type === 'tool_use') {
        return {
          type: 'tool_use',
          toolName: event.tool?.name,
          toolInput: event.tool?.input,
        };
      }

      if (event.type === 'tool_result') {
        return {
          type: 'tool_result',
          result: event.result,
        };
      }

      if (event.type === 'result') {
        return {
          type: 'complete',
          result: event.result,
          usage: event.usage,
          cost: event.total_cost_usd,
          sessionId: event.session_id,
          error: event.is_error ? event.result : undefined,
        };
      }

      return null;
    } catch {
      return null;
    }
  },

  parseResult(stdout: string): UnifiedResult {
    // Parse stream-json or json output
    const lines = stdout.trim().split('\n');
    let result = '';
    let structuredOutput: unknown;
    let usage: { input_tokens: number; output_tokens: number } | undefined;
    let cost: number | undefined;
    let sessionId: string | undefined;
    let error: string | undefined;

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'result') {
          result = event.result || '';
          structuredOutput = event.structured_output;
          usage = event.usage;
          cost = event.total_cost_usd;
          sessionId = event.session_id;
          if (event.is_error) error = event.result;
        }
      } catch {
        // Not JSON, might be raw text
        result += line;
      }
    }

    return {
      content: result,
      structuredOutput,
      model: 'claude',
      duration: 0,
      usage,
      cost,
      sessionId,
      error,
    };
  },
};

/**
 * Gemini CLI configuration
 */
const geminiConfig: CLIConfig = {
  command: 'gemini',

  buildArgs(prompt: string, options: UnifiedCLIOptions): string[] {
    const args: string[] = [];
    const outputFormat = options.outputFormat ?? 'json';

    args.push('--output-format', outputFormat);

    // Model
    if (options.model) {
      args.push('-m', options.model);
    }

    // Structured output schema
    if (options.schema) {
      args.push('--schema', JSON.stringify(options.schema));
    }

    // Autonomous mode (Gemini uses approval-mode)
    if (options.autonomous) {
      args.push('--approval-mode', 'auto_edit');
    }

    // Positional prompt (Gemini -p is deprecated)
    if (!options.promptViaStdin) {
      args.push('--', prompt);
    }

    return args;
  },

  parseStreamEvent(line: string): StreamEvent | null {
    try {
      const event = JSON.parse(line);

      // Gemini stream events have similar structure
      if (event.type === 'delta' || event.event?.delta?.text) {
        return {
          type: 'delta',
          text: event.text || event.event?.delta?.text,
        };
      }

      if (event.type === 'result') {
        return {
          type: 'complete',
          result: event.result || event.response,
          usage: event.usage || (event.stats?.models ? extractGeminiUsage(event.stats.models) : undefined),
          sessionId: event.session_id,
        };
      }

      return null;
    } catch {
      return null;
    }
  },

  parseResult(stdout: string): UnifiedResult {
    try {
      const json = JSON.parse(stdout);
      const usage = json.stats?.models ? extractGeminiUsage(json.stats.models) : undefined;

      return {
        content: json.response || json.result || '',
        structuredOutput: json.structured_output,
        model: 'gemini',
        duration: 0,
        usage,
        sessionId: json.session_id,
      };
    } catch {
      return {
        content: stdout,
        model: 'gemini',
        duration: 0,
      };
    }
  },
};

function extractGeminiUsage(models: Record<string, { tokens?: { prompt?: number; candidates?: number } }>): { input_tokens: number; output_tokens: number } {
  let input = 0;
  let output = 0;
  for (const m of Object.values(models)) {
    input += m.tokens?.prompt || 0;
    output += m.tokens?.candidates || 0;
  }
  return { input_tokens: input, output_tokens: output };
}

/**
 * Get CLI config for an agent
 */
function getCliConfig(agent: AgentName): CLIConfig {
  const config = getConfig();

  switch (agent) {
    case 'claude':
      return {
        ...claudeConfig,
        command: config.adapters.claude?.path || 'claude',
      };
    case 'gemini':
    case 'gemini-safe':
      return {
        ...geminiConfig,
        command: config.adapters.gemini?.path || 'gemini',
      };
    default:
      // Default to Claude-like behavior
      return {
        ...claudeConfig,
        command: config.adapters.claude?.path || 'claude',
      };
  }
}

/**
 * Unified CLI - run a prompt with consistent interface
 */
export async function runUnified(
  agent: AgentName,
  prompt: string,
  options: UnifiedCLIOptions = {}
): Promise<UnifiedResult> {
  const cli = getCliConfig(agent);
  const startTime = Date.now();

  const usePromptStdin =
    (agent === 'gemini' || agent === 'gemini-safe') &&
    prompt.length > GEMINI_MAX_PROMPT_CHARS;
  const args = cli.buildArgs(prompt, {
    ...options,
    promptViaStdin: options.promptViaStdin ?? usePromptStdin
  });

  const { stdout, stderr } = await execa(cli.command, args, {
    timeout: options.timeout || 120000,
    cancelSignal: options.signal,
    reject: false,
    input: usePromptStdin ? prompt : undefined,
    stdin: usePromptStdin ? 'pipe' : 'ignore',
  });

  if (stderr && !stdout) {
    return {
      content: '',
      model: agent,
      duration: Date.now() - startTime,
      error: stderr,
    };
  }

  const result = cli.parseResult(stdout);
  result.model = agent;
  result.duration = Date.now() - startTime;
  return result;
}

/**
 * Unified CLI - stream a prompt with consistent interface
 */
export function streamUnified(
  agent: AgentName,
  prompt: string,
  options: UnifiedCLIOptions = {}
): {
  process: ExecaProcess;
  events: AsyncIterable<StreamEvent>;
} {
  const cli = getCliConfig(agent);

  // Force stream-json output
  const streamOptions = {
    ...options,
    outputFormat: 'stream-json' as const,
  };

  const usePromptStdin =
    (agent === 'gemini' || agent === 'gemini-safe') &&
    prompt.length > GEMINI_MAX_PROMPT_CHARS;
  const args = cli.buildArgs(prompt, {
    ...streamOptions,
    promptViaStdin: streamOptions.promptViaStdin ?? usePromptStdin
  });

  const proc = execa(cli.command, args, {
    timeout: options.timeout || 120000,
    cancelSignal: options.signal,
    reject: false,
    input: usePromptStdin ? prompt : undefined,
    stdin: usePromptStdin ? 'pipe' : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Create async iterable from stdout
  const events = (async function* () {
    if (!proc.stdout) return;

    const rl = readline.createInterface({
      input: proc.stdout as Readable,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      const event = cli.parseStreamEvent(line);
      if (event) {
        yield event;
      }
    }
  })();

  return { process: proc, events };
}

/**
 * Unified CLI - extract structured data with schema
 */
export async function extractUnified<T>(
  agent: AgentName,
  prompt: string,
  schema: object,
  options: UnifiedCLIOptions = {}
): Promise<{ content: string; data?: T; error?: string }> {
  const result = await runUnified(agent, prompt, {
    ...options,
    outputFormat: 'json',
    schema,
    disableTools: true,
    ephemeral: true,
  });

  return {
    content: result.content,
    data: result.structuredOutput as T,
    error: result.error,
  };
}

/**
 * Unified CLI - run autonomously with tool access
 */
export async function runAutonomous(
  agent: AgentName,
  task: string,
  options: UnifiedCLIOptions = {}
): Promise<UnifiedResult> {
  return runUnified(agent, task, {
    ...options,
    autonomous: true,
    tools: options.tools || 'Bash,Read,Write,Edit,Glob,Grep',
    ephemeral: true,
    outputFormat: 'stream-json',
  });
}

/**
 * Interactive streaming session - feels like one cohesive CLI
 */
export async function* interactiveStream(
  agent: AgentName,
  prompt: string,
  options: UnifiedCLIOptions = {}
): AsyncGenerator<string, UnifiedResult, undefined> {
  const { events } = streamUnified(agent, prompt, options);

  let finalResult: UnifiedResult = {
    content: '',
    model: agent,
    duration: 0,
  };

  for await (const event of events) {
    if (event.type === 'delta' && event.text) {
      yield event.text;
      finalResult.content += event.text;
    }

    if (event.type === 'tool_use') {
      yield `\n[Tool: ${event.toolName}]\n`;
    }

    if (event.type === 'complete') {
      finalResult = {
        content: finalResult.content || event.result || '',
        model: agent,
        duration: 0,
        usage: event.usage,
        cost: event.cost,
        sessionId: event.sessionId,
        error: event.error,
      };
    }
  }

  return finalResult;
}

/**
 * Get the appropriate model default for an agent
 */
export function getDefaultModel(agent: AgentName): string {
  switch (agent) {
    case 'claude':
      return 'sonnet';
    case 'gemini':
    case 'gemini-safe':
      return 'gemini-2.0-flash';
    default:
      return 'sonnet';
  }
}

/**
 * Get the fast/cheap model for an agent
 */
export function getFastModel(agent: AgentName): string {
  switch (agent) {
    case 'claude':
      return 'haiku';
    case 'gemini':
    case 'gemini-safe':
      return 'gemini-2.0-flash';
    default:
      return 'haiku';
  }
}

/**
 * Get the best quality model for an agent
 */
export function getBestModel(agent: AgentName): string {
  switch (agent) {
    case 'claude':
      return 'opus';
    case 'gemini':
    case 'gemini-safe':
      return 'gemini-2.0-pro';
    default:
      return 'opus';
  }
}
