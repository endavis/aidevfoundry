/**
 * LLM-based plan generator
 *
 * Uses an LLM to analyze a task and generate an ExecutionPlan
 */

import type { ExecutionPlan, PlanStep, AgentName, StepAction } from './types';
import { adapters } from '../adapters';
import { getConfig } from '../lib/config';

const PLANNER_PROMPT = `You are a task planner for a multi-LLM system. Analyze the user's task and create an execution plan.

Available agents:
- claude: Best for complex coding, debugging, architecture, creative writing
- gemini: Best for analysis, research, multi-modal tasks, data processing
- codex: Best for quick code generation, scripts, simple tasks
- ollama: Best for simple queries, local processing, fast responses

Actions you can assign:
- analyze: Examine and provide insights
- code: Write or generate code
- review: Review and suggest improvements
- fix: Fix issues or bugs
- test: Generate tests
- summarize: Condense information

Output a JSON plan with this exact structure:
{
  "steps": [
    {
      "agent": "agent_name",
      "action": "action_type",
      "description": "What this step does"
    }
  ],
  "reasoning": "Brief explanation of why this plan"
}

Rules:
1. Use 1-5 steps (prefer fewer)
2. Each step should have a clear purpose
3. Later steps can reference earlier outputs
4. Match agents to their strengths
5. Output ONLY valid JSON, no markdown

Task: `;

interface PlannerResult {
  plan: ExecutionPlan | null;
  reasoning?: string;
  error?: string;
}

interface RawPlanStep {
  agent: string;
  action: string;
  description: string;
}

interface RawPlan {
  steps: RawPlanStep[];
  reasoning?: string;
}

/**
 * Generate an execution plan using an LLM
 */
export async function generatePlan(
  task: string,
  plannerAgent: AgentName = 'ollama'
): Promise<PlannerResult> {
  const config = getConfig();
  const adapter = adapters[plannerAgent];

  if (!adapter) {
    return { plan: null, error: `Planner agent "${plannerAgent}" not found` };
  }

  if (!(await adapter.isAvailable())) {
    const fallback = adapters[config.fallbackAgent as AgentName];
    if (fallback && await fallback.isAvailable()) {
      return generatePlanWithAdapter(task, fallback, config.fallbackAgent);
    }
    return { plan: null, error: `Planner agent "${plannerAgent}" not available` };
  }

  return generatePlanWithAdapter(task, adapter, plannerAgent);
}

async function generatePlanWithAdapter(
  task: string,
  adapter: typeof adapters[AgentName],
  _agentName: string
): Promise<PlannerResult> {
  try {
    const prompt = PLANNER_PROMPT + task;
    const result = await adapter.run(prompt, {});

    if (result.error) {
      return { plan: null, error: result.error };
    }

    const parsed = parseResponse(result.content);

    if (!parsed) {
      return { plan: null, error: 'Failed to parse plan from LLM response' };
    }

    const plan = buildPlanFromRaw(task, parsed);

    return {
      plan,
      reasoning: parsed.reasoning
    };
  } catch (err) {
    return { plan: null, error: (err as Error).message };
  }
}

function parseResponse(content: string): RawPlan | null {
  let jsonStr = content.trim();

  // Remove markdown code blocks if present
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  // Find JSON object
  const match = jsonStr.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[0]) as RawPlan;

    if (!parsed.steps || !Array.isArray(parsed.steps)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function buildPlanFromRaw(task: string, raw: RawPlan): ExecutionPlan {
  const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const steps: PlanStep[] = raw.steps.map((step, i) => {
    const agent = normalizeAgent(step.agent);

    return {
      id: `step_${i}`,
      agent,
      action: step.action as StepAction,
      prompt: buildStepPrompt(step, i),
      dependsOn: i > 0 ? [`step_${i - 1}`] : undefined,
      outputAs: `step${i}_output`
    };
  });

  return {
    id: planId,
    mode: 'auto',
    prompt: task,
    steps,
    createdAt: Date.now()
  };
}

function normalizeAgent(agent: string): AgentName | 'auto' {
  const normalized = agent.toLowerCase().trim();
  if (['claude', 'gemini', 'codex', 'ollama'].includes(normalized)) {
    return normalized as AgentName;
  }
  return 'auto';
}

function buildStepPrompt(step: RawPlanStep, index: number): string {
  const desc = step.description || step.action;
  const prevRef = index > 0 ? `\n\nPrevious step output:\n{{step${index - 1}_output}}` : '';

  return `${desc}

Original task: {{prompt}}${prevRef}`;
}

/**
 * Format plan for display
 */
export function formatPlanForDisplay(plan: ExecutionPlan, reasoning?: string): string {
  const lines: string[] = [];

  lines.push(`Plan ID: ${plan.id}`);
  lines.push(`Mode: ${plan.mode}`);
  lines.push(`Steps: ${plan.steps.length}`);
  lines.push('');

  if (reasoning) {
    lines.push(`Reasoning: ${reasoning}`);
    lines.push('');
  }

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    lines.push(`${i + 1}. [${step.agent}] ${step.action}`);
    if (step.dependsOn?.length) {
      lines.push(`   depends on: ${step.dependsOn.join(', ')}`);
    }
  }

  return lines.join('\n');
}
