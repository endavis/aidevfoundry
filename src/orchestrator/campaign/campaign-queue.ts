import type { CampaignTask, CampaignTaskStatus } from './campaign-state.js';
import type {
  EnhancedCampaignTask,
  CampaignDomain,
  DomainStatus,
  isEnhancedTask
} from './campaign-types.js';
import { canTaskStart } from './campaign-validation.js';

export interface TaskQueue {
  pending: string[];
  inProgress: string[];
  completed: string[];
  failed: string[];
  blocked: string[];
}

// ============================================================================
// Domain Queue Types
// ============================================================================

/**
 * DomainQueue - A queue scoped to a single domain for parallel execution
 */
export interface DomainQueue {
  /** Domain name */
  domain: string;

  /** Task IDs in this domain by status */
  pending: string[];
  inProgress: string[];
  completed: string[];
  failed: string[];
  blocked: string[];

  /** Domain status derived from task states */
  status: DomainStatus;

  /** Progress percentage (0-100) */
  progress: number;
}

/**
 * DomainQueueStatus - Summary of domain queue state
 */
export interface DomainQueueStatus {
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  blocked: number;
  total: number;
  progress: number;
}

/**
 * MultiDomainQueue - Manages queues for multiple domains
 */
export interface MultiDomainQueue {
  domains: Map<string, DomainQueue>;
  orphanTasks: string[]; // Tasks with no domain assignment
}

export function createQueueFromTasks(tasks: CampaignTask[]): TaskQueue {
  return {
    pending: tasks.filter(t => t.status === 'pending').map(t => t.id),
    inProgress: tasks.filter(t => t.status === 'in_progress').map(t => t.id),
    completed: tasks.filter(t => t.status === 'completed').map(t => t.id),
    failed: tasks.filter(t => t.status === 'failed').map(t => t.id),
    blocked: tasks.filter(t => t.status === 'blocked').map(t => t.id)
  };
}

export function getNextTask(queue: TaskQueue, tasks: CampaignTask[]): CampaignTask | null {
  // Prefer tasks that were previously attempted (failed or blocked)
  for (const taskId of [...queue.failed, ...queue.blocked]) {
    const task = tasks.find(t => t.id === taskId);
    if (task && task.attempts < 3) {
      return task;
    }
  }

  // Then get pending tasks
  for (const taskId of queue.pending) {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      return task;
    }
  }

  return null;
}

export function updateTaskStatus(
  tasks: CampaignTask[],
  taskId: string,
  newStatus: CampaignTaskStatus,
  error?: string
): CampaignTask[] {
  return tasks.map(t => {
    if (t.id !== taskId) return t;
    
    const updated: CampaignTask = {
      ...t,
      status: newStatus,
      updatedAt: Date.now()
    };

    if (newStatus === 'in_progress') {
      updated.assignee = updated.assignee || 'worker';
    }
    
    if (newStatus === 'failed' && error) {
      updated.lastError = error;
      updated.attempts += 1;
    }

    if (newStatus === 'completed') {
      updated.resultSummary = updated.resultSummary || 'Task completed';
    }

    return updated;
  });
}

export function hasWorkRemaining(queue: TaskQueue): boolean {
  return queue.pending.length > 0 ||
         queue.inProgress.length > 0 ||
         queue.failed.length > 0 ||
         queue.blocked.length > 0;
}

export function getProgress(queue: TaskQueue, totalTasks: number): number {
  const completed = queue.completed.length;
  if (totalTasks === 0) return 0;
  return Math.round((completed / totalTasks) * 100);
}

// ============================================================================
// Domain Queue Functions
// ============================================================================

/**
 * Create a domain queue for a specific domain
 *
 * Filters tasks by domain and creates an isolated queue for that domain.
 * Supports both enhanced tasks (with domain field) and tasks with area field.
 *
 * @param domainName - Name of the domain
 * @param tasks - All tasks (will be filtered by domain)
 * @returns DomainQueue for the specified domain
 */
export function createDomainQueue(
  domainName: string,
  tasks: CampaignTask[]
): DomainQueue {
  // Filter tasks belonging to this domain
  const domainTasks = tasks.filter(t => {
    // Check enhanced task domain field first
    if ('domain' in t && (t as EnhancedCampaignTask).domain === domainName) {
      return true;
    }
    // Fall back to area field for backwards compatibility
    return t.area === domainName;
  });

  const pending = domainTasks.filter(t => t.status === 'pending').map(t => t.id);
  const inProgress = domainTasks.filter(t => t.status === 'in_progress').map(t => t.id);
  const completed = domainTasks.filter(t => t.status === 'completed').map(t => t.id);
  const failed = domainTasks.filter(t => t.status === 'failed').map(t => t.id);
  const blocked = domainTasks.filter(t => t.status === 'blocked').map(t => t.id);

  const total = domainTasks.length;
  const progress = total > 0 ? Math.round((completed.length / total) * 100) : 0;

  // Derive domain status from task states
  let status: DomainStatus = 'pending';
  if (completed.length === total && total > 0) {
    status = 'completed';
  } else if (failed.length > 0 && pending.length === 0 && inProgress.length === 0) {
    status = 'failed';
  } else if (inProgress.length > 0) {
    status = 'running';
  } else if (blocked.length > 0 && pending.length === 0 && inProgress.length === 0) {
    status = 'blocked';
  }

  return {
    domain: domainName,
    pending,
    inProgress,
    completed,
    failed,
    blocked,
    status,
    progress
  };
}

/**
 * Create domain queues for multiple domains
 *
 * @param domains - Array of domain configurations
 * @param tasks - All tasks
 * @returns MultiDomainQueue with queues for each domain
 */
export function createMultiDomainQueue(
  domains: CampaignDomain[],
  tasks: CampaignTask[]
): MultiDomainQueue {
  const domainQueues = new Map<string, DomainQueue>();
  const assignedTaskIds = new Set<string>();

  // Create queue for each domain
  for (const domain of domains) {
    const queue = createDomainQueue(domain.name, tasks);
    domainQueues.set(domain.name, queue);

    // Track assigned tasks
    [...queue.pending, ...queue.inProgress, ...queue.completed, ...queue.failed, ...queue.blocked]
      .forEach(id => assignedTaskIds.add(id));
  }

  // Find orphan tasks (not assigned to any domain)
  const orphanTasks = tasks
    .filter(t => !assignedTaskIds.has(t.id))
    .map(t => t.id);

  return {
    domains: domainQueues,
    orphanTasks
  };
}

/**
 * Get the next task for a specific domain
 *
 * Returns the highest priority pending task in the domain that:
 * 1. Has all dependencies satisfied
 * 2. Passes entry criteria (if enhanced task with criteria)
 *
 * @param domainQueue - The domain queue to get next task from
 * @param tasks - All tasks (for dependency checking)
 * @param cwd - Working directory for entry criteria validation
 * @param checkEntryCriteria - Whether to validate entry criteria (default: true)
 * @returns Next task or null if none available
 */
export async function getNextTaskForDomain(
  domainQueue: DomainQueue,
  tasks: CampaignTask[],
  cwd: string,
  checkEntryCriteria: boolean = true
): Promise<CampaignTask | null> {
  // First try failed/blocked tasks that can be retried
  for (const taskId of [...domainQueue.failed, ...domainQueue.blocked]) {
    const task = tasks.find(t => t.id === taskId);
    if (task && task.attempts < 3) {
      if (areDependenciesSatisfied(task, tasks)) {
        if (!checkEntryCriteria || await checkTaskCanStart(task, cwd)) {
          return task;
        }
      }
    }
  }

  // Sort pending tasks by priority (if enhanced tasks)
  const pendingTasks = domainQueue.pending
    .map(id => tasks.find(t => t.id === id))
    .filter((t): t is CampaignTask => t !== undefined)
    .sort((a, b) => {
      const priorityA = 'priority' in a ? (a as EnhancedCampaignTask).priority ?? 999 : 999;
      const priorityB = 'priority' in b ? (b as EnhancedCampaignTask).priority ?? 999 : 999;
      return priorityA - priorityB;
    });

  // Return first task that meets all criteria
  for (const task of pendingTasks) {
    if (areDependenciesSatisfied(task, tasks)) {
      if (!checkEntryCriteria || await checkTaskCanStart(task, cwd)) {
        return task;
      }
    }
  }

  return null;
}

/**
 * Get status summary for a domain queue
 *
 * @param domainQueue - The domain queue
 * @returns DomainQueueStatus with counts
 */
export function getDomainStatus(domainQueue: DomainQueue): DomainQueueStatus {
  const total = domainQueue.pending.length +
                domainQueue.inProgress.length +
                domainQueue.completed.length +
                domainQueue.failed.length +
                domainQueue.blocked.length;

  return {
    pending: domainQueue.pending.length,
    in_progress: domainQueue.inProgress.length,
    completed: domainQueue.completed.length,
    failed: domainQueue.failed.length,
    blocked: domainQueue.blocked.length,
    total,
    progress: domainQueue.progress
  };
}

/**
 * Check if a domain has work remaining
 *
 * @param domainQueue - The domain queue to check
 * @returns true if there are pending, in-progress, failed, or blocked tasks
 */
export function hasDomainWorkRemaining(domainQueue: DomainQueue): boolean {
  return domainQueue.pending.length > 0 ||
         domainQueue.inProgress.length > 0 ||
         domainQueue.failed.length > 0 ||
         domainQueue.blocked.length > 0;
}

/**
 * Get all domains that have work remaining
 *
 * @param multiQueue - The multi-domain queue
 * @returns Array of domain names with remaining work
 */
export function getDomainsWithWork(multiQueue: MultiDomainQueue): string[] {
  const domains: string[] = [];
  for (const [name, queue] of multiQueue.domains) {
    if (hasDomainWorkRemaining(queue)) {
      domains.push(name);
    }
  }
  return domains;
}

/**
 * Get aggregate progress across all domains
 *
 * @param multiQueue - The multi-domain queue
 * @returns Overall progress percentage (0-100)
 */
export function getMultiDomainProgress(multiQueue: MultiDomainQueue): number {
  let totalTasks = 0;
  let completedTasks = 0;

  for (const queue of multiQueue.domains.values()) {
    const status = getDomainStatus(queue);
    totalTasks += status.total;
    completedTasks += status.completed;
  }

  if (totalTasks === 0) return 0;
  return Math.round((completedTasks / totalTasks) * 100);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if all dependencies for a task are satisfied
 */
function areDependenciesSatisfied(
  task: CampaignTask,
  allTasks: CampaignTask[]
): boolean {
  const deps = task.dependencies || [];
  if (deps.length === 0) return true;

  for (const depId of deps) {
    const depTask = allTasks.find(t => t.id === depId);
    if (!depTask || depTask.status !== 'completed') {
      return false;
    }
  }
  return true;
}

/**
 * Check if a task can start (entry criteria satisfied)
 */
async function checkTaskCanStart(
  task: CampaignTask,
  cwd: string
): Promise<boolean> {
  // Only check entry criteria for enhanced tasks
  if ('entry_criteria' in task) {
    return canTaskStart(task as EnhancedCampaignTask, cwd);
  }
  return true;
}

/**
 * Update task status within a domain queue (returns new queue)
 *
 * @param domainQueue - The domain queue
 * @param taskId - Task ID to update
 * @param newStatus - New status
 * @returns Updated DomainQueue
 */
export function updateDomainTaskStatus(
  domainQueue: DomainQueue,
  taskId: string,
  newStatus: CampaignTaskStatus
): DomainQueue {
  // Remove from all status arrays
  const removeFrom = (arr: string[]) => arr.filter(id => id !== taskId);

  const newQueue: DomainQueue = {
    ...domainQueue,
    pending: removeFrom(domainQueue.pending),
    inProgress: removeFrom(domainQueue.inProgress),
    completed: removeFrom(domainQueue.completed),
    failed: removeFrom(domainQueue.failed),
    blocked: removeFrom(domainQueue.blocked)
  };

  // Add to appropriate status array
  switch (newStatus) {
    case 'pending':
      newQueue.pending.push(taskId);
      break;
    case 'in_progress':
      newQueue.inProgress.push(taskId);
      break;
    case 'completed':
      newQueue.completed.push(taskId);
      break;
    case 'failed':
      newQueue.failed.push(taskId);
      break;
    case 'blocked':
      newQueue.blocked.push(taskId);
      break;
  }

  // Recalculate progress and status
  const total = newQueue.pending.length + newQueue.inProgress.length +
                newQueue.completed.length + newQueue.failed.length + newQueue.blocked.length;
  newQueue.progress = total > 0 ? Math.round((newQueue.completed.length / total) * 100) : 0;

  // Update domain status
  if (newQueue.completed.length === total && total > 0) {
    newQueue.status = 'completed';
  } else if (newQueue.failed.length > 0 && newQueue.pending.length === 0 && newQueue.inProgress.length === 0) {
    newQueue.status = 'failed';
  } else if (newQueue.inProgress.length > 0) {
    newQueue.status = 'running';
  } else if (newQueue.blocked.length > 0 && newQueue.pending.length === 0 && newQueue.inProgress.length === 0) {
    newQueue.status = 'blocked';
  } else {
    newQueue.status = 'pending';
  }

  return newQueue;
}
