import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import type { OrchestrationConfig } from '../orchestrator/profiles';
import { getDefaultOrchestrationConfig } from '../orchestrator/profiles';
import type { PermissionPolicy } from '../interactive/permission-router';

export interface InteractiveConfig {
  enabled: boolean;
  timeout: number;
  maxConcurrentSessions: number;
  maxQueueSize: number;
  watchdogTimeout: number;
  permissionPolicy: PermissionPolicy;
  adapters: {
    claude: { enabled: boolean };
    gemini: { enabled: boolean };
    codex: { enabled: boolean };
    factory: { enabled: boolean };
    crush: { enabled: boolean };
  };
}

export interface PulzdConfig {
  defaultAgent:
    | 'auto'
    | 'claude'
    | 'gemini'
    | 'gemini-safe'
    | 'gemini-unsafe'
    | 'codex'
    | 'codex-safe'
    | 'codex-unsafe'
    | 'ollama'
    | 'mistral'
    | 'factory'
    | 'crush';
  routerModel: string;
  timeout: number;
  fallbackAgent: string;
  confidenceThreshold: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  adapters: {
    claude: { enabled: boolean; path: string; model?: string };
    gemini: { enabled: boolean; path: string; model?: string };
    codex: { enabled: boolean; path: string; model?: string };
    ollama: { enabled: boolean; model: string; host: string; maxTokens?: number };
    mistral?: { enabled: boolean; path: string; model?: string };
    factory?: {
      enabled: boolean;
      path: string;
      model?: string;
      autonomy?: 'low' | 'medium' | 'high';
      reasoningEffort?: 'off' | 'low' | 'medium' | 'high' | 'xhigh';
      skipPermissions?: boolean;
      cwd?: string;
    };
    crush?: {
      enabled: boolean;
      path: string;
      model?: string;
      autoAccept?: boolean;
      debug?: boolean;
      cwd?: string;
    };
  };
  api: { port: number; host: string };
  ttyd: { port: number; enabled: boolean };
  orchestration: OrchestrationConfig;
  interactive?: InteractiveConfig;
  cloud?: {
    endpoint: string;
    token?: string;
    machineId?: string;
  };
  mcp?: {
    port: number;
    host: string;
  };
}

const CONFIG_DIR = join(homedir(), '.puzldai');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const TEST_CONFIG_DIR = join(tmpdir(), 'puzldai-test-config');
const OLD_CONFIG_DIR = join(homedir(), '.pulzdai');
const OLD_CONFIG_PATH = join(OLD_CONFIG_DIR, 'config.json');

const DEFAULT_INTERACTIVE: InteractiveConfig = {
  enabled: true,
  timeout: 120000,
  maxConcurrentSessions: 5,
  maxQueueSize: 10,
  watchdogTimeout: 60000,
  permissionPolicy: 'ask',
  adapters: {
    claude: { enabled: true },
    gemini: { enabled: true },
    codex: { enabled: true },
    factory: { enabled: true },
    crush: { enabled: true },
  },
};

const DEFAULT_CONFIG: PulzdConfig = {
  defaultAgent: 'auto',
  routerModel: 'llama3.2',
  timeout: 120000,
  fallbackAgent: 'claude',
  confidenceThreshold: 0.6,
  logLevel: 'info',
  adapters: {
    claude: { enabled: true, path: 'claude' },
    gemini: { enabled: true, path: 'gemini' },
    codex: { enabled: true, path: 'codex' },
    ollama: { enabled: false, model: 'llama3.2', host: 'http://localhost:11434' },
    mistral: { enabled: false, path: 'vibe' },
    factory: {
      enabled: true,
      path: 'droid',
      model: 'GLM-4.7',
      autonomy: 'low',
      reasoningEffort: 'medium'
    },
    crush: {
      enabled: true,
      path: 'crush',
      autoAccept: false,
      debug: false
    }
  },
  api: { port: 3000, host: '0.0.0.0' },
  ttyd: { port: 3001, enabled: true },
  orchestration: getDefaultOrchestrationConfig(),
  interactive: DEFAULT_INTERACTIVE,
  cloud: {
    endpoint: 'https://api.puzld.cc'
  },
  mcp: {
    port: 9234,
    host: '127.0.0.1'
  }
};

export function getConfigDir(): string {
  if (process.env.PUZLDAI_CONFIG_DIR) {
    return process.env.PUZLDAI_CONFIG_DIR;
  }
  if (process.env.NODE_ENV === 'test') {
    return TEST_CONFIG_DIR;
  }
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

export function loadConfig(): PulzdConfig {
  const configPath = getConfigPath();
  const configDir = getConfigDir();

  if (!existsSync(configPath) && existsSync(OLD_CONFIG_PATH)) {
    mkdirSync(configDir, { recursive: true });
    const oldConfig = readFileSync(OLD_CONFIG_PATH, 'utf-8');
    writeFileSync(configPath, oldConfig);
    console.log('Migrated config from ~/.pulzdai to ~/.puzldai');
  }

  if (!existsSync(configPath)) {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    console.warn('Invalid config file, using defaults');
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: PulzdConfig): void {
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

let configInstance: PulzdConfig | null = null;

export function getConfig(): PulzdConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}
