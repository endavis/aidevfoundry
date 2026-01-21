/**
 * Campaign Git Branch Management
 *
 * Manages git branches for parallel domain execution:
 * - Domain-specific branches (e.g., campaign/my-campaign/ui)
 * - Safe branch switching with stash/pop
 * - Merge coordination for combining domain work
 * - Conflict detection and resolution hooks
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import {
  isGitRepo,
  getGitStatus,
  type GitStatus
} from '../../lib/git.js';
import type { CampaignDomain, ParallelGitStrategy } from './campaign-types.js';

const execAsync = promisify(exec);
const GIT_TIMEOUT_MS = 60000; // 60 seconds for potentially slow operations

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a git operation with rollback support
 */
export interface GitOperationResult {
  success: boolean;
  error?: string;
  rollbackData?: Record<string, unknown>;
}

/**
 * Branch information
 */
export interface BranchInfo {
  name: string;
  commit: string;
  isRemote: boolean;
  isTracking: boolean;
  upstream?: string;
}

/**
 * Merge result
 */
export interface MergeResult {
  success: boolean;
  conflicts: string[];
  mergedBranches: string[];
  error?: string;
}

/**
 * Stash entry
 */
export interface StashEntry {
  index: number;
  message: string;
  branch: string;
}

// ============================================================================
// Git Command Execution
// ============================================================================

/**
 * Execute a git command and return stdout
 */
async function gitExec(cwd: string, args: string, timeout: number = GIT_TIMEOUT_MS): Promise<string> {
  const { stdout } = await execAsync(`git ${args}`, {
    cwd,
    timeout,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout.trim();
}

/**
 * Execute a git command, returning success/failure without throwing
 */
async function gitExecSafe(cwd: string, args: string): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const output = await gitExec(cwd, args);
    return { success: true, output };
  } catch (err) {
    return { success: false, output: '', error: (err as Error).message };
  }
}

// ============================================================================
// Branch Management
// ============================================================================

/**
 * Get current branch name
 */
export async function getCurrentBranch(cwd: string): Promise<string | null> {
  try {
    return await gitExec(cwd, 'rev-parse --abbrev-ref HEAD');
  } catch {
    return null;
  }
}

/**
 * Get commit hash for a branch or ref
 */
export async function getBranchCommit(cwd: string, branch: string): Promise<string | null> {
  try {
    return await gitExec(cwd, `rev-parse ${branch}`);
  } catch {
    return null;
  }
}

/**
 * Check if a branch exists
 */
export async function branchExists(cwd: string, branchName: string): Promise<boolean> {
  const result = await gitExecSafe(cwd, `rev-parse --verify ${branchName}`);
  return result.success;
}

/**
 * List all local branches
 */
export async function listBranches(cwd: string): Promise<BranchInfo[]> {
  try {
    const output = await gitExec(cwd, 'branch -vv --format="%(refname:short)|%(objectname:short)|%(upstream:short)"');

    if (!output) return [];

    return output.split('\n').filter(Boolean).map(line => {
      const [name, commit, upstream] = line.split('|');
      return {
        name,
        commit,
        isRemote: false,
        isTracking: !!upstream,
        upstream: upstream || undefined
      };
    });
  } catch {
    return [];
  }
}

/**
 * Create a new branch from a base
 *
 * @param cwd - Working directory
 * @param branchName - New branch name
 * @param baseBranch - Base branch to create from (default: current branch)
 * @returns GitOperationResult
 */
export async function createBranch(
  cwd: string,
  branchName: string,
  baseBranch?: string
): Promise<GitOperationResult> {
  // Check if branch already exists
  if (await branchExists(cwd, branchName)) {
    return { success: false, error: `Branch '${branchName}' already exists` };
  }

  const baseArg = baseBranch ? ` ${baseBranch}` : '';
  const result = await gitExecSafe(cwd, `branch ${branchName}${baseArg}`);

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    rollbackData: { branchName }
  };
}

/**
 * Delete a branch
 *
 * @param cwd - Working directory
 * @param branchName - Branch to delete
 * @param force - Force delete even if not merged
 */
export async function deleteBranch(
  cwd: string,
  branchName: string,
  force: boolean = false
): Promise<GitOperationResult> {
  const flag = force ? '-D' : '-d';
  const result = await gitExecSafe(cwd, `branch ${flag} ${branchName}`);

  return {
    success: result.success,
    error: result.error
  };
}

/**
 * Switch to a branch
 *
 * @param cwd - Working directory
 * @param branchName - Branch to switch to
 */
export async function switchBranch(cwd: string, branchName: string): Promise<GitOperationResult> {
  // Try 'switch' first (modern git), fall back to 'checkout'
  let result = await gitExecSafe(cwd, `switch ${branchName}`);

  if (!result.success) {
    result = await gitExecSafe(cwd, `checkout ${branchName}`);
  }

  return {
    success: result.success,
    error: result.error
  };
}

// ============================================================================
// Domain Branch Management
// ============================================================================

/**
 * Generate branch name for a domain
 *
 * @param campaignName - Name of the campaign
 * @param domainName - Name of the domain
 * @returns Branch name (e.g., "campaign/my-campaign/ui")
 */
export function getDomainBranchName(campaignName: string, domainName: string): string {
  // Sanitize names for git branch naming
  const sanitizedCampaign = campaignName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const sanitizedDomain = domainName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return `campaign/${sanitizedCampaign}/${sanitizedDomain}`;
}

/**
 * Get campaign branch name (main branch for the campaign)
 */
export function getCampaignBranchName(campaignName: string): string {
  const sanitizedCampaign = campaignName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return `campaign/${sanitizedCampaign}`;
}

/**
 * Create a domain-specific branch
 *
 * @param cwd - Working directory
 * @param campaignName - Campaign name
 * @param domainName - Domain name
 * @param baseBranch - Base branch to create from
 * @returns GitOperationResult with branch name
 */
export async function createDomainBranch(
  cwd: string,
  campaignName: string,
  domainName: string,
  baseBranch: string
): Promise<GitOperationResult & { branchName?: string }> {
  const branchName = getDomainBranchName(campaignName, domainName);

  const result = await createBranch(cwd, branchName, baseBranch);

  if (result.success) {
    return { ...result, branchName };
  }

  return result;
}

/**
 * Switch to a domain branch with stash/pop for safety
 *
 * If there are uncommitted changes, they are stashed before switching
 * and popped after switching (if switching back to original branch).
 *
 * @param cwd - Working directory
 * @param campaignName - Campaign name
 * @param domainName - Domain name
 * @returns GitOperationResult with stash info
 */
export async function switchToDomainBranch(
  cwd: string,
  campaignName: string,
  domainName: string
): Promise<GitOperationResult & { stashed?: boolean; previousBranch?: string }> {
  const branchName = getDomainBranchName(campaignName, domainName);

  // Get current state
  const currentBranch = await getCurrentBranch(cwd);
  const status = await getGitStatus(cwd);

  let stashed = false;

  // Stash if dirty
  if (status.isDirty) {
    const stashResult = await gitExecSafe(cwd, `stash push -m "campaign-switch: ${currentBranch} -> ${branchName}"`);
    if (!stashResult.success) {
      return { success: false, error: `Failed to stash changes: ${stashResult.error}` };
    }
    stashed = true;
  }

  // Switch branch
  const switchResult = await switchBranch(cwd, branchName);

  if (!switchResult.success) {
    // Try to restore stash if we stashed
    if (stashed) {
      await gitExecSafe(cwd, 'stash pop');
    }
    return { success: false, error: switchResult.error };
  }

  return {
    success: true,
    stashed,
    previousBranch: currentBranch || undefined,
    rollbackData: { previousBranch: currentBranch, stashed }
  };
}

/**
 * Return to previous branch after domain work
 *
 * @param cwd - Working directory
 * @param previousBranch - Branch to return to
 * @param popStash - Whether to pop the stash
 */
export async function returnFromDomainBranch(
  cwd: string,
  previousBranch: string,
  popStash: boolean = false
): Promise<GitOperationResult> {
  const switchResult = await switchBranch(cwd, previousBranch);

  if (!switchResult.success) {
    return switchResult;
  }

  if (popStash) {
    const popResult = await gitExecSafe(cwd, 'stash pop');
    if (!popResult.success) {
      // Non-fatal - log but continue
      console.warn(`Warning: Failed to pop stash: ${popResult.error}`);
    }
  }

  return { success: true };
}

// ============================================================================
// Merge Operations
// ============================================================================

/**
 * Merge a branch into the current branch
 *
 * @param cwd - Working directory
 * @param branchToMerge - Branch to merge
 * @param strategy - Merge strategy ('merge' | 'squash' | 'rebase')
 */
export async function mergeBranch(
  cwd: string,
  branchToMerge: string,
  strategy: 'merge' | 'squash' | 'rebase' = 'merge'
): Promise<MergeResult> {
  let result: { success: boolean; output: string; error?: string };

  switch (strategy) {
    case 'squash':
      result = await gitExecSafe(cwd, `merge --squash ${branchToMerge}`);
      break;
    case 'rebase':
      result = await gitExecSafe(cwd, `rebase ${branchToMerge}`);
      break;
    default:
      result = await gitExecSafe(cwd, `merge ${branchToMerge}`);
  }

  if (result.success) {
    return {
      success: true,
      conflicts: [],
      mergedBranches: [branchToMerge]
    };
  }

  // Check for conflicts
  const conflicts = await getConflictingFiles(cwd);

  return {
    success: false,
    conflicts,
    mergedBranches: [],
    error: conflicts.length > 0 ? `Merge conflicts in: ${conflicts.join(', ')}` : result.error
  };
}

/**
 * Get list of conflicting files
 */
export async function getConflictingFiles(cwd: string): Promise<string[]> {
  const result = await gitExecSafe(cwd, 'diff --name-only --diff-filter=U');

  if (!result.success || !result.output) {
    return [];
  }

  return result.output.split('\n').filter(Boolean);
}

/**
 * Abort an in-progress merge
 */
export async function abortMerge(cwd: string): Promise<GitOperationResult> {
  const result = await gitExecSafe(cwd, 'merge --abort');
  return { success: result.success, error: result.error };
}

/**
 * Merge all domain branches into the campaign branch
 *
 * @param cwd - Working directory
 * @param campaignName - Campaign name
 * @param domains - List of domains to merge
 * @param strategy - Merge strategy
 */
export async function mergeDomainsToCampaign(
  cwd: string,
  campaignName: string,
  domains: CampaignDomain[],
  strategy: 'merge' | 'squash' | 'rebase' = 'merge'
): Promise<MergeResult> {
  const campaignBranch = getCampaignBranchName(campaignName);
  const mergedBranches: string[] = [];
  const allConflicts: string[] = [];

  // Switch to campaign branch
  const switchResult = await switchBranch(cwd, campaignBranch);
  if (!switchResult.success) {
    return {
      success: false,
      conflicts: [],
      mergedBranches: [],
      error: `Failed to switch to campaign branch: ${switchResult.error}`
    };
  }

  // Merge each domain branch
  for (const domain of domains) {
    const domainBranch = getDomainBranchName(campaignName, domain.name);

    // Check if branch exists
    if (!await branchExists(cwd, domainBranch)) {
      continue; // Skip domains without branches
    }

    const mergeResult = await mergeBranch(cwd, domainBranch, strategy);

    if (mergeResult.success) {
      mergedBranches.push(domainBranch);
    } else {
      allConflicts.push(...mergeResult.conflicts);

      // Abort and return on conflict (fail fast)
      if (mergeResult.conflicts.length > 0) {
        await abortMerge(cwd);
        return {
          success: false,
          conflicts: allConflicts,
          mergedBranches,
          error: `Conflicts detected when merging ${domainBranch}`
        };
      }
    }
  }

  return {
    success: allConflicts.length === 0,
    conflicts: allConflicts,
    mergedBranches
  };
}

// ============================================================================
// Conflict Detection
// ============================================================================

/**
 * Check if merging a branch would cause conflicts (dry run)
 *
 * @param cwd - Working directory
 * @param branchToMerge - Branch to check
 * @returns List of files that would conflict
 */
export async function detectMergeConflicts(
  cwd: string,
  branchToMerge: string
): Promise<string[]> {
  // Try merge with --no-commit --no-ff
  const mergeResult = await gitExecSafe(cwd, `merge --no-commit --no-ff ${branchToMerge}`);

  if (mergeResult.success) {
    // No conflicts - abort the merge
    await gitExecSafe(cwd, 'merge --abort');
    return [];
  }

  // Get conflicting files
  const conflicts = await getConflictingFiles(cwd);

  // Abort the merge
  await gitExecSafe(cwd, 'merge --abort');

  return conflicts;
}

/**
 * Check all domain branches for potential conflicts
 *
 * @param cwd - Working directory
 * @param campaignName - Campaign name
 * @param domains - Domains to check
 * @returns Map of domain name to conflicting files
 */
export async function detectDomainConflicts(
  cwd: string,
  campaignName: string,
  domains: CampaignDomain[]
): Promise<Map<string, string[]>> {
  const conflicts = new Map<string, string[]>();
  const campaignBranch = getCampaignBranchName(campaignName);

  // Save current branch
  const currentBranch = await getCurrentBranch(cwd);

  // Switch to campaign branch
  await switchBranch(cwd, campaignBranch);

  for (const domain of domains) {
    const domainBranch = getDomainBranchName(campaignName, domain.name);

    if (!await branchExists(cwd, domainBranch)) {
      continue;
    }

    const domainConflicts = await detectMergeConflicts(cwd, domainBranch);
    if (domainConflicts.length > 0) {
      conflicts.set(domain.name, domainConflicts);
    }
  }

  // Return to original branch
  if (currentBranch) {
    await switchBranch(cwd, currentBranch);
  }

  return conflicts;
}

// ============================================================================
// Stash Management
// ============================================================================

/**
 * List all stash entries
 */
export async function listStashes(cwd: string): Promise<StashEntry[]> {
  const result = await gitExecSafe(cwd, 'stash list --format="%gd|%gs"');

  if (!result.success || !result.output) {
    return [];
  }

  return result.output.split('\n').filter(Boolean).map((line, index) => {
    const [, message] = line.split('|');
    // Extract branch from message if it follows our format
    const branchMatch = message.match(/campaign-switch: (\S+)/);
    return {
      index,
      message,
      branch: branchMatch ? branchMatch[1] : 'unknown'
    };
  });
}

/**
 * Pop a specific stash entry
 */
export async function popStash(cwd: string, index?: number): Promise<GitOperationResult> {
  const stashArg = index !== undefined ? `stash@{${index}}` : '';
  const result = await gitExecSafe(cwd, `stash pop ${stashArg}`);
  return { success: result.success, error: result.error };
}

/**
 * Drop a specific stash entry
 */
export async function dropStash(cwd: string, index?: number): Promise<GitOperationResult> {
  const stashArg = index !== undefined ? `stash@{${index}}` : '';
  const result = await gitExecSafe(cwd, `stash drop ${stashArg}`);
  return { success: result.success, error: result.error };
}

// ============================================================================
// Rollback Operations
// ============================================================================

/**
 * Rollback a branch creation
 */
export async function rollbackBranchCreation(
  cwd: string,
  branchName: string
): Promise<GitOperationResult> {
  // First check if we're on that branch
  const currentBranch = await getCurrentBranch(cwd);

  if (currentBranch === branchName) {
    // Need to switch away first
    const mainBranch = await gitExecSafe(cwd, 'rev-parse --abbrev-ref origin/HEAD');
    const targetBranch = mainBranch.success ? mainBranch.output.replace('origin/', '') : 'main';
    await switchBranch(cwd, targetBranch);
  }

  return deleteBranch(cwd, branchName, true);
}

/**
 * Hard reset to a specific commit (DESTRUCTIVE)
 */
export async function hardReset(cwd: string, commit: string): Promise<GitOperationResult> {
  const result = await gitExecSafe(cwd, `reset --hard ${commit}`);
  return { success: result.success, error: result.error };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Initialize campaign branches
 *
 * Creates the main campaign branch and domain branches.
 *
 * @param cwd - Working directory
 * @param campaignName - Campaign name
 * @param domains - Domains to create branches for
 * @param baseBranch - Base branch for all campaign branches
 */
export async function initializeCampaignBranches(
  cwd: string,
  campaignName: string,
  domains: CampaignDomain[],
  baseBranch: string
): Promise<GitOperationResult & { createdBranches: string[] }> {
  const createdBranches: string[] = [];

  // Verify we're in a git repo
  if (!await isGitRepo(cwd)) {
    return { success: false, error: 'Not a git repository', createdBranches: [] };
  }

  // Create main campaign branch
  const campaignBranch = getCampaignBranchName(campaignName);
  const campaignResult = await createBranch(cwd, campaignBranch, baseBranch);

  if (!campaignResult.success && !campaignResult.error?.includes('already exists')) {
    return { success: false, error: campaignResult.error, createdBranches };
  }

  if (campaignResult.success) {
    createdBranches.push(campaignBranch);
  }

  // Create domain branches from campaign branch
  for (const domain of domains) {
    const domainBranch = getDomainBranchName(campaignName, domain.name);
    const domainResult = await createBranch(cwd, domainBranch, campaignBranch);

    if (domainResult.success) {
      createdBranches.push(domainBranch);
    }
    // Continue even if branch already exists
  }

  return { success: true, createdBranches };
}

/**
 * Clean up campaign branches
 *
 * Deletes all branches associated with a campaign.
 *
 * @param cwd - Working directory
 * @param campaignName - Campaign name
 * @param domains - Domains that may have branches
 * @param force - Force delete even if not merged
 */
export async function cleanupCampaignBranches(
  cwd: string,
  campaignName: string,
  domains: CampaignDomain[],
  force: boolean = false
): Promise<GitOperationResult & { deletedBranches: string[] }> {
  const deletedBranches: string[] = [];

  // Delete domain branches first
  for (const domain of domains) {
    const domainBranch = getDomainBranchName(campaignName, domain.name);

    if (await branchExists(cwd, domainBranch)) {
      const result = await deleteBranch(cwd, domainBranch, force);
      if (result.success) {
        deletedBranches.push(domainBranch);
      }
    }
  }

  // Delete main campaign branch
  const campaignBranch = getCampaignBranchName(campaignName);

  if (await branchExists(cwd, campaignBranch)) {
    const result = await deleteBranch(cwd, campaignBranch, force);
    if (result.success) {
      deletedBranches.push(campaignBranch);
    }
  }

  return { success: true, deletedBranches };
}

/**
 * Get branch status summary for a campaign
 */
export async function getCampaignBranchStatus(
  cwd: string,
  campaignName: string,
  domains: CampaignDomain[]
): Promise<{
  campaignBranch: { exists: boolean; commit?: string };
  domainBranches: Map<string, { exists: boolean; commit?: string; aheadBehind?: string }>;
}> {
  const campaignBranch = getCampaignBranchName(campaignName);
  const campaignExists = await branchExists(cwd, campaignBranch);
  const campaignCommit = campaignExists ? await getBranchCommit(cwd, campaignBranch) : undefined;

  const domainBranches = new Map<string, { exists: boolean; commit?: string; aheadBehind?: string }>();

  for (const domain of domains) {
    const domainBranch = getDomainBranchName(campaignName, domain.name);
    const exists = await branchExists(cwd, domainBranch);
    const commit = exists ? await getBranchCommit(cwd, domainBranch) : undefined;

    let aheadBehind: string | undefined;
    if (exists && campaignExists) {
      const result = await gitExecSafe(cwd, `rev-list --left-right --count ${campaignBranch}...${domainBranch}`);
      if (result.success) {
        aheadBehind = result.output;
      }
    }

    domainBranches.set(domain.name, { exists, commit: commit || undefined, aheadBehind });
  }

  return {
    campaignBranch: { exists: campaignExists, commit: campaignCommit || undefined },
    domainBranches
  };
}
