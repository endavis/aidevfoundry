/**
 * Plan builders for different execution modes
 *
 * Each builder creates an ExecutionPlan from user input
 */

import type {
  AgentName,
  ExecutionPlan,
  PlanStep,
  CompareOptions,
  PipelineOptions,
  PipelineStep
} from './types';

function generatePlanId(): string {
  return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateStepId(index: number): string {
  return `step_${index}`;
}

/**
 * Build a single-agent plan
 *
 * Usage: ai run "task" [--agent claude]
 */
export function buildSingleAgentPlan(
  prompt: string,
  agent: AgentName | 'auto' = 'auto'
): ExecutionPlan {
  return {
    id: generatePlanId(),
    mode: 'single',
    prompt,
    steps: [
      {
        id: generateStepId(0),
        agent,
        action: 'prompt',
        prompt: '{{prompt}}',
        outputAs: 'result'
      }
    ],
    createdAt: Date.now()
  };
}

/**
 * Build a compare plan (parallel or sequential)
 *
 * Usage: ai compare "task" --agents claude,gemini,ollama
 */
export function buildComparePlan(
  prompt: string,
  options: CompareOptions
): ExecutionPlan {
  const { agents, sequential = false, pick = false } = options;

  const steps: PlanStep[] = agents.map((agent, i) => ({
    id: generateStepId(i),
    agent,
    action: 'prompt' as const,
    prompt: '{{prompt}}',
    outputAs: `response_${agent}`,
    // Sequential mode: each step depends on previous
    dependsOn: sequential && i > 0 ? [generateStepId(i - 1)] : undefined
  }));

  // Add a combine step if pick mode
  if (pick) {
    steps.push({
      id: generateStepId(agents.length),
      agent: 'auto',
      action: 'combine',
      prompt: buildPickPrompt(agents),
      dependsOn: agents.map((_, i) => generateStepId(i)),
      outputAs: 'selected'
    });
  }

  return {
    id: generatePlanId(),
    mode: 'compare',
    prompt,
    steps,
    createdAt: Date.now()
  };
}

function buildPickPrompt(agents: AgentName[]): string {
  const refs = agents.map(a => `**${a}:**\n{{response_${a}}}`).join('\n\n');
  return `Compare these responses and select the best one. Explain why briefly, then output ONLY the selected response.

${refs}

Selected response:`;
}

/**
 * Build a pipeline plan (sequential with dependencies)
 *
 * Usage: ai run "task" --pipeline "gemini:analyze,claude:code,ollama:review"
 */
export function buildPipelinePlan(
  prompt: string,
  options: PipelineOptions
): ExecutionPlan {
  const steps: PlanStep[] = options.steps.map((step, i) => ({
    id: generateStepId(i),
    agent: step.agent,
    action: 'prompt',
    prompt: buildPipelineStepPrompt(step, i),
    dependsOn: i > 0 ? [generateStepId(i - 1)] : undefined,
    outputAs: `step${i}_output`
  }));

  return {
    id: generatePlanId(),
    mode: 'pipeline',
    prompt,
    steps,
    createdAt: Date.now()
  };
}

function buildPipelineStepPrompt(step: PipelineStep, index: number): string {
  if (step.promptTemplate) {
    return step.promptTemplate;
  }

  const prevRef = index > 0 ? `\n\nPrevious step output:\n{{step${index - 1}_output}}` : '';

  switch (step.action) {
    case 'analyze':
      return `Analyze the following task and provide insights:

{{prompt}}${prevRef}`;

    case 'code':
      return `Write code for the following task:

{{prompt}}${prevRef}`;

    case 'review':
      return `Review the following and suggest improvements:

{{prompt}}${prevRef}`;

    case 'fix':
      return `Fix any issues in the following:

{{prompt}}${prevRef}`;

    case 'test':
      return `Write tests for the following:

{{prompt}}${prevRef}`;

    case 'summarize':
      return `Summarize the following concisely:

{{prompt}}${prevRef}`;

    default:
      return `${step.action}:

{{prompt}}${prevRef}`;
  }
}

/**
 * Parse pipeline string into PipelineOptions
 *
 * Format: "agent:action,agent:action,..."
 * Example: "gemini:analyze,claude:code,ollama:review"
 */
export function parsePipelineString(pipeline: string): PipelineOptions {
  const steps: PipelineStep[] = pipeline.split(',').map(part => {
    const [agentStr, action = 'prompt'] = part.trim().split(':');
    const agent = agentStr.trim() as AgentName | 'auto';
    return { agent, action: action.trim() };
  });

  return { steps };
}

/**
 * Parse compare agents string
 *
 * Format: "agent1,agent2,agent3"
 * Example: "claude,gemini,ollama"
 */
export function parseAgentsString(agents: string): AgentName[] {
  return agents.split(',').map(a => a.trim() as AgentName);
}
