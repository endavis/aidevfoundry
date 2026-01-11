import type { AgentName, PlanMode } from '../executor/types';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export type OrchestrationMode = PlanMode | 'supervise';

export interface OrchestrationProfile {
  name: string;
  preferredModes: OrchestrationMode[];
  maxConcurrency: number;
  consensusRounds: number;
  requireReview: boolean;
  allowAgents: AgentName[];
  useContextCompression: boolean;
  timeoutBudgetMs: number;
}

export interface OrchestrationConfig {
  defaultProfile: string;
  profiles: Record<string, OrchestrationProfile>;
}

const KNOWN_MODES: OrchestrationMode[] = [
  'single',
  'compare',
  'pipeline',
  'auto',
  'debate',
  'consensus',
  'correction',
  'pickbuild',
  'pkpoet',
  'poetiq',
  'adversary',
  'selfdiscover',
  'codereason',
  'largefeature',
  'supervise'
];

const KNOWN_AGENTS: AgentName[] = [
  'claude',
  'gemini',
  'gemini-safe',
  'gemini-unsafe',
  'codex',
  'codex-safe',
  'codex-unsafe',
  'ollama',
  'mistral',
  'factory',
  'crush'
];

const DEFAULT_PROFILES: Record<string, OrchestrationProfile> = {
  speed: {
    name: 'speed',
    preferredModes: ['single', 'pipeline'],
    maxConcurrency: 4,
    consensusRounds: 1,
    requireReview: false,
    allowAgents: [...KNOWN_AGENTS],
    useContextCompression: false,
    timeoutBudgetMs: 60000
  },
  balanced: {
    name: 'balanced',
    preferredModes: ['pipeline', 'supervise', 'consensus'],
    maxConcurrency: 3,
    consensusRounds: 2,
    requireReview: false,
    allowAgents: [...KNOWN_AGENTS],
    useContextCompression: true,
    timeoutBudgetMs: 120000
  },
  quality: {
    name: 'quality',
    preferredModes: ['consensus', 'pickbuild', 'supervise', 'pipeline'],
    maxConcurrency: 2,
    consensusRounds: 3,
    requireReview: true,
    allowAgents: ['claude', 'gemini', 'codex', 'mistral'],
    useContextCompression: true,
    timeoutBudgetMs: 180000
  }
};

export function getDefaultProfiles(): Record<string, OrchestrationProfile> {
  return JSON.parse(JSON.stringify(DEFAULT_PROFILES)) as Record<string, OrchestrationProfile>;
}

export function getDefaultOrchestrationConfig(): OrchestrationConfig {
  return {
    defaultProfile: 'speed',
    profiles: getDefaultProfiles()
  };
}

export function validateProfile(profile: OrchestrationProfile): string[] {
  const errors: string[] = [];

  if (!profile.name || profile.name.trim() === '') {
    errors.push('Profile name is required.');
  }

  if (!Array.isArray(profile.preferredModes) || profile.preferredModes.length === 0) {
    errors.push('preferredModes must be a non-empty array.');
  } else {
    const unknownModes = profile.preferredModes.filter(mode => !KNOWN_MODES.includes(mode));
    if (unknownModes.length > 0) {
      errors.push('Unknown preferredModes: ' + unknownModes.join(', '));
    }
  }

  if (!Number.isFinite(profile.maxConcurrency) || profile.maxConcurrency < 1) {
    errors.push('maxConcurrency must be >= 1.');
  }

  if (!Number.isFinite(profile.consensusRounds) || profile.consensusRounds < 1) {
    errors.push('consensusRounds must be >= 1.');
  }

  if (typeof profile.requireReview !== 'boolean') {
    errors.push('requireReview must be boolean.');
  }

  if (!Array.isArray(profile.allowAgents) || profile.allowAgents.length === 0) {
    errors.push('allowAgents must be a non-empty array.');
  } else {
    const unknownAgents = profile.allowAgents.filter(agent => !KNOWN_AGENTS.includes(agent));
    if (unknownAgents.length > 0) {
      errors.push('Unknown allowAgents: ' + unknownAgents.join(', '));
    }
  }

  if (typeof profile.useContextCompression !== 'boolean') {
    errors.push('useContextCompression must be boolean.');
  }

  if (!Number.isFinite(profile.timeoutBudgetMs) || profile.timeoutBudgetMs < 1000) {
    errors.push('timeoutBudgetMs must be >= 1000.');
  }

  return errors;
}

export function validateOrchestrationConfig(config: OrchestrationConfig): string[] {
  const errors: string[] = [];

  if (!config.defaultProfile || config.defaultProfile.trim() === '') {
    errors.push('defaultProfile is required.');
  }

  const profiles = config.profiles || {};
  const profileKeys = Object.keys(profiles);
  if (profileKeys.length === 0) {
    errors.push('profiles must contain at least one profile.');
  }

  for (const key of profileKeys) {
    const profile = profiles[key];
    if (!profile) {
      errors.push('Profile entry missing for key: ' + key);
      continue;
    }
    if (profile.name !== key) {
      errors.push('Profile name must match key: ' + key);
    }
    errors.push(...validateProfile(profile));
  }

  if (config.defaultProfile && profileKeys.length > 0 && !profiles[config.defaultProfile]) {
    errors.push('defaultProfile does not match any profile: ' + config.defaultProfile);
  }

  return errors;
}

const PROFILE_DIR = join(homedir(), '.puzldai');
const PROFILES_PATH = join(PROFILE_DIR, 'profiles.json');

export function getProfilesPath(): string {
  return PROFILES_PATH;
}

export function loadProfilesFile(): OrchestrationConfig | null {
  if (!existsSync(PROFILES_PATH)) {
    return null;
  }

  try {
    const raw = readFileSync(PROFILES_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as OrchestrationConfig;
    return normalizeOrchestrationConfig(parsed);
  } catch {
    return null;
  }
}

export function saveProfilesFile(config: OrchestrationConfig): void {
  mkdirSync(PROFILE_DIR, { recursive: true });
  writeFileSync(PROFILES_PATH, JSON.stringify(config, null, 2));
}

export function normalizeOrchestrationConfig(
  config: Partial<OrchestrationConfig> | undefined
): OrchestrationConfig {
  const defaults = getDefaultOrchestrationConfig();
  const profiles = {
    ...defaults.profiles,
    ...(config?.profiles || {})
  };

  const defaultProfile = config?.defaultProfile || defaults.defaultProfile;

  for (const [key, profile] of Object.entries(profiles)) {
    if (!profile.name) {
      profile.name = key;
    }
  }

  return {
    defaultProfile,
    profiles
  };
}

export function resolveOrchestrationConfig(
  configFromSettings?: OrchestrationConfig
): OrchestrationConfig {
  const fileConfig = loadProfilesFile();
  if (fileConfig) {
    return fileConfig;
  }
  return normalizeOrchestrationConfig(configFromSettings);
}

