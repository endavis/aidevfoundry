/**
 * Provider Translation Layer
 *
 * Converts between unified message format and provider-specific formats.
 * Each provider has different requirements for message structure.
 */

import type {
  UnifiedMessage,
  MessagePart,
  TextPart,
  ToolResultPart,
  FilePart,
} from './unified-message';

/**
 * Provider-specific message formats
 */

// OpenAI/Codex format
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[];
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// Anthropic/Claude format
export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

// Ollama format (similar to OpenAI but simpler)
export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

// Gemini format
export interface GeminiMessage {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: unknown } }
  | { inlineData: { mimeType: string; data: string } };

/**
 * Translator interface
 */
export interface ProviderTranslator<T> {
  name: string;
  toProviderFormat(messages: UnifiedMessage[], systemPrompt?: string): T[];
  fromProviderResponse(response: unknown, sessionId: string): UnifiedMessage;
}

/**
 * OpenAI/Codex translator
 */
export const openaiTranslator: ProviderTranslator<OpenAIMessage> = {
  name: 'openai',

  toProviderFormat(messages: UnifiedMessage[], systemPrompt?: string): OpenAIMessage[] {
    const result: OpenAIMessage[] = [];

    // Add system prompt first
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      // Handle tool results separately (OpenAI uses role: 'tool')
      const toolResults = msg.content.filter((p): p is ToolResultPart => p.type === 'tool-result');
      for (const tr of toolResults) {
        result.push({
          role: 'tool',
          content: tr.content,
          tool_call_id: tr.toolCallId,
        });
      }

      // Skip if message only had tool results
      const otherParts = msg.content.filter(p => p.type !== 'tool-result');
      if (otherParts.length === 0) continue;

      const openaiMsg: OpenAIMessage = {
        role: msg.role === 'tool' ? 'assistant' : msg.role as 'system' | 'user' | 'assistant',
        content: '',
      };

      // Build content
      const contentParts: OpenAIContentPart[] = [];
      const toolCalls: OpenAIToolCall[] = [];

      for (const part of otherParts) {
        switch (part.type) {
          case 'text':
          case 'reasoning':
            contentParts.push({ type: 'text', text: part.content });
            break;
          case 'tool-call':
            toolCalls.push({
              id: part.id,
              type: 'function',
              function: {
                name: part.name,
                arguments: JSON.stringify(part.input),
              },
            });
            break;
          case 'file':
            if (part.mediaType.startsWith('image/')) {
              contentParts.push({
                type: 'image_url',
                image_url: { url: `data:${part.mediaType};base64,${part.data}` },
              });
            }
            break;
        }
      }

      // Set content
      if (contentParts.length === 1 && contentParts[0].type === 'text') {
        openaiMsg.content = contentParts[0].text!;
      } else if (contentParts.length > 0) {
        openaiMsg.content = contentParts;
      }

      // Add tool calls
      if (toolCalls.length > 0) {
        openaiMsg.tool_calls = toolCalls;
      }

      result.push(openaiMsg);
    }

    return result;
  },

  fromProviderResponse(response: unknown, sessionId: string): UnifiedMessage {
    const resp = response as { role?: string; content?: string; tool_calls?: OpenAIToolCall[] };
    const parts: MessagePart[] = [];

    if (resp.content) {
      parts.push({ type: 'text', content: resp.content });
    }

    if (resp.tool_calls) {
      for (const tc of resp.tool_calls) {
        parts.push({
          type: 'tool-call',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        });
      }
    }

    return {
      sessionId,
      role: 'assistant',
      content: parts,
      agent: 'codex',
      timestamp: Date.now(),
    };
  },
};

/**
 * Anthropic/Claude translator
 */
export const anthropicTranslator: ProviderTranslator<AnthropicMessage> = {
  name: 'anthropic',

  toProviderFormat(messages: UnifiedMessage[], _systemPrompt?: string): AnthropicMessage[] {
    // Note: Anthropic uses a separate 'system' field, not a message
    // System prompt should be passed separately to the API
    const result: AnthropicMessage[] = [];

    for (const msg of messages) {
      // Skip system messages (handled separately in Anthropic API)
      if (msg.role === 'system') continue;

      // Anthropic only has 'user' and 'assistant' roles
      // Tool results go inside user messages
      const role = msg.role === 'tool' ? 'user' : msg.role as 'user' | 'assistant';

      const contentBlocks: AnthropicContentBlock[] = [];

      for (const part of msg.content) {
        switch (part.type) {
          case 'text':
            contentBlocks.push({ type: 'text', text: part.content });
            break;
          case 'reasoning':
            contentBlocks.push({
              type: 'thinking',
              thinking: part.content,
              signature: part.signature,
            });
            break;
          case 'tool-call':
            contentBlocks.push({
              type: 'tool_use',
              id: part.id,
              name: part.name,
              input: part.input,
            });
            break;
          case 'tool-result':
            contentBlocks.push({
              type: 'tool_result',
              tool_use_id: part.toolCallId,
              content: part.content,
              is_error: part.isError,
            });
            break;
          case 'file':
            if (part.mediaType.startsWith('image/')) {
              contentBlocks.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: part.mediaType,
                  data: part.data,
                },
              });
            }
            break;
        }
      }

      if (contentBlocks.length > 0) {
        result.push({ role, content: contentBlocks });
      }
    }

    return result;
  },

  fromProviderResponse(response: unknown, sessionId: string): UnifiedMessage {
    const resp = response as { content?: AnthropicContentBlock[] };
    const parts: MessagePart[] = [];

    if (resp.content) {
      for (const block of resp.content) {
        switch (block.type) {
          case 'text':
            parts.push({ type: 'text', content: block.text });
            break;
          case 'thinking':
            parts.push({
              type: 'reasoning',
              content: block.thinking,
              signature: block.signature,
            });
            break;
          case 'tool_use':
            parts.push({
              type: 'tool-call',
              id: block.id,
              name: block.name,
              input: block.input,
            });
            break;
        }
      }
    }

    return {
      sessionId,
      role: 'assistant',
      content: parts,
      agent: 'claude',
      timestamp: Date.now(),
    };
  },
};

/**
 * Ollama translator
 */
export const ollamaTranslator: ProviderTranslator<OllamaMessage> = {
  name: 'ollama',

  toProviderFormat(messages: UnifiedMessage[], systemPrompt?: string): OllamaMessage[] {
    const result: OllamaMessage[] = [];

    // Add system prompt first
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      // Ollama is simpler - just text content
      const textParts = msg.content.filter((p): p is TextPart => p.type === 'text');
      const fileParts = msg.content.filter((p): p is FilePart => p.type === 'file');

      const content = textParts.map(p => p.content).join('\n');
      const images = fileParts
        .filter(p => p.mediaType.startsWith('image/'))
        .map(p => p.data);

      if (content || images.length > 0) {
        const ollamaMsg: OllamaMessage = {
          role: msg.role === 'tool' ? 'assistant' : msg.role as 'system' | 'user' | 'assistant',
          content: content || '(image)',
        };

        if (images.length > 0) {
          ollamaMsg.images = images;
        }

        result.push(ollamaMsg);
      }
    }

    return result;
  },

  fromProviderResponse(response: unknown, sessionId: string): UnifiedMessage {
    const resp = response as { message?: { content?: string } };
    const content = resp.message?.content ?? '';

    return {
      sessionId,
      role: 'assistant',
      content: [{ type: 'text', content }],
      agent: 'ollama',
      timestamp: Date.now(),
    };
  },
};

/**
 * Gemini translator
 */
export const geminiTranslator: ProviderTranslator<GeminiMessage> = {
  name: 'gemini',

  toProviderFormat(messages: UnifiedMessage[], systemPrompt?: string): GeminiMessage[] {
    const result: GeminiMessage[] = [];

    // Gemini uses 'user' for system prompts too (as first message)
    if (systemPrompt) {
      result.push({
        role: 'user',
        parts: [{ text: `System: ${systemPrompt}` }],
      });
      // Add empty model response to maintain alternation
      result.push({
        role: 'model',
        parts: [{ text: 'Understood.' }],
      });
    }

    for (const msg of messages) {
      // Gemini uses 'user' and 'model'
      const role = msg.role === 'assistant' ? 'model' : 'user';

      const parts: GeminiPart[] = [];

      for (const part of msg.content) {
        switch (part.type) {
          case 'text':
          case 'reasoning':
            parts.push({ text: part.content });
            break;
          case 'tool-call':
            parts.push({
              functionCall: {
                name: part.name,
                args: part.input,
              },
            });
            break;
          case 'tool-result':
            parts.push({
              functionResponse: {
                name: part.toolCallId,
                response: { result: part.content },
              },
            });
            break;
          case 'file':
            parts.push({
              inlineData: {
                mimeType: part.mediaType,
                data: part.data,
              },
            });
            break;
        }
      }

      if (parts.length > 0) {
        result.push({ role, parts });
      }
    }

    return result;
  },

  fromProviderResponse(response: unknown, sessionId: string): UnifiedMessage {
    const resp = response as { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> };
    const parts: MessagePart[] = [];

    const responseParts = resp.candidates?.[0]?.content?.parts ?? [];
    for (const part of responseParts) {
      if ('text' in part) {
        parts.push({ type: 'text', content: part.text });
      } else if ('functionCall' in part) {
        parts.push({
          type: 'tool-call',
          id: `gemini_${Date.now()}`,
          name: part.functionCall.name,
          input: part.functionCall.args,
        });
      }
    }

    return {
      sessionId,
      role: 'assistant',
      content: parts,
      agent: 'gemini',
      timestamp: Date.now(),
    };
  },
};

/**
 * Get translator for an agent
 */
export function getTranslator(agent: string): ProviderTranslator<unknown> {
  switch (agent) {
    case 'claude':
      return anthropicTranslator;
    case 'codex':
      return openaiTranslator;
    case 'gemini':
      return geminiTranslator;
    case 'ollama':
    case 'mistral':
    default:
      return ollamaTranslator;
  }
}

/**
 * Translate messages for a specific agent
 */
export function translateForAgent(
  messages: UnifiedMessage[],
  agent: string,
  systemPrompt?: string
): unknown[] {
  const translator = getTranslator(agent);
  return translator.toProviderFormat(messages, systemPrompt);
}
