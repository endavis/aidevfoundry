/**
 * Plan Tree Display
 *
 * Renders ExecutionPlan as a collapsible ASCII tree with status icons.
 */

import pc from 'picocolors';
import type { ExecutionPlan, PlanStep } from '../executor/types';

// Status icons
const STATUS_ICONS = {
  pending: '[ ]',
  running: pc.cyan('[>]'),
  completed: pc.green('[✓]'),
  failed: pc.red('[✗]'),
  skipped: pc.dim('[○]'),
};

// Tree drawing characters
const TREE = {
  branch: '├── ',
  lastBranch: '└── ',
  vertical: '│   ',
  empty: '    ',
};

export interface TreeNode {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  children: TreeNode[];
  details?: string;
  duration?: number;
  collapsed?: boolean;
}

/**
 * Convert ExecutionPlan to tree structure
 */
export function planToTree(plan: ExecutionPlan, stepResults?: Map<string, 'completed' | 'failed' | 'running'>): TreeNode {
  const root: TreeNode = {
    id: plan.id,
    label: plan.prompt.slice(0, 60) + (plan.prompt.length > 60 ? '...' : ''),
    status: 'running',
    children: [],
  };

  // Group steps by dependencies
  const stepMap = new Map<string, PlanStep>();
  const childrenOf = new Map<string, string[]>();

  for (const step of plan.steps) {
    stepMap.set(step.id, step);

    // Find parent (first dependency or root)
    const parentId = step.dependsOn?.[0] || '_root';
    if (!childrenOf.has(parentId)) {
      childrenOf.set(parentId, []);
    }
    childrenOf.get(parentId)!.push(step.id);
  }

  // Build tree recursively
  function buildNode(stepId: string): TreeNode {
    const step = stepMap.get(stepId)!;
    const status = stepResults?.get(stepId) || 'pending';

    const node: TreeNode = {
      id: step.id,
      label: `${step.agent}: ${step.action}`,
      status,
      children: [],
      details: step.prompt.slice(0, 40) + (step.prompt.length > 40 ? '...' : ''),
    };

    const children = childrenOf.get(stepId) || [];
    for (const childId of children) {
      node.children.push(buildNode(childId));
    }

    return node;
  }

  // Add root-level steps
  const rootChildren = childrenOf.get('_root') || [];
  for (const stepId of rootChildren) {
    root.children.push(buildNode(stepId));
  }

  // If no dependency structure, add all steps as children
  if (root.children.length === 0) {
    for (const step of plan.steps) {
      const status = stepResults?.get(step.id) || 'pending';
      root.children.push({
        id: step.id,
        label: `${step.agent}: ${step.action}`,
        status,
        children: [],
        details: step.prompt.slice(0, 40) + (step.prompt.length > 40 ? '...' : ''),
      });
    }
  }

  // Update root status based on children
  const allCompleted = root.children.every(c => c.status === 'completed');
  const anyFailed = root.children.some(c => c.status === 'failed');
  const anyRunning = root.children.some(c => c.status === 'running');

  if (allCompleted) root.status = 'completed';
  else if (anyFailed) root.status = 'failed';
  else if (anyRunning) root.status = 'running';
  else root.status = 'pending';

  return root;
}

/**
 * Render tree node as ASCII lines
 */
export function renderTree(node: TreeNode, prefix = '', isLast = true): string[] {
  const lines: string[] = [];
  const statusIcon = STATUS_ICONS[node.status];

  // Current node
  const connector = prefix === '' ? '' : (isLast ? TREE.lastBranch : TREE.branch);
  const label = node.collapsed ? pc.dim(node.label) : node.label;
  lines.push(`${prefix}${connector}${statusIcon} ${label}`);

  // Details line
  if (node.details && !node.collapsed) {
    const detailPrefix = prefix + (isLast ? TREE.empty : TREE.vertical);
    lines.push(pc.dim(`${detailPrefix}    ${node.details}`));
  }

  // Duration if available
  if (node.duration !== undefined) {
    const durPrefix = prefix + (isLast ? TREE.empty : TREE.vertical);
    lines.push(pc.dim(`${durPrefix}    (${(node.duration / 1000).toFixed(1)}s)`));
  }

  // Children
  if (!node.collapsed) {
    const childPrefix = prefix + (isLast ? TREE.empty : TREE.vertical);
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const childIsLast = i === node.children.length - 1;
      lines.push(...renderTree(child, childPrefix, childIsLast));
    }
  }

  return lines;
}

/**
 * Print tree to console
 */
export function printTree(node: TreeNode): void {
  const lines = renderTree(node);
  for (const line of lines) {
    console.log(line);
  }
}

/**
 * Format plan as simple text (fallback)
 */
export function formatPlanText(plan: ExecutionPlan, stepResults?: Map<string, 'completed' | 'failed' | 'running'>): string {
  const lines = [
    `Plan: ${plan.id}`,
    `Mode: ${plan.mode}`,
    `Steps:`,
  ];

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const status = stepResults?.get(step.id) || 'pending';
    const icon = STATUS_ICONS[status];
    lines.push(`  ${i + 1}. ${icon} ${step.agent}: ${step.action}`);
    if (step.dependsOn?.length) {
      lines.push(pc.dim(`      depends on: ${step.dependsOn.join(', ')}`));
    }
  }

  return lines.join('\n');
}

/**
 * Create progress bar
 */
export function createProgressBar(completed: number, total: number, width = 20): string {
  const percent = total > 0 ? completed / total : 0;
  const filled = Math.round(percent * width);
  const empty = width - filled;

  const bar = pc.green('█'.repeat(filled)) + pc.dim('░'.repeat(empty));
  const pct = Math.round(percent * 100);

  return `[${bar}] ${pct}% (${completed}/${total})`;
}

/**
 * Create status summary line
 */
export function createStatusSummary(
  steps: { status: 'pending' | 'running' | 'completed' | 'failed' }[]
): string {
  const counts = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
  };

  for (const step of steps) {
    counts[step.status]++;
  }

  const parts: string[] = [];
  if (counts.completed > 0) parts.push(pc.green(`${counts.completed} done`));
  if (counts.running > 0) parts.push(pc.cyan(`${counts.running} running`));
  if (counts.pending > 0) parts.push(pc.dim(`${counts.pending} pending`));
  if (counts.failed > 0) parts.push(pc.red(`${counts.failed} failed`));

  return parts.join(' | ');
}
