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
  PipelineStep,
  CorrectionOptions,
  DebateOptions,
  ConsensusOptions,
  PickBuildOptions,
  PKPoetOptions
} from './types';

// Re-export PK-Poet builder
export { buildPKPoetPlan } from './pk-poet-builder';

// Re-export Factory-Droid mode builders
export {
  buildPoetiqPlan,
  buildAdversaryPlan,
  buildSelfDiscoverPlan,
  buildCodeReasonPlan,
  buildLargeFeaturePlan
} from './factory-modes-builder';

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
  const { agents, models, sequential = false, pick = false, projectStructure } = options;

  // Build context with project structure if provided
  const context: Record<string, unknown> = {};
  if (projectStructure) {
    context.project_structure = projectStructure;
  }

  const steps: PlanStep[] = agents.map((agent, i) => ({
    id: generateStepId(i),
    agent,
    model: models?.[i],  // Map model by index if provided
    action: 'prompt' as const,
    prompt: projectStructure
      ? `**Task:** {{prompt}}

**Project Structure:**
{{project_structure}}

CRITICAL INSTRUCTIONS:
- You HAVE access to the project structure above - USE IT
- Do NOT say "I don't have access to tools" or "I cannot read files"
- Do NOT apologize for limitations - you have all the context you need
- Give a concrete, actionable response referencing specific files/directories
- Act as if you can see and understand the entire project`
      : '{{prompt}}',
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
    context: Object.keys(context).length > 0 ? context : undefined,
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
    model: step.model,  // Pass model override to step
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
 * Supported formats:
 * - Comma-separated: "gemini:analyze,claude:code,ollama:review"
 * - Arrow-separated: "gemini:analyze -> claude:code -> ollama:review"
 * - Mixed: "gemini:analyze, claude:code -> ollama:review"
 * - With models: "gemini:analyze -> Droid [glm-4.7]:coding -> claude:review"
 *
 * Agent name formats:
 * - "agent:action" - standard format
 * - "agent [model]:action" - agent with model specification
 * - "agent:action [model]" - agent with model suffix
 * - "agent : action" - flexible spacing
 */
export function parsePipelineString(pipeline: string): PipelineOptions {
  // Split by arrows (->) or commas, supporting mixed separators
  const stepStrings = pipeline
    .split(/\s*->\s*|\s*,\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const steps: PipelineStep[] = stepStrings.map(stepStr => {
    // Extract model specification if present (e.g., "Droid [glm-4.7]" or "Droid [glm-4.7]:coding")
    let agentAction = stepStr;
    let model: string | undefined;

    // Pattern 1: "Agent [model]:action"
    const bracketMatch = stepStr.match(/^(\w+)\s*\[([^\]]+)\]:(.+)$/);
    if (bracketMatch) {
      const [, agent, modelStr, action] = bracketMatch;
      return {
        agent: agent as AgentName | 'auto',
        action: action.trim(),
        model: modelStr.trim()
      };
    }

    // Pattern 2: "Agent:action [model]"
    const suffixMatch = stepStr.match(/^(.+?)\s*\[([^\]]+)\]$/);
    if (suffixMatch) {
      agentAction = suffixMatch[1].trim();
      model = suffixMatch[2].trim();
    }

    // Now parse "agent:action" or just "agent"
    const colonIndex = agentAction.indexOf(':');
    if (colonIndex !== -1) {
      const agent = agentAction.slice(0, colonIndex).trim() as AgentName | 'auto';
      const action = agentAction.slice(colonIndex + 1).trim() || 'prompt';
      return { agent, action, model };
    } else {
      // Just agent name, default to prompt action
      return {
        agent: agentAction as AgentName | 'auto',
        action: 'prompt',
        model
      };
    }
  });

  return { steps };
}

export function buildProfilePipelineSteps(options: {
  primaryAgent: AgentName;
  allowAgents: AgentName[];
  includeReview?: boolean;
}): PipelineStep[] {
  const { primaryAgent, allowAgents, includeReview } = options;

  const pickAgent = (preferred: AgentName[], fallback: AgentName): AgentName => {
    for (const agent of preferred) {
      if (allowAgents.includes(agent)) {
        return agent;
      }
    }
    return fallback;
  };

  const analyzeAgent = pickAgent(['gemini', 'claude'], primaryAgent);
  const codeAgent = pickAgent(['claude', 'codex'], primaryAgent);
  const reviewAgent = pickAgent(['codex', 'claude'], primaryAgent);

  const steps: PipelineStep[] = [
    { agent: analyzeAgent, action: 'analyze' },
    { agent: codeAgent, action: 'code' }
  ];

  if (includeReview) {
    steps.push({ agent: reviewAgent, action: 'review' });
  }

  return steps;
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

// --- Multi-Agent Collaboration Plan Builders ---

/**
 * Build a correction plan (producer → reviewer → optional fix)
 *
 * Usage: ai correct "task" --producer claude --reviewer gemini
 */
export function buildCorrectionPlan(
  prompt: string,
  options: CorrectionOptions
): ExecutionPlan {
  const { producer, reviewer, fixAfterReview = false } = options;

  const steps: PlanStep[] = [
    // Step 0: Producer generates initial output
    {
      id: generateStepId(0),
      agent: producer,
      action: 'prompt',
      prompt: '{{prompt}}',
      outputAs: 'production'
    },
    // Step 1: Reviewer critiques the output
    {
      id: generateStepId(1),
      agent: reviewer,
      action: 'prompt',
      prompt: `Review and critique this output. Identify issues, suggest improvements, and rate quality (1-10).

**Original task:** {{prompt}}

**Output to review:**
{{production}}

Provide specific, actionable feedback.`,
      dependsOn: [generateStepId(0)],
      outputAs: 'review'
    }
  ];

  // Optional Step 2: Producer fixes based on review
  if (fixAfterReview) {
    steps.push({
      id: generateStepId(2),
      agent: producer,
      action: 'prompt',
      prompt: `Fix the issues identified in this review.

**Original task:** {{prompt}}

**Your previous output:**
{{production}}

**Review feedback:**
{{review}}

Provide an improved version addressing all feedback.`,
      dependsOn: [generateStepId(1)],
      outputAs: 'fixed'
    });
  }

  return {
    id: generatePlanId(),
    mode: 'correction',
    prompt,
    steps,
    createdAt: Date.now()
  };
}

/**
 * Build a debate plan (multi-round agent discussion)
 *
 * Usage: ai debate "topic" --agents claude,gemini --rounds 2
 */
export function buildDebatePlan(
  prompt: string,
  options: DebateOptions
): ExecutionPlan {
  const { agents, rounds, moderator } = options;

  if (agents.length < 2) {
    throw new Error('Debate requires at least 2 agents');
  }

  const steps: PlanStep[] = [];
  let stepIndex = 0;

  // Round 0: Initial positions (parallel)
  for (const agent of agents) {
    steps.push({
      id: generateStepId(stepIndex),
      agent,
      action: 'prompt',
      prompt: `You are participating in a debate. Present your initial position on this topic.

**Topic:** {{prompt}}

Be clear, concise, and well-reasoned.`,
      outputAs: `${agent}_round0`
    });
    stepIndex++;
  }

  // Subsequent rounds: Agents respond to each other
  for (let round = 1; round < rounds; round++) {
    const prevRound = round - 1;
    const prevResponses = agents
      .map(a => `**${a}:** {{${a}_round${prevRound}}}`)
      .join('\n\n');

    // Track where previous round started for dependencies
    const prevRoundStart = stepIndex - agents.length;

    for (const agent of agents) {
      steps.push({
        id: generateStepId(stepIndex),
        agent,
        action: 'prompt',
        prompt: `Round ${round}: Respond to other participants' arguments.

**Topic:** {{prompt}}

**Previous responses:**
${prevResponses}

Address their points, defend your position, or update your view if convinced.`,
        // Each agent in round N depends on ALL round N-1 responses
        dependsOn: agents.map((_, i) => generateStepId(prevRoundStart + i)),
        outputAs: `${agent}_round${round}`
      });
      stepIndex++;
    }
  }

  // Final step: Moderator synthesizes (optional)
  if (moderator) {
    const finalResponses = agents
      .map(a => `**${a}:** {{${a}_round${rounds}}}`)
      .join('\n\n');

    const lastRoundStart = stepIndex - agents.length;

    steps.push({
      id: generateStepId(stepIndex),
      agent: moderator,
      action: 'combine',
      prompt: `Synthesize this debate into a final conclusion.

**Topic:** {{prompt}}

**Final positions:**
${finalResponses}

Summarize key agreements, disagreements, and provide a balanced conclusion.`,
      dependsOn: agents.map((_, i) => generateStepId(lastRoundStart + i)),
      outputAs: 'conclusion'
    });
  }

  return {
    id: generatePlanId(),
    mode: 'debate',
    prompt,
    steps,
    createdAt: Date.now()
  };
}

/**
 * Build a consensus plan (propose → vote → synthesize)
 *
 * Note: threshold option reserved for future dynamic iteration.
 * Current implementation uses fixed maxRounds.
 *
 * Usage: ai consensus "task" --agents claude,gemini,ollama --rounds 2
 */
export function buildConsensusPlan(
  prompt: string,
  options: ConsensusOptions
): ExecutionPlan {
  const { agents, maxRounds = 2, synthesizer, projectStructure } = options;

  if (agents.length < 2) {
    throw new Error('Consensus requires at least 2 agents');
  }

  // Build initial context with project structure if provided
  const context: Record<string, unknown> = {};
  if (projectStructure) {
    context.project_structure = projectStructure;
  }

  const steps: PlanStep[] = [];
  let stepIndex = 0;

  // Round 0: Initial proposals (parallel) - includes project context
  for (const agent of agents) {
    steps.push({
      id: generateStepId(stepIndex),
      agent,
      action: 'prompt',
      prompt: `Propose a solution for this task.

**Task:** {{prompt}}

**Project Structure:**
{{project_structure}}

CRITICAL INSTRUCTIONS:
- You HAVE access to the project structure above - USE IT
- Do NOT say "I don't have access to tools" or "I cannot read files"
- Do NOT apologize for limitations - you have all the context you need
- Give a concrete, actionable proposal referencing specific files/directories
- Act as if you can see and understand the entire project`,
      outputAs: `${agent}_proposal`
    });
    stepIndex++;
  }

  // Voting rounds
  for (let round = 0; round < maxRounds; round++) {
    const proposals = agents
      .map(a => `**${a}'s proposal:** {{${a}_proposal}}`)
      .join('\n\n');

    const prevVotes = round > 0
      ? agents.map(a => `**${a}'s previous vote:** {{${a}_vote${round - 1}}}`).join('\n\n')
      : '';

    const prevRoundStart = stepIndex - agents.length;

    for (const agent of agents) {
      steps.push({
        id: generateStepId(stepIndex),
        agent,
        action: 'prompt',
        prompt: `IMPORTANT: You are voting in a consensus process. DO NOT execute any task. DO NOT write code. Your ONLY job is to vote.

Review the proposals below and cast your vote for the best one.

**Original Task:** {{prompt}}

**Proposals to vote on:**
${proposals}
${prevVotes ? `\n**Previous votes:**\n${prevVotes}` : ''}

RESPOND ONLY WITH YOUR VOTE using this exact format (nothing else):

**My Vote:** [agent name]'s proposal
**Reasoning:** [1-2 sentences explaining why this proposal is best]`,
        // Round 0 depends on proposals, subsequent rounds depend on previous votes
        dependsOn: round === 0
          ? agents.map((_, i) => generateStepId(i))
          : agents.map((_, i) => generateStepId(prevRoundStart + i)),
        outputAs: `${agent}_vote${round}`
      });
      stepIndex++;
    }
  }

  // Final synthesis
  const synth = synthesizer || agents[0];
  const finalVotes = agents
    .map(a => `**${a}:** {{${a}_vote${maxRounds - 1}}}`)
    .join('\n\n');

  const lastRoundStart = stepIndex - agents.length;

  steps.push({
    id: generateStepId(stepIndex),
    agent: synth,
    action: 'combine',
    prompt: `Analyze the votes and synthesize a final solution.

**Task:** {{prompt}}

**Final votes:**
${finalVotes}

First, identify which proposal won or had the most agreement. Then create a unified solution based on that winning approach, incorporating any valuable additions from other proposals.

Format:
**Winner:** [agent name]'s proposal
**Reason:** [why it won/had consensus]
**Final Solution:** [the synthesized solution]`,
    dependsOn: agents.map((_, i) => generateStepId(lastRoundStart + i)),
    outputAs: 'consensus'
  });

  return {
    id: generatePlanId(),
    mode: 'consensus',
    prompt,
    steps,
    context: Object.keys(context).length > 0 ? context : undefined,
    createdAt: Date.now()
  };
}

// --- Mode C: Compare→Pick→Build (pickbuild) ---

/**
 * JSON schema for PlanArtifact that agents must produce
 */
const PLAN_ARTIFACT_SCHEMA = `{
  "title": "string - short plan name",
  "summary": ["string - 3-6 bullet points summarizing the approach"],
  "assumptions": ["string - assumptions made about requirements or context"],
  "steps": [
    {
      "id": "string - unique step identifier (e.g., 'step_1')",
      "goal": "string - what this step accomplishes",
      "filesLikelyTouched": ["string - file paths that will likely be modified"],
      "approach": "string - how to accomplish this step",
      "verification": "string - how to verify this step succeeded"
    }
  ],
  "risks": [
    {
      "risk": "string - potential issue or concern",
      "mitigation": "string - how to address or mitigate this risk"
    }
  ],
  "acceptanceCriteria": ["string - definition of done criteria"]
}`;

/**
 * Build a Compare→Pick→Build plan
 *
 * Workflow:
 * 1. Multiple agents propose PLANs (not code) in parallel/sequential
 * 2. A picker (human or LLM) selects the best plan
 * 3. A build agent implements the selected plan with agentic tools
 * 4. Optional reviewer validates the implementation
 *
 * Usage: pk-puzldai pickbuild "task" --agents claude,gemini --build-agent claude
 */
export function buildPickBuildPlan(
  prompt: string,
  options: PickBuildOptions
): ExecutionPlan {
  const {
    agents,
    picker = 'human',
    buildAgent = 'claude',
    reviewer,
    sequential = false,
    format = 'json',
    skipReview = false,
    projectStructure
  } = options;

  if (agents.length < 1) {
    throw new Error('PickBuild requires at least 1 proposer agent');
  }

  const steps: PlanStep[] = [];
  let stepIndex = 0;

  // Build context with project structure if provided
  const context: Record<string, unknown> = {};
  if (projectStructure) {
    context.project_structure = projectStructure;
  }

  // --- Phase 1: Propose Plans (parallel or sequential) ---
  const proposalPrompt = format === 'json'
    ? buildJsonPlanProposalPrompt(projectStructure)
    : buildMarkdownPlanProposalPrompt(projectStructure);

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    steps.push({
      id: generateStepId(stepIndex),
      agent,
      action: 'prompt',
      prompt: proposalPrompt,
      // Sequential mode: each proposer depends on previous
      dependsOn: sequential && i > 0 ? [generateStepId(stepIndex - 1)] : undefined,
      outputAs: `plan_${agent}`
    });
    stepIndex++;
  }

  // --- Phase 2: Pick Plan ---
  // Human picker is handled at runtime via interactive mode
  // LLM picker uses a dedicated step
  const pickerStepId = generateStepId(stepIndex);
  const pickerAgent = picker === 'human' ? buildAgent : picker; // Human picker uses build agent for formatting

  steps.push({
    id: pickerStepId,
    agent: pickerAgent,
    action: 'combine',
    prompt: buildPickerPrompt(agents, format),
    dependsOn: agents.map((_, i) => generateStepId(i)),
    outputAs: 'picked_plan'
  });
  stepIndex++;

  // --- Phase 3: Build from Plan (Agentic) ---
  steps.push({
    id: generateStepId(stepIndex),
    agent: buildAgent,
    action: 'prompt',
    role: 'code', // Enable agentic tools for implementation
    prompt: buildBuildFromPlanPrompt(),
    dependsOn: [pickerStepId],
    outputAs: 'implementation'
  });
  stepIndex++;

  // --- Phase 4: Review (Optional) ---
  if (!skipReview && reviewer) {
    steps.push({
      id: generateStepId(stepIndex),
      agent: reviewer,
      action: 'prompt',
      role: 'review',
      prompt: buildReviewPrompt(),
      dependsOn: [generateStepId(stepIndex - 1)],
      outputAs: 'review'
    });
    stepIndex++;
  }

  return {
    id: generatePlanId(),
    mode: 'pickbuild',
    prompt,
    steps,
    context: Object.keys(context).length > 0 ? context : undefined,
    createdAt: Date.now()
  };
}

/**
 * Build prompt for JSON plan proposals
 */
function buildJsonPlanProposalPrompt(projectStructure?: string): string {
  const projectContext = projectStructure
    ? `\n\n**Project Structure:**\n{{project_structure}}\n\nCRITICAL: Reference specific files/directories from the project structure above.`
    : '';

  return `You are proposing an implementation PLAN for a task. Do NOT write code. Produce a structured plan.

**Task:** {{prompt}}${projectContext}

IMPORTANT:
- This is a PLANNING phase, not implementation
- Analyze the task requirements thoroughly
- Consider edge cases and potential issues
- Be specific about which files will need to be modified
- Include verification steps for each phase

Output your plan as valid JSON matching this schema:
${PLAN_ARTIFACT_SCHEMA}

Respond with ONLY the JSON object. No markdown code fences, no explanation, just the JSON.`;
}

/**
 * Build prompt for Markdown plan proposals
 */
function buildMarkdownPlanProposalPrompt(projectStructure?: string): string {
  const projectContext = projectStructure
    ? `\n\n**Project Structure:**\n{{project_structure}}\n\nCRITICAL: Reference specific files/directories from the project structure above.`
    : '';

  return `You are proposing an implementation PLAN for a task. Do NOT write code. Produce a structured plan.

**Task:** {{prompt}}${projectContext}

IMPORTANT:
- This is a PLANNING phase, not implementation
- Analyze the task requirements thoroughly
- Consider edge cases and potential issues
- Be specific about which files will need to be modified
- Include verification steps for each phase

Format your plan using this structure:

# Plan Title

## Summary
- Bullet point 1
- Bullet point 2
(3-6 bullet points)

## Assumptions
- Assumption 1
- Assumption 2

## Steps

### Step 1: [Goal]
**Files:** file1.ts, file2.ts
**Approach:** Description of approach
**Verification:** How to verify success

### Step 2: [Goal]
...

## Risks
| Risk | Mitigation |
|------|------------|
| Risk 1 | Mitigation 1 |

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2`;
}

/**
 * Build prompt for plan selection (LLM picker)
 */
function buildPickerPrompt(agents: AgentName[], _format: 'json' | 'md'): string {
  const planRefs = agents.map(a => `**${a}'s Plan:**\n{{plan_${a}}}`).join('\n\n---\n\n');

  return `You are selecting the BEST implementation plan from multiple proposals.

**Original Task:** {{prompt}}

**Proposed Plans:**

${planRefs}

EVALUATION CRITERIA:
1. Completeness - Does the plan cover all requirements?
2. Specificity - Are the steps concrete and actionable?
3. Risk awareness - Does it identify and mitigate potential issues?
4. Verification - Does it include ways to validate success?
5. Feasibility - Is the approach realistic and well-scoped?

INSTRUCTIONS:
1. Analyze each plan against the criteria
2. Select the BEST plan
3. Output your decision in this format:

**Selected:** [agent name]
**Reasoning:** [2-3 sentences explaining why this plan is best]

**Chosen Plan:**
[Copy the full selected plan here verbatim]`;
}

/**
 * Build prompt for agentic implementation from plan
 */
function buildBuildFromPlanPrompt(): string {
  return `You are implementing a task based on a selected plan.

**Original Task:** {{prompt}}

**Selected Plan:**
{{picked_plan}}

IMPLEMENTATION INSTRUCTIONS:
1. Follow the plan steps in order
2. Use tools to explore the codebase as needed (view, glob, grep)
3. Make targeted edits using the edit tool (NOT bash/sed)
4. Create new files using the write tool when needed
5. After each significant change, verify it works

SAFETY RULES:
- NEVER use bash for file modifications (use edit/write tools)
- Read files with 'view' before editing them
- Make one edit at a time and wait for confirmation
- If unsure about a change, explain your reasoning before proceeding

Begin implementing the plan now.`;
}

/**
 * Build prompt for implementation review
 */
function buildReviewPrompt(): string {
  return `You are reviewing an implementation against its original plan.

**Original Task:** {{prompt}}

**Plan That Was Followed:**
{{picked_plan}}

**Implementation Result:**
{{implementation}}

REVIEW CHECKLIST:
1. Does the implementation satisfy all acceptance criteria from the plan?
2. Are there any steps from the plan that were not completed?
3. Were there any deviations from the plan? If so, were they justified?
4. Are there any obvious bugs, security issues, or edge cases not handled?
5. Is the code quality acceptable (readable, maintainable)?

Provide your review in this format:

## Summary
[1-2 sentence overall assessment]

## Checklist Results
- [ ] All acceptance criteria met
- [ ] All plan steps completed
- [ ] No unjustified deviations
- [ ] No obvious bugs or security issues
- [ ] Code quality acceptable

## Issues Found
[List any issues, or "None" if implementation is solid]

## Suggested Fixes
[If issues found, specific suggestions for fixes]`;
}
