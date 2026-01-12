/**
 * Agent Discovery
 *
 * Discovers and loads custom agent definitions from .claude/agents/ directory.
 * These agents are markdown files with YAML frontmatter that define prompts,
 * tools, and behavior for Claude Code sessions.
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, basename, extname } from 'path';

/**
 * Agent definition parsed from markdown file
 */
export interface AgentDefinition {
  name: string;           // Filename without extension
  description: string;    // From frontmatter
  model?: string;         // Preferred model
  tools?: string[];       // Allowed tools
  filePath: string;       // Full path to the agent file
  content: string;        // Full markdown content
}

/**
 * Parse YAML frontmatter from markdown content
 */
function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const yaml = match[1];
  const result: Record<string, unknown> = {};

  // Simple YAML parser for common patterns
  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();

    // Handle arrays like ["Bash", "Read"]
    if (typeof value === 'string' && value.startsWith('[')) {
      try {
        value = JSON.parse(value.replace(/'/g, '"'));
      } catch {
        // Keep as string if parsing fails
      }
    }

    // Handle quoted strings
    if (typeof value === 'string') {
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
    }

    result[key] = value;
  }

  return result;
}

/**
 * Discover agents from .claude/agents/ directory
 */
export async function discoverAgents(cwd?: string): Promise<AgentDefinition[]> {
  const baseDir = cwd || process.cwd();
  const agentsDir = join(baseDir, '.claude', 'agents');

  try {
    const stats = await stat(agentsDir);
    if (!stats.isDirectory()) return [];
  } catch {
    return []; // Directory doesn't exist
  }

  const entries = await readdir(agentsDir);
  const agents: AgentDefinition[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;

    const filePath = join(agentsDir, entry);
    const name = basename(entry, extname(entry));

    try {
      const content = await readFile(filePath, 'utf-8');
      const frontmatter = parseFrontmatter(content);

      agents.push({
        name,
        description: (frontmatter.description as string) || `Agent: ${name}`,
        model: frontmatter.model as string | undefined,
        tools: frontmatter.tools as string[] | undefined,
        filePath,
        content,
      });
    } catch (err) {
      console.warn(`[agent-discovery] Failed to load ${entry}:`, (err as Error).message);
    }
  }

  return agents;
}

/**
 * Get a specific agent by name
 */
export async function getAgent(name: string, cwd?: string): Promise<AgentDefinition | null> {
  const agents = await discoverAgents(cwd);
  return agents.find(a => a.name === name) || null;
}

/**
 * List agent names (for autocomplete)
 */
export async function listAgentNames(cwd?: string): Promise<string[]> {
  const agents = await discoverAgents(cwd);
  return agents.map(a => a.name);
}

/**
 * Format agents for display
 */
export function formatAgentList(agents: AgentDefinition[]): string {
  if (agents.length === 0) {
    return 'No agents found in .claude/agents/';
  }

  const lines = ['Available agents:', ''];
  const maxName = Math.max(...agents.map(a => a.name.length));

  for (const agent of agents) {
    const name = agent.name.padEnd(maxName + 2);
    lines.push(`  ${name} ${agent.description}`);
  }

  return lines.join('\n');
}
