/**
 * Campaign Checkpoint Manager
 *
 * Handles checkpoint creation, validation, storage, and restoration
 * for reliable campaign pause/resume functionality.
 */

import { promises as fs } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import type { CampaignState, CampaignTask, CampaignTaskStatus } from './campaign-state.js';
import type {
  EnhancedCheckpoint,
  DomainCheckpointState,
  DomainStatus,
  CampaignMetrics,
  CampaignDomain
} from './campaign-types.js';
import { getBranchCommit, branchExists } from './campaign-git.js';

// Type guard for checking if state has domains
function hasDomains(state: CampaignState): state is CampaignState & { domains: CampaignDomain[] } {
  return 'domains' in state && Array.isArray((state as { domains?: unknown }).domains);
}

// ============================================================================
// Types
// ============================================================================

/** Checkpoint storage configuration */
export interface CheckpointConfig {
  /** Directory for checkpoint files */
  checkpointDir: string;
  /** Maximum number of checkpoints to keep (0 = unlimited) */
  maxCheckpoints: number;
  /** Whether to compress checkpoint data */
  compress: boolean;
  /** Working directory for git operations */
  cwd: string;
}

/** Checkpoint validation result */
export interface CheckpointValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Resume options */
export interface ResumeOptions {
  /** Validate git state before resuming */
  validateGit: boolean;
  /** Reset tasks that were in_progress to pending */
  resetInProgress: boolean;
  /** Specific checkpoint ID (defaults to latest) */
  checkpointId?: string;
}

/** Resume result */
export interface ResumeResult {
  success: boolean;
  checkpoint: EnhancedCheckpoint | null;
  restoredTasks: string[];
  warnings: string[];
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_CHECKPOINTS = 10;
const CHECKPOINT_FILE_PREFIX = 'checkpoint_';
const CHECKPOINT_FILE_SUFFIX = '.json';

// ============================================================================
// Checkpoint Creation
// ============================================================================

/**
 * Create an enhanced checkpoint from current campaign state
 */
export async function createCheckpoint(
  state: CampaignState,
  config: CheckpointConfig,
  summary?: string
): Promise<EnhancedCheckpoint> {
  const now = Date.now();
  const checkpointId = `cp_${now}_${Math.random().toString(36).slice(2, 8)}`;

  // Gather completed task IDs
  const completedTaskIds = state.tasks
    .filter((t: CampaignTask) => t.status === 'completed')
    .map((t: CampaignTask) => t.id);

  // Build domain states
  const domainStates = await buildDomainStates(state, config);

  // Get git refs for domain branches
  const gitRefs = await gatherGitRefs(state, config);

  // Get campaign metrics
  const metrics = await gatherMetrics(state);

  // Create checkpoint object
  const checkpointData: EnhancedCheckpoint = {
    id: checkpointId,
    created_at: now,
    summary: summary ?? generateCheckpointSummary(state),
    completed_task_ids: completedTaskIds,
    domain_states: domainStates,
    git_refs: gitRefs,
    metrics,
    integrity_hash: '', // Computed below
    size_bytes: 0
  };

  // Compute integrity hash
  const jsonStr = JSON.stringify(checkpointData);
  checkpointData.integrity_hash = computeIntegrityHash(jsonStr);
  checkpointData.size_bytes = Buffer.byteLength(jsonStr, 'utf-8');

  return checkpointData;
}

/**
 * Build domain state snapshots for checkpoint
 */
async function buildDomainStates(
  state: CampaignState,
  config: CheckpointConfig
): Promise<Record<string, DomainCheckpointState>> {
  const domainStates: Record<string, DomainCheckpointState> = {};

  // Check if state has domains (extended state)
  if (hasDomains(state)) {
    for (const domain of state.domains) {
      const domainTasks = state.tasks.filter((t: CampaignTask) =>
        'domain' in t && (t as CampaignTask & { domain?: string }).domain === domain.name
      );

      const taskCounts = countTasksByStatus(domainTasks);
      const progress = domainTasks.length > 0
        ? (taskCounts.completed / domainTasks.length) * 100
        : 0;

      // Get branch HEAD if available
      let branchHead: string | undefined;
      try {
        const branchName = `campaign/${state.campaignId}/${domain.name}`;
        if (await branchExists(config.cwd, branchName)) {
          const commit = await getBranchCommit(config.cwd, branchName);
          branchHead = commit ?? undefined;
        }
      } catch {
        // Branch operations may fail - continue without
      }

      domainStates[domain.name] = {
        domain: domain.name,
        status: domain.status,
        progress_percent: progress,
        task_counts: taskCounts,
        branch_head: branchHead
      };
    }
  } else {
    // Basic campaign without explicit domains - use default domain
    const taskCounts = countTasksByStatus(state.tasks);
    const progress = state.tasks.length > 0
      ? (taskCounts.completed / state.tasks.length) * 100
      : 0;

    domainStates['default'] = {
      domain: 'default',
      status: determineStatusFromTasks(taskCounts),
      progress_percent: progress,
      task_counts: taskCounts,
      branch_head: undefined
    };
  }

  return domainStates;
}

/**
 * Gather git refs for all domain branches
 */
async function gatherGitRefs(
  state: CampaignState,
  config: CheckpointConfig
): Promise<Record<string, string>> {
  const gitRefs: Record<string, string> = {};

  // Get main campaign branch
  const mainBranch = `campaign/${state.campaignId}`;
  try {
    if (await branchExists(config.cwd, mainBranch)) {
      const commit = await getBranchCommit(config.cwd, mainBranch);
      if (commit) {
        gitRefs['main'] = commit;
      }
    }
  } catch {
    // Continue without main branch ref
  }

  // Get domain branches if available
  if (hasDomains(state)) {
    for (const domain of state.domains) {
      const domainBranch = `campaign/${state.campaignId}/${domain.name}`;
      try {
        if (await branchExists(config.cwd, domainBranch)) {
          const commit = await getBranchCommit(config.cwd, domainBranch);
          if (commit) {
            gitRefs[domain.name] = commit;
          }
        }
      } catch {
        // Continue without this domain's ref
      }
    }
  }

  return gitRefs;
}

/**
 * Gather current campaign metrics
 *
 * Prefers state-based counts since DB may not have records for this campaign.
 */
function gatherMetrics(
  state: CampaignState
): CampaignMetrics {
  const counts = countTasksByStatus(state.tasks);
  return {
    tasks_total: state.tasks.length,
    tasks_completed: counts.completed,
    tasks_failed: counts.failed,
    retries_total: state.tasks.reduce((sum, t) => sum + t.attempts, 0),
    started_at: state.createdAt,
    total_duration_ms: Date.now() - state.createdAt,
    drift_checks: 0,
    drift_corrections: 0
  };
}

// ============================================================================
// Checkpoint Storage
// ============================================================================

/**
 * Save checkpoint to file
 */
export async function saveCheckpoint(
  checkpoint: EnhancedCheckpoint,
  config: CheckpointConfig
): Promise<string> {
  await fs.mkdir(config.checkpointDir, { recursive: true });

  const filename = `${CHECKPOINT_FILE_PREFIX}${checkpoint.id}${CHECKPOINT_FILE_SUFFIX}`;
  const filepath = resolve(config.checkpointDir, filename);

  const data = JSON.stringify(checkpoint, null, 2);
  await fs.writeFile(filepath, data, 'utf-8');

  // Prune old checkpoints if needed
  if (config.maxCheckpoints > 0) {
    await pruneOldCheckpoints(config.checkpointDir, config.maxCheckpoints);
  }

  return filepath;
}

/**
 * Load checkpoint from file
 */
export async function loadCheckpoint(
  checkpointPath: string
): Promise<EnhancedCheckpoint | null> {
  try {
    const data = await fs.readFile(checkpointPath, 'utf-8');
    return JSON.parse(data) as EnhancedCheckpoint;
  } catch {
    return null;
  }
}

/**
 * Load the latest checkpoint from directory
 */
export async function loadLatestCheckpoint(
  checkpointDir: string
): Promise<EnhancedCheckpoint | null> {
  try {
    const files = await fs.readdir(checkpointDir);
    const checkpointFiles = files
      .filter(f => f.startsWith(CHECKPOINT_FILE_PREFIX) && f.endsWith(CHECKPOINT_FILE_SUFFIX))
      .sort()
      .reverse();

    if (checkpointFiles.length === 0) {
      return null;
    }

    const latestPath = resolve(checkpointDir, checkpointFiles[0]);
    return loadCheckpoint(latestPath);
  } catch {
    return null;
  }
}

/**
 * List all available checkpoints
 */
export async function listCheckpoints(
  checkpointDir: string
): Promise<Array<{ id: string; created_at: number; summary: string; path: string }>> {
  try {
    const files = await fs.readdir(checkpointDir);
    const checkpointFiles = files
      .filter(f => f.startsWith(CHECKPOINT_FILE_PREFIX) && f.endsWith(CHECKPOINT_FILE_SUFFIX));

    const checkpoints: Array<{ id: string; created_at: number; summary: string; path: string }> = [];

    for (const file of checkpointFiles) {
      const filepath = resolve(checkpointDir, file);
      const checkpoint = await loadCheckpoint(filepath);
      if (checkpoint) {
        checkpoints.push({
          id: checkpoint.id,
          created_at: checkpoint.created_at,
          summary: checkpoint.summary,
          path: filepath
        });
      }
    }

    return checkpoints.sort((a, b) => b.created_at - a.created_at);
  } catch {
    return [];
  }
}

/**
 * Prune old checkpoints, keeping only the most recent N
 */
async function pruneOldCheckpoints(
  checkpointDir: string,
  keepCount: number
): Promise<void> {
  const checkpoints = await listCheckpoints(checkpointDir);

  if (checkpoints.length <= keepCount) {
    return;
  }

  const toDelete = checkpoints.slice(keepCount);
  for (const cp of toDelete) {
    try {
      await fs.unlink(cp.path);
    } catch {
      // Ignore deletion errors
    }
  }
}

// ============================================================================
// Checkpoint Validation
// ============================================================================

/**
 * Validate checkpoint integrity and compatibility
 */
export function validateCheckpoint(
  checkpoint: EnhancedCheckpoint,
  currentState?: CampaignState
): CheckpointValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required fields
  if (!checkpoint.id) {
    errors.push('Checkpoint missing ID');
  }
  if (!checkpoint.created_at) {
    errors.push('Checkpoint missing creation timestamp');
  }
  if (!Array.isArray(checkpoint.completed_task_ids)) {
    errors.push('Checkpoint missing completed_task_ids array');
  }

  // Validate integrity hash
  // Hash was computed with integrity_hash='' and size_bytes=0
  const cloned = { ...checkpoint };
  const storedHash = cloned.integrity_hash;
  const storedSize = cloned.size_bytes;
  cloned.integrity_hash = '';
  cloned.size_bytes = 0;
  const computedHash = computeIntegrityHash(JSON.stringify(cloned));

  if (storedHash !== computedHash) {
    errors.push('Checkpoint integrity hash mismatch - data may be corrupted');
  }

  // Check compatibility with current state if provided
  if (currentState) {
    const currentTaskIds = new Set(currentState.tasks.map(t => t.id));

    // Warn about tasks in checkpoint that don't exist in current state
    const missingTasks = checkpoint.completed_task_ids.filter(id => !currentTaskIds.has(id));
    if (missingTasks.length > 0) {
      warnings.push(`${missingTasks.length} completed tasks in checkpoint not found in current state`);
    }

    // Warn if checkpoint is old
    const age = Date.now() - checkpoint.created_at;
    const ageHours = age / (1000 * 60 * 60);
    if (ageHours > 24) {
      warnings.push(`Checkpoint is ${Math.round(ageHours)} hours old`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

// ============================================================================
// Resume Operations
// ============================================================================

/**
 * Resume campaign from checkpoint
 */
export async function resumeFromCheckpoint(
  state: CampaignState,
  config: CheckpointConfig,
  options: ResumeOptions = { validateGit: true, resetInProgress: true }
): Promise<ResumeResult> {
  const warnings: string[] = [];

  // Load checkpoint
  let checkpoint: EnhancedCheckpoint | null;
  if (options.checkpointId) {
    const checkpoints = await listCheckpoints(config.checkpointDir);
    const found = checkpoints.find(c => c.id === options.checkpointId);
    checkpoint = found ? await loadCheckpoint(found.path) : null;
  } else {
    checkpoint = await loadLatestCheckpoint(config.checkpointDir);
  }

  if (!checkpoint) {
    return {
      success: false,
      checkpoint: null,
      restoredTasks: [],
      warnings: [],
      error: 'No checkpoint found'
    };
  }

  // Validate checkpoint
  const validation = validateCheckpoint(checkpoint, state);
  if (!validation.valid) {
    return {
      success: false,
      checkpoint,
      restoredTasks: [],
      warnings: validation.warnings,
      error: `Checkpoint validation failed: ${validation.errors.join('; ')}`
    };
  }
  warnings.push(...validation.warnings);

  // Validate git state if requested
  if (options.validateGit && Object.keys(checkpoint.git_refs).length > 0) {
    const gitWarnings = await validateGitState(checkpoint, config);
    warnings.push(...gitWarnings);
  }

  // Restore task states
  const restoredTasks: string[] = [];
  const completedSet = new Set(checkpoint.completed_task_ids);

  for (const task of state.tasks) {
    if (completedSet.has(task.id)) {
      if (task.status !== 'completed') {
        task.status = 'completed';
        restoredTasks.push(task.id);
      }
    } else if (options.resetInProgress && task.status === 'in_progress') {
      task.status = 'pending';
      restoredTasks.push(task.id);
    }
  }

  // Update state status
  state.status = 'running';
  state.updatedAt = Date.now();

  return {
    success: true,
    checkpoint,
    restoredTasks,
    warnings
  };
}

/**
 * Validate git state matches checkpoint
 */
async function validateGitState(
  checkpoint: EnhancedCheckpoint,
  config: CheckpointConfig
): Promise<string[]> {
  const warnings: string[] = [];

  for (const [name, expectedRef] of Object.entries(checkpoint.git_refs)) {
    try {
      const branchName = name === 'main'
        ? `campaign/${checkpoint.id.split('_')[1]}`
        : `campaign/${checkpoint.id.split('_')[1]}/${name}`;

      if (await branchExists(config.cwd, branchName)) {
        const currentRef = await getBranchCommit(config.cwd, branchName);
        if (currentRef && currentRef !== expectedRef) {
          warnings.push(`Branch ${name} HEAD has diverged from checkpoint (expected ${expectedRef.slice(0, 8)}, got ${currentRef.slice(0, 8)})`);
        } else if (!currentRef) {
          warnings.push(`Branch ${name} could not be read`);
        }
      } else {
        warnings.push(`Branch ${name} no longer exists`);
      }
    } catch {
      // Git operations may fail
    }
  }

  return warnings;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Compute integrity hash for checkpoint data
 */
function computeIntegrityHash(data: string): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/**
 * Generate checkpoint summary from state
 */
function generateCheckpointSummary(state: CampaignState): string {
  const counts = countTasksByStatus(state.tasks);
  const total = state.tasks.length;
  const percent = total > 0 ? Math.round((counts.completed / total) * 100) : 0;

  return `Progress: ${counts.completed}/${total} tasks (${percent}%) - ${counts.in_progress} in progress, ${counts.failed} failed`;
}

/**
 * Count tasks by status
 */
function countTasksByStatus(
  tasks: CampaignTask[]
): Record<CampaignTaskStatus, number> {
  const counts: Record<CampaignTaskStatus, number> = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
    blocked: 0
  };

  for (const task of tasks) {
    counts[task.status] = (counts[task.status] || 0) + 1;
  }

  return counts;
}

/**
 * Determine domain status from task counts
 */
function determineStatusFromTasks(
  counts: Record<CampaignTaskStatus, number>
): DomainStatus {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  if (total === 0) return 'pending';
  if (counts.completed === total) return 'completed';
  if (counts.failed > 0 && counts.in_progress === 0) return 'failed';
  if (counts.in_progress > 0) return 'running';
  if (counts.blocked > 0 && counts.pending === 0) return 'blocked';

  return 'pending';
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create checkpoint with default config
 */
export async function quickCheckpoint(
  state: CampaignState,
  cwd: string,
  summary?: string
): Promise<EnhancedCheckpoint> {
  const config: CheckpointConfig = {
    checkpointDir: resolve(cwd, '.campaign', 'checkpoints'),
    maxCheckpoints: DEFAULT_MAX_CHECKPOINTS,
    compress: false,
    cwd
  };

  return createCheckpoint(state, config, summary);
}

/**
 * Save checkpoint with default config
 */
export async function quickSaveCheckpoint(
  state: CampaignState,
  cwd: string,
  summary?: string
): Promise<string> {
  const config: CheckpointConfig = {
    checkpointDir: resolve(cwd, '.campaign', 'checkpoints'),
    maxCheckpoints: DEFAULT_MAX_CHECKPOINTS,
    compress: false,
    cwd
  };

  const checkpoint = await createCheckpoint(state, config, summary);
  return saveCheckpoint(checkpoint, config);
}

/**
 * Resume with default config
 */
export async function quickResume(
  state: CampaignState,
  cwd: string,
  options?: Partial<ResumeOptions>
): Promise<ResumeResult> {
  const config: CheckpointConfig = {
    checkpointDir: resolve(cwd, '.campaign', 'checkpoints'),
    maxCheckpoints: DEFAULT_MAX_CHECKPOINTS,
    compress: false,
    cwd
  };

  return resumeFromCheckpoint(state, config, {
    validateGit: true,
    resetInProgress: true,
    ...options
  });
}
