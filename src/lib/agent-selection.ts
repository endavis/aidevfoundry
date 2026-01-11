import type { AgentName } from '../executor/types';

export interface AgentSelectionResult {
  agent: AgentName | 'auto';
  notice?: string;
}

export function resolveAgentSelection(agent: AgentName | 'auto'): AgentSelectionResult {
  switch (agent) {
    case 'gemini':
      return {
        agent: 'gemini-safe',
        notice: 'Auto-redirecting gemini to gemini-safe (use gemini-unsafe to override).'
      };
    case 'codex':
      return {
        agent: 'codex-safe',
        notice: 'Auto-redirecting codex to codex-safe (use codex-unsafe to override).'
      };
    case 'gemini-unsafe':
      return {
        agent: 'gemini',
        notice: 'Using gemini-unsafe (no approval interception).'
      };
    case 'codex-unsafe':
      return {
        agent: 'codex',
        notice: 'Using codex-unsafe (no approval interception).'
      };
    default:
      return { agent };
  }
}

export function resolveInteractiveAgent(agent: AgentName | 'auto'): AgentSelectionResult {
  if (agent === 'gemini-safe') {
    return {
      agent: 'gemini',
      notice: 'gemini-safe is not supported in interactive mode; using gemini (unsafe).'
    };
  }
  if (agent === 'codex-safe') {
    return {
      agent: 'codex',
      notice: 'codex-safe is not supported in interactive mode; using codex (unsafe).'
    };
  }
  return resolveAgentSelection(agent);
}
