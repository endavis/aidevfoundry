/**
 * Interactive CLI Session Module
 *
 * Provides the ability for pk-puzldai to act as a "user" when
 * interacting with CLI AI tools in interactive/conversation mode.
 *
 * Example: When running `gemini -i "prompt"`, pk-puzldai can
 * automatically respond to follow-up questions, verification
 * prompts, and keep the conversation going until the task is complete.
 */

export {
  InteractiveSession,
  runInteractiveSession,
} from './session';

export {
  generateResponse,
  detectPromptType,
  extractChoices,
} from './responder';

export {
  CLI_TOOL_CONFIGS,
  type CLIToolConfig,
  type DetectedPrompt,
  type GeneratedResponse,
  type InteractiveSessionConfig,
  type InteractiveSessionResult,
  type InteractiveSessionState,
  type ResponderOptions,
} from './types';
