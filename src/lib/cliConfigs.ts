import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface CLIDefaults {
  claude: string | undefined;
  gemini: string | undefined;
  codex: string | undefined;
  ollama: string | undefined;
}

// Read Claude's default model from ~/.claude/settings.json
// Claude Code defaults to 'sonnet' if not specified
function readClaudeDefault(): string | undefined {
  try {
    const configPath = join(homedir(), '.claude', 'settings.json');
    if (!existsSync(configPath)) return 'sonnet';
    const content = JSON.parse(readFileSync(configPath, 'utf-8'));
    return content.model || 'sonnet';
  } catch {
    return 'sonnet';
  }
}

// Read Gemini's default model from ~/.gemini/settings.json
// Gemini CLI defaults to 'gemini-2.5-pro' if not specified
function readGeminiDefault(): string | undefined {
  try {
    const configPath = join(homedir(), '.gemini', 'settings.json');
    if (!existsSync(configPath)) return 'gemini-2.5-pro';
    const content = JSON.parse(readFileSync(configPath, 'utf-8'));
    return content.model?.name || 'gemini-2.5-pro';
  } catch {
    return 'gemini-2.5-pro';
  }
}

// Read Codex's default model from ~/.codex/config.toml
// Codex defaults to 'gpt-5.1-codex' if not specified
function readCodexDefault(): string | undefined {
  try {
    const configPath = join(homedir(), '.codex', 'config.toml');
    if (!existsSync(configPath)) return 'gpt-5.1-codex';
    const content = readFileSync(configPath, 'utf-8');
    // Simple TOML parse for model = "value"
    const match = content.match(/^model\s*=\s*"([^"]+)"/m);
    return match ? match[1] : 'gpt-5.1-codex';
  } catch {
    return 'gpt-5.1-codex';
  }
}

// Read Ollama's model - ollama doesn't have a global default config
function readOllamaDefault(): string | undefined {
  return undefined;
}

// Get all CLI defaults (read-only, called on startup)
export function getCLIDefaults(): CLIDefaults {
  return {
    claude: readClaudeDefault(),
    gemini: readGeminiDefault(),
    codex: readCodexDefault(),
    ollama: readOllamaDefault(),
  };
}

// Get a specific CLI's default model
export function getCLIDefault(agent: 'claude' | 'gemini' | 'codex' | 'ollama'): string | undefined {
  switch (agent) {
    case 'claude': return readClaudeDefault();
    case 'gemini': return readGeminiDefault();
    case 'codex': return readCodexDefault();
    case 'ollama': return readOllamaDefault();
  }
}
