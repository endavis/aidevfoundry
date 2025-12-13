/**
 * Config Detector (Phase 12)
 *
 * Detects project-level configuration:
 * - AGENTS.md (project instructions)
 * - .puzldai/ config directory
 * - CLAUDE.md, CODEX.md (agent-specific instructions)
 * - .github/copilot-instructions.md
 *
 * These files are automatically injected into prompts.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, basename } from 'path';

export interface ProjectConfig {
  /** Project root directory */
  rootDir: string;
  /** Main project instructions (AGENTS.md) */
  agentsInstructions?: string;
  /** Agent-specific instructions */
  agentInstructions: Map<string, string>;
  /** Project-level config from .puzldai/config.json */
  puzldConfig?: Record<string, unknown>;
  /** Detected config files */
  configFiles: string[];
}

/** Known instruction file names (priority order) */
const INSTRUCTION_FILES = [
  'AGENTS.md',           // PuzldAI / Droid style
  'CLAUDE.md',           // Claude-specific
  'CODEX.md',            // Codex-specific
  'CURSOR_RULES.md',     // Cursor style
  '.cursorrules',        // Cursor rules file
  'COPILOT.md',          // GitHub Copilot
  '.github/copilot-instructions.md', // GitHub Copilot official
  'AI_INSTRUCTIONS.md',  // Generic
  'CONTEXT.md',          // Context file
];

/** Agent name mappings for specific instruction files */
const AGENT_FILE_MAP: Record<string, string> = {
  'CLAUDE.md': 'claude',
  'CODEX.md': 'codex',
  'GEMINI.md': 'gemini',
  'OLLAMA.md': 'ollama',
  'MISTRAL.md': 'mistral',
};

/**
 * Detect project configuration
 */
export function detectProjectConfig(rootDir: string): ProjectConfig {
  const config: ProjectConfig = {
    rootDir,
    agentInstructions: new Map(),
    configFiles: [],
  };

  // Check for instruction files
  for (const fileName of INSTRUCTION_FILES) {
    const filePath = join(rootDir, fileName);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      config.configFiles.push(fileName);

      // Check if it's agent-specific
      const baseName = basename(fileName).toUpperCase().replace('.MD', '.md');
      const agent = AGENT_FILE_MAP[baseName];

      if (agent) {
        config.agentInstructions.set(agent, content);
      } else if (!config.agentsInstructions) {
        // First generic instruction file becomes main instructions
        config.agentsInstructions = content;
      }
    }
  }

  // Check .puzldai directory
  const puzldaiDir = join(rootDir, '.puzldai');
  if (existsSync(puzldaiDir)) {
    // Load config.json if exists
    const configPath = join(puzldaiDir, 'config.json');
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        config.puzldConfig = JSON.parse(content);
        config.configFiles.push('.puzldai/config.json');
      } catch {
        // Ignore parse errors
      }
    }

    // Load agent-specific instructions from .puzldai/
    const agentFiles = ['claude.md', 'codex.md', 'gemini.md', 'ollama.md', 'mistral.md'];
    for (const agentFile of agentFiles) {
      const agentPath = join(puzldaiDir, agentFile);
      if (existsSync(agentPath)) {
        const content = readFileSync(agentPath, 'utf-8');
        const agent = agentFile.replace('.md', '');
        config.agentInstructions.set(agent, content);
        config.configFiles.push(`.puzldai/${agentFile}`);
      }
    }
  }

  return config;
}

/**
 * Get instructions for a specific agent
 */
export function getAgentInstructions(config: ProjectConfig, agent: string): string | undefined {
  // Check agent-specific first
  const specific = config.agentInstructions.get(agent);
  if (specific) {
    return specific;
  }

  // Fall back to general instructions
  return config.agentsInstructions;
}

/**
 * Format instructions for prompt injection
 */
export function formatInstructions(
  config: ProjectConfig,
  agent: string,
  format: 'xml' | 'markdown' = 'xml'
): string {
  const instructions = getAgentInstructions(config, agent);
  if (!instructions) {
    return '';
  }

  if (format === 'xml') {
    return `<project_instructions>
${instructions}
</project_instructions>`;
  }

  return `## Project Instructions

${instructions}`;
}

/**
 * Get a summary of detected config
 */
export function getConfigSummary(config: ProjectConfig): string {
  const lines: string[] = [];

  if (config.configFiles.length === 0) {
    return 'No project configuration detected.';
  }

  lines.push('Detected configuration files:');
  for (const file of config.configFiles) {
    lines.push(`  - ${file}`);
  }

  if (config.agentsInstructions) {
    const preview = config.agentsInstructions.slice(0, 100).replace(/\n/g, ' ');
    lines.push(`\nMain instructions: "${preview}..."`);
  }

  if (config.agentInstructions.size > 0) {
    lines.push('\nAgent-specific instructions:');
    for (const [agent] of config.agentInstructions) {
      lines.push(`  - ${agent}`);
    }
  }

  return lines.join('\n');
}

/**
 * Create a default AGENTS.md template
 */
export function createAgentsTemplate(): string {
  return `# Project Instructions

This file provides context to AI assistants working on this codebase.

## Project Overview

<!-- Describe your project here -->

## Architecture

<!-- Describe key architectural decisions -->

## Coding Standards

<!-- List coding conventions, style guides, etc. -->

## Important Files

<!-- List key files the AI should know about -->

## Common Tasks

<!-- Document common development tasks -->

## Testing

<!-- Describe how to run tests -->

## Notes

<!-- Any other important context -->
`;
}

/**
 * Check if project has configuration
 */
export function hasProjectConfig(rootDir: string): boolean {
  for (const fileName of INSTRUCTION_FILES) {
    if (existsSync(join(rootDir, fileName))) {
      return true;
    }
  }
  if (existsSync(join(rootDir, '.puzldai'))) {
    return true;
  }
  return false;
}

/**
 * Initialize project configuration
 */
export function initProjectConfig(rootDir: string): void {
  const agentsPath = join(rootDir, 'AGENTS.md');
  if (!existsSync(agentsPath)) {
    const template = createAgentsTemplate();
    writeFileSync(agentsPath, template, 'utf-8');
  }
}
