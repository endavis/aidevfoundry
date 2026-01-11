/**
 * Intelligent Orchestrator - Coordinates multi-agent workflows
 *
 * Capabilities:
 * - Dynamic task decomposition
 * - Multi-agent coordination with context passing
 * - Interactive tool session management
 * - Intelligent response routing
 */

import type { ModelResponse, RunOptions } from '../lib/types';
import { getConfig } from '../lib/config';
import { adapters } from '../adapters';
import { routeTask, isRouterAvailable } from '../router/router';
import { runAgentLoop } from '../agentic/agent-loop';

export interface OrchestrateOptions extends RunOptions {
  agent?: string;
  mode?: 'single' | 'delegate' | 'coordinate' | 'supervise';
  agents?: string[];
  maxIterations?: number;
  onAgentResponse?: (agent: string, response: ModelResponse) => void;
  onToolCall?: (agent: string, tool: string, args: Record<string, unknown>) => void;
  context?: Record<string, unknown>;
}

export interface OrchestrationResult {
  content: string;
  model: string;
  iterations: number;
  agentCount: number;
  toolCalls: number;
  workflow: AgentExecution[];
  duration: number;
}

export interface AgentExecution {
  agent: string;
  model: string;
  duration: number;
  tokens: { input: number; output: number };
  content: string;
  toolCalls: number;
}

const ORCHESTRATOR_SYSTEM_PROMPT = `You are an intelligent orchestration coordinator. Your role is to:

1. ANALYZE the user's task and decompose it into logical steps
2. DELEGATE each step to the most appropriate agent
3. COORDINATE context passing between agents
4. SUPERVISE execution and handle errors gracefully
5. SYNTHESIZE final results into a coherent response

Available agents and their strengths:
- claude: Complex coding, architecture, debugging, multi-file refactoring
- gemini: Analysis, research, explanations, documentation
- codex: Quick code generation, simple scripts, prototypes
- ollama: Simple queries, local processing, basic questions
- factory: CLI tasks, shell operations, system commands
- mistral: General purpose, balanced capabilities

Your response should be a JSON object describing the orchestration plan:
{
  "decomposition": [
    {"step": 1, "agent": "claude", "task": "Design the solution", "dependsOn": []},
    {"step": 2, "agent": "codex", "task": "Generate initial code", "dependsOn": [1]},
    {"step": 3, "agent": "claude", "task": "Review and refine", "dependsOn": [2]}
  ],
  "strategy": "sequential", // or "parallel", "hybrid"
  "estimatedComplexity": "medium"
}`;

export async function orchestrate(
  task: string,
  options?: OrchestrateOptions
): Promise<ModelResponse> {
  const config = getConfig();
  const startTime = Date.now();

  // Single agent mode (existing behavior)
  if (!options?.mode || options.mode === 'single') {
    return runSingleAgent(task, options);
  }

  // Multi-agent modes
  switch (options.mode) {
    case 'delegate':
      return runDelegationMode(task, options);
    case 'coordinate':
      return runCoordinateMode(task, options);
    case 'supervise':
      return runSuperviseMode(task, options);
    default:
      return runSingleAgent(task, options);
  }
}

/**
 * Single agent mode - original behavior
 */
async function runSingleAgent(
  task: string,
  options?: OrchestrateOptions
): Promise<ModelResponse> {
  const config = getConfig();
  let selectedAgent = config.fallbackAgent;

  if (options?.agent && options.agent !== 'auto') {
    selectedAgent = options.agent;
  } else if (await isRouterAvailable()) {
    const route = await routeTask(task);
    selectedAgent = route.agent;
  }

  const adapter = adapters[selectedAgent];
  if (!adapter || !(await adapter.isAvailable())) {
    // Fallback to any available agent
    for (const [name, adp] of Object.entries(adapters)) {
      if (await adp.isAvailable()) {
        return adp.run(task, options);
      }
    }
    return { content: '', model: 'error', error: 'No agents available' };
  }

  return adapter.run(task, options);
}

/**
 * Delegation Mode - Agent analyzes task and delegates sub-tasks
 * Good for: Complex tasks that need decomposition
 */
async function runDelegationMode(
  task: string,
  options: OrchestrateOptions
): Promise<ModelResponse> {
  const config = getConfig();
  const startTime = Date.now();
  const workflow: AgentExecution[] = [];
  const context = options.context || {};

  // Get orchestration plan from router
  const routerAvailable = await isRouterAvailable();
  let decomposition: Array<{ step: number; agent: string; task: string; dependsOn: number[] }> = [];

  if (routerAvailable) {
    try {
      const { Ollama } = await import('ollama');
      const ollama = new Ollama({ host: config.adapters.ollama.host });
      const response = await ollama.chat({
        model: config.routerModel,
        messages: [
          { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
          { role: 'user', content: `Analyze this task and create a delegation plan:\n\n${task}` }
        ],
        format: 'json'
      });
      const parsed = JSON.parse(response.message.content);
      decomposition = parsed.decomposition || [];
    } catch {
      // Fallback to single agent if router fails
      return runSingleAgent(task, options);
    }
  }

  // Execute delegation plan
  if (decomposition.length === 0) {
    // No decomposition, use single agent
    return runSingleAgent(task, options);
  }

  console.log(`[orchestrator] Delegation plan: ${decomposition.length} steps`);

  const stepResults = new Map<number, ModelResponse>();

  for (const step of decomposition) {
    const stepStart = Date.now();
    const agentName = step.agent;
    const adapter = adapters[agentName];

    if (!adapter || !(await adapter.isAvailable())) {
      console.log(`[orchestrator] Agent ${agentName} unavailable, skipping`);
      continue;
    }

    // Build context from dependent steps
    let taskWithContext = step.task;
    for (const dep of step.dependsOn) {
      const depResult = stepResults.get(dep);
      if (depResult) {
        taskWithContext += `\n\nPrevious step result:\n${depResult.content}`;
      }
    }

    // Add shared context
    if (Object.keys(context).length > 0) {
      taskWithContext += `\n\nContext: ${JSON.stringify(context, null, 2)}`;
    }

    console.log(`[orchestrator] Step ${step.step}: ${agentName} - ${step.task.slice(0, 50)}...`);

    let result: ModelResponse;
    if (options.agentic) {
      result = await runAgentLoop(adapter, taskWithContext, {
        cwd: process.cwd(),
        disableTools: true,
      });
    } else {
      result = await adapter.run(taskWithContext, {
        ...options,
        disableTools: options.disableTools ?? true,
      });
    }

    stepResults.set(step.step, result);
    workflow.push({
      agent: agentName,
      model: result.model,
      duration: Date.now() - stepStart,
      tokens: result.tokens || { input: 0, output: 0 },
      content: result.content,
      toolCalls: 0
    });

    options.onAgentResponse?.(agentName, result);
  }

  // Synthesize final result
  const synthesis = synthesizeResults(task, workflow);

  return {
    content: synthesis,
    model: 'orchestrator',
    duration: Date.now() - startTime,
    tokens: {
      input: workflow.reduce((sum, w) => sum + w.tokens.input, 0),
      output: workflow.reduce((sum, w) => sum + w.tokens.output, 0)
    }
  };
}

/**
 * Coordinate Mode - Parallel execution with coordination
 * Good for: Independent subtasks that can run in parallel
 */
async function runCoordinateMode(
  task: string,
  options: OrchestrateOptions
): Promise<ModelResponse> {
  const config = getConfig();
  const startTime = Date.now();
  const agents = options.agents || ['claude', 'gemini'];

  console.log(`[orchestrator] Coordinating ${agents.length} agents in parallel`);

  // Run agents in parallel
  const results = await Promise.all(
    agents.map(async (agentName) => {
      const adapter = adapters[agentName];
      if (!adapter || !(await adapter.isAvailable())) {
        return { agent: agentName, result: null };
      }
      const result = await adapter.run(task, { ...options, disableTools: true });
      return { agent: agentName, result };
    })
  );

  // Synthesize results
  const content = results
    .filter(r => r.result && !r.result.error)
    .map(r => `## ${r.agent.toUpperCase()}\n${r.result?.content}`)
    .join('\n\n---\n\n');

  return {
    content: content || 'No results from coordinated agents',
    model: 'orchestrator/coordinated',
    duration: Date.now() - startTime
  };
}

/**
 * Supervise Mode - Expert agent supervises execution by other agents
 * Good for: Quality-critical tasks with review
 */
async function runSuperviseMode(
  task: string,
  options: OrchestrateOptions
): Promise<ModelResponse> {
  const config = getConfig();
  const startTime = Date.now();
  const supervisor = options.agents?.[0] || 'claude';
  const worker = options.agents?.[1] || 'gemini';

  console.log(`[orchestrator] Supervision: ${supervisor} → ${worker}`);

  const supervisorAdapter = adapters[supervisor];
  const workerAdapter = adapters[worker];

  if (!supervisorAdapter || !(await supervisorAdapter.isAvailable())) {
    return runSingleAgent(task, options);
  }

  // Step 1: Supervisor plans the task
  const planPrompt = `Analyze this task and provide detailed instructions for execution:

${task}

Respond with a detailed plan including:
1. Approach
2. Key considerations
3. Success criteria`;

  const plan = await supervisorAdapter.run(planPrompt, { ...options, disableTools: true });

  // Step 2: Worker executes based on supervisor's plan
  let workerResult: ModelResponse;
  if (workerAdapter && await workerAdapter.isAvailable()) {
    const execPrompt = `${plan.content}\n\n---\n\nNow execute this plan. Be thorough and follow the supervisor's guidance.`;
    workerResult = await workerAdapter.run(execPrompt, { ...options, disableTools: options.disableTools ?? true });
  } else {
    workerResult = { content: 'Worker agent not available', model: worker, error: 'Unavailable' };
  }

  // Step 3: Supervisor reviews the work
  const reviewPrompt = `You supervised this task:
PLAN:
${plan.content}

WORKER RESULT:
${workerResult.content}

Review the work:
1. Did the worker follow your plan?
2. Are there any issues or improvements needed?
3. Final assessment`;

  const review = await supervisorAdapter.run(reviewPrompt, { ...options, disableTools: true });

  return {
    content: `## Plan\n${plan.content}\n\n## Execution\n${workerResult.content}\n\n## Review\n${review.content}`,
    model: 'orchestrator/supervised',
    duration: Date.now() - startTime,
    tokens: {
      input: (plan.tokens?.input || 0) + (workerResult.tokens?.input || 0) + (review.tokens?.input || 0),
      output: (plan.tokens?.output || 0) + (workerResult.tokens?.output || 0) + (review.tokens?.output || 0)
    }
  };
}

/**
 * Synthesize results from a multi-agent workflow
 */
function synthesizeResults(task: string, workflow: AgentExecution[]): string {
  if (workflow.length === 0) {
    return 'No results from orchestration';
  }

  if (workflow.length === 1) {
    return workflow[0].content;
  }

  // Generate a synthesis using the last agent's response
  const lastResult = workflow[workflow.length - 1];
  return `## Orchestrated Result

${lastResult.content}

---

*Executed via ${workflow.length}-step orchestration:*\n` +
    workflow.map(w => `- ${w.agent} (${w.duration}ms)`).join('\n');
}

export { runSingleAgent };
