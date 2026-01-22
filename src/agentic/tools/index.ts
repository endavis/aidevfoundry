// Tool registry - exports all available tools

export * from './types';

import { viewTool } from './view';
import { globTool } from './glob';
import { grepTool } from './grep';
import { bashTool } from './bash';
import { writeTool } from './write';
import { editTool } from './edit';
import { gitTool } from './git';
import type { Tool, ToolCall, ToolResult } from './types';

// All available tools
export const allTools: Tool[] = [
  viewTool,
  globTool,
  grepTool,
  bashTool,
  writeTool,
  editTool,
  gitTool,
];

// Read-only tools (safe to run without review)
export const readOnlyTools: Tool[] = [
  viewTool,
  globTool,
  grepTool,
];

// Tools that modify files (require review)
export const writeTools: Tool[] = [
  writeTool,
  editTool,
];

// Shell tools (can be destructive)
export const shellTools: Tool[] = [
  bashTool,
];

// Git tool (has mixed permission levels based on action)
export const gitTools: Tool[] = [
  gitTool,
];

// Tool name aliases - maps common LLM naming patterns to our tools
const TOOL_ALIASES: Record<string, string> = {
  // View aliases
  'read_file': 'view',
  'read': 'view',
  'cat': 'view',
  'file_read': 'view',
  // Glob aliases
  'find': 'glob',
  'find_files': 'glob',
  'list_files': 'glob',
  'search_files': 'glob',
  'list_directory': 'glob',
  'listdirectory': 'glob',
  'ls': 'glob',
  // Grep aliases
  'search': 'grep',
  'search_content': 'grep',
  'find_in_files': 'grep',
  'search_file_content': 'grep',
  'searchfilecontent': 'grep',
  'file_search': 'grep',
  'grep_search': 'grep',
  'search_code': 'grep',
  // Bash aliases
  'shell': 'bash',
  'run': 'bash',
  'execute': 'bash',
  'run_command': 'bash',
  'run_shell_command': 'bash',
  'runshellcommand': 'bash',
  'terminal': 'bash',
  'cmd': 'bash',
  // Write aliases
  'write_file': 'write',
  'create_file': 'write',
  'file_write': 'write',
  // Edit aliases
  'update': 'edit',
  'modify': 'edit',
  'replace': 'edit',
  'file_edit': 'edit',
  // Git aliases
  'git_status': 'git',
  'git_diff': 'git',
  'git_stage': 'git',
  'git_unstage': 'git',
  'git_commit': 'git',
  'git_restore': 'git',
  'git_show': 'git',
  'git_log': 'git',
  'version_control': 'git',
  'vcs': 'git',
  'source_control': 'git',
};

// Normalize tool name - strip prefixes and apply aliases
function normalizeToolName(name: string): string {
  let normalized = name;
  // Strip common prefixes (Gemini uses default_api:, others may use functions., etc.)
  if (normalized.includes(':')) {
    normalized = normalized.split(':').pop() || normalized;
  }
  if (normalized.includes('.')) {
    normalized = normalized.split('.').pop() || normalized;
  }
  normalized = normalized.toLowerCase();
  return TOOL_ALIASES[normalized] || normalized;
}

// Get tool by name (with alias support)
export function getTool(name: string): Tool | undefined {
  const normalizedName = normalizeToolName(name);
  return allTools.find(t => t.name === normalizedName);
}

// Normalize argument names to match our tool parameter names
function normalizeArguments(_toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...args };

  // Map various path argument names -> path
  if (args.file_path && !args.path) {
    normalized.path = args.file_path;
  }
  if (args.file && !args.path) {
    normalized.path = args.file;
  }
  if (args.dir_path && !args.path) {
    normalized.path = args.dir_path;
  }
  if (args.directory && !args.path) {
    normalized.path = args.directory;
  }

  // Map cmd -> command
  if (args.cmd && !args.command) {
    normalized.command = args.cmd;
  }

  return normalized;
}

// Execute a tool call
export async function executeTool(
  call: ToolCall,
  cwd: string
): Promise<ToolResult> {
  const normalizedName = normalizeToolName(call.name);
  const tool = getTool(normalizedName);

  if (!tool) {
    return {
      toolCallId: call.id,
      content: `Error: Unknown tool '${call.name}'`,
      isError: true,
    };
  }

  try {
    // Normalize arguments to match tool parameter names
    const normalizedArgs = normalizeArguments(normalizedName, call.arguments);
    const result = await tool.execute(normalizedArgs, cwd);
    return {
      ...result,
      toolCallId: call.id,
    };
  } catch (err) {
    return {
      toolCallId: call.id,
      content: `Error executing ${call.name}: ${(err as Error).message}`,
      isError: true,
    };
  }
}

// Execute multiple tool calls sequentially
export async function executeTools(
  calls: ToolCall[],
  cwd: string
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const call of calls) {
    const result = await executeTool(call, cwd);
    results.push(result);
  }

  return results;
}

// Re-export individual tools
export { viewTool, globTool, grepTool, bashTool, writeTool, editTool, gitTool };

// Re-export permission system
export {
  type PermissionAction,
  type PermissionDecision,
  type PermissionRequest,
  type PermissionResult,
  type PermissionHandler,
  PermissionTracker,
  permissionTracker,
} from './permissions';

// Re-export git permission helpers
export {
  getGitActionPermission,
  isDestructiveAction,
  WRITE_ACTIONS as GIT_WRITE_ACTIONS,
  DESTRUCTIVE_ACTIONS as GIT_DESTRUCTIVE_ACTIONS,
  READ_ACTIONS as GIT_READ_ACTIONS,
} from './git';
