/**
 * Interactive CLI Session Manager
 *
 * Manages interactive sessions with CLI tools where pk-puzldai
 * acts as the "user" responding to prompts and verification requests.
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { getConfig } from '../lib/config';
import type { AgentName } from '../executor/types';
import {
  generateResponse,
  detectPromptType,
  extractChoices,
} from './responder';
import {
  CLI_TOOL_CONFIGS,
  type CLIToolConfig,
  type DetectedPrompt,
  type GeneratedResponse,
  type InteractiveSessionConfig,
  type InteractiveSessionResult,
  type InteractiveSessionState,
} from './types';

/**
 * Interactive CLI Session
 *
 * Spawns a CLI tool in interactive mode and manages the conversation
 * by detecting prompts and generating appropriate responses.
 */
export class InteractiveSession extends EventEmitter {
  private process: ChildProcess | null = null;
  private state: InteractiveSessionState = 'initializing';
  private outputBuffer = '';
  private interactionCount = 0;
  private startTime = 0;
  private history: Array<{ prompt: DetectedPrompt; response: GeneratedResponse }> = [];
  private promptCheckTimer: NodeJS.Timeout | null = null;
  private sessionTimer: NodeJS.Timeout | null = null;
  private outputTimer: NodeJS.Timeout | null = null;
  private idleTimeouts = 0;
  private lastOutputTime = 0;
  private config: InteractiveSessionConfig;
  private toolConfig: CLIToolConfig;
  private resolveSession: ((result: InteractiveSessionResult) => void) | null = null;

  /**
   * Set state and notify callback
   */
  private setState(newState: InteractiveSessionState): void {
    this.state = newState;
    this.config.onStateChange?.(newState);
  }

  constructor(config: InteractiveSessionConfig) {
    super();
    this.config = {
      maxInteractions: 50,
      outputTimeout: 10000,  // 10 seconds
      sessionTimeout: 300000, // 5 minutes
      responderAgent: 'ollama',
      ...config,
    };

    // Get tool config or create default
    this.toolConfig = CLI_TOOL_CONFIGS[config.agent] || this.createDefaultToolConfig(config.agent);
  }

  /**
   * Create a default tool configuration for unknown agents
   */
  private createDefaultToolConfig(agent: AgentName): CLIToolConfig {
    const config = getConfig();
    const adapterConfig = config.adapters[agent as keyof typeof config.adapters];
    const command = (adapterConfig as any)?.path || agent;

    return {
      command,
      interactiveArgs: [],
      promptPatterns: [
        /^>\s*$/m,
        /\?\s*$/m,
        /:\s*$/m,
        /\(y\/n\)\s*$/im,
      ],
      endPatterns: [
        /goodbye/i,
        /complete/i,
        /done/i,
      ],
    };
  }

  /**
   * Start the interactive session
   */
  async run(): Promise<InteractiveSessionResult> {
    return new Promise((resolve) => {
      this.resolveSession = resolve;
      this.start();
    });
  }

  /**
   * Start the CLI process and begin interaction
   */
  private start(): void {
    this.startTime = Date.now();
    this.setState('running');
    this.lastOutputTime = Date.now();
    this.resetOutputTimeout();

    const appConfig = getConfig();
    const adapterConfig = appConfig.adapters[this.config.agent as keyof typeof appConfig.adapters];
    const command = (adapterConfig as any)?.path || this.toolConfig.command;

    // Build arguments: interactive args + model + initial prompt
    const args = [...this.toolConfig.interactiveArgs];

    if (this.config.model) {
      args.push('-m', this.config.model);
    }

    // Add initial prompt if not empty
    if (this.config.initialPrompt) {
      args.push(this.config.initialPrompt);
    }

    console.log(`[interactive] Starting ${command} with args:`, args);

    // Spawn the process with stdin/stdout pipes
    this.process = spawn(command, args, {
      cwd: this.config.cwd || process.cwd(),
      env: { ...process.env, ...this.config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    // Handle stdout
    this.process.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      this.outputBuffer += chunk;
      this.lastOutputTime = Date.now();
      this.idleTimeouts = 0;
      this.resetOutputTimeout();

      this.config.onOutput?.(chunk);
      this.emit('output', chunk);

      // Check for prompts after receiving output
      this.schedulePromptCheck();
    });

    // Handle stderr (often used for prompts/status)
    this.process.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      this.outputBuffer += chunk;
      this.lastOutputTime = Date.now();
      this.idleTimeouts = 0;
      this.resetOutputTimeout();

      this.config.onOutput?.(chunk);
      this.emit('output', chunk);

      this.schedulePromptCheck();
    });

    // Handle process exit
    this.process.on('exit', (code) => {
      this.cleanup();

      if (this.state !== 'completed' && this.state !== 'timeout' && this.state !== 'failed') {
        this.setState(code === 0 ? 'completed' : 'failed');
      }

      this.finishSession(code === 0 ? undefined : `Process exited with code ${code}`);
    });

    // Handle process error
    this.process.on('error', (err) => {
      this.cleanup();
      this.setState('failed');
      this.finishSession(err.message);
    });

    // Set session timeout
    this.sessionTimer = setTimeout(() => {
      this.cleanup();
      this.setState('timeout');
      this.finishSession('Session timeout');
    }, this.config.sessionTimeout!);

    // Initial prompt check after short delay
    setTimeout(() => this.checkForPrompt(), 500);
  }

  /**
   * Reset output timeout timer
   */
  private resetOutputTimeout(): void {
    if (!this.config.outputTimeout) return;
    if (this.outputTimer) {
      clearTimeout(this.outputTimer);
    }
    this.outputTimer = setTimeout(
      () => void this.handleOutputTimeout(),
      this.config.outputTimeout
    );
  }

  /**
   * Handle output timeout - try to respond or send keepalive
   */
  private async handleOutputTimeout(): Promise<void> {
    if (!this.config.outputTimeout) return;
    if (this.state === 'completed' || this.state === 'failed' || this.state === 'timeout') {
      return;
    }
    // If responding, just reset the timer
    if (this.state === 'responding') {
      this.resetOutputTimeout();
      return;
    }

    const idleTime = Date.now() - this.lastOutputTime;
    if (idleTime < this.config.outputTimeout) {
      this.resetOutputTimeout();
      return;
    }

    // Try to detect and respond to any pending prompt
    const promptText = this.extractPromptText();
    if (promptText && this.shouldRespond(promptText)) {
      try {
        await this.respondToPrompt(promptText);
      } catch (error) {
        this.setState('failed');
        this.finishSession(
          `Responder failed after output timeout: ${(error as Error).message}`
        );
        return;
      }
      this.resetOutputTimeout();
      return;
    }

    // Track consecutive idle timeouts
    this.idleTimeouts += 1;
    if (this.idleTimeouts >= 2) {
      this.setState('timeout');
      this.finishSession(
        `Output timeout after ${this.config.outputTimeout}ms without activity`
      );
      return;
    }

    // Send empty keepalive to potentially wake up the CLI
    try {
      await this.sendResponse('');
    } catch (error) {
      this.setState('failed');
      this.finishSession(
        `Failed to send keepalive: ${(error as Error).message}`
      );
      return;
    }
    this.resetOutputTimeout();
  }

  /**
   * Schedule a prompt check after output settles
   */
  private schedulePromptCheck(): void {
    if (this.promptCheckTimer) {
      clearTimeout(this.promptCheckTimer);
    }

    // Wait for output to settle before checking for prompts
    this.promptCheckTimer = setTimeout(() => {
      this.checkForPrompt();
    }, 500);
  }

  /**
   * Check if the output contains a prompt requiring response
   */
  private async checkForPrompt(): Promise<void> {
    if (this.state !== 'running' && this.state !== 'waiting_for_input') {
      return;
    }

    // Check for end patterns first
    for (const pattern of this.toolConfig.endPatterns) {
      if (pattern.test(this.outputBuffer)) {
        console.log('[interactive] Detected end pattern, completing session');
        this.setState('completed');
        this.finishSession();
        return;
      }
    }

    // Check for prompt patterns
    const customPatterns = this.config.promptPatterns || [];
    const allPatterns = [...this.toolConfig.promptPatterns, ...customPatterns];

    for (const pattern of allPatterns) {
      const match = this.outputBuffer.match(pattern);
      if (match) {
        // Extract the prompt text (last few lines before the pattern)
        const promptText = this.extractPromptText();

        if (promptText && this.shouldRespond(promptText)) {
          await this.respondToPrompt(promptText);
          return;
        }
      }
    }

    // Check if output has been idle too long (might be waiting)
    const idleTime = Date.now() - this.lastOutputTime;
    if (idleTime > 2000 && this.outputBuffer.length > 0) {
      const promptText = this.extractPromptText();
      if (promptText && this.shouldRespond(promptText)) {
        console.log('[interactive] Output idle, attempting response');
        await this.respondToPrompt(promptText);
      }
    }
  }

  /**
   * Extract the most recent prompt text from the output buffer
   */
  private extractPromptText(): string {
    // Get the last chunk of output that might contain a prompt
    const lines = this.outputBuffer.split('\n');
    const recentLines = lines.slice(-10).filter(l => l.trim());

    // Join recent lines and find the likely prompt
    return recentLines.join('\n').trim();
  }

  /**
   * Determine if we should respond to this prompt
   */
  private shouldRespond(promptText: string): boolean {
    // Don't respond if we're at max interactions
    if (this.interactionCount >= this.config.maxInteractions!) {
      return false;
    }

    // Don't respond to empty prompts
    if (!promptText || promptText.length < 2) {
      return false;
    }

    // Don't respond if we just responded to the same thing
    if (this.history.length > 0) {
      const lastPrompt = this.history[this.history.length - 1].prompt.text;
      if (promptText === lastPrompt) {
        return false;
      }
    }

    return true;
  }

  /**
   * Generate and send a response to a detected prompt
   */
  private async respondToPrompt(promptText: string): Promise<void> {
    if (this.state !== 'running' && this.state !== 'waiting_for_input') {
      return;
    }

    this.setState('responding');

    // Detect prompt type and extract choices
    const promptType = detectPromptType(promptText);
    const choices = extractChoices(promptText);

    const prompt: DetectedPrompt = {
      text: promptText,
      type: promptType,
      choices,
      isFinal: false,
      timestamp: Date.now(),
    };

    console.log(`[interactive] Detected ${promptType} prompt: "${promptText.slice(0, 100)}..."`);

    // Generate response using AI
    const response = await generateResponse({
      planContext: this.config.planContext,
      prompt,
      history: this.history,
      outputBuffer: this.outputBuffer,
      agent: this.config.responderAgent,
    });

    console.log(`[interactive] Responding: "${response.response}" (confidence: ${response.confidence})`);

    // Record the interaction
    this.history.push({ prompt, response });
    this.interactionCount++;

    // Notify callback
    this.config.onInteraction?.(prompt, response);
    this.emit('interaction', prompt, response);

    // Check if we should end
    if (response.shouldEnd) {
      this.setState('completed');
      this.finishSession();
      return;
    }

    // Send the response
    await this.sendResponse(response.response);

    // Clear the buffer after responding (keep last bit for context)
    this.outputBuffer = this.outputBuffer.slice(-500);
    this.setState('running');
  }

  /**
   * Send a response to the CLI process
   */
  private async sendResponse(text: string): Promise<void> {
    if (!this.process?.stdin?.writable) {
      console.warn('[interactive] Cannot write to stdin - not writable');
      return;
    }

    // Format response if needed
    let formattedResponse = text;
    if (this.toolConfig.formatResponse) {
      formattedResponse = this.toolConfig.formatResponse(text);
    } else {
      // Ensure newline at end
      if (!formattedResponse.endsWith('\n')) {
        formattedResponse += '\n';
      }
    }

    console.log(`[interactive] Sending: "${formattedResponse.trim()}"`);

    return new Promise((resolve, reject) => {
      this.process!.stdin!.write(formattedResponse, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Clean up timers and process
   */
  private cleanup(): void {
    if (this.promptCheckTimer) {
      clearTimeout(this.promptCheckTimer);
      this.promptCheckTimer = null;
    }

    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }

    if (this.outputTimer) {
      clearTimeout(this.outputTimer);
      this.outputTimer = null;
    }

    if (this.process && !this.process.killed) {
      this.process.kill();
    }
  }

  /**
   * Finish the session and return result
   */
  private finishSession(error?: string): void {
    this.cleanup();

    const result: InteractiveSessionResult = {
      success: this.state === 'completed' && !error,
      state: this.state,
      output: this.outputBuffer,
      interactions: this.interactionCount,
      duration: Date.now() - this.startTime,
      error,
      history: this.history,
    };

    this.emit('complete', result);

    if (this.resolveSession) {
      this.resolveSession(result);
      this.resolveSession = null;
    }
  }

  /**
   * Send a manual response (for external control)
   */
  async send(text: string): Promise<void> {
    await this.sendResponse(text);
  }

  /**
   * Abort the session
   */
  abort(): void {
    this.setState('failed');
    this.finishSession('Aborted by user');
  }

  /**
   * Get current state
   */
  getState(): InteractiveSessionState {
    return this.state;
  }

  /**
   * Get current output buffer
   */
  getOutput(): string {
    return this.outputBuffer;
  }
}

/**
 * Run an interactive session with a CLI tool
 *
 * This is the main entry point for interactive mode execution.
 *
 * @param config Session configuration
 * @returns Session result
 */
export async function runInteractiveSession(
  config: InteractiveSessionConfig
): Promise<InteractiveSessionResult> {
  const session = new InteractiveSession(config);
  return session.run();
}
