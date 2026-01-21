import type { AgentName, PlanMode, ExecutionPlan } from '../../executor/types.js';
import type { CampaignTask } from './campaign-state.js';
import type { EnhancedCampaignTask } from './campaign-types.js';
import { runAdapter } from '../../lib/adapter-runner.js';
import { runAgentLoop } from '../../agentic/agent-loop.js';
import { adapters } from '../../adapters/index.js';
import { resolveAgentForRole } from './campaign-agent.js';
import { getGitStatus, getGitDiff, getStagedDiff, stageFile, commit, isGitRepo } from '../../lib/git.js';
import { execute } from '../../executor/executor.js';
import {
  buildSingleAgentPlan,
  buildComparePlan,
  buildPipelinePlan,
  buildCorrectionPlan,
  buildDebatePlan,
  buildConsensusPlan,
  buildPickBuildPlan
} from '../../executor/plan-builders.js';
import { isEnhancedTask } from './campaign-types.js';

export interface WorkerResult {
  taskId: string;
  success: boolean;
  summary: string;
  error?: string;
  artifacts: string[];
  gitDiff?: string;
  /** Execution mode used */
  executionMode?: PlanMode;
}

/** Options for worker execution */
export interface WorkerOptions {
  /** Working directory */
  cwd: string;
  /** Worker agent specs */
  workers: string[];
  /** Use agentic droid mode */
  useDroid: boolean;
  /** Force a specific execution mode (overrides task's execution_mode) */
  forceMode?: PlanMode;
  /** Agents for compare/debate modes */
  compareAgents?: AgentName[];
  /** Number of debate rounds */
  debateRounds?: number;
  /** Enable interactive mode for pickbuild */
  interactive?: boolean;
}

export async function runWorkerTask(
  task: CampaignTask | EnhancedCampaignTask,
  workers: string[],
  cwd: string,
  useDroid: boolean,
  options?: Partial<WorkerOptions>
): Promise<WorkerResult> {
  // Determine execution mode
  const executionMode = options?.forceMode ??
    (isEnhancedTask(task) ? task.execution_mode : undefined) ??
    'single';

  // Route to appropriate executor based on mode
  if (executionMode !== 'single') {
    return runModeBasedExecution(task, executionMode, cwd, options);
  }
  // Select worker agent (round-robin through available workers)
  const workerSpec = workers[0] || 'droid:minimax-m2.1';
  const { agent, model } = await resolveAgentForRole('worker', workerSpec);

  // Build execution prompt from task
  const prompt = buildTaskPrompt(task, cwd);
  
  // Execute task
  try {
    const adapter = adapters[agent as AgentName];
    if (!adapter) {
      return {
        taskId: task.id,
        success: false,
        summary: '',
        error: `Unknown adapter for agent ${agent}`,
        artifacts: []
      };
    }

    let content = '';

    if (useDroid) {
      const loopResult = await runAgentLoop(adapter, prompt, { cwd, model });
      content = loopResult.content;
    } else {
      const result = await runAdapter(agent as AgentName, prompt, { model });
      if (result.error) {
        return {
          taskId: task.id,
          success: false,
          summary: '',
          error: result.error,
          artifacts: []
        };
      }
      content = result.content;
    }

    const artifacts = extractArtifacts(content);
    const commitResult = await commitWorkerChanges(cwd, task, artifacts);
    const summary = commitResult?.hash
      ? `${extractSummary(content)}\nCommit: ${commitResult.hash}`
      : extractSummary(content);

    return {
      taskId: task.id,
      success: true,
      summary,
      error: undefined,
      artifacts,
      gitDiff: commitResult?.diff
    };
  } catch (err) {
    const gitDiff = await getWorkingDiff(cwd);
    return {
      taskId: task.id,
      success: false,
      summary: '',
      error: (err as Error).message,
      artifacts: [],
      gitDiff
    };
  }
}

function buildTaskPrompt(task: CampaignTask, cwd: string): string {
  let prompt = `Task: ${task.title}\n\n`;
  
  if (task.description) {
    prompt += `Description: ${task.description}\n\n`;
  }

  if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
    prompt += `Acceptance Criteria:\n`;
    for (const criteria of task.acceptanceCriteria) {
      prompt += `- ${criteria}\n`;
    }
    prompt += '\n';
  }

  prompt += `Working Directory: ${cwd}\n\n`;
  prompt += `Execute this task using tools as needed. Run relevant tests or checks if you modify code. `;
  prompt += `If you make file changes, list them at the end along with any tests run.`;

  return prompt;
}

async function commitWorkerChanges(
  cwd: string,
  task: CampaignTask,
  artifacts: string[]
): Promise<{ hash: string; diff: string } | null> {
  const isRepo = await isGitRepo(cwd);
  if (!isRepo) {
    return null;
  }

  const status = await getGitStatus(cwd);
  if (!status.isDirty) {
    return null;
  }

  const filesToStage = [...status.unstaged, ...status.untracked];
  const stageTargets = filesToStage.length > 0 ? filesToStage : artifacts;

  for (const file of stageTargets) {
    await stageFile(cwd, file);
  }

  const updatedStatus = await getGitStatus(cwd);
  if (updatedStatus.staged.length === 0) {
    return null;
  }

  const stagedDiffs = await getStagedDiff(cwd);
  const diffText = formatGitDiffs(stagedDiffs);

  const message = `campaign: ${task.title}`;
  const hash = await commit(cwd, message);
  return { hash, diff: diffText };
}

async function getWorkingDiff(cwd: string): Promise<string> {
  const diffs = await getGitDiff(cwd);
  return formatGitDiffs(diffs);
}

function formatGitDiffs(diffs: Array<{ file: string; hunks: string }>): string {
  if (diffs.length === 0) {
    return '';
  }

  return diffs
    .map(diff => `# ${diff.file}\n${diff.hunks}`)
    .join('\n\n')
    .trim();
}

function extractSummary(content: string): string {
  // Take first 500 chars as summary
  const cleaned = content.trim();
  if (cleaned.length <= 500) {
    return cleaned;
  }
  return cleaned.slice(0, 500) + '...';
}

function extractArtifacts(content: string): string[] {
  const artifacts: string[] = [];
  
  // Look for file patterns like "Modified: file.ts" or "Created: path/to/file"
  const filePatterns = [
    /(?:Modified|Created|Updated|Deleted):\s*(\S+)/gi,
    /File:\s*(\S+)/gi
  ];

  for (const pattern of filePatterns) {
    const matches = content.match(pattern);
    if (matches) {
      for (const match of matches) {
        const filePath = match.replace(/^(?:Modified|Created|Updated|Deleted):\s*/i, '');
        if (filePath && !artifacts.includes(filePath)) {
          artifacts.push(filePath);
        }
      }
    }
  }

  return artifacts;
}

// ============================================================================
// Mode-Based Execution
// ============================================================================

/**
 * Execute task using appropriate plan builder based on execution mode
 */
async function runModeBasedExecution(
  task: CampaignTask | EnhancedCampaignTask,
  mode: PlanMode,
  cwd: string,
  options?: Partial<WorkerOptions>
): Promise<WorkerResult> {
  const prompt = buildTaskPrompt(task, cwd);
  const defaultAgents: AgentName[] = options?.compareAgents ?? ['claude', 'gemini'];

  try {
    // Build plan based on mode
    const plan = buildPlanForMode(mode, prompt, defaultAgents, options);

    // Execute the plan
    const result = await execute(plan);

    // Commit any changes
    const artifacts = extractArtifactsFromResult(result.finalOutput || '');
    const commitResult = await commitWorkerChanges(cwd, task, artifacts);

    const summary = result.finalOutput
      ? (commitResult?.hash
          ? `${extractSummary(result.finalOutput)}\nCommit: ${commitResult.hash}`
          : extractSummary(result.finalOutput))
      : 'Execution completed';

    return {
      taskId: task.id,
      success: result.status === 'completed',
      summary,
      error: result.status === 'failed' ? 'Execution failed' : undefined,
      artifacts,
      gitDiff: commitResult?.diff,
      executionMode: mode
    };
  } catch (err) {
    const gitDiff = await getWorkingDiff(cwd);
    return {
      taskId: task.id,
      success: false,
      summary: '',
      error: (err as Error).message,
      artifacts: [],
      gitDiff,
      executionMode: mode
    };
  }
}

/**
 * Build execution plan based on mode
 */
function buildPlanForMode(
  mode: PlanMode,
  prompt: string,
  agents: AgentName[],
  options?: Partial<WorkerOptions>
): ExecutionPlan {
  switch (mode) {
    case 'compare':
      return buildComparePlan(prompt, {
        agents,
        pick: true
      });

    case 'pipeline':
      // Simple 3-step pipeline: analyze, implement, review
      return buildPipelinePlan(prompt, {
        steps: [
          { agent: agents[0] || 'claude', action: 'analyze' as const },
          { agent: agents[0] || 'claude', action: 'code' as const },
          { agent: agents[1] || 'ollama', action: 'review' as const }
        ]
      });

    case 'correction':
      return buildCorrectionPlan(prompt, {
        producer: agents[0] || 'claude',
        reviewer: agents[1] || 'gemini',
        fixAfterReview: true
      });

    case 'debate':
      return buildDebatePlan(prompt, {
        agents,
        moderator: 'auto',
        rounds: options?.debateRounds ?? 2
      });

    case 'consensus':
      return buildConsensusPlan(prompt, {
        agents,
        maxRounds: 3
      });

    case 'pickbuild':
      return buildPickBuildPlan(prompt, {
        agents,
        picker: 'auto',
        buildAgent: agents[0] || 'claude',
        interactive: options?.interactive ?? false
      });

    case 'single':
    default:
      return buildSingleAgentPlan(prompt, agents[0] || 'auto');
  }
}

/**
 * Extract artifacts from execution result
 */
function extractArtifactsFromResult(output: string): string[] {
  return extractArtifacts(output);
}

/**
 * Run task with a specific execution mode
 *
 * @param task - The campaign task
 * @param mode - The execution mode to use
 * @param cwd - Working directory
 * @param agents - Agents to use for multi-agent modes
 * @returns WorkerResult
 */
export async function runTaskWithMode(
  task: CampaignTask | EnhancedCampaignTask,
  mode: PlanMode,
  cwd: string,
  agents?: AgentName[]
): Promise<WorkerResult> {
  return runWorkerTask(task, [], cwd, false, {
    forceMode: mode,
    compareAgents: agents
  });
}
