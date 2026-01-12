import { execa } from 'execa';

/** Type for execa subprocess with streaming capabilities */
type ExecaProcess = ReturnType<typeof execa>;
import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import { getConfig } from '../lib/config';
import { StreamParser, type ResultEvent } from '../lib/stream-parser';
import { extractProposedEdits, type ProposedEdit } from '../lib/edit-review';

/**
 * Claude CLI Wrapper Guide Reference:
 * See .claude/docs/claude-cli-wrapper-guide.md for expert-level patterns
 *
 * Input/Output Format Matrix:
 * | Input    | Output      | Requirement  | Use Case                    |
 * |----------|-------------|--------------|------------------------------|
 * | text     | text        | None         | Simple pipes                 |
 * | text     | json        | None         | Structured responses         |
 * | text     | stream-json | --verbose    | Real-time streaming          |
 * | stream   | stream-json | --verbose    | Bidirectional streaming      |
 */

/**
 * Extended run options for expert-level Claude CLI usage
 */
export interface ClaudeRunOptions extends RunOptions {
  /** Tool whitelist (e.g., "Bash,Read,Write,Edit") */
  tools?: string;
  /** Append to system prompt without replacing */
  appendSystemPrompt?: string;
  /** Replace system prompt entirely */
  systemPrompt?: string;
  /** JSON schema for structured output */
  jsonSchema?: object;
  /** Session ID for multi-turn conversations */
  sessionId?: string;
  /** Continue from last session */
  continueSession?: boolean;
  /** Fallback model if primary unavailable */
  fallbackModel?: string;
  /** Permission mode: 'default' | 'bypassPermissions' */
  permissionMode?: 'default' | 'bypassPermissions';
  /** Disable session persistence (ephemeral) */
  noSessionPersistence?: boolean;
  /** Agent name to use */
  agent?: string;
}

/**
 * Structured extraction result
 */
export interface StructuredResult<T = unknown> {
  result: string;
  structured_output?: T;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
  };
  session_id: string;
  duration_ms: number;
}

export function buildClaudeArgs(params: {
  prompt: string;
  model?: string;
  disableTools: boolean;
  tools?: string;
  appendSystemPrompt?: string;
  systemPrompt?: string;
  jsonSchema?: object;
  sessionId?: string;
  continueSession?: boolean;
  fallbackModel?: string;
  permissionMode?: string;
  noSessionPersistence?: boolean;
  agent?: string;
  outputFormat?: 'text' | 'json' | 'stream-json';
}): string[] {
  // claude -p --output-format stream-json --verbose "prompt" for non-interactive output
  // -p is shorthand for --print (print without interactive mode)
  // IMPORTANT: `--tools <tools...>` is variadic; using `--tools ""` consumes the positional prompt.
  // Using `--tools=` sets an empty value without eating the prompt.

  const outputFormat = params.outputFormat ?? 'stream-json';
  const args = ['-p', '--output-format', outputFormat];

  // stream-json REQUIRES --verbose
  if (outputFormat === 'stream-json') {
    args.push('--verbose');
  }

  // Tool configuration
  if (params.disableTools) {
    args.push('--tools=');
  } else if (params.tools) {
    args.push('--tools', params.tools);
  }

  // Model selection with fallback
  if (params.model) {
    args.push('--model', params.model);
  }
  if (params.fallbackModel) {
    args.push('--fallback-model', params.fallbackModel);
  }

  // System prompt configuration
  if (params.systemPrompt) {
    args.push('--system-prompt', params.systemPrompt);
  }
  if (params.appendSystemPrompt) {
    args.push('--append-system-prompt', params.appendSystemPrompt);
  }

  // JSON schema for structured output
  if (params.jsonSchema) {
    args.push('--json-schema', JSON.stringify(params.jsonSchema));
  }

  // Session management
  if (params.sessionId) {
    args.push('--session-id', params.sessionId);
  }
  if (params.continueSession) {
    args.push('--continue');
  }
  if (params.noSessionPersistence) {
    args.push('--no-session-persistence');
  }

  // Permission mode
  if (params.permissionMode === 'bypassPermissions') {
    args.push('--permission-mode', 'bypassPermissions');
  }

  // Agent selection
  if (params.agent) {
    args.push('--agent', params.agent);
  }

  // Prompt must come last
  args.push(params.prompt);
  return args;
}

/**
 * Result of a dry-run execution (with permission-mode default)
 */
export interface DryRunResult {
  response: ModelResponse;
  proposedEdits: ProposedEdit[];
  resultEvent: ResultEvent | null;
}

export const claudeAdapter: Adapter & {
  dryRun: (prompt: string, options?: RunOptions) => Promise<DryRunResult>;
  extract: <T>(prompt: string, schema: object, options?: ClaudeRunOptions) => Promise<StructuredResult<T>>;
  autonomous: (task: string, options?: ClaudeRunOptions) => Promise<ModelResponse>;
  chat: (prompt: string, sessionId?: string, options?: ClaudeRunOptions) => Promise<ModelResponse>;
  spawnAgent: (agentName: string, task: string, options?: ClaudeRunOptions) => ExecaProcess;
} = {
  name: 'claude',

  async isAvailable(): Promise<boolean> {
    const config = getConfig();
    if (!config.adapters.claude.enabled) return false;

    try {
      const command = process.platform === 'win32' ? 'where' : 'which';
      await execa(command, [config.adapters.claude.path]);
      return true;
    } catch {
      return false;
    }
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();
    const model = options?.model ?? config.adapters.claude.model;
    const disableTools = options?.disableTools ?? true; // Default: disable tools

    try {
      const args = buildClaudeArgs({
        prompt,
        model,
        disableTools,
      });

      const { stdout, stderr } = await execa(
        config.adapters.claude.path,
        args,
        {
          timeout: config.timeout,
          cancelSignal: options?.signal,
          reject: false,
          stdin: 'ignore'
        }
      );

      const modelName = model ? `claude/${model}` : 'claude';

      if (stderr && !stdout) {
        return {
          content: '',
          model: modelName,
          duration: Date.now() - startTime,
          error: stderr
        };
      }

      // Parse stream-json response using StreamParser
      try {
        const parser = new StreamParser();

        // Subscribe to tool events if callback provided
        if (options?.onToolEvent) {
          parser.onEvent(options.onToolEvent);
        }

        // Parse all lines (emits events to subscribers)
        parser.parseAll(stdout);

        // Get final result
        const resultEvent = parser.getResult();
        const result: ResultEvent = resultEvent ?? {
          type: 'result',
          subtype: 'success',
          result: '',
          isError: false
        };

        return {
          content: result.result,
          model: modelName,
          duration: Date.now() - startTime,
          tokens: result.usage ? {
            input: result.usage.input_tokens,
            output: result.usage.output_tokens
          } : undefined,
          error: result.isError ? result.result : undefined
        };
      } catch {
        // Fallback if parsing fails
        return {
          content: stdout || '',
          model: modelName,
          duration: Date.now() - startTime
        };
      }
    } catch (err: unknown) {
      const error = err as Error;
      const modelName = model ? `claude/${model}` : 'claude';
      return {
        content: '',
        model: modelName,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  },

  /**
   * Dry-run mode: Execute with --permission-mode default to capture
   * proposed edits without applying them
   */
  async dryRun(prompt: string, options?: RunOptions): Promise<DryRunResult> {
    const config = getConfig();
    const startTime = Date.now();
    const model = options?.model ?? config.adapters.claude.model;

    try {
      // Use --permission-mode default to capture Write/Edit attempts
      // WITHOUT --tools "" so Claude can actually try to use tools
      const args = [
        '-p',
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-mode', 'default'
      ];
      if (model) {
        args.push('--model', model);
      }

      // Prompt must come last
      args.push(prompt);

      const { stdout, stderr } = await execa(
        config.adapters.claude.path,
        args,
        {
          timeout: config.timeout,
          cancelSignal: options?.signal,
          reject: false,
          stdin: 'ignore'
        }
      );

      const modelName = model ? `claude/${model}` : 'claude';

      if (stderr && !stdout) {
        return {
          response: {
            content: '',
            model: modelName,
            duration: Date.now() - startTime,
            error: stderr
          },
          proposedEdits: [],
          resultEvent: null
        };
      }

      // Parse stream-json response
      const parser = new StreamParser();

      if (options?.onToolEvent) {
        parser.onEvent(options.onToolEvent);
      }

      parser.parseAll(stdout);

      const resultEvent = parser.getResult();
      const result: ResultEvent = resultEvent ?? {
        type: 'result',
        subtype: 'success',
        result: '',
        isError: false
      };

      // Extract proposed edits from permission denials
      const proposedEdits = extractProposedEdits(result);

      return {
        response: {
          content: result.result,
          model: modelName,
          duration: Date.now() - startTime,
          tokens: result.usage ? {
            input: result.usage.input_tokens,
            output: result.usage.output_tokens
          } : undefined,
          error: result.isError ? result.result : undefined
        },
        proposedEdits,
        resultEvent
      };
    } catch (err: unknown) {
      const error = err as Error;
      const modelName = model ? `claude/${model}` : 'claude';
      return {
        response: {
          content: '',
          model: modelName,
          duration: Date.now() - startTime,
          error: error.message
        },
        proposedEdits: [],
        resultEvent: null
      };
    }
  },

  /**
   * Structured extraction with JSON schema
   * Returns both text result and parsed structured_output
   *
   * @example
   * const result = await claudeAdapter.extract<{answer: string}>(
   *   "What is the capital of France?",
   *   { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] }
   * );
   * console.log(result.structured_output?.answer); // "Paris"
   */
  async extract<T>(
    prompt: string,
    schema: object,
    options?: ClaudeRunOptions
  ): Promise<StructuredResult<T>> {
    const config = getConfig();
    const startTime = Date.now();
    const model = options?.model ?? config.adapters.claude.model ?? 'haiku';

    const args = buildClaudeArgs({
      prompt,
      model,
      disableTools: options?.disableTools ?? true,
      jsonSchema: schema,
      outputFormat: 'json', // JSON output for structured extraction
      noSessionPersistence: options?.noSessionPersistence ?? true,
    });

    const { stdout, stderr } = await execa(
      config.adapters.claude.path,
      args,
      {
        timeout: config.timeout,
        cancelSignal: options?.signal,
        reject: false,
        stdin: 'ignore'
      }
    );

    if (stderr && !stdout) {
      throw new Error(stderr);
    }

    try {
      const parsed = JSON.parse(stdout);
      return {
        result: parsed.result || '',
        structured_output: parsed.structured_output as T,
        total_cost_usd: parsed.total_cost_usd || 0,
        usage: parsed.usage || { input_tokens: 0, output_tokens: 0 },
        session_id: parsed.session_id || '',
        duration_ms: Date.now() - startTime,
      };
    } catch {
      throw new Error(`Failed to parse JSON response: ${stdout.slice(0, 200)}`);
    }
  },

  /**
   * Autonomous execution with full tool access and permission bypass
   * Use for CI/CD pipelines and trusted automation
   *
   * @example
   * const result = await claudeAdapter.autonomous(
   *   "Fix the failing tests in src/lib/",
   *   { tools: "Bash,Read,Write,Edit,Glob,Grep" }
   * );
   */
  async autonomous(
    task: string,
    options?: ClaudeRunOptions
  ): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();
    const model = options?.model ?? config.adapters.claude.model ?? 'sonnet';

    const args = buildClaudeArgs({
      prompt: task,
      model,
      disableTools: false,
      tools: options?.tools ?? 'Bash,Read,Write,Edit,Glob,Grep',
      permissionMode: 'bypassPermissions',
      noSessionPersistence: options?.noSessionPersistence ?? true,
      fallbackModel: options?.fallbackModel ?? 'haiku',
      appendSystemPrompt: options?.appendSystemPrompt,
      outputFormat: 'stream-json',
    });

    const { stdout, stderr } = await execa(
      config.adapters.claude.path,
      args,
      {
        timeout: options?.timeout ?? config.timeout,
        cancelSignal: options?.signal,
        reject: false,
        stdin: 'ignore'
      }
    );

    const modelName = model ? `claude/${model}` : 'claude';

    if (stderr && !stdout) {
      return {
        content: '',
        model: modelName,
        duration: Date.now() - startTime,
        error: stderr
      };
    }

    // Parse stream-json response
    const parser = new StreamParser();
    if (options?.onToolEvent) {
      parser.onEvent(options.onToolEvent);
    }
    parser.parseAll(stdout);

    const resultEvent = parser.getResult();
    const result: ResultEvent = resultEvent ?? {
      type: 'result',
      subtype: 'success',
      result: '',
      isError: false
    };

    return {
      content: result.result,
      model: modelName,
      duration: Date.now() - startTime,
      tokens: result.usage ? {
        input: result.usage.input_tokens,
        output: result.usage.output_tokens
      } : undefined,
      error: result.isError ? result.result : undefined
    };
  },

  /**
   * Multi-turn chat with session persistence
   * Pass same sessionId to maintain conversation context
   *
   * @example
   * const session = crypto.randomUUID();
   * await claudeAdapter.chat("My name is Alice", session);
   * const response = await claudeAdapter.chat("What's my name?", session);
   */
  async chat(
    prompt: string,
    sessionId?: string,
    options?: ClaudeRunOptions
  ): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();
    const model = options?.model ?? config.adapters.claude.model;

    const args = buildClaudeArgs({
      prompt,
      model,
      disableTools: options?.disableTools ?? true,
      sessionId,
      continueSession: !!sessionId && options?.continueSession,
      appendSystemPrompt: options?.appendSystemPrompt,
      outputFormat: 'stream-json',
    });

    const { stdout, stderr } = await execa(
      config.adapters.claude.path,
      args,
      {
        timeout: config.timeout,
        cancelSignal: options?.signal,
        reject: false,
        stdin: 'ignore'
      }
    );

    const modelName = model ? `claude/${model}` : 'claude';

    if (stderr && !stdout) {
      return {
        content: '',
        model: modelName,
        duration: Date.now() - startTime,
        error: stderr
      };
    }

    const parser = new StreamParser();
    if (options?.onToolEvent) {
      parser.onEvent(options.onToolEvent);
    }
    parser.parseAll(stdout);

    const resultEvent = parser.getResult();
    const result: ResultEvent = resultEvent ?? {
      type: 'result',
      subtype: 'success',
      result: '',
      isError: false
    };

    return {
      content: result.result,
      model: modelName,
      duration: Date.now() - startTime,
      tokens: result.usage ? {
        input: result.usage.input_tokens,
        output: result.usage.output_tokens
      } : undefined,
      error: result.isError ? result.result : undefined
    };
  },

  /**
   * Spawn a custom agent from .claude/agents/
   * Returns the child process for streaming/monitoring
   *
   * @example
   * const proc = claudeAdapter.spawnAgent('ui-components-agent', 'Build the status bar');
   * proc.stdout.on('data', (chunk) => console.log(chunk.toString()));
   */
  spawnAgent(
    agentName: string,
    task: string,
    options?: ClaudeRunOptions
  ): ExecaProcess {
    const config = getConfig();

    const args: string[] = ['--agent', agentName];

    if (options?.model) {
      args.push('--model', options.model);
    }

    // For streaming output
    args.push('--output-format', 'stream-json', '--verbose');

    // Permission mode
    if (options?.permissionMode === 'bypassPermissions') {
      args.push('--permission-mode', 'bypassPermissions');
    }

    // Session management
    if (options?.noSessionPersistence) {
      args.push('--no-session-persistence');
    }

    // The task/prompt
    args.push(task);

    return execa(config.adapters.claude.path, args, {
      timeout: options?.timeout ?? config.timeout,
      cancelSignal: options?.signal,
      reject: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }
};
