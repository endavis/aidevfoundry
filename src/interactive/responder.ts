/**
 * Interactive Session AI Responder
 *
 * Uses an AI model to generate appropriate responses to prompts
 * from CLI tools based on the plan context and conversation history.
 */

import { adapters, runOpenRouter } from '../adapters';
import type { AgentName } from '../executor/types';
import type {
  DetectedPrompt,
  GeneratedResponse,
  ResponderOptions,
} from './types';

/**
 * Build the system prompt for the responder
 */
function buildResponderPrompt(options: ResponderOptions): string {
  const historyContext = options.history?.length
    ? `\n\nPrevious interactions:\n${options.history
        .map(
          (h, i) =>
            `[${i + 1}] Prompt: "${h.prompt.text}"\n    Response: "${h.response.response}"`
        )
        .join('\n')}`
    : '';

  const outputContext = options.outputBuffer
    ? `\n\nRecent output from the CLI tool:\n\`\`\`\n${options.outputBuffer.slice(-2000)}\n\`\`\``
    : '';

  return `You are acting as a smart user interacting with a CLI AI tool.
Your goal is to help accomplish the following plan:

<plan>
${options.planContext}
</plan>

The CLI tool has presented you with a prompt or question. You need to provide an appropriate response that advances the plan toward completion.
${historyContext}
${outputContext}

Current prompt from the CLI tool:
Type: ${options.prompt.type}
Text: "${options.prompt.text}"
${options.prompt.choices ? `Available choices: ${options.prompt.choices.join(', ')}` : ''}

Instructions:
1. Analyze the prompt and determine what the CLI tool is asking for
2. Consider the plan context and what response would best advance the goal
3. For yes/no questions, answer based on what advances the plan
4. For verification prompts (like confirming file changes), approve if it aligns with the plan
5. For input requests, provide concise, focused input
6. For choices, select the option most aligned with the plan

Respond in this JSON format:
{
  "response": "your response text to send to the CLI",
  "reasoning": "brief explanation of why this response",
  "shouldEnd": false,
  "confidence": 0.9
}

Important:
- Keep responses concise and direct
- For yes/no: respond with just "y" or "n" or "yes" or "no"
- For confirmations: respond with "y" or "yes" to proceed, "n" or "no" to abort
- If the CLI seems to have completed the task, set shouldEnd: true
- Only return valid JSON, no other text`;
}

/**
 * Parse the AI response into a GeneratedResponse
 */
function parseResponderOutput(output: string): GeneratedResponse {
  try {
    // Try to extract JSON from the output
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        response: parsed.response || '',
        reasoning: parsed.reasoning,
        shouldEnd: parsed.shouldEnd || false,
        confidence: parsed.confidence ?? 0.8,
      };
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: treat the entire output as the response
  return {
    response: output.trim().split('\n')[0], // Just take the first line
    reasoning: 'Fallback parsing - using first line of output',
    shouldEnd: false,
    confidence: 0.5,
  };
}

/**
 * Ensure response is non-empty, falling back to heuristics if needed
 */
function ensureNonEmptyResponse(
  response: GeneratedResponse,
  prompt: DetectedPrompt
): GeneratedResponse {
  if (!response.response || !response.response.trim()) {
    return {
      ...generateHeuristicResponse(prompt),
      reasoning: 'Fallback after empty responder output',
    };
  }
  return response;
}

/**
 * Generate a response to a CLI prompt using AI
 */
export async function generateResponse(
  options: ResponderOptions
): Promise<GeneratedResponse> {
  const prompt = buildResponderPrompt(options);

  // Try OpenRouter first (fast and cheap with Devstral)
  try {
    const orResult = await runOpenRouter(prompt);

    if (!orResult.error && orResult.content) {
      return ensureNonEmptyResponse(parseResponderOutput(orResult.content), options.prompt);
    }
  } catch {
    // Fall through to adapter fallback
  }

  // Fallback to specified adapter or ollama
  const agentName = options.agent || 'ollama';
  const adapter = adapters[agentName];

  if (!adapter) {
    return generateHeuristicResponse(options.prompt);
  }

  const isAvailable = await adapter.isAvailable();
  if (!isAvailable) {
    return generateHeuristicResponse(options.prompt);
  }

  try {
    const result = await adapter.run(prompt, {
      disableTools: true,
      model: agentName === 'ollama' ? 'llama3.2' : undefined,
    });

    if (result.error || !result.content) {
      return generateHeuristicResponse(options.prompt);
    }

    return ensureNonEmptyResponse(parseResponderOutput(result.content), options.prompt);
  } catch {
    return generateHeuristicResponse(options.prompt);
  }
}

/**
 * Generate a response using simple heuristics when AI is not available
 */
export function generateHeuristicResponse(prompt: DetectedPrompt): GeneratedResponse {
  const text = prompt.text.toLowerCase();

  // Claude-specific permission patterns (Allow Read, Allow Write, Allow Edit, etc.)
  if (
    text.includes('allow read') ||
    text.includes('allow write') ||
    text.includes('allow edit') ||
    text.includes('allow bash') ||
    text.includes('allow execute') ||
    text.includes('allow this') ||
    text.includes('allow all') ||
    text.includes('allow in directory')
  ) {
    return {
      response: 'y',
      reasoning: 'Heuristic: approving Claude permission request',
      shouldEnd: false,
      confidence: 0.85,
    };
  }

  // Claude-specific file operation prompts
  if (
    text.includes('create file') ||
    text.includes('modify file') ||
    text.includes('delete file') ||
    text.includes('overwrite') ||
    text.includes('run command') ||
    text.includes('execute command')
  ) {
    return {
      response: 'y',
      reasoning: 'Heuristic: approving file/command operation',
      shouldEnd: false,
      confidence: 0.8,
    };
  }

  // Yes/No detection
  if (
    text.includes('(y/n)') ||
    text.includes('[y/n]') ||
    text.includes('yes or no') ||
    text.includes('continue?') ||
    text.includes('proceed?') ||
    text.includes('confirm')
  ) {
    // Default to yes for most confirmations
    return {
      response: 'y',
      reasoning: 'Heuristic: confirming to proceed with operation',
      shouldEnd: false,
      confidence: 0.7,
    };
  }

  // Choice detection
  if (prompt.choices && prompt.choices.length > 0) {
    return {
      response: prompt.choices[0],
      reasoning: 'Heuristic: selecting first available choice',
      shouldEnd: false,
      confidence: 0.5,
    };
  }

  // Verification/approval
  if (
    text.includes('approve') ||
    text.includes('accept') ||
    text.includes('allow')
  ) {
    return {
      response: 'yes',
      reasoning: 'Heuristic: approving requested action',
      shouldEnd: false,
      confidence: 0.7,
    };
  }

  // Abort/cancel detection
  if (text.includes('abort') || text.includes('cancel') || text.includes('error')) {
    return {
      response: 'n',
      reasoning: 'Heuristic: declining abort/cancel prompt',
      shouldEnd: false,
      confidence: 0.6,
    };
  }

  // Exit/done detection
  if (
    text.includes('goodbye') ||
    text.includes('complete') ||
    text.includes('finished') ||
    text.includes('done')
  ) {
    return {
      response: '',
      reasoning: 'Heuristic: session appears complete',
      shouldEnd: true,
      confidence: 0.8,
    };
  }

  // Default: continue with empty or generic response
  return {
    response: 'continue',
    reasoning: 'Heuristic: generic continuation response',
    shouldEnd: false,
    confidence: 0.3,
  };
}

/**
 * Detect the type of prompt based on text patterns
 */
export function detectPromptType(
  text: string
): DetectedPrompt['type'] {
  const lower = text.toLowerCase();

  // Yes/No confirmation
  if (
    lower.includes('(y/n)') ||
    lower.includes('[y/n]') ||
    lower.includes('yes/no') ||
    lower.includes('yes or no')
  ) {
    return 'confirmation';
  }

  // Verification prompts
  if (
    lower.includes('verify') ||
    lower.includes('confirm') ||
    lower.includes('approve') ||
    lower.includes('allow') ||
    lower.includes('accept')
  ) {
    return 'verification';
  }

  // Question prompts
  if (text.trim().endsWith('?')) {
    return 'question';
  }

  // Choice prompts (numbered or bulleted options)
  if (
    /\d+\.\s+\w/.test(text) ||
    /\[\d+\]/.test(text) ||
    /•\s+\w/.test(text)
  ) {
    return 'choice';
  }

  // Input prompts (ending with colon or >)
  if (text.trim().endsWith(':') || text.trim().endsWith('>')) {
    return 'input';
  }

  return 'unknown';
}

/**
 * Extract choices from a prompt text if present
 */
export function extractChoices(text: string): string[] | undefined {
  const choices: string[] = [];

  // Pattern 1: Numbered choices (1. Option, 2. Option)
  const numbered = text.match(/\d+\.\s+([^\n\d]+)/g);
  if (numbered) {
    numbered.forEach((match) => {
      const choice = match.replace(/^\d+\.\s+/, '').trim();
      if (choice) choices.push(choice);
    });
  }

  // Pattern 2: Bracketed choices ([1] Option, [2] Option)
  const bracketed = text.match(/\[\d+\]\s+([^\n\[]+)/g);
  if (bracketed) {
    bracketed.forEach((match) => {
      const choice = match.replace(/^\[\d+\]\s+/, '').trim();
      if (choice) choices.push(choice);
    });
  }

  // Pattern 3: Parenthetical options (a) Option, (b) Option
  const parens = text.match(/\([a-z]\)\s+([^\n\(]+)/gi);
  if (parens) {
    parens.forEach((match) => {
      const choice = match.replace(/^\([a-z]\)\s+/i, '').trim();
      if (choice) choices.push(choice);
    });
  }

  return choices.length > 0 ? choices : undefined;
}
