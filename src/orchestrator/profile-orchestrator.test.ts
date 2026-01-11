import { describe, it, expect } from 'bun:test';
import { selectPlanForProfile } from './profile-orchestrator';
import { getDefaultProfiles } from './profiles';
import type { AgentName } from '../executor/types';

const router = (agent: AgentName, confidence: number) => ({
  isAvailable: async () => true,
  routeTask: async () => ({ agent, confidence })
});

describe('profile orchestrator selection', () => {
  it('selects single mode for speed profile with high confidence', async () => {
    const profiles = getDefaultProfiles();
    const result = await selectPlanForProfile('Write a short note', profiles.speed, {
      router: router('gemini', 0.9)
    });

    expect(result.mode).toBe('single');
    expect(result.primaryAgent).toBe('gemini');
  });

  it('selects consensus when confidence is low and profile allows it', async () => {
    const profiles = getDefaultProfiles();
    const result = await selectPlanForProfile('Refactor auth flow', profiles.balanced, {
      router: router('claude', 0.1)
    });

    expect(result.mode).toBe('consensus');
    expect(result.agents.length).toBeGreaterThan(0);
  });
});
