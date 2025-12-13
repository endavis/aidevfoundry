/**
 * Unified Message Format for Multi-Model Context Management
 *
 * Provider-agnostic message storage that translates at send time.
 * Enables seamless agent switching mid-conversation.
 */

/**
 * Content part types - matches what different providers support
 */
export type MessagePartType = 'text' | 'reasoning' | 'tool-call' | 'tool-result' | 'file';

/**
 * Base content part
 */
export interface BaseMessagePart {
  type: MessagePartType;
}

/**
 * Text content (standard responses)
 */
export interface TextPart extends BaseMessagePart {
  type: 'text';
  content: string;
}

/**
 * Reasoning content (Claude's extended thinking, o1's reasoning)
 */
export interface ReasoningPart extends BaseMessagePart {
  type: 'reasoning';
  content: string;
  signature?: string;  // For Claude's thinking blocks
}

/**
 * Tool call (function/tool invocation)
 */
export interface ToolCallPart extends BaseMessagePart {
  type: 'tool-call';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Tool result (response from tool execution)
 */
export interface ToolResultPart extends BaseMessagePart {
  type: 'tool-result';
  toolCallId: string;
  content: string;
  isError?: boolean;
}

/**
 * File attachment (images, documents)
 */
export interface FilePart extends BaseMessagePart {
  type: 'file';
  filename: string;
  mediaType: string;
  data: string;  // Base64 encoded
}

/**
 * Union of all message part types
 */
export type MessagePart = TextPart | ReasoningPart | ToolCallPart | ToolResultPart | FilePart;

/**
 * Message roles
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Unified message format - provider agnostic
 */
export interface UnifiedMessage {
  id?: number;
  sessionId: string;
  role: MessageRole;
  content: MessagePart[];
  agent?: string;        // Which agent produced this (claude, gemini, etc.)
  model?: string;        // Specific model used (sonnet, opus, etc.)
  tokens?: {
    input: number;
    output: number;
  };
  timestamp: number;
}

/**
 * Context limits per agent (in tokens)
 */
export const CONTEXT_LIMITS: Record<string, number> = {
  claude: 200000,
  gemini: 1000000,
  codex: 128000,
  mistral: 128000,
  ollama: 8000,  // Default, varies by model
};

/**
 * Get context limit for an agent
 */
export function getContextLimit(agent: string, model?: string): number {
  // Special cases for Ollama models with different context sizes
  if (agent === 'ollama' && model) {
    const ollamaLimits: Record<string, number> = {
      'llama3.2': 128000,
      'llama3.1': 128000,
      'llama3': 8000,
      'mistral': 32000,
      'codellama': 16000,
      'qwen2.5-coder': 32000,
    };
    return ollamaLimits[model] ?? CONTEXT_LIMITS.ollama;
  }

  return CONTEXT_LIMITS[agent] ?? 8000;
}

/**
 * Helper to create a text message
 */
export function createTextMessage(
  sessionId: string,
  role: MessageRole,
  content: string,
  agent?: string,
  model?: string
): UnifiedMessage {
  return {
    sessionId,
    role,
    content: [{ type: 'text', content }],
    agent,
    model,
    timestamp: Date.now(),
  };
}

/**
 * Helper to extract text content from a message
 */
export function getTextContent(message: UnifiedMessage): string {
  return message.content
    .filter((part): part is TextPart => part.type === 'text')
    .map(part => part.content)
    .join('\n');
}

/**
 * Helper to check if message has tool calls
 */
export function hasToolCalls(message: UnifiedMessage): boolean {
  return message.content.some(part => part.type === 'tool-call');
}

/**
 * Helper to get tool calls from a message
 */
export function getToolCalls(message: UnifiedMessage): ToolCallPart[] {
  return message.content.filter((part): part is ToolCallPart => part.type === 'tool-call');
}

/**
 * Helper to get tool results from a message
 */
export function getToolResults(message: UnifiedMessage): ToolResultPart[] {
  return message.content.filter((part): part is ToolResultPart => part.type === 'tool-result');
}

/**
 * Estimate tokens for a unified message
 */
export function estimateMessageTokens(message: UnifiedMessage): number {
  let tokens = 0;

  for (const part of message.content) {
    switch (part.type) {
      case 'text':
      case 'reasoning':
        // ~4 chars per token
        tokens += Math.ceil(part.content.length / 4);
        break;
      case 'tool-call':
        tokens += Math.ceil(JSON.stringify(part.input).length / 4) + 20;
        break;
      case 'tool-result':
        tokens += Math.ceil(part.content.length / 4) + 10;
        break;
      case 'file':
        // Images/files typically count as fixed tokens
        tokens += 1000;
        break;
    }
  }

  return tokens;
}

/**
 * Calculate total tokens for a conversation
 */
export function calculateConversationTokens(messages: UnifiedMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}
