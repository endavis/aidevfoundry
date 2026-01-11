/**
 * Dynamic Memory Injection (Phase 7)
 *
 * Intelligent per-step context assembly with:
 * - Priority-based inclusion (critical → low)
 * - Graceful overflow handling (drop → truncate → summarize)
 * - XML/Markdown formatting per agent
 * - Default rules per step role
 */

import type {
  InjectionRule,
  InjectionConfig,
  ContextSource,
  IncludeMode,
  ContextPriority,
  StepRole,
  StepResult,
  PlanStep
} from '../executor/types';
import { evaluateCondition, type ExecutionContext } from '../executor/context';
import type { MemoryContext, StepOutput } from './pipeline-memory';
import { estimateTokens, truncateForAgent, getTokenConfig } from './tokens';
import { summarizeIfNeeded, isSummarizerAvailable } from './summarizer';

// --- Default Injection Rules per Step Role ---

export const DEFAULT_RULES: Record<StepRole, InjectionRule[]> = {
  code: [
    { source: 'user_input', include: 'full', priority: 1, tag: 'task' },
    { source: 'previous_output', include: 'full', priority: 1, tag: 'requirements' },
    { source: 'file_context', include: 'full', priority: 2, tag: 'code_context' }
  ],
  review: [
    { source: 'step_output', include: 'full', priority: 1, tag: 'code_to_review' },
    { source: 'user_input', include: 'summary', priority: 2, tag: 'original_task' },
    { source: 'previous_output', include: 'summary', priority: 3, tag: 'background' }
  ],
  analyze: [
    { source: 'user_input', include: 'full', priority: 1, tag: 'task' },
    { source: 'file_context', include: 'keyPoints', priority: 2, tag: 'context' },
    { source: 'previous_output', include: 'summary', priority: 3, tag: 'prior_analysis' }
  ],
  fix: [
    { source: 'step_output', include: 'full', priority: 1, tag: 'review_feedback' },
    { source: 'previous_output', include: 'full', priority: 1, tag: 'original_code' },
    { source: 'user_input', include: 'summary', priority: 3, tag: 'task' }
  ],
  plan: [
    { source: 'user_input', include: 'full', priority: 1, tag: 'task' },
    { source: 'file_context', include: 'keyPoints', priority: 2, tag: 'codebase_context' }
  ],
  summarize: [
    { source: 'previous_output', include: 'full', priority: 1, tag: 'content_to_summarize' },
    { source: 'user_input', include: 'summary', priority: 3, tag: 'original_task' }
  ]
};

// --- Context Block for Assembly ---

interface ContextBlock {
  source: ContextSource;
  stepId?: string;
  content: string;
  tokens: number;
  priority: ContextPriority;
  tag?: string;
  includeMode: IncludeMode;
}

interface CompressionSettings {
  enabled: boolean;
  tokenLimit: number;
}

// --- Main Assembly Function ---

/**
 * Assemble context for a step based on injection rules
 *
 * @param step - Current step being executed
 * @param context - Execution context with previous results (ExecutionContext or MemoryContext)
 * @param config - Injection configuration
 * @returns Assembled context string
 */
export async function assembleStepContext(
  step: PlanStep,
  context: ExecutionContext | MemoryContext,
  config: Partial<InjectionConfig> = {}
): Promise<string> {
  // Determine rules: custom > role defaults > empty
  const rules = step.injectionRules
    ?? (step.role ? DEFAULT_RULES[step.role] : undefined)
    ?? [];

  if (rules.length === 0) {
    return ''; // No injection rules, return empty context
  }

  // Get agent-specific settings
  const agent = step.agent === 'auto' ? 'claude' : step.agent;
  const tokenConfig = getTokenConfig(agent);
  const tokenBudget = config.tokenBudget ?? Math.floor(tokenConfig.maxTokens * 0.7);
  const format = config.format ?? (agent === 'claude' ? 'xml' : 'markdown');
  const reserveForPrompt = config.reserveForPrompt ?? estimateTokens(step.prompt);

  // Available budget for context (minus prompt reserve)
  const availableBudget = tokenBudget - reserveForPrompt;

  // Collect context blocks based on rules
  const blocks = await collectContextBlocks(rules, context, step);

  // Apply priority-based overflow handling
  const fittedBlocks = await fitToTokenBudget(blocks, availableBudget, agent);

  // Format output
  return formatContextBlocks(fittedBlocks, format);
}

// --- Context Collection ---

/**
 * Collect context blocks based on injection rules
 * Note: MemoryContext extends ExecutionContext, so evaluateCondition works for both
 */
async function collectContextBlocks(
  rules: InjectionRule[],
  context: ExecutionContext | MemoryContext,
  currentStep: PlanStep
): Promise<ContextBlock[]> {
  const blocks: ContextBlock[] = [];
  const compression = getCompressionSettings(context);
  const isMemoryContext = 'memory' in context;

  for (const rule of rules) {
    // Check condition if present
    // Note: evaluateCondition expects ExecutionContext, MemoryContext extends it
    if (rule.condition && !evaluateCondition(rule.condition, context as ExecutionContext)) {
      continue;
    }

    // Skip 'none' include mode
    if (rule.include === 'none') {
      continue;
    }

    const adjustedRule = applyCompressionRule(rule, compression);
    const content = await resolveContextSource(adjustedRule, context, currentStep);
    if (!content) continue;

    const finalContent = await maybeSummarizeContent(content, adjustedRule, compression, isMemoryContext);
    const tokens = estimateTokens(finalContent);

    blocks.push({
      source: adjustedRule.source,
      stepId: adjustedRule.stepId,
      content: finalContent,
      tokens,
      priority: adjustedRule.priority,
      tag: adjustedRule.tag,
      includeMode: adjustedRule.include
    });
  }

  return blocks;
}

/**
 * Resolve content from a context source
 */
async function resolveContextSource(
  rule: InjectionRule,
  context: ExecutionContext | MemoryContext,
  currentStep: PlanStep
): Promise<string | undefined> {
  const isMemoryContext = 'memory' in context;

  switch (rule.source) {
    case 'user_input':
      return context.prompt;

    case 'plan':
      return context.prompt; // Same as user_input for now

    case 'step_output': {
      // Get output from specific step
      const stepId = rule.stepId;
      if (!stepId) return undefined;

      const stepResult = context.steps[stepId];
      if (!stepResult?.content) return undefined;

      // Use memory if available for smart retrieval
      if (isMemoryContext) {
        const mem = (context as MemoryContext).memory[stepId];
        if (mem) {
          return getContentByIncludeMode(mem, rule.include, stepResult.content);
        }
      }

      return stepResult.content;
    }

    case 'previous_output': {
      // Get output from all previous steps (before current)
      const previousSteps = Object.entries(context.steps)
        .filter(([id, result]) => {
          // Exclude current step and steps that depend on current
          if (id === currentStep.id) return false;
          return result.status === 'completed' && result.content;
        })
        .map(([id, result]) => ({ id, result }));

      if (previousSteps.length === 0) return undefined;

      // Combine previous outputs
      const outputs: string[] = [];
      for (const { id, result } of previousSteps) {
        let content = result.content ?? '';

        if (isMemoryContext) {
          const mem = (context as MemoryContext).memory[id];
          if (mem) {
            content = getContentByIncludeMode(mem, rule.include, content);
          }
        }

        if (content) {
          outputs.push(`[Step: ${id}]\n${content}`);
        }
      }

      return outputs.join('\n\n');
    }

    case 'file_context':
      // Future: integrate with file context system
      // For now, check if there's file context in initial
      if (context.initial['fileContext']) {
        return String(context.initial['fileContext']);
      }
      return undefined;

    default:
      return undefined;
  }
}

/**
 * Get content based on include mode from memory
 */
function getContentByIncludeMode(
  mem: StepOutput,
  mode: IncludeMode,
  fallback: string
): string {
  switch (mode) {
    case 'full':
      return mem.raw || fallback;
    case 'summary':
      return mem.summary || fallback;
    case 'keyPoints':
      return mem.keyPoints.length > 0
        ? '- ' + mem.keyPoints.join('\n- ')
        : fallback;
    case 'truncated':
      return mem.summary || fallback; // Summary is a form of truncation
    default:
      return fallback;
  }
}

function getCompressionSettings(
  context: ExecutionContext | MemoryContext
): CompressionSettings {
  const orchestration = (context.initial?.['orchestration'] ?? {}) as {
    useContextCompression?: boolean;
    noCompress?: boolean;
    compressionTokenLimit?: number;
  };

  const enabled = Boolean(orchestration.useContextCompression) && !orchestration.noCompress;
  const tokenLimit = orchestration.compressionTokenLimit && orchestration.compressionTokenLimit > 0
    ? orchestration.compressionTokenLimit
    : 800;

  return { enabled, tokenLimit };
}

function applyCompressionRule(
  rule: InjectionRule,
  compression: CompressionSettings
): InjectionRule {
  if (!compression.enabled) {
    return rule;
  }

  if (rule.include === 'full' && rule.priority > 1) {
    if (rule.source === 'previous_output' || rule.source === 'step_output') {
      return { ...rule, include: 'summary' };
    }
  }

  return rule;
}

async function maybeSummarizeContent(
  content: string,
  rule: InjectionRule,
  compression: CompressionSettings,
  isMemoryContext: boolean
): Promise<string> {
  if (!compression.enabled || rule.include !== 'summary' || isMemoryContext) {
    return content;
  }

  const summarizerAvailable = await isSummarizerAvailable();
  if (!summarizerAvailable) {
    return content;
  }

  return summarizeIfNeeded(content, compression.tokenLimit);
}

// --- Priority-Based Overflow Handling ---

/**
 * Fit context blocks to token budget using priority-based strategies
 *
 * Strategy order:
 * 1. Drop low-priority (4) blocks
 * 2. Drop medium-priority (3) blocks
 * 3. Truncate high-priority (2) blocks
 * 4. Summarize critical (1) blocks if still over
 */
async function fitToTokenBudget(
  blocks: ContextBlock[],
  budget: number,
  agent: string
): Promise<ContextBlock[]> {
  // Sort by priority (1 = highest, 4 = lowest)
  const sorted = [...blocks].sort((a, b) => a.priority - b.priority);

  const totalTokens = sorted.reduce((sum, b) => sum + b.tokens, 0);

  // If within budget, return as-is
  if (totalTokens <= budget) {
    return sorted;
  }

  const result: ContextBlock[] = [];
  let remainingBudget = budget;

  // Process by priority
  for (const block of sorted) {
    if (remainingBudget <= 0) break;

    if (block.tokens <= remainingBudget) {
      // Fits entirely
      result.push(block);
      remainingBudget -= block.tokens;
    } else if (block.priority <= 2) {
      // High priority: truncate to fit
      const truncated = await truncateOrSummarize(
        block,
        remainingBudget,
        agent,
        block.priority === 1 // Critical = try summarize first
      );
      if (truncated) {
        result.push(truncated);
        remainingBudget -= truncated.tokens;
      }
    }
    // Priority 3-4: drop if doesn't fit
  }

  return result;
}

/**
 * Truncate or summarize a block to fit budget
 */
async function truncateOrSummarize(
  block: ContextBlock,
  budget: number,
  agent: string,
  preferSummarize: boolean
): Promise<ContextBlock | null> {
  if (budget <= 0) return null;

  const summarizerAvailable = await isSummarizerAvailable();

  // Try summarize first for critical content
  if (preferSummarize && summarizerAvailable && budget >= 200) {
    try {
      const summary = await summarizeIfNeeded(block.content, budget);
      const summaryTokens = estimateTokens(summary);

      if (summaryTokens <= budget) {
        return {
          ...block,
          content: summary,
          tokens: summaryTokens,
          includeMode: 'summary'
        };
      }
    } catch {
      // Fall through to truncation
    }
  }

  // Truncate to fit
  const truncated = truncateForAgent(block.content, agent);
  const truncatedTokens = estimateTokens(truncated);

  // Further truncate if still over budget
  if (truncatedTokens > budget) {
    const ratio = budget / truncatedTokens;
    const targetChars = Math.floor(truncated.length * ratio * 0.9); // 10% buffer
    const hardTruncated = truncated.slice(0, targetChars) + '\n\n[...truncated]';

    return {
      ...block,
      content: hardTruncated,
      tokens: estimateTokens(hardTruncated),
      includeMode: 'truncated'
    };
  }

  return {
    ...block,
    content: truncated,
    tokens: truncatedTokens,
    includeMode: 'truncated'
  };
}

// --- Output Formatting ---

/**
 * Format context blocks as XML or Markdown
 */
function formatContextBlocks(
  blocks: ContextBlock[],
  format: 'xml' | 'markdown'
): string {
  if (blocks.length === 0) return '';

  const sections: string[] = [];

  for (const block of blocks) {
    const tag = block.tag || sourceToTag(block.source, block.stepId);
    const content = block.content.trim();

    if (format === 'xml') {
      // XML format with semantic tags
      const attrs = block.stepId ? ` source="${block.stepId}"` : '';
      sections.push(`<${tag}${attrs}>\n${content}\n</${tag}>`);
    } else {
      // Markdown format with headers
      const header = tag.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      sections.push(`## ${header}\n\n${content}`);
    }
  }

  return sections.join('\n\n');
}

/**
 * Convert source type to tag name
 */
function sourceToTag(source: ContextSource, stepId?: string): string {
  switch (source) {
    case 'user_input':
      return 'task';
    case 'plan':
      return 'plan';
    case 'step_output':
      return stepId ? `${stepId}_output` : 'step_output';
    case 'previous_output':
      return 'previous_context';
    case 'file_context':
      return 'code_context';
    default:
      return 'context';
  }
}

// --- Utility Functions ---

/**
 * Get default injection rules for a step role
 */
export function getDefaultRules(role: StepRole): InjectionRule[] {
  return DEFAULT_RULES[role] || [];
}

/**
 * Merge custom rules with defaults (custom takes precedence)
 */
export function mergeRules(
  customRules: InjectionRule[],
  role?: StepRole
): InjectionRule[] {
  if (!role) return customRules;

  const defaults = DEFAULT_RULES[role] || [];

  // Custom rules override defaults for same source+stepId combo
  const customKeys = new Set(
    customRules.map(r => `${r.source}:${r.stepId || ''}`)
  );

  const merged = [...customRules];
  for (const def of defaults) {
    const key = `${def.source}:${def.stepId || ''}`;
    if (!customKeys.has(key)) {
      merged.push(def);
    }
  }

  return merged;
}

/**
 * Estimate token budget for an agent
 */
export function getAgentTokenBudget(agent: string, inputRatio = 0.7): number {
  const config = getTokenConfig(agent);
  return Math.floor((config.maxTokens - config.reserveTokens) * inputRatio);
}

/**
 * Infer step role from prompt keywords (heuristic)
 */
export function inferStepRole(prompt: string, action?: string): StepRole | undefined {
  const lower = prompt.toLowerCase();

  // Check action first
  if (action === 'analyze') return 'analyze';

  // Keyword heuristics
  if (lower.includes('review') || lower.includes('critique') || lower.includes('evaluate')) {
    return 'review';
  }
  if (lower.includes('fix') || lower.includes('debug') || lower.includes('resolve')) {
    return 'fix';
  }
  if (lower.includes('implement') || lower.includes('code') || lower.includes('write')) {
    return 'code';
  }
  if (lower.includes('plan') || lower.includes('design') || lower.includes('architect')) {
    return 'plan';
  }
  if (lower.includes('summarize') || lower.includes('summary') || lower.includes('tldr')) {
    return 'summarize';
  }
  if (lower.includes('analyze') || lower.includes('analysis') || lower.includes('examine')) {
    return 'analyze';
  }

  return undefined;
}
