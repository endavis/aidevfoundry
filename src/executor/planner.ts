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
- claude: Best for coding, code generation, architecture, creative writing
- gemini: Best for analysis, research, planning, data processing (auto-redirects to gemini-safe)
- codex: Best for debugging, security analysis, finding bugs, code review (auto-redirects to codex-safe)
- ollama: Best for simple queries, local processing, fast responses

Guidelines:
- Use claude for code writing steps
- Use gemini for analysis/planning steps
- Use codex for review/debug steps
- Create multi-step plans that leverage different agents' strengths

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

    const { parsed, parseError } = parseResponseWithError(result.content);

    if (!parsed) {
      // Provide hint about what went wrong
      const preview = result.content.slice(0, 200);
      return {
        plan: null,
        error: `Failed to parse plan${parseError ? `: ${parseError}` : ''}. Response preview: ${preview}${result.content.length > 200 ? '...' : ''}`
      };
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

function parseResponseWithError(content: string): { parsed: RawPlan | null; parseError?: string } {
  let jsonStr = content.trim();

  // Remove markdown code blocks if present (various formats)
  // Handle: ```json\n...\n``` or ```\n...\n``` anywhere in content
  jsonStr = jsonStr
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // Try to find JSON object - greedy match for nested objects
  let match = jsonStr.match(/\{[\s\S]*\}/);

  // If no match, the LLM might have returned just steps array
  if (!match) {
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      // Wrap in object
      jsonStr = `{"steps": ${arrayMatch[0]}}`;
      match = jsonStr.match(/\{[\s\S]*\}/);
    }
  }

  if (!match) {
    return { parsed: null, parseError: 'No JSON object found in response' };
  }

  // Clean up common JSON issues
  const cleanJson = match[0]
    .replace(/,\s*}/g, '}')  // Trailing commas
    .replace(/,\s*]/g, ']')  // Trailing commas in arrays
    .replace(/'/g, '"');     // Single quotes to double

  try {
    const parsed = JSON.parse(cleanJson) as RawPlan;

    if (!parsed.steps || !Array.isArray(parsed.steps)) {
      return { parsed: null, parseError: 'JSON missing "steps" array' };
    }

    // Validate steps have required fields
    for (const step of parsed.steps) {
      if (!step.agent || !step.action) {
        // Try to fill in defaults
        step.agent = step.agent || 'auto';
        step.action = step.action || 'prompt';
        step.description = step.description || step.action;
      }
    }

    return { parsed };
  } catch (err) {
    const jsonError = (err as Error).message;

    // Last resort: try to extract steps manually
    try {
      const stepsMatch = content.match(/"steps"\s*:\s*\[([\s\S]*?)\]/);
      if (stepsMatch) {
        const stepsJson = `[${stepsMatch[1]}]`
          .replace(/,\s*]/g, ']')
          .replace(/'/g, '"');
        const steps = JSON.parse(stepsJson) as RawPlanStep[];
        if (steps.length > 0) {
          return { parsed: { steps } };
        }
      }
    } catch {
      // Give up
    }
    return { parsed: null, parseError: jsonError };
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
  const allowed = new Set([
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
  ]);
  if (allowed.has(normalized)) {
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
