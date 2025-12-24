// Agent loop - runs LLM with tools until completion

import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import { allTools, executeTools, executeTool } from './tools';
import type { Tool, ToolCall, ToolResult, AgentMessage } from './tools/types';
import { globSync } from 'glob';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import {
  type PermissionRequest,
  type PermissionResult,
  type PermissionHandler,
  permissionTracker
} from './tools/permissions';
import { isAbsolutePath, joinPaths, normalizePath } from '../lib/paths';
import { getContextLimit, type UnifiedMessage, getTextContent } from '../context/unified-message';
import { prepareContextForAgent } from '../context/context-manager';

const MAX_ITERATIONS = 20;

// Tools that require read permission
const READ_TOOLS = ['view', 'grep', 'glob'];
// Tools that require write permission
const WRITE_TOOLS = ['write', 'edit'];
// Tools that require execute permission
const EXEC_TOOLS = ['bash'];

// Tool name aliases - maps common LLM naming patterns to our tools
const TOOL_ALIASES: Record<string, string> = {
  // View/read aliases
  'read_file': 'view', 'read': 'view', 'cat': 'view', 'file_read': 'view',
  'view_file': 'view', 'get_file': 'view', 'open_file': 'view',
  // Glob aliases
  'find': 'glob', 'find_files': 'glob', 'list_files': 'glob', 'search_files': 'glob',
  'list_directory': 'glob', 'ls': 'glob',
  // Grep aliases
  'search': 'grep', 'search_content': 'grep', 'find_in_files': 'grep',
  'grep_search': 'grep', 'search_code': 'grep', 'search_file_content': 'grep',
  'searchfilecontent': 'grep', 'file_search': 'grep',
  // Bash aliases
  'shell': 'bash', 'run': 'bash', 'execute': 'bash', 'run_command': 'bash',
  'terminal': 'bash', 'cmd': 'bash', 'run_shell_command': 'bash', 'runshellcommand': 'bash',
  // Write aliases
  'write_file': 'write', 'create_file': 'write', 'file_write': 'write',
  'create': 'write', 'save_file': 'write', 'overwrite': 'write',
  // Edit aliases
  'update': 'edit', 'modify': 'edit', 'replace': 'edit', 'file_edit': 'edit',
  'edit_file': 'edit', 'patch': 'edit', 'str_replace': 'edit',
  'str_replace_editor': 'edit', 'text_editor': 'edit',
};

// Normalize tool name using aliases
function normalizeToolName(name: string): string {
  // Strip common prefixes (Gemini uses default_api:, others may use functions., etc.)
  let normalized = name;
  if (normalized.includes(':')) {
    normalized = normalized.split(':').pop() || normalized;
  }
  if (normalized.includes('.')) {
    normalized = normalized.split('.').pop() || normalized;
  }
  // Convert to lowercase for matching
  normalized = normalized.toLowerCase();
  return TOOL_ALIASES[normalized] || normalized;
}

export interface AgentLoopOptions extends RunOptions {
  /** Tools available to the agent (default: all tools) */
  tools?: Tool[];
  /** Working directory for tool execution */
  cwd?: string;
  /** Skip diff preview for all edits (user selected "allow all") */
  allowAllEdits?: boolean;
  /** Callback when tool is called (before permission check) */
  onToolCall?: (call: ToolCall) => void;
  /** Callback when tool returns result */
  onToolResult?: (result: ToolResult) => void;
  /** Callback for each iteration */
  onIteration?: (iteration: number, response: string) => void;
  /** Permission handler - called when tool needs permission */
  onPermissionRequest?: PermissionHandler;
  /** Callback when tool starts executing (after permission granted) */
  onToolStart?: (call: ToolCall) => void;
  /** Callback when tool finishes */
  onToolEnd?: (call: ToolCall, result: ToolResult) => void;
  /** Diff preview handler - called before write/edit execution (single file), return decision */
  onDiffPreview?: (preview: {
    filePath: string;
    operation: 'create' | 'edit' | 'overwrite';
    originalContent: string | null;
    newContent: string;
  }) => Promise<'yes' | 'yes-all' | 'no'>;
  /** Batch diff preview handler - called when multiple write/edit operations in one response */
  onBatchDiffPreview?: (previews: Array<{
    toolCallId: string;
    filePath: string;
    operation: 'create' | 'edit' | 'overwrite';
    originalContent: string | null;
    newContent: string;
  }>) => Promise<{ accepted: string[]; rejected: string[]; allowAll: boolean }>;
  /** Conversation history from previous messages (for multi-model context) - legacy format */
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string; agent?: string }>;
  /** Unified message history - preferred format, enables proper context management */
  unifiedHistory?: UnifiedMessage[];
  /** Callback when user selects "allow all edits" */
  onAllowAllEdits?: () => void;
}

export interface AgentLoopResult {
  content: string;
  model: string;
  iterations: number;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  tokens?: { input: number; output: number };
  duration?: number;
}

/**
 * Build system prompt based on adapter type
 */
function buildSystemPrompt(adapterName: string, projectFiles: string, toolDescriptions: string): string {
  // Base instructions shared by all adapters
  const baseInstructions = `# Current Project Files

You CAN see the project structure below. These are the files in the workspace:

${projectFiles}

(Use the 'view' tool to read file contents when needed)

# Available Tools

${toolDescriptions}`;

  // Adapter-specific prompts
  if (adapterName === 'mistral') {
    // Mistral needs very explicit instructions about text-based tool invocation
    return `You are a helpful assistant. You can have normal conversations AND help with coding tasks.

For casual messages (greetings, questions, chat), respond naturally without using tools.
For coding tasks, you invoke tools by OUTPUTTING special code blocks.

IMPORTANT: You do NOT have native/built-in tool access. Tools are invoked by writing \`\`\`tool code blocks in your response. The system parses your text output and executes tools for you.

${baseInstructions}

# How to Invoke Tools

Write a code block with the "tool" language tag:

\`\`\`tool
{"name": "view", "arguments": {"path": "README.md"}}
\`\`\`

The system reads your text, finds \`\`\`tool blocks, executes them, and returns results.

RULES:
1. OUTPUT the \`\`\`tool block as text - do not try to call functions
2. You cannot see file contents until you OUTPUT a view tool block
3. One tool per \`\`\`tool block, multiple blocks allowed
4. After outputting tool blocks, wait for results before continuing

Example - to read a file, OUTPUT this text:
\`\`\`tool
{"name": "view", "arguments": {"path": "package.json"}}
\`\`\``;
  }

  if (adapterName === 'gemini') {
    // Gemini may have native context - remind it to use our tools
    return `You are a helpful assistant with access to coding tools. You can have normal conversations AND help with coding tasks.

For casual messages (greetings, questions, chat), respond naturally without using tools.
For coding tasks, use the tools below to explore and modify the codebase.

${baseInstructions}

# How to Use Tools

Output a \`\`\`tool code block:

\`\`\`tool
{
  "name": "tool_name",
  "arguments": {"param": "value"}
}
\`\`\`

IMPORTANT:
- Use \`\`\`tool blocks to invoke tools (not native functions)
- You must use 'view' tool to read file contents
- Do not assume or hallucinate file contents
- Multiple tools = multiple \`\`\`tool blocks
- ALWAYS use 'write' or 'edit' tools for file modifications - NOT bash/sed/awk
- The 'edit' tool shows a diff preview before applying changes`;
  }

  // Default prompt for Claude, Codex, Ollama
  return `You are a helpful assistant with access to coding tools. You can have normal conversations AND help with coding tasks.

For casual messages (greetings, questions, chat), respond naturally without using tools.
For coding tasks, use the available tools to explore and modify the codebase.

IMPORTANT: When working with code, you MUST use tools to read files. Do NOT pretend or hallucinate file contents.

${baseInstructions}

# How to Use Tools

To use a tool, respond with a JSON block in this format:

\`\`\`tool
{
  "name": "tool_name",
  "arguments": {
    "param1": "value1"
  }
}
\`\`\`

CRITICAL:
- Use \`\`\`tool (not \`\`\`json or other formats)
- You CANNOT read files without using the 'view' tool
- Do NOT make up or assume file contents

You can call multiple tools by including multiple \`\`\`tool blocks.

# Guidelines

- Use 'glob' to find files by pattern (e.g., "**/*.ts")
- Use 'grep' to search file contents for patterns
- Use 'view' to read file contents
- Use 'edit' for targeted changes to existing files (shows diff preview)
- Use 'write' for new files or complete rewrites
- Use 'bash' for running commands (NOT for file edits - use 'edit' instead)
- NEVER use sed/awk via bash to modify files - always use 'edit' tool

IMPORTANT for editing:
- ALWAYS use 'view' to read a file BEFORE using 'edit' on it
- The 'edit' search text MUST exactly match the file contents
- Only make ONE edit per file per response - wait for result before making more edits to same file`;
}

/**
 * Get a tool usage reminder for context handoff between agents
 * Helps models remember how to use tools when receiving conversation history
 */
function getToolReminder(adapterName: string): string {
  if (adapterName === 'mistral') {
    return `

REMINDER: I have access to tools via \`\`\`tool code blocks. To read files, run commands, or make changes, I output:
\`\`\`tool
{"name": "view", "arguments": {"path": "filename"}}
\`\`\`
I will use these tools when needed.`;
  }

  if (adapterName === 'gemini') {
    return `

REMINDER: I can use tools via \`\`\`tool blocks to read files, run commands, and make changes.`;
  }

  // Claude, Codex, Ollama - native tool support, minimal reminder
  return '';
}

/**
 * Run an agent loop with tool access
 *
 * The agent can call tools to explore the codebase, then respond.
 * Loop continues until agent responds without tool calls.
 */
export async function runAgentLoop(
  adapter: Adapter,
  userMessage: string,
  options: AgentLoopOptions = {}
): Promise<AgentLoopResult> {
  const tools = options.tools ?? allTools;
  const cwd = options.cwd ?? process.cwd();
  const startTime = Date.now();

  const allToolCalls: ToolCall[] = [];
  const allToolResults: ToolResult[] = [];
  const messages: AgentMessage[] = [];

  // Track if user selected "allow all edits" to skip future diff previews
  let allowAllEdits = options.allowAllEdits ?? false;

  // Get project structure overview (file listing - not contents)
  const projectFiles = getProjectStructure(cwd);

  // Build tool descriptions for system prompt
  const toolDescriptions = tools.map(t => {
    const params = Object.entries(t.parameters.properties || {})
      .map(([name, schema]) => `  - ${name}: ${(schema as { description: string }).description}`)
      .join('\n');
    const required = t.parameters.required?.join(', ') || 'none';
    return `## ${t.name}\n${t.description}\n\nParameters:\n${params}\nRequired: ${required}`;
  }).join('\n\n---\n\n');

  // Build adapter-specific system prompt
  const systemPrompt = buildSystemPrompt(adapter.name, projectFiles, toolDescriptions);

  // Add conversation history if provided (for multi-model context)
  // Prefer unified history format which enables proper context management
  if (options.unifiedHistory && options.unifiedHistory.length > 0) {
    // Use the context manager for proper compaction and formatting
    const preparedContext = await prepareContextForAgent(options.unifiedHistory, {
      agent: adapter.name,
      model: options.model,
      systemPrompt, // Account for system prompt in token calculations
    });

    // Format the prepared history as context
    let historyContext = options.unifiedHistory
      .map(msg => {
        const agentLabel = msg.agent ? ` (${msg.agent})` : '';
        const content = getTextContent(msg);
        return `${msg.role}${agentLabel}: ${content}`;
      })
      .join('\n\n');

    // If compaction happened, use the summary
    if (preparedContext.wasCompacted && preparedContext.summary) {
      historyContext = `<earlier_summary>\n${preparedContext.summary}\n</earlier_summary>\n\n${historyContext.slice(-8000)}`;
    }

    // Add as context before the current message
    messages.push({
      role: 'user',
      content: `<conversation_history>\nPrevious conversation:\n${historyContext}\n</conversation_history>`
    });

    // Add tool reminder for models that use text-based tool invocation
    const toolReminder = getToolReminder(adapter.name);
    messages.push({
      role: 'assistant',
      content: `I understand the previous conversation context. I'll continue from where we left off.${toolReminder}`
    });
  } else if (options.conversationHistory && options.conversationHistory.length > 0) {
    // Legacy format - simple string-based handling
    const contextLimit = getContextLimit(adapter.name, options.model);
    const historyTokenBudget = Math.floor(contextLimit * 0.4);

    let historyContext = options.conversationHistory
      .map(msg => {
        const agentLabel = msg.agent ? ` (${msg.agent})` : '';
        return `${msg.role}${agentLabel}: ${msg.content}`;
      })
      .join('\n\n');

    const estimatedTokens = Math.ceil(historyContext.length / 4);

    if (estimatedTokens > historyTokenBudget) {
      const targetChars = historyTokenBudget * 4;
      if (historyContext.length > targetChars) {
        historyContext = '...(earlier context truncated)...\n\n' + historyContext.slice(-targetChars);
      }
    }

    messages.push({
      role: 'user',
      content: `<conversation_history>\nPrevious conversation:\n${historyContext}\n</conversation_history>`
    });

    // Add tool reminder for models that use text-based tool invocation
    const toolReminder = getToolReminder(adapter.name);
    messages.push({
      role: 'assistant',
      content: `I understand the previous conversation context. I'll continue from where we left off.${toolReminder}`
    });
  }

  // Initial message
  messages.push({ role: 'user', content: userMessage });

  let lastResponse: ModelResponse | null = null;
  let iterations = 0;
  let totalTokens = { input: 0, output: 0 };

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Build prompt with history
    const prompt = buildPrompt(systemPrompt, messages);

    // Call LLM
    const response = await adapter.run(prompt, {
      ...options,
      disableTools: true, // We handle tools ourselves
    });

    lastResponse = response;

    // Accumulate tokens from each iteration
    if (response.tokens) {
      totalTokens.input += response.tokens.input || 0;
      totalTokens.output += response.tokens.output || 0;
    }

    if (response.error) {
      return {
        content: response.error,
        model: response.model,
        iterations,
        toolCalls: allToolCalls,
        toolResults: allToolResults,
        tokens: totalTokens.input > 0 || totalTokens.output > 0 ? totalTokens : undefined,
        duration: Date.now() - startTime,
      };
    }

    options.onIteration?.(iterations, response.content);

    // Parse tool calls from response
    const toolCalls = parseToolCalls(response.content);

    if (toolCalls.length === 0) {
      // No tool calls - we're done
      return {
        content: response.content,
        model: response.model,
        iterations,
        toolCalls: allToolCalls,
        toolResults: allToolResults,
        tokens: totalTokens.input > 0 || totalTokens.output > 0 ? totalTokens : undefined,
        duration: Date.now() - startTime,
      };
    }

    // Execute tools
    messages.push({
      role: 'assistant',
      content: response.content,
      toolCalls,
    });

    const results: ToolResult[] = [];
    let cancelled = false;

    // Deduplicate write/edit calls to the same file (LLMs sometimes duplicate)
    const seenWriteFiles = new Set<string>();
    const deduplicatedToolCalls = toolCalls.filter(call => {
      const normalizedName = normalizeToolName(call.name);
      if (normalizedName === 'write' || normalizedName === 'edit') {
        const filePath = (call.arguments.path || call.arguments.file_path || call.arguments.filePath) as string | undefined;
        if (filePath && seenWriteFiles.has(filePath)) {
          // Skip duplicate write/edit to same file
          results.push({
            toolCallId: call.id,
            content: 'Skipped: duplicate write to same file',
            isError: false,
          });
          return false;
        }
        if (filePath) seenWriteFiles.add(filePath);
      }
      return true;
    });

    // Collect write/edit operations for batch preview
    const writeEditCalls: Array<{
      call: ToolCall;
      normalizedName: string;
      preview?: {
        toolCallId: string;
        filePath: string;
        operation: 'create' | 'edit' | 'overwrite';
        originalContent: string | null;
        newContent: string;
      };
    }> = [];

    // First pass: check permissions and collect write/edit previews
    for (const call of deduplicatedToolCalls) {
      options.onToolCall?.(call);
      allToolCalls.push(call);

      const normalizedName = normalizeToolName(call.name);
      const isWriteEdit = normalizedName === 'write' || normalizedName === 'edit';
      const hasDiffPreview = options.onDiffPreview || options.onBatchDiffPreview;

      // Skip permission check for write/edit if diff preview is enabled
      // (diff preview serves as the approval mechanism)
      if (!isWriteEdit || !hasDiffPreview || allowAllEdits) {
        // Check if permission is needed for non-write/edit tools
        const permissionResult = await checkAndRequestPermission(call, cwd, options.onPermissionRequest);

        if (permissionResult.decision === 'cancel') {
          cancelled = true;
          results.push({
            toolCallId: call.id,
            content: 'Operation cancelled by user',
            isError: true,
          });
          break;
        }

        if (permissionResult.decision === 'deny') {
          results.push({
            toolCallId: call.id,
            content: 'Permission denied by user',
            isError: true,
          });
          allToolResults.push(results[results.length - 1]);
          continue;
        }
      }

      // Collect write/edit for diff preview
      if (isWriteEdit && !allowAllEdits && hasDiffPreview) {
        const preview = await prepareDiffPreview(call, cwd, normalizedName);
        writeEditCalls.push({ call, normalizedName, preview: preview ? { toolCallId: call.id, ...preview } : undefined });
      } else if (isWriteEdit && allowAllEdits) {
        // Allow all edits - collect for execution without preview
        writeEditCalls.push({ call, normalizedName, preview: undefined });
      } else {
        // Non-write/edit tools - execute immediately
        options.onToolStart?.(call);
        const result = await executeTool(call, cwd);
        options.onToolEnd?.(call, result);
        results.push(result);
        options.onToolResult?.(result);
        allToolResults.push(result);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    // Handle write/edit operations (batch or single)
    if (!cancelled && writeEditCalls.length > 0 && !allowAllEdits) {
      const validPreviews = writeEditCalls.filter(w => w.preview).map(w => w.preview!);

      if (validPreviews.length > 1 && options.onBatchDiffPreview) {
        // Batch review for multiple files
        const batchResult = await options.onBatchDiffPreview(validPreviews);

        if (batchResult.allowAll) {
          // Only set local allowAllEdits for remaining tool calls in this response
          // Do NOT call onAllowAllEdits - batch "Yes to all" applies only to current batch
          // Session-wide "allow all" is only set via SingleFileDiff
          allowAllEdits = true;
        }

        // Execute accepted, reject others
        for (const item of writeEditCalls) {
          if (!item.preview) {
            // No preview (error preparing) - execute anyway
            options.onToolStart?.(item.call);
            const result = await executeTool(item.call, cwd);
            options.onToolEnd?.(item.call, result);
            results.push(result);
            options.onToolResult?.(result);
            allToolResults.push(result);
          } else if (batchResult.accepted.includes(item.call.id)) {
            options.onToolStart?.(item.call);
            const result = await executeTool(item.call, cwd);
            options.onToolEnd?.(item.call, result);
            results.push(result);
            options.onToolResult?.(result);
            allToolResults.push(result);
          } else {
            results.push({
              toolCallId: item.call.id,
              content: 'Edit rejected by user',
              isError: true,
            });
            allToolResults.push(results[results.length - 1]);
          }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } else {
        // Single file preview (or no batch handler)
        for (const item of writeEditCalls) {
          if (allowAllEdits) {
            // Skip preview, just execute
            options.onToolStart?.(item.call);
            const result = await executeTool(item.call, cwd);
            options.onToolEnd?.(item.call, result);
            results.push(result);
            options.onToolResult?.(result);
            allToolResults.push(result);
          } else if (item.preview && options.onDiffPreview) {
            const decision = await options.onDiffPreview(item.preview);
            if (decision === 'no') {
              results.push({
                toolCallId: item.call.id,
                content: 'Edit rejected by user',
                isError: true,
              });
              allToolResults.push(results[results.length - 1]);
            } else {
              if (decision === 'yes-all') {
                allowAllEdits = true;
                options.onAllowAllEdits?.();
              }
              options.onToolStart?.(item.call);
              const result = await executeTool(item.call, cwd);
              options.onToolEnd?.(item.call, result);
              results.push(result);
              options.onToolResult?.(result);
              allToolResults.push(result);
            }
          } else {
            // No preview available - execute anyway
            options.onToolStart?.(item.call);
            const result = await executeTool(item.call, cwd);
            options.onToolEnd?.(item.call, result);
            results.push(result);
            options.onToolResult?.(result);
            allToolResults.push(result);
          }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    } else if (!cancelled && writeEditCalls.length > 0 && allowAllEdits) {
      // Allow all is active - execute without preview
      for (const item of writeEditCalls) {
        options.onToolStart?.(item.call);
        const result = await executeTool(item.call, cwd);
        options.onToolEnd?.(item.call, result);
        results.push(result);
        options.onToolResult?.(result);
        allToolResults.push(result);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    // If cancelled, return early
    if (cancelled) {
      return {
        content: 'Operation cancelled by user',
        model: lastResponse?.model || adapter.name,
        iterations,
        toolCalls: allToolCalls,
        toolResults: allToolResults,
        tokens: totalTokens.input > 0 || totalTokens.output > 0 ? totalTokens : undefined,
        duration: Date.now() - startTime,
      };
    }

    // Add tool results to messages
    messages.push({
      role: 'tool',
      content: '',
      toolResults: results,
    });
  }

  // Max iterations reached
  return {
    content: lastResponse?.content || 'Max iterations reached without final response',
    model: lastResponse?.model || adapter.name,
    iterations,
    toolCalls: allToolCalls,
    toolResults: allToolResults,
    tokens: totalTokens.input > 0 || totalTokens.output > 0 ? totalTokens : undefined,
    duration: Date.now() - startTime,
  };
}

/**
 * Build full prompt from system message and conversation history
 */
function buildPrompt(systemPrompt: string, messages: AgentMessage[]): string {
  let prompt = systemPrompt + '\n\n---\n\n';

  for (const msg of messages) {
    if (msg.role === 'user') {
      prompt += `User: ${msg.content}\n\n`;
    } else if (msg.role === 'assistant') {
      prompt += `Assistant: ${msg.content}\n\n`;
    } else if (msg.role === 'tool') {
      prompt += 'Tool Results:\n';
      for (const result of msg.toolResults || []) {
        const status = result.isError ? 'ERROR' : 'SUCCESS';
        prompt += `[${status}] ${result.toolCallId}:\n${result.content}\n\n`;
      }
    }
  }

  prompt += 'Assistant: ';
  return prompt;
}

/**
 * Parse tool calls from LLM response
 */
function parseToolCalls(content: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const toolBlockRegex = /```tool\s*([\s\S]*?)```/g;

  let match;

  while ((match = toolBlockRegex.exec(content)) !== null) {
    try {
      const json = match[1].trim();
      const parsed = JSON.parse(json);

      if (parsed.name && typeof parsed.name === 'string') {
        // Use unique ID to avoid collisions across iterations
        const uniqueId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        calls.push({
          id: uniqueId,
          name: parsed.name,
          arguments: (parsed.arguments || {}) as Record<string, unknown>,
        });
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return calls;
}

/**
 * Check if permission is needed and request it
 */
async function checkAndRequestPermission(
  call: ToolCall,
  cwd: string,
  handler?: PermissionHandler
): Promise<PermissionResult> {
  // Normalize tool name (handle aliases like read_file -> view)
  const toolName = normalizeToolName(call.name);

  // Handle different argument names (file_path -> path, pattern for glob/grep, etc.)
  const filePath = (call.arguments.path || call.arguments.file_path || call.arguments.file) as string | undefined;
  const pattern = call.arguments.pattern as string | undefined;
  const command = (call.arguments.command || call.arguments.cmd) as string | undefined;

  // Determine action type using normalized name
  let action: 'read' | 'write' | 'execute';
  if (READ_TOOLS.includes(toolName)) {
    action = 'read';
  } else if (WRITE_TOOLS.includes(toolName)) {
    action = 'write';
  } else if (EXEC_TOOLS.includes(toolName)) {
    action = 'execute';
  } else {
    // Unknown tool type - default to 'write' permission to be safe
    // This ensures we don't accidentally allow dangerous operations
    action = 'write';
  }

  // Build full path (for file operations) or use pattern (for glob/grep)
  let fullPath: string | undefined;
  let displayTarget: string | undefined;

  // For glob/grep tools, prefer pattern for display (even if path is also provided)
  if (pattern && (toolName === 'glob' || toolName === 'grep')) {
    // For glob/grep, use the search directory as base path for auto-approval
    // Use cross-platform path utilities for consistent handling
    const searchDir = filePath
      ? (isAbsolutePath(filePath) ? normalizePath(filePath) : joinPaths(cwd, filePath))
      : cwd;
    fullPath = searchDir;
    displayTarget = pattern;
  } else if (filePath) {
    // Use cross-platform path handling instead of direct string concatenation
    fullPath = isAbsolutePath(filePath) ? normalizePath(filePath) : joinPaths(cwd, filePath);
    displayTarget = fullPath;
  } else if (pattern) {
    // Fallback for other tools with pattern
    fullPath = cwd;
    displayTarget = pattern;
  }

  // Check if already auto-approved
  if (permissionTracker.isAutoApproved(action, fullPath)) {
    return { decision: 'allow' };
  }

  // No handler = auto-allow (for non-interactive mode)
  if (!handler) {
    return { decision: 'allow' };
  }

  // Request permission (use normalized name)
  const request: PermissionRequest = {
    action,
    tool: toolName,
    path: displayTarget,
    command,
    description: getPermissionDescription(toolName, call.arguments),
  };

  const result = await handler(request);

  // Record approval for future auto-approve
  if (result.decision === 'allow_dir' || result.decision === 'allow_all') {
    permissionTracker.recordApproval(action, result.decision, fullPath);
  }

  return result;
}

/**
 * Get human-readable description for permission request
 */
function getPermissionDescription(toolName: string, args: Record<string, unknown>): string {
  // Handle different argument names
  const path = args.path || args.file_path || args.file;
  const pattern = args.pattern;
  const command = args.command || args.cmd;

  switch (toolName) {
    case 'view':
      return `Read contents of file: ${path}`;
    case 'glob':
      return `Search for files matching: ${pattern}`;
    case 'grep':
      return `Search file contents for: ${pattern}`;
    case 'write':
      return `Create/overwrite file: ${path}`;
    case 'edit':
      return `Edit file: ${path}`;
    case 'bash':
      return `Execute command: ${command}`;
    default:
      return `Execute tool: ${toolName}`;
  }
}

/**
 * Prepare diff preview data for write/edit operations
 * Returns preview data or null if preview can't be prepared
 */
async function prepareDiffPreview(
  call: ToolCall,
  cwd: string,
  toolName: string
): Promise<{
  filePath: string;
  operation: 'create' | 'edit' | 'overwrite';
  originalContent: string | null;
  newContent: string;
} | null> {
  const filePath = (call.arguments.path || call.arguments.file_path || call.arguments.file) as string;
  if (!filePath) return null;

  const fullPath = resolve(cwd, filePath);
  let originalContent: string | null = null;
  let newContent: string;
  let operation: 'create' | 'edit' | 'overwrite';

  try {
    if (toolName === 'write') {
      // Normalize content argument (Gemini may use different names)
      newContent = (call.arguments.content || call.arguments.file_content ||
                    call.arguments.text || call.arguments.body ||
                    call.arguments.data || '') as string;
      if (existsSync(fullPath)) {
        originalContent = readFileSync(fullPath, 'utf-8');
        operation = 'overwrite';
      } else {
        operation = 'create';
      }
    } else if (toolName === 'edit') {
      // Normalize search/replace arguments
      const search = (call.arguments.search || call.arguments.old_text ||
                      call.arguments.find || call.arguments.pattern) as string;
      const replace = (call.arguments.replace || call.arguments.new_text ||
                       call.arguments.replacement || call.arguments.with) as string;

      if (!existsSync(fullPath)) {
        return null;
      }

      originalContent = readFileSync(fullPath, 'utf-8');

      if (!originalContent.includes(search)) {
        return null;
      }

      newContent = originalContent.replace(search, replace);
      operation = 'edit';
    } else {
      return null;
    }

    return { filePath: fullPath, operation, originalContent, newContent };
  } catch {
    return null;
  }
}

/**
 * Get project structure (file listing) for context
 * Returns a tree-like listing of important files
 */
export function getProjectStructure(cwd: string): string {
  try {
    // Get key project files
    const patterns = [
      'README.md',
      'package.json',
      'tsconfig.json',
      'go.mod',
      'Cargo.toml',
      'requirements.txt',
      'src/**/*.{ts,tsx,js,jsx}',
      'lib/**/*.{ts,tsx,js,jsx}',
      'app/**/*.{ts,tsx,js,jsx}',
      'pages/**/*.{ts,tsx,js,jsx}',
      'components/**/*.{ts,tsx,js,jsx}',
      '*.{ts,tsx,js,jsx,go,rs,py}',
    ];

    const files: string[] = [];
    for (const pattern of patterns) {
      const matches = globSync(pattern, {
        cwd,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
        nodir: true,
      });
      files.push(...matches);
    }

    // Dedupe and sort
    const uniqueFiles = [...new Set(files)].sort();

    // Limit to 100 files to avoid huge prompts
    const limited = uniqueFiles.slice(0, 100);

    if (limited.length === 0) {
      return '(No files found - use glob tool to explore)';
    }

    let result = limited.join('\n');
    if (uniqueFiles.length > 100) {
      result += `\n... and ${uniqueFiles.length - 100} more files`;
    }

    return result;
  } catch {
    return '(Unable to list files - use glob tool to explore)';
  }
}

export { allTools, executeTools };
