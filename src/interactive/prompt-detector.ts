/**
 * Prompt Detector
 *
 * Detects permission prompts, input requests, and confirmations
 * from CLI tool output using regex patterns.
 *
 * Features:
 * - Pattern registry keyed by CLI tool
 * - Buffer management for partial matches
 * - Debounce for streaming output
 * - Extensible pattern system
 */

import type { PromptEvent, PromptEventType } from '../lib/types';

/**
 * Pattern definition for detecting prompts
 */
export interface PromptPattern {
  /** Regex pattern to match */
  pattern: RegExp;
  /** Type of prompt this pattern detects */
  type: PromptEventType;
  /** Extract tool name from match groups */
  extractTool?: (match: RegExpMatchArray) => string | undefined;
  /** Extract message from match groups */
  extractMessage?: (match: RegExpMatchArray) => string;
  /** Extract options from match groups */
  extractOptions?: (match: RegExpMatchArray) => string[] | undefined;
  /** Risk level for permission prompts */
  riskLevel?: 'low' | 'medium' | 'high';
}

/**
 * Configuration for a CLI tool's prompt detection
 */
export interface ToolPatternConfig {
  /** Tool name */
  name: string;
  /** Patterns to match */
  patterns: PromptPattern[];
  /** Maximum buffer size before truncation */
  maxBufferSize?: number;
  /** Debounce time for partial matches (ms) */
  debounceMs?: number;
}

/**
 * Options for PromptDetector
 */
export interface PromptDetectorOptions {
  /** Tool-specific pattern configs */
  toolConfigs?: ToolPatternConfig[];
  /** Default max buffer size */
  maxBufferSize?: number;
  /** Default debounce time (ms) */
  debounceMs?: number;
}

// ============================================================================
// Default Patterns for Common CLI Tools
// ============================================================================

/**
 * Claude Code permission patterns
 */
export const CLAUDE_PATTERNS: PromptPattern[] = [
  // Tool permission prompt: Allow tool "bash" to execute command? [y/n/a]
  {
    pattern: /Allow (?:tool\s+)?"([^"]+)"[^?]*\?\s*\[([^\]]+)\]/i,
    type: 'permission',
    extractTool: (m) => m[1],
    extractOptions: (m) => m[2]?.split('/'),
    riskLevel: 'medium',
  },
  // Read permission: Allow reading file? [y/n]
  {
    pattern: /Allow\s+read(?:ing)?\s+(?:file\s+)?["']?([^"'\s?]+)["']?\s*\?\s*\[([^\]]+)\]/i,
    type: 'permission',
    extractTool: () => 'read',
    extractOptions: (m) => m[2]?.split('/'),
    riskLevel: 'low',
  },
  // Write permission: Allow writing to file? [y/n]
  {
    pattern: /Allow\s+writ(?:e|ing)\s+(?:to\s+)?(?:file\s+)?["']?([^"'\s?]+)["']?\s*\?\s*\[([^\]]+)\]/i,
    type: 'permission',
    extractTool: () => 'write',
    extractOptions: (m) => m[2]?.split('/'),
    riskLevel: 'high',
  },
  // Bash command permission
  {
    pattern: /(?:Execute|Run)\s+(?:command|bash)?\s*[:"]?\s*([^"?\n]+)\s*\??\s*\[([^\]]+)\]/i,
    type: 'permission',
    extractTool: () => 'bash',
    extractOptions: (m) => m[2]?.split('/'),
    riskLevel: 'high',
  },
  // Generic confirmation
  {
    pattern: /(?:Are you sure|Confirm|Continue)\s*\?\s*\[([^\]]+)\]/i,
    type: 'confirm',
    extractOptions: (m) => m[1]?.split('/'),
  },
  // Input prompt (ends with > or :)
  {
    pattern: /(?:^|\n)(?:>|>>|\$|#|:)\s*$/,
    type: 'input',
  },
];

/**
 * Codex CLI permission patterns
 */
export const CODEX_PATTERNS: PromptPattern[] = [
  // Shell command approval: ⚡ Allow shell command: ... [a]pprove / [d]eny
  {
    pattern: /(?:⚡|Allow)\s+(?:shell\s+)?command[:\s]+([^\n]+)\n?\s*\[([^\]]+)\]/i,
    type: 'permission',
    extractTool: () => 'bash',
    extractMessage: (m) => m[1]?.trim(),
    extractOptions: (m) => {
      const opts = m[2];
      if (!opts) return undefined;
      // Parse [a]pprove / [d]eny format
      const matches = opts.match(/\[([a-z])\][a-z]+/gi);
      return matches?.map((o) => o.replace(/[\[\]]/g, ''));
    },
    riskLevel: 'high',
  },
  // File write approval
  {
    pattern: /(?:Write|Create|Modify)\s+(?:file\s+)?["']?([^"'\n]+)["']?\s*\?\s*\[([^\]]+)\]/i,
    type: 'permission',
    extractTool: () => 'write',
    extractOptions: (m) => m[2]?.split('/').map((o) => o.trim()),
    riskLevel: 'high',
  },
  // Sandbox mode prompt
  {
    pattern: /sandbox\s+(?:mode\s+)?(?:is\s+)?(\w+)[.!]?\s*(?:proceed|continue)\s*\?\s*\[([^\]]+)\]/i,
    type: 'confirm',
    extractOptions: (m) => m[2]?.split('/'),
  },
];

/**
 * Factory (droid) CLI permission patterns
 */
export const FACTORY_PATTERNS: PromptPattern[] = [
  // Autonomy level prompt
  {
    pattern: /autonomy\s+(?:level\s+)?(?:is\s+)?(\w+)[.:]?\s*(?:allow|approve)\s*\?\s*\[([^\]]+)\]/i,
    type: 'permission',
    extractMessage: (m) => `Autonomy: ${m[1]}`,
    extractOptions: (m) => m[2]?.split('/'),
    riskLevel: 'medium',
  },
  // Generic approval prompt
  {
    pattern: /(?:Approve|Allow|Confirm)\s+([^?]+)\?\s*\[([^\]]+)\]/i,
    type: 'permission',
    extractMessage: (m) => m[1]?.trim(),
    extractOptions: (m) => m[2]?.split('/'),
  },
];

/**
 * Generic patterns that work with most CLI tools
 */
export const GENERIC_PATTERNS: PromptPattern[] = [
  // Yes/No prompt
  {
    pattern: /\(y(?:es)?\/n(?:o)?\)\s*:?\s*$/i,
    type: 'confirm',
    extractOptions: () => ['y', 'n'],
  },
  // Yes/No/All prompt
  {
    pattern: /\[y(?:es)?\/n(?:o)?\/a(?:ll)?\]\s*:?\s*$/i,
    type: 'confirm',
    extractOptions: () => ['y', 'n', 'a'],
  },
  // Press any key
  {
    pattern: /press\s+(?:any\s+)?(?:key|enter)\s+to\s+continue/i,
    type: 'input',
  },
  // Password/secret prompt
  {
    pattern: /(?:password|secret|token|key)\s*:\s*$/i,
    type: 'input',
  },
  // Error indicator
  {
    pattern: /(?:error|fatal|failed|exception)[:\s]+(.+?)(?:\n|$)/i,
    type: 'error',
    extractMessage: (m) => m[1]?.trim(),
  },
];

// ============================================================================
// Prompt Detector Class
// ============================================================================

/**
 * Prompt Detector
 *
 * Buffers CLI output and detects prompts requiring user interaction.
 */
export class PromptDetector {
  private buffer = '';
  private readonly maxBufferSize: number;
  private readonly debounceMs: number;
  private readonly patterns: Map<string, PromptPattern[]>;
  private currentTool: string = 'generic';
  private debounceTimer: NodeJS.Timeout | null = null;
  private lastDetection: PromptEvent | null = null;

  constructor(options: PromptDetectorOptions = {}) {
    this.maxBufferSize = options.maxBufferSize ?? 10000;
    this.debounceMs = options.debounceMs ?? 100;

    // Initialize pattern registry
    this.patterns = new Map();
    this.patterns.set('claude', CLAUDE_PATTERNS);
    this.patterns.set('codex', CODEX_PATTERNS);
    this.patterns.set('factory', FACTORY_PATTERNS);
    this.patterns.set('generic', GENERIC_PATTERNS);

    // Add custom tool configs
    if (options.toolConfigs) {
      for (const config of options.toolConfigs) {
        this.patterns.set(config.name, config.patterns);
      }
    }
  }

  /**
   * Set the current tool for pattern selection
   */
  setTool(tool: string): void {
    this.currentTool = tool;
  }

  /**
   * Get the current tool
   */
  getTool(): string {
    return this.currentTool;
  }

  /**
   * Add output to buffer and check for prompts
   */
  addOutput(chunk: string): PromptEvent | null {
    this.buffer += chunk;

    // Truncate buffer if too large
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.maxBufferSize);
    }

    return this.detect();
  }

  /**
   * Detect prompts in the current buffer
   */
  detect(): PromptEvent | null {
    // Get patterns for current tool + generic
    const toolPatterns = this.patterns.get(this.currentTool) ?? [];
    const genericPatterns = this.patterns.get('generic') ?? [];
    const allPatterns = [...toolPatterns, ...genericPatterns];

    // Check each pattern
    for (const pattern of allPatterns) {
      const match = this.buffer.match(pattern.pattern);
      if (match) {
        const event = this.createPromptEvent(pattern, match);

        // Avoid duplicate detections
        if (this.isDuplicate(event)) {
          continue;
        }

        this.lastDetection = event;
        return event;
      }
    }

    return null;
  }

  /**
   * Create a PromptEvent from a pattern match
   */
  private createPromptEvent(pattern: PromptPattern, match: RegExpMatchArray): PromptEvent {
    const message = pattern.extractMessage?.(match) ?? match[0];

    switch (pattern.type) {
      case 'permission':
        return {
          type: 'permission',
          tool: pattern.extractTool?.(match),
          message,
          riskLevel: pattern.riskLevel,
          options: pattern.extractOptions?.(match),
        };
      case 'input':
        return {
          type: 'input',
          message,
          hidden: /password|secret|token|key/i.test(message),
        };
      case 'confirm':
        return {
          type: 'confirm',
          message,
          defaultResponse: undefined,
        };
      case 'error':
        return {
          type: 'error',
          message,
          recoverable: true,
        };
    }
  }

  /**
   * Check if this event is a duplicate of the last detection
   */
  private isDuplicate(event: PromptEvent): boolean {
    if (!this.lastDetection) return false;
    return (
      this.lastDetection.type === event.type &&
      this.lastDetection.message === event.message
    );
  }

  /**
   * Clear the buffer
   */
  clearBuffer(): void {
    this.buffer = '';
    this.lastDetection = null;
  }

  /**
   * Get the current buffer contents
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * Get recent buffer (last N characters)
   */
  getRecentBuffer(chars: number = 500): string {
    return this.buffer.slice(-chars);
  }

  /**
   * Register custom patterns for a tool
   */
  registerPatterns(tool: string, patterns: PromptPattern[]): void {
    const existing = this.patterns.get(tool) ?? [];
    this.patterns.set(tool, [...existing, ...patterns]);
  }

  /**
   * Clear patterns for a tool
   */
  clearPatterns(tool: string): void {
    this.patterns.delete(tool);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a prompt detector for a specific CLI tool
 */
export function createPromptDetector(tool: string): PromptDetector {
  const detector = new PromptDetector();
  detector.setTool(tool);
  return detector;
}

/**
 * Test if a string contains any prompt pattern
 */
export function containsPrompt(text: string, tool: string = 'generic'): boolean {
  const detector = createPromptDetector(tool);
  detector.addOutput(text);
  return detector.detect() !== null;
}
