/**
 * Interactive CLI Session Module
 *
 * Provides the ability for pk-puzldai to act as a "user" when
 * interacting with CLI AI tools in interactive/conversation mode.
 *
 * Example: When running `gemini -i "prompt"`, pk-puzldai can
 * automatically respond to follow-up questions, verification
 * prompts, and keep the conversation going until the task is complete.
 *
 * Two modes available:
 * 1. Higher-level InteractiveSession with auto-response (session.ts)
 * 2. Lower-level PtySession for direct PTY control (pty-session.ts)
 */

// Higher-level session management with auto-response
export {
  InteractiveSession,
  runInteractiveSession,
} from './session';

export {
  generateResponse,
  detectPromptType,
  extractChoices,
} from './responder';

// Prompt detection with pattern registry
export {
  PromptDetector,
  createPromptDetector,
  containsPrompt,
  CLAUDE_PATTERNS,
  CODEX_PATTERNS,
  FACTORY_PATTERNS,
  GENERIC_PATTERNS,
  type PromptPattern,
  type ToolPatternConfig,
  type PromptDetectorOptions,
} from './prompt-detector';

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

// Lower-level PTY session wrapper with fallback to subprocess
export {
  PtySession,
  createPtySession,
  isPtyAvailable,
  getPtyLoadError,
  isConPtyAvailable,
  getDefaultShell,
  type PtySessionOptions,
  type PtySessionEvents,
} from './pty-session';

// Mock PTY for deterministic testing
export {
  MockPty,
  createClaudePermissionMock,
  createCodexPermissionMock,
  createTimeoutMock,
  createExitMock,
  createSpawnFailureMock,
  type MockResponse,
  type MockPtyOptions,
} from './mock-pty';

// Security: credential filtering
export {
  CredentialFilter,
  filterCredentials,
  containsCredentials,
  detectCredentialTypes,
  createCredentialFilter,
  type CredentialType,
  type CredentialPattern,
  type CredentialFilterOptions,
} from './security';

// Session management with concurrency limits
export {
  SessionManager,
  ManagedSession,
  getSessionManager,
  createManagedSession,
  type SessionMetadata,
  type SessionManagerConfig,
  type SessionRequest,
  type SessionManagerEvents,
} from './session-manager';
