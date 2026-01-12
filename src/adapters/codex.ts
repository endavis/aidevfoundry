import { execa } from 'execa';
import {
  SessionState,
  type Adapter,
  type ModelResponse,
  type RunOptions,
  type InteractiveSession,
  type InteractiveSessionOptions,
  type PromptEvent,
} from '../lib/types';
import { getConfig } from '../lib/config';
// Direct imports to avoid circular dependency through responder.ts
import { getSessionManager, type ManagedSession } from '../interactive/session-manager';
import { CODEX_PATTERNS, PromptDetector } from '../interactive/prompt-detector';
import { detectVersion } from '../interactive/version-detector';

/**
 * Interactive session options for Codex CLI
 */
export interface CodexInteractiveOptions extends InteractiveSessionOptions {
  /** Model to use */
  model?: string;
  /** Sandbox mode: 'workspace-read' | 'workspace-write' | 'full' */
  sandbox?: 'workspace-read' | 'workspace-write' | 'full';
  /** Skip git repo check */
  skipGitRepoCheck?: boolean;
}

/**
 * Codex interactive session wrapper
 */
class CodexInteractiveSession implements InteractiveSession {
  readonly id: string;
  readonly tool = 'codex';
  readonly createdAt: number;
  version?: string;

  private managedSession: ManagedSession;
  private _state: SessionState = SessionState.IDLE;

  constructor(managed: ManagedSession, version?: string) {
    this.managedSession = managed;
    this.id = managed.id;
    this.createdAt = Date.now();
    this.version = version;
  }

  get state(): SessionState {
    return this._state;
  }

  async send(input: string): Promise<void> {
    await this.managedSession.send(input);
  }

  onOutput(callback: (chunk: string) => void): () => void {
    this.managedSession.on('output', callback);
    return () => this.managedSession.off('output', callback);
  }

  onPrompt(callback: (prompt: PromptEvent) => void): () => void {
    this.managedSession.on('prompt', callback);
    return () => this.managedSession.off('prompt', callback);
  }

  async close(reason?: string): Promise<void> {
    await this.managedSession.close(reason);
    this._state = SessionState.CLOSED;
  }
}

export const codexAdapter: Adapter & {
  supportsInteractive: true;
  startInteractive: (options?: CodexInteractiveOptions) => Promise<InteractiveSession>;
  parsePrompt: (buffer: string) => PromptEvent | null;
} = {
  name: 'codex',
  supportsInteractive: true,

  async isAvailable(): Promise<boolean> {
    const config = getConfig();
    if (!config.adapters.codex.enabled) return false;

    try {
      const command = process.platform === 'win32' ? 'where' : 'which';
      await execa(command, [config.adapters.codex.path]);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Start an interactive Codex CLI session
   *
   * The session runs Codex in interactive mode via PTY, allowing
   * real-time interaction with approval prompts for shell commands.
   *
   * @example
   * const session = await codexAdapter.startInteractive({ sandbox: 'workspace-write' });
   * session.onPrompt((prompt) => {
   *   if (prompt.type === 'permission') {
   *     session.send('a'); // Approve
   *   }
   * });
   */
  async startInteractive(options?: CodexInteractiveOptions): Promise<InteractiveSession> {
    const config = getConfig();

    // Detect version
    const versionResult = await detectVersion('codex');
    if (versionResult.warning) {
      console.warn(`[codex] ${versionResult.warning}`);
    }

    // Build command args for interactive mode
    const args: string[] = [];

    // Sandbox mode - defaults to workspace-write for interactive
    const sandbox = options?.sandbox ?? 'workspace-write';
    args.push('--sandbox', sandbox);

    // Model selection
    const model = options?.model ?? config.adapters.codex.model;
    if (model) {
      args.push('-m', model);
    }

    // Skip git repo check
    if (options?.skipGitRepoCheck !== false) {
      args.push('--skip-git-repo-check');
    }

    // Initial prompt if provided
    if (options?.initialPrompt) {
      args.push(options.initialPrompt);
    }

    // Create managed session
    const sessionManager = getSessionManager();
    const managed = await sessionManager.create({
      tool: 'codex',
      command: config.adapters.codex.path,
      args,
      cwd: options?.cwd ?? process.cwd(),
    });

    // Check for dangerous flags that bypass approvals
    if (args.includes('--dangerously-bypass-approvals-and-sandbox')) {
      console.warn(
        '[codex] WARNING: Running with approval bypass. ' +
        'No approval prompts will fire - output monitoring only.'
      );
    }

    // Warn about full sandbox mode
    if (sandbox === 'full') {
      console.warn(
        '[codex] WARNING: Running with full sandbox (unrestricted access). ' +
        'Exercise caution with approval decisions.'
      );
    }

    return new CodexInteractiveSession(managed, versionResult.version?.raw);
  },

  /**
   * Parse Codex-specific prompts from buffer
   */
  parsePrompt(buffer: string): PromptEvent | null {
    const detector = new PromptDetector();
    detector.setTool('codex');
    detector.addOutput(buffer);
    return detector.detect();
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();
    const model = options?.model ?? config.adapters.codex.model;

    try {
      // codex exec for non-interactive mode
      // --skip-git-repo-check allows running outside git repos
      // --json for JSONL output with token usage
      // -m for model selection
      const args = ['exec', '--skip-git-repo-check', '--json'];

      // For agentic mode: use workspace-write so Codex is willing to use tools
      // PuzldAI's tool system will control what actually gets executed
      // For non-agentic mode: allow native Codex tools to work
      args.push('--sandbox', 'workspace-write');

      if (model) {
        args.push('-m', model);
      }
      args.push(prompt);

      const { stdout, stderr } = await execa(
        config.adapters.codex.path,
        args,
        {
          timeout: config.timeout,
          cancelSignal: options?.signal,
          reject: false,
          stdin: 'ignore'
        }
      );

      const modelName = model ? `codex/${model}` : 'codex';

      if (stderr && !stdout) {
        return {
          content: '',
          model: modelName,
          duration: Date.now() - startTime,
          error: stderr
        };
      }

      // Parse JSONL output - each line is a separate JSON object
      try {
        const lines = stdout.trim().split('\n');
        const contentParts: string[] = [];
        let inputTokens = 0;
        let outputTokens = 0;

        for (const line of lines) {
          try {
            const json = JSON.parse(line);

            // Extract agent message content (accumulate all parts)
            if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
              const text = json.item.text;
              if (text) {
                contentParts.push(text);
              }
            }

            // Extract token usage from turn.completed (accumulate all turns)
            if (json.type === 'turn.completed' && json.usage) {
              inputTokens += json.usage.input_tokens || 0;
              outputTokens += json.usage.output_tokens || 0;
            }
          } catch (lineErr) {
            // Skip malformed JSON lines but continue parsing
            if (config.logLevel === 'debug') {
              console.warn(`[codex] Failed to parse JSONL line: ${(lineErr as Error).message}`);
            }
          }
        }

        // Join all content parts
        const content = contentParts.join('\n');

        return {
          content,
          model: modelName,
          duration: Date.now() - startTime,
          tokens: (inputTokens || outputTokens) ? {
            input: inputTokens,
            output: outputTokens
          } : undefined
        };
      } catch {
        // Fallback if JSONL parsing completely fails
        return {
          content: stdout || '',
          model: modelName,
          duration: Date.now() - startTime
        };
      }
    } catch (err: unknown) {
      const error = err as Error;
      const modelName = model ? `codex/${model}` : 'codex';
      return {
        content: '',
        model: modelName,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }
};
