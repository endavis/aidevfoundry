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
import { PromptDetector } from '../interactive/prompt-detector';
import { detectVersion } from '../interactive/version-detector';

/**
 * Factory AI (droid) CLI adapter
 * Integrates with Factory's CLI tool for autonomous AI-assisted development
 */

/**
 * Autonomy levels for Factory CLI
 */
export type FactoryAutonomy = 'read-only' | 'suggest' | 'auto-edit' | 'full';

/**
 * Interactive session options for Factory CLI
 */
export interface FactoryInteractiveOptions extends InteractiveSessionOptions {
  /** Model to use */
  model?: string;
  /** Autonomy level: 'read-only' | 'suggest' | 'auto-edit' | 'full' */
  autonomy?: FactoryAutonomy;
  /** Reasoning effort */
  reasoningEffort?: string;
  /** Skip permissions (DANGEROUS!) */
  skipPermissions?: boolean;
}

/**
 * Factory interactive session wrapper
 */
class FactoryInteractiveSession implements InteractiveSession {
  readonly id: string;
  readonly tool = 'factory';
  readonly createdAt: number;
  version?: string;

  private managedSession: ManagedSession;
  private _state: SessionState = SessionState.IDLE;
  private autonomyLevel: FactoryAutonomy;

  constructor(managed: ManagedSession, version?: string, autonomy: FactoryAutonomy = 'suggest') {
    this.managedSession = managed;
    this.id = managed.id;
    this.createdAt = Date.now();
    this.version = version;
    this.autonomyLevel = autonomy;
  }

  get state(): SessionState {
    return this._state;
  }

  /**
   * Check if this session will receive permission prompts
   */
  get willReceivePrompts(): boolean {
    // Full autonomy mode bypasses all permission prompts
    return this.autonomyLevel !== 'full';
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

export const factoryAdapter: Adapter & {
  supportsInteractive: true;
  startInteractive: (options?: FactoryInteractiveOptions) => Promise<InteractiveSession>;
  parsePrompt: (buffer: string) => PromptEvent | null;
} = {
  name: 'factory',
  supportsInteractive: true,

  async isAvailable(): Promise<boolean> {
    const config = getConfig();
    if (!config.adapters.factory?.enabled) return false;

    try {
      // Check if droid CLI is available
      const command = process.platform === 'win32' ? 'where' : 'which';
      await execa(command, [config.adapters.factory.path || 'droid']);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Start an interactive Factory (droid) CLI session
   *
   * The session runs Factory in interactive mode via PTY, allowing
   * real-time interaction with approval prompts.
   *
   * CRITICAL: When autonomy='full', no permission prompts will fire.
   * The session will operate in output-monitoring mode only.
   *
   * @example
   * const session = await factoryAdapter.startInteractive({ autonomy: 'suggest' });
   * session.onPrompt((prompt) => {
   *   if (prompt.type === 'permission') {
   *     session.send('y'); // Approve
   *   }
   * });
   */
  async startInteractive(options?: FactoryInteractiveOptions): Promise<InteractiveSession> {
    const config = getConfig();
    const factoryConfig = config.adapters.factory;

    // Detect version
    const versionResult = await detectVersion('factory');
    if (versionResult.warning) {
      console.warn(`[factory] ${versionResult.warning}`);
    }

    // Build command args for interactive mode (no 'exec' for interactive)
    const args: string[] = [];

    // Model selection
    const model = options?.model ?? factoryConfig?.model;
    if (model) {
      args.push('--model', model);
    }

    // Autonomy level - defaults to 'suggest' for interactive mode
    const autonomy = options?.autonomy ?? factoryConfig?.autonomy ?? 'suggest';
    if (autonomy && autonomy !== 'read-only') {
      args.push('--auto', autonomy);
    }

    // Reasoning effort
    if (options?.reasoningEffort ?? factoryConfig?.reasoningEffort) {
      args.push('--reasoning-effort', options?.reasoningEffort ?? factoryConfig?.reasoningEffort ?? '');
    }

    // Skip permissions (DANGEROUS!)
    if (options?.skipPermissions ?? factoryConfig?.skipPermissions) {
      args.push('--skip-permissions-unsafe');
      console.warn(
        '[factory] WARNING: Running with --skip-permissions-unsafe. ' +
        'No permission prompts will fire - output monitoring only.'
      );
    }

    // Initial prompt if provided
    if (options?.initialPrompt) {
      args.push(options.initialPrompt);
    }

    // Create managed session
    const sessionManager = getSessionManager();
    const managed = await sessionManager.create({
      tool: 'factory',
      command: factoryConfig?.path || 'droid',
      args,
      cwd: options?.cwd ?? factoryConfig?.cwd ?? process.cwd(),
    });

    // Warn about full autonomy mode - no prompts will fire
    if (autonomy === 'full') {
      console.warn(
        '[factory] WARNING: Running with autonomy=full. ' +
        'No permission prompts will fire - output monitoring only. ' +
        'Factory will autonomously make all decisions.'
      );
    }

    const session = new FactoryInteractiveSession(
      managed,
      versionResult.version?.raw,
      autonomy as FactoryAutonomy
    );

    // Log if this session won't receive prompts
    if (!session.willReceivePrompts) {
      console.warn('[factory] This session will NOT receive permission prompts.');
    }

    return session;
  },

  /**
   * Parse Factory-specific prompts from buffer
   */
  parsePrompt(buffer: string): PromptEvent | null {
    const detector = new PromptDetector();
    detector.setTool('factory');
    detector.addOutput(buffer);
    return detector.detect();
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();
    const factoryConfig = config.adapters.factory;
    const model = options?.model ?? factoryConfig?.model;

    try {
      const args: string[] = ['exec'];

      // Add model selection if specified
      if (model) {
        args.push('--model', model);
      }

      // Add autonomy level if specified
      // If not specified, no --auto flag = read-only (default behavior)
      const autonomy = factoryConfig?.autonomy;
      if (autonomy) {
        args.push('--auto', autonomy);
      }

      // Add reasoning effort if specified
      if (factoryConfig?.reasoningEffort) {
        args.push('--reasoning-effort', factoryConfig.reasoningEffort);
      }

      // Skip permissions if configured (dangerous!)
      if (factoryConfig?.skipPermissions) {
        args.push('--skip-permissions-unsafe');
      }

      // Set working directory if specified
      if (factoryConfig?.cwd) {
        args.push('--cwd', factoryConfig.cwd);
      }

      // Add output format for clean parsing
      args.push('--output-format', 'text');

      // Add the prompt
      args.push(prompt);

      const { stdout, stderr } = await execa(
        config.adapters.factory?.path || 'droid',
        args,
        {
          timeout: config.timeout,
          cancelSignal: options?.signal,
          reject: false,
          stdin: 'ignore'
        }
      );

      const modelName = model ? `factory/${model}` : 'factory/droid';

      if (stderr && !stdout) {
        return {
          content: '',
          model: modelName,
          duration: Date.now() - startTime,
          error: stderr
        };
      }

      // Factory droid outputs plain text responses
      return {
        content: stdout || '',
        model: modelName,
        duration: Date.now() - startTime
      };

    } catch (err: unknown) {
      const error = err as Error;
      const modelName = model ? `factory/${model}` : 'factory/droid';
      return {
        content: '',
        model: modelName,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }
};
