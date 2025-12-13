/**
 * Pipeline Orchestrator (Phase 13)
 *
 * Wraps pipeline/workflow execution with:
 * - Previous run retrieval for context
 * - Template performance tracking
 * - Success/failure statistics
 */

import type { AgentName, ExecutionResult, ExecutionPlan, PipelineTemplate } from '../executor';
import { buildPipelinePlan, execute, loadTemplate } from '../executor';
import { addMemory } from '../memory/vector-store';
import { retrieve } from '../memory/retriever';
import { summarizeIfNeeded, isSummarizerAvailable } from '../context/summarizer';

export interface PipelineOptions {
  agents?: AgentName[];
  template?: string;
  sequential?: boolean;
  injectPreviousRuns?: boolean;
}

export interface PipelineResult {
  execution: ExecutionResult;
  previousRuns?: PreviousRun[];
  templateStats?: TemplateStats;
}

export interface PreviousRun {
  query: string;
  template?: string;
  success: boolean;
  summary: string;
  timestamp: number;
}

export interface TemplateStats {
  templateName: string;
  totalRuns: number;
  successRate: number;
  avgDuration: number;
}

/**
 * Run a pipeline
 */
export async function pipeline(
  query: string,
  options: PipelineOptions
): Promise<PipelineResult> {
  const {
    agents,
    template: templateName,
    sequential: _sequential = true,
    injectPreviousRuns = true
  } = options;

  // 1. Load template if specified
  let template: PipelineTemplate | null = null;
  if (templateName) {
    template = loadTemplate(templateName);
    if (!template) {
      throw new Error(`Template not found: ${templateName}`);
    }
  }

  // 2. Retrieve previous runs
  let previousRuns: PreviousRun[] = [];
  if (injectPreviousRuns) {
    try {
      const searchQuery = templateName
        ? `pipeline template:${templateName} ${query}`
        : `pipeline ${query}`;

      const results = await retrieve(searchQuery, {
        types: ['decision'],
        limit: 5
      });

      previousRuns = results.items
        .filter(r => r.metadata?.mode === 'pipeline')
        .map(r => ({
          query: (r.metadata?.query as string) || '',
          template: r.metadata?.template as string | undefined,
          success: r.metadata?.success === 'true',
          summary: r.content,
          timestamp: r.createdAt || 0
        }));
    } catch {
      // Continue without previous runs
    }
  }

  // 3. Enhance query with previous context
  let enhancedQuery = query;
  if (previousRuns.length > 0) {
    const context = previousRuns.slice(0, 2)
      .map(r => `[Previous ${r.template || 'pipeline'} run]: ${r.summary}`)
      .join('\n');

    enhancedQuery = `${query}\n\n<previous_runs>\n${context}\n</previous_runs>`;
  }

  // 4. Build & execute plan
  let plan: ExecutionPlan;
  if (template) {
    plan = {
      id: `plan_${Date.now()}`,
      mode: 'pipeline',
      prompt: enhancedQuery,
      steps: template.steps.map((step, i) => ({
        id: `step_${i}`,
        agent: step.agent,
        action: 'prompt' as const,
        prompt: step.promptTemplate || buildDefaultPrompt(step.action, i),
        dependsOn: i > 0 ? [`step_${i - 1}`] : undefined,
        outputAs: `step${i}_output`
      })),
      createdAt: Date.now()
    };
  } else if (agents) {
    plan = buildPipelinePlan(enhancedQuery, {
      steps: agents.map(agent => ({
        agent,
        action: 'prompt'
      }))
    });
  } else {
    throw new Error('Either template or agents required');
  }

  const startTime = Date.now();
  const execution = await execute(plan);
  const duration = Date.now() - startTime;

  // 5. Store run in memory
  const success = !execution.results.some(r => r.error);
  const summary = await summarizePipelineRun(query, execution, success);

  await addMemory({
    type: 'decision',
    content: summary,
    metadata: {
      mode: 'pipeline',
      query,
      template: templateName || '',
      agents: JSON.stringify(agents || template?.steps.map(s => s.agent) || []),
      success: String(success),
      duration: String(duration)
    }
  });

  // 6. Get template stats
  let templateStats: TemplateStats | undefined;
  if (templateName) {
    templateStats = await getTemplateStats(templateName);
  }

  return { execution, previousRuns, templateStats };
}

/**
 * Build default prompt for pipeline step
 */
function buildDefaultPrompt(action: string, index: number): string {
  const prevRef = index > 0 ? `\n\nPrevious step output:\n{{step${index - 1}_output}}` : '';

  switch (action) {
    case 'analyze':
      return `Analyze the following task and provide insights:\n\n{{prompt}}${prevRef}`;
    case 'code':
      return `Write code for the following task:\n\n{{prompt}}${prevRef}`;
    case 'review':
      return `Review the following and suggest improvements:\n\n{{prompt}}${prevRef}`;
    case 'fix':
      return `Fix any issues in the following:\n\n{{prompt}}${prevRef}`;
    case 'test':
      return `Write tests for the following:\n\n{{prompt}}${prevRef}`;
    case 'summarize':
      return `Summarize the following concisely:\n\n{{prompt}}${prevRef}`;
    default:
      return `${action}:\n\n{{prompt}}${prevRef}`;
  }
}

/**
 * Summarize pipeline run for storage
 */
async function summarizePipelineRun(
  query: string,
  execution: ExecutionResult,
  success: boolean
): Promise<string> {
  const status = success ? 'succeeded' : 'failed';
  const stepCount = execution.results.length;
  const completedSteps = execution.results.filter(r => r.status === 'completed').length;

  const basicSummary = `Pipeline ${status}: ${completedSteps}/${stepCount} steps completed for "${query}"`;

  // Try to get a summary of the output
  if (execution.finalOutput && await isSummarizerAvailable()) {
    try {
      const outputSummary = await summarizeIfNeeded(execution.finalOutput, 200);
      return `${basicSummary}\n\nOutput: ${outputSummary}`;
    } catch {
      // Fall through to basic summary
    }
  }

  return basicSummary;
}

/**
 * Get statistics for a template
 */
export async function getTemplateStats(templateName: string): Promise<TemplateStats> {
  try {
    const results = await retrieve(`pipeline template:${templateName}`, {
      types: ['decision'],
      limit: 100
    });

    const runs = results.items.filter(r =>
      r.metadata?.mode === 'pipeline' &&
      r.metadata?.template === templateName
    );

    const successCount = runs.filter(r => r.metadata?.success === 'true').length;
    const durations = runs
      .map(r => parseInt((r.metadata?.duration as string) || '0'))
      .filter(d => d > 0);

    return {
      templateName,
      totalRuns: runs.length,
      successRate: runs.length > 0 ? successCount / runs.length : 0,
      avgDuration: durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0
    };
  } catch {
    return {
      templateName,
      totalRuns: 0,
      successRate: 0,
      avgDuration: 0
    };
  }
}

/**
 * Get all template statistics
 */
export async function getAllTemplateStats(): Promise<TemplateStats[]> {
  try {
    const results = await retrieve('pipeline template', {
      types: ['decision'],
      limit: 200
    });

    // Group by template
    const templateRuns = new Map<string, Array<{
      success: boolean;
      duration: number;
    }>>();

    for (const item of results.items) {
      if (item.metadata?.mode !== 'pipeline') continue;

      const template = item.metadata?.template as string;
      if (!template) continue;

      const runs = templateRuns.get(template) || [];
      runs.push({
        success: item.metadata?.success === 'true',
        duration: parseInt((item.metadata?.duration as string) || '0')
      });
      templateRuns.set(template, runs);
    }

    // Calculate stats for each template
    const stats: TemplateStats[] = [];
    for (const [templateName, runs] of templateRuns) {
      const successCount = runs.filter(r => r.success).length;
      const durations = runs.map(r => r.duration).filter(d => d > 0);

      stats.push({
        templateName,
        totalRuns: runs.length,
        successRate: runs.length > 0 ? successCount / runs.length : 0,
        avgDuration: durations.length > 0
          ? durations.reduce((a, b) => a + b, 0) / durations.length
          : 0
      });
    }

    return stats.sort((a, b) => b.totalRuns - a.totalRuns);
  } catch {
    return [];
  }
}

/**
 * Get pipeline history
 */
export async function getPipelineHistory(limit: number = 10): Promise<Array<{
  query: string;
  template?: string;
  agents: string[];
  success: boolean;
  duration: number;
  timestamp: number;
}>> {
  try {
    const results = await retrieve('pipeline mode', {
      types: ['decision'],
      limit
    });

    return results.items
      .filter(r => r.metadata?.mode === 'pipeline')
      .map(r => ({
        query: (r.metadata?.query as string) || '',
        template: r.metadata?.template as string | undefined,
        agents: JSON.parse((r.metadata?.agents as string) || '[]'),
        success: r.metadata?.success === 'true',
        duration: parseInt((r.metadata?.duration as string) || '0'),
        timestamp: r.createdAt || 0
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

