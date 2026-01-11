import type { AgentName, ExecutionPlan } from '../executor/types';
import { getConfig } from '../lib/config';
import { isRouterAvailable, routeTask } from '../router/router';
import { resolveAgentSelection } from '../lib/agent-selection';
import {
  buildSingleAgentPlan,
  buildPipelinePlan,
  buildConsensusPlan,
  buildPickBuildPlan,
  buildProfilePipelineSteps
} from '../executor/plan-builders';
import type { OrchestrationProfile } from './profiles';

export interface ProfileSelectionResult {
  mode: 'single' | 'pipeline' | 'consensus' | 'pickbuild' | 'supervise';
  plan?: ExecutionPlan;
  orchestrateMode?: 'delegate' | 'coordinate' | 'supervise';
  agents: AgentName[];
  primaryAgent: AgentName;
  rationale: string;
}

export interface RouterOverride {
  isAvailable: () => Promise<boolean>;
  routeTask: (task: string) => Promise<{ agent: AgentName; confidence: number; taskType?: string }>;
}

const AGENT_PRIORITY: AgentName[] = [
  'claude',
  'gemini-safe',
  'codex-safe',
  'gemini',
  'codex',
  'gemini-unsafe',
  'codex-unsafe',
  'mistral',
  'ollama',
  'factory',
  'crush'
];

const COMPLEXITY_KEYWORDS = [
  'architecture',
  'refactor',
  'migration',
  'multi-file',
  'pipeline',
  'workflow',
  'orchestration',
  'consensus',
  'pickbuild',
  'review',
  'tests'
];

export async function selectPlanForProfile(
  task: string,
  profile: OrchestrationProfile,
  overrides?: { router?: RouterOverride }
): Promise<ProfileSelectionResult> {
  const config = getConfig();
  const route = await getRoute(task, profile.allowAgents, overrides?.router);
  const selection = resolveAgentSelection(route.agent);
  const primaryAgent = selection.agent as AgentName;

  const normalizedTask = task.toLowerCase();
  const wordCount = task.trim().split(/\s+/).filter(Boolean).length;
  const hasComplexitySignal = COMPLEXITY_KEYWORDS.some(keyword => normalizedTask.includes(keyword));
  const isComplexTask = wordCount >= 120 || hasComplexitySignal;

  const preferredModes = profile.preferredModes;
  const supportedModes = preferredModes.filter(mode =>
    mode === 'single' ||
    mode === 'pipeline' ||
    mode === 'consensus' ||
    mode === 'pickbuild' ||
    mode === 'supervise'
  );

  const lowConfidence = route.confidence < config.confidenceThreshold;

  if (profile.requireReview && supportedModes.includes('supervise')) {
    return buildSuperviseSelection(profile, primaryAgent, 'profile requires review');
  }

  if (lowConfidence && supportedModes.includes('consensus')) {
    return buildConsensusSelection(task, profile, primaryAgent, 'low router confidence');
  }

  if (isComplexTask && supportedModes.includes('pickbuild')) {
    return buildPickBuildSelection(task, profile, primaryAgent, 'complex task signals detected');
  }

  if (isComplexTask && supportedModes.includes('pipeline')) {
    return buildPipelineSelection(task, profile, primaryAgent, 'pipeline preferred for complex task');
  }

  if (supportedModes.includes('single')) {
    return buildSingleSelection(task, profile, primaryAgent, 'defaulting to single');
  }

  if (supportedModes.length > 0) {
    const fallback = supportedModes[0];
    if (fallback === 'pipeline') {
      return buildPipelineSelection(task, profile, primaryAgent, 'fallback to pipeline');
    }
    if (fallback === 'consensus') {
      return buildConsensusSelection(task, profile, primaryAgent, 'fallback to consensus');
    }
    if (fallback === 'pickbuild') {
      return buildPickBuildSelection(task, profile, primaryAgent, 'fallback to pickbuild');
    }
  }

  return buildSingleSelection(task, profile, primaryAgent, 'fallback to single');
}

async function getRoute(
  task: string,
  allowedAgents: AgentName[],
  override?: RouterOverride
): Promise<{ agent: AgentName; confidence: number }> {
  if (override && await override.isAvailable()) {
    const route = await override.routeTask(task);
    if (route.agent && allowedAgents.includes(route.agent)) {
      return { agent: route.agent, confidence: route.confidence };
    }
  } else if (await isRouterAvailable()) {
    const route = await routeTask(task);
    if (route.agent && allowedAgents.includes(route.agent as AgentName)) {
      return { agent: route.agent as AgentName, confidence: route.confidence };
    }
  }

  const fallback = allowedAgents[0] || 'claude';
  return { agent: fallback, confidence: 0 };
}

function filterAgents(allowedAgents: AgentName[]): AgentName[] {
  const allowed = allowedAgents.length > 0 ? allowedAgents : AGENT_PRIORITY;
  return AGENT_PRIORITY.filter(agent => allowed.includes(agent));
}

function buildSingleSelection(
  task: string,
  profile: OrchestrationProfile,
  primaryAgent: AgentName,
  reason: string
): ProfileSelectionResult {
  const plan = buildSingleAgentPlan(task, primaryAgent);
  return {
    mode: 'single',
    plan,
    agents: [primaryAgent],
    primaryAgent,
    rationale: `Selected single mode (${reason}).`
  };
}

function buildPipelineSelection(
  task: string,
  profile: OrchestrationProfile,
  primaryAgent: AgentName,
  reason: string
): ProfileSelectionResult {
  const agents = filterAgents(profile.allowAgents);
  const steps = buildProfilePipelineSteps({
    primaryAgent,
    allowAgents: agents,
    includeReview: profile.requireReview
  });
  const plan = buildPipelinePlan(task, { steps });

  return {
    mode: 'pipeline',
    plan,
    agents,
    primaryAgent,
    rationale: `Selected pipeline mode (${reason}).`
  };
}

function buildConsensusSelection(
  task: string,
  profile: OrchestrationProfile,
  primaryAgent: AgentName,
  reason: string
): ProfileSelectionResult {
  const agents = filterAgents(profile.allowAgents).slice(0, 3);
  const plan = buildConsensusPlan(task, {
    agents,
    maxRounds: profile.consensusRounds,
    synthesizer: primaryAgent
  });

  return {
    mode: 'consensus',
    plan,
    agents,
    primaryAgent,
    rationale: `Selected consensus mode (${reason}).`
  };
}

function buildPickBuildSelection(
  task: string,
  profile: OrchestrationProfile,
  primaryAgent: AgentName,
  reason: string
): ProfileSelectionResult {
  const agents = filterAgents(profile.allowAgents).slice(0, 2);
  const reviewer = profile.requireReview ? agents[1] : undefined;

  const plan = buildPickBuildPlan(task, {
    agents,
    buildAgent: primaryAgent,
    picker: primaryAgent,
    reviewer,
    sequential: false,
    format: 'json',
    skipReview: !profile.requireReview
  });

  return {
    mode: 'pickbuild',
    plan,
    agents,
    primaryAgent,
    rationale: `Selected pickbuild mode (${reason}).`
  };
}

function buildSuperviseSelection(
  profile: OrchestrationProfile,
  primaryAgent: AgentName,
  reason: string
): ProfileSelectionResult {
  const agents = filterAgents(profile.allowAgents).slice(0, 2);
  const supervisor = agents[0] || primaryAgent;
  const worker = agents[1] || primaryAgent;

  return {
    mode: 'supervise',
    orchestrateMode: 'supervise',
    agents: [supervisor, worker],
    primaryAgent: supervisor,
    rationale: `Selected supervise mode (${reason}).`
  };
}
