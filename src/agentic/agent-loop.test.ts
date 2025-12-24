/**
 * Regression tests for agent-loop tool parsing and alias normalization
 *
 * These tests ensure that:
 * 1. Tool name aliases are correctly normalized
 * 2. Tool calls are properly parsed from LLM responses
 * 3. Permission categories are correctly determined
 */

import { describe, it, expect, beforeEach } from 'bun:test';

// Tool name aliases - copied from agent-loop.ts for testing
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

// Tools by permission category
const READ_TOOLS = ['view', 'grep', 'glob'];
const WRITE_TOOLS = ['write', 'edit'];
const EXEC_TOOLS = ['bash'];

// Normalize tool name using aliases (copied from agent-loop.ts)
function normalizeToolName(name: string): string {
  let normalized = name;
  if (normalized.includes(':')) {
    normalized = normalized.split(':').pop() || normalized;
  }
  if (normalized.includes('.')) {
    normalized = normalized.split('.').pop() || normalized;
  }
  normalized = normalized.toLowerCase();
  return TOOL_ALIASES[normalized] || normalized;
}

// Parse tool calls from LLM response (copied from agent-loop.ts)
function parseToolCalls(content: string): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
  const calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
  const toolBlockRegex = /```tool\s*([\s\S]*?)```/g;

  let match;
  while ((match = toolBlockRegex.exec(content)) !== null) {
    try {
      const json = match[1].trim();
      const parsed = JSON.parse(json);

      if (parsed.name && typeof parsed.name === 'string') {
        const uniqueId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        calls.push({
          id: uniqueId,
          name: parsed.name,
          arguments: parsed.arguments || {},
        });
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return calls;
}

// Determine permission category for a tool
function getPermissionCategory(toolName: string): 'read' | 'write' | 'execute' | 'unknown' {
  const normalized = normalizeToolName(toolName);
  if (READ_TOOLS.includes(normalized)) return 'read';
  if (WRITE_TOOLS.includes(normalized)) return 'write';
  if (EXEC_TOOLS.includes(normalized)) return 'execute';
  return 'unknown';
}

// ============================================================================
// TESTS
// ============================================================================

describe('Tool Name Normalization', () => {
  describe('View tool aliases', () => {
    it('should normalize read_file to view', () => {
      expect(normalizeToolName('read_file')).toBe('view');
    });

    it('should normalize cat to view', () => {
      expect(normalizeToolName('cat')).toBe('view');
    });

    it('should normalize file_read to view', () => {
      expect(normalizeToolName('file_read')).toBe('view');
    });

    it('should normalize view_file to view', () => {
      expect(normalizeToolName('view_file')).toBe('view');
    });

    it('should normalize get_file to view', () => {
      expect(normalizeToolName('get_file')).toBe('view');
    });

    it('should normalize open_file to view', () => {
      expect(normalizeToolName('open_file')).toBe('view');
    });

    it('should handle uppercase READ_FILE', () => {
      expect(normalizeToolName('READ_FILE')).toBe('view');
    });

    it('should handle mixed case Read_File', () => {
      expect(normalizeToolName('Read_File')).toBe('view');
    });
  });

  describe('Glob tool aliases', () => {
    it('should normalize find to glob', () => {
      expect(normalizeToolName('find')).toBe('glob');
    });

    it('should normalize find_files to glob', () => {
      expect(normalizeToolName('find_files')).toBe('glob');
    });

    it('should normalize list_files to glob', () => {
      expect(normalizeToolName('list_files')).toBe('glob');
    });

    it('should normalize search_files to glob', () => {
      expect(normalizeToolName('search_files')).toBe('glob');
    });

    it('should normalize list_directory to glob', () => {
      expect(normalizeToolName('list_directory')).toBe('glob');
    });

    it('should normalize ls to glob', () => {
      expect(normalizeToolName('ls')).toBe('glob');
    });
  });

  describe('Grep tool aliases', () => {
    it('should normalize search to grep', () => {
      expect(normalizeToolName('search')).toBe('grep');
    });

    it('should normalize search_content to grep', () => {
      expect(normalizeToolName('search_content')).toBe('grep');
    });

    it('should normalize find_in_files to grep', () => {
      expect(normalizeToolName('find_in_files')).toBe('grep');
    });

    it('should normalize grep_search to grep', () => {
      expect(normalizeToolName('grep_search')).toBe('grep');
    });

    it('should normalize search_code to grep', () => {
      expect(normalizeToolName('search_code')).toBe('grep');
    });

    it('should normalize search_file_content to grep', () => {
      expect(normalizeToolName('search_file_content')).toBe('grep');
    });

    it('should normalize searchfilecontent to grep', () => {
      expect(normalizeToolName('searchfilecontent')).toBe('grep');
    });

    it('should normalize file_search to grep', () => {
      expect(normalizeToolName('file_search')).toBe('grep');
    });
  });

  describe('Bash tool aliases', () => {
    it('should normalize shell to bash', () => {
      expect(normalizeToolName('shell')).toBe('bash');
    });

    it('should normalize run to bash', () => {
      expect(normalizeToolName('run')).toBe('bash');
    });

    it('should normalize execute to bash', () => {
      expect(normalizeToolName('execute')).toBe('bash');
    });

    it('should normalize run_command to bash', () => {
      expect(normalizeToolName('run_command')).toBe('bash');
    });

    it('should normalize terminal to bash', () => {
      expect(normalizeToolName('terminal')).toBe('bash');
    });

    it('should normalize cmd to bash', () => {
      expect(normalizeToolName('cmd')).toBe('bash');
    });

    it('should normalize run_shell_command to bash', () => {
      expect(normalizeToolName('run_shell_command')).toBe('bash');
    });

    it('should normalize runshellcommand to bash', () => {
      expect(normalizeToolName('runshellcommand')).toBe('bash');
    });
  });

  describe('Write tool aliases', () => {
    it('should normalize write_file to write', () => {
      expect(normalizeToolName('write_file')).toBe('write');
    });

    it('should normalize create_file to write', () => {
      expect(normalizeToolName('create_file')).toBe('write');
    });

    it('should normalize file_write to write', () => {
      expect(normalizeToolName('file_write')).toBe('write');
    });

    it('should normalize create to write', () => {
      expect(normalizeToolName('create')).toBe('write');
    });

    it('should normalize save_file to write', () => {
      expect(normalizeToolName('save_file')).toBe('write');
    });

    it('should normalize overwrite to write', () => {
      expect(normalizeToolName('overwrite')).toBe('write');
    });
  });

  describe('Edit tool aliases', () => {
    it('should normalize update to edit', () => {
      expect(normalizeToolName('update')).toBe('edit');
    });

    it('should normalize modify to edit', () => {
      expect(normalizeToolName('modify')).toBe('edit');
    });

    it('should normalize replace to edit', () => {
      expect(normalizeToolName('replace')).toBe('edit');
    });

    it('should normalize file_edit to edit', () => {
      expect(normalizeToolName('file_edit')).toBe('edit');
    });

    it('should normalize edit_file to edit', () => {
      expect(normalizeToolName('edit_file')).toBe('edit');
    });

    it('should normalize patch to edit', () => {
      expect(normalizeToolName('patch')).toBe('edit');
    });

    it('should normalize str_replace to edit', () => {
      expect(normalizeToolName('str_replace')).toBe('edit');
    });

    it('should normalize str_replace_editor to edit', () => {
      expect(normalizeToolName('str_replace_editor')).toBe('edit');
    });

    it('should normalize text_editor to edit', () => {
      expect(normalizeToolName('text_editor')).toBe('edit');
    });
  });

  describe('Prefix stripping', () => {
    it('should strip Gemini default_api: prefix', () => {
      expect(normalizeToolName('default_api:read_file')).toBe('view');
    });

    it('should strip functions. prefix', () => {
      expect(normalizeToolName('functions.read_file')).toBe('view');
    });

    it('should strip tools. prefix', () => {
      expect(normalizeToolName('tools.read_file')).toBe('view');
    });

    it('should strip multiple prefixes', () => {
      expect(normalizeToolName('api:tools.read_file')).toBe('view');
    });

    it('should handle colon in middle of name', () => {
      // Takes everything after last colon
      expect(normalizeToolName('namespace:sub:read_file')).toBe('view');
    });
  });

  describe('Native tool names', () => {
    it('should preserve native view name', () => {
      expect(normalizeToolName('view')).toBe('view');
    });

    it('should preserve native glob name', () => {
      expect(normalizeToolName('glob')).toBe('glob');
    });

    it('should preserve native grep name', () => {
      expect(normalizeToolName('grep')).toBe('grep');
    });

    it('should preserve native bash name', () => {
      expect(normalizeToolName('bash')).toBe('bash');
    });

    it('should preserve native write name', () => {
      expect(normalizeToolName('write')).toBe('write');
    });

    it('should preserve native edit name', () => {
      expect(normalizeToolName('edit')).toBe('edit');
    });
  });

  describe('Unknown tool names', () => {
    it('should return unknown tool names as-is (lowercase)', () => {
      expect(normalizeToolName('custom_tool')).toBe('custom_tool');
    });

    it('should lowercase unknown tool names', () => {
      expect(normalizeToolName('CUSTOM_TOOL')).toBe('custom_tool');
    });
  });
});

describe('Tool Call Parsing', () => {
  describe('Valid tool blocks', () => {
    it('should parse single tool call', () => {
      const content = `Let me read the file.

\`\`\`tool
{"name": "view", "arguments": {"path": "README.md"}}
\`\`\``;

      const calls = parseToolCalls(content);
      expect(calls.length).toBe(1);
      expect(calls[0].name).toBe('view');
      expect(calls[0].arguments.path).toBe('README.md');
    });

    it('should parse multiple tool calls', () => {
      const content = `I'll search for files and read one.

\`\`\`tool
{"name": "glob", "arguments": {"pattern": "**/*.ts"}}
\`\`\`

\`\`\`tool
{"name": "view", "arguments": {"path": "src/index.ts"}}
\`\`\``;

      const calls = parseToolCalls(content);
      expect(calls.length).toBe(2);
      expect(calls[0].name).toBe('glob');
      expect(calls[1].name).toBe('view');
    });

    it('should parse tool call with complex arguments', () => {
      const content = `\`\`\`tool
{
  "name": "edit",
  "arguments": {
    "path": "src/utils.ts",
    "search": "function old() {}",
    "replace": "function new() {}"
  }
}
\`\`\``;

      const calls = parseToolCalls(content);
      expect(calls.length).toBe(1);
      expect(calls[0].name).toBe('edit');
      expect(calls[0].arguments.search).toBe('function old() {}');
      expect(calls[0].arguments.replace).toBe('function new() {}');
    });

    it('should handle tool call with empty arguments', () => {
      const content = `\`\`\`tool
{"name": "glob", "arguments": {}}
\`\`\``;

      const calls = parseToolCalls(content);
      expect(calls.length).toBe(1);
      expect(calls[0].arguments).toEqual({});
    });

    it('should handle tool call without arguments key', () => {
      const content = `\`\`\`tool
{"name": "view"}
\`\`\``;

      const calls = parseToolCalls(content);
      expect(calls.length).toBe(1);
      expect(calls[0].arguments).toEqual({});
    });
  });

  describe('Invalid tool blocks', () => {
    it('should skip invalid JSON', () => {
      const content = `\`\`\`tool
{invalid json here}
\`\`\``;

      const calls = parseToolCalls(content);
      expect(calls.length).toBe(0);
    });

    it('should skip tool block without name', () => {
      const content = `\`\`\`tool
{"arguments": {"path": "file.txt"}}
\`\`\``;

      const calls = parseToolCalls(content);
      expect(calls.length).toBe(0);
    });

    it('should skip tool block with non-string name', () => {
      const content = `\`\`\`tool
{"name": 123, "arguments": {}}
\`\`\``;

      const calls = parseToolCalls(content);
      expect(calls.length).toBe(0);
    });

    it('should not parse json blocks (only tool blocks)', () => {
      const content = `\`\`\`json
{"name": "view", "arguments": {"path": "file.txt"}}
\`\`\``;

      const calls = parseToolCalls(content);
      expect(calls.length).toBe(0);
    });

    it('should not parse code blocks without tool tag', () => {
      const content = `\`\`\`
{"name": "view", "arguments": {"path": "file.txt"}}
\`\`\``;

      const calls = parseToolCalls(content);
      expect(calls.length).toBe(0);
    });
  });

  describe('Mixed content', () => {
    it('should parse valid calls and skip invalid ones', () => {
      const content = `Here are my actions:

\`\`\`tool
{"name": "view", "arguments": {"path": "good.txt"}}
\`\`\`

\`\`\`tool
{invalid json}
\`\`\`

\`\`\`tool
{"name": "glob", "arguments": {"pattern": "*.ts"}}
\`\`\``;

      const calls = parseToolCalls(content);
      expect(calls.length).toBe(2);
      expect(calls[0].name).toBe('view');
      expect(calls[1].name).toBe('glob');
    });

    it('should handle content with no tool blocks', () => {
      const content = 'This is just text with no tool calls.';
      const calls = parseToolCalls(content);
      expect(calls.length).toBe(0);
    });
  });

  describe('Unique IDs', () => {
    it('should generate unique IDs for each call', () => {
      const content = `\`\`\`tool
{"name": "view", "arguments": {}}
\`\`\`

\`\`\`tool
{"name": "view", "arguments": {}}
\`\`\``;

      const calls = parseToolCalls(content);
      expect(calls.length).toBe(2);
      expect(calls[0].id).not.toBe(calls[1].id);
    });

    it('should prefix IDs with call_', () => {
      const content = `\`\`\`tool
{"name": "view", "arguments": {}}
\`\`\``;

      const calls = parseToolCalls(content);
      expect(calls[0].id.startsWith('call_')).toBe(true);
    });
  });
});

describe('Permission Categories', () => {
  describe('Read permissions', () => {
    it('should categorize view as read', () => {
      expect(getPermissionCategory('view')).toBe('read');
    });

    it('should categorize glob as read', () => {
      expect(getPermissionCategory('glob')).toBe('read');
    });

    it('should categorize grep as read', () => {
      expect(getPermissionCategory('grep')).toBe('read');
    });

    it('should categorize read_file alias as read', () => {
      expect(getPermissionCategory('read_file')).toBe('read');
    });

    it('should categorize find alias as read', () => {
      expect(getPermissionCategory('find')).toBe('read');
    });

    it('should categorize search alias as read', () => {
      expect(getPermissionCategory('search')).toBe('read');
    });
  });

  describe('Write permissions', () => {
    it('should categorize write as write', () => {
      expect(getPermissionCategory('write')).toBe('write');
    });

    it('should categorize edit as write', () => {
      expect(getPermissionCategory('edit')).toBe('write');
    });

    it('should categorize write_file alias as write', () => {
      expect(getPermissionCategory('write_file')).toBe('write');
    });

    it('should categorize edit_file alias as write', () => {
      expect(getPermissionCategory('edit_file')).toBe('write');
    });

    it('should categorize str_replace alias as write', () => {
      expect(getPermissionCategory('str_replace')).toBe('write');
    });
  });

  describe('Execute permissions', () => {
    it('should categorize bash as execute', () => {
      expect(getPermissionCategory('bash')).toBe('execute');
    });

    it('should categorize shell alias as execute', () => {
      expect(getPermissionCategory('shell')).toBe('execute');
    });

    it('should categorize run_command alias as execute', () => {
      expect(getPermissionCategory('run_command')).toBe('execute');
    });

    it('should categorize terminal alias as execute', () => {
      expect(getPermissionCategory('terminal')).toBe('execute');
    });
  });

  describe('Unknown permissions', () => {
    it('should categorize unknown tools as unknown', () => {
      expect(getPermissionCategory('custom_tool')).toBe('unknown');
    });

    it('should categorize unknown with prefix as unknown', () => {
      expect(getPermissionCategory('api:custom_tool')).toBe('unknown');
    });
  });
});

describe('Comprehensive Alias Coverage', () => {
  it('should have all view aliases covered', () => {
    const viewAliases = ['read_file', 'read', 'cat', 'file_read', 'view_file', 'get_file', 'open_file'];
    for (const alias of viewAliases) {
      expect(normalizeToolName(alias)).toBe('view');
    }
  });

  it('should have all glob aliases covered', () => {
    const globAliases = ['find', 'find_files', 'list_files', 'search_files', 'list_directory', 'ls'];
    for (const alias of globAliases) {
      expect(normalizeToolName(alias)).toBe('glob');
    }
  });

  it('should have all grep aliases covered', () => {
    const grepAliases = ['search', 'search_content', 'find_in_files', 'grep_search', 'search_code', 'search_file_content', 'searchfilecontent', 'file_search'];
    for (const alias of grepAliases) {
      expect(normalizeToolName(alias)).toBe('grep');
    }
  });

  it('should have all bash aliases covered', () => {
    const bashAliases = ['shell', 'run', 'execute', 'run_command', 'terminal', 'cmd', 'run_shell_command', 'runshellcommand'];
    for (const alias of bashAliases) {
      expect(normalizeToolName(alias)).toBe('bash');
    }
  });

  it('should have all write aliases covered', () => {
    const writeAliases = ['write_file', 'create_file', 'file_write', 'create', 'save_file', 'overwrite'];
    for (const alias of writeAliases) {
      expect(normalizeToolName(alias)).toBe('write');
    }
  });

  it('should have all edit aliases covered', () => {
    const editAliases = ['update', 'modify', 'replace', 'file_edit', 'edit_file', 'patch', 'str_replace', 'str_replace_editor', 'text_editor'];
    for (const alias of editAliases) {
      expect(normalizeToolName(alias)).toBe('edit');
    }
  });
});
