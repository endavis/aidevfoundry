/**
 * Tests for Campaign Git Branch Management
 *
 * Note: These tests run against the actual git repository.
 * They create and clean up test branches to avoid polluting the repo.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import {
  getCurrentBranch,
  getBranchCommit,
  branchExists,
  listBranches,
  createBranch,
  deleteBranch,
  getDomainBranchName,
  getCampaignBranchName,
  detectMergeConflicts,
  listStashes
} from './campaign-git.js';

const cwd = process.cwd();
const TEST_CAMPAIGN = 'test-git-campaign';
const TEST_BRANCHES: string[] = [];

// Clean up any test branches after tests
afterAll(async () => {
  for (const branch of TEST_BRANCHES) {
    try {
      await deleteBranch(cwd, branch, true);
    } catch {
      // Ignore cleanup errors
    }
  }
});

describe('Branch naming', () => {
  it('should generate correct domain branch name', () => {
    const branchName = getDomainBranchName('my-campaign', 'ui');
    expect(branchName).toBe('campaign/my-campaign/ui');
  });

  it('should sanitize special characters in campaign name', () => {
    const branchName = getDomainBranchName('My Campaign!', 'UI Layer');
    expect(branchName).toBe('campaign/my-campaign-/ui-layer');
  });

  it('should generate correct campaign branch name', () => {
    const branchName = getCampaignBranchName('my-campaign');
    expect(branchName).toBe('campaign/my-campaign');
  });
});

describe('getCurrentBranch', () => {
  it('should return current branch name', async () => {
    const branch = await getCurrentBranch(cwd);
    expect(branch).toBeTruthy();
    expect(typeof branch).toBe('string');
  });
});

describe('getBranchCommit', () => {
  it('should return commit hash for HEAD', async () => {
    const commit = await getBranchCommit(cwd, 'HEAD');
    expect(commit).toBeTruthy();
    expect(commit?.length).toBe(40); // Full SHA
  });

  it('should return null for non-existent branch', async () => {
    const commit = await getBranchCommit(cwd, 'non-existent-branch-xyz123');
    expect(commit).toBeNull();
  });
});

describe('branchExists', () => {
  it('should return true for HEAD', async () => {
    const exists = await branchExists(cwd, 'HEAD');
    expect(exists).toBe(true);
  });

  it('should return false for non-existent branch', async () => {
    const exists = await branchExists(cwd, 'non-existent-branch-xyz123');
    expect(exists).toBe(false);
  });
});

describe('listBranches', () => {
  it('should return list of branches', async () => {
    const branches = await listBranches(cwd);
    expect(Array.isArray(branches)).toBe(true);
    expect(branches.length).toBeGreaterThan(0);

    // Check branch structure
    const branch = branches[0];
    expect(branch).toHaveProperty('name');
    expect(branch).toHaveProperty('commit');
    expect(branch).toHaveProperty('isRemote');
  });
});

describe('createBranch and deleteBranch', () => {
  const testBranchName = `test-branch-${Date.now()}`;

  it('should create a new branch', async () => {
    const result = await createBranch(cwd, testBranchName);
    TEST_BRANCHES.push(testBranchName);

    expect(result.success).toBe(true);

    const exists = await branchExists(cwd, testBranchName);
    expect(exists).toBe(true);
  });

  it('should fail to create duplicate branch', async () => {
    const result = await createBranch(cwd, testBranchName);
    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });

  it('should delete the test branch', async () => {
    const result = await deleteBranch(cwd, testBranchName, true);
    expect(result.success).toBe(true);

    const exists = await branchExists(cwd, testBranchName);
    expect(exists).toBe(false);

    // Remove from cleanup list
    const idx = TEST_BRANCHES.indexOf(testBranchName);
    if (idx >= 0) TEST_BRANCHES.splice(idx, 1);
  });

  it('should fail to delete non-existent branch', async () => {
    const result = await deleteBranch(cwd, 'non-existent-branch-xyz123');
    expect(result.success).toBe(false);
  });
});

describe('detectMergeConflicts', () => {
  it('should return empty array when merging same branch', async () => {
    const currentBranch = await getCurrentBranch(cwd);
    if (!currentBranch) {
      console.log('Skipping test: could not get current branch');
      return;
    }

    const conflicts = await detectMergeConflicts(cwd, currentBranch);
    expect(conflicts).toEqual([]);
  });
});

describe('listStashes', () => {
  it('should return array of stash entries', async () => {
    const stashes = await listStashes(cwd);
    expect(Array.isArray(stashes)).toBe(true);

    // Stash structure check if there are any
    if (stashes.length > 0) {
      const stash = stashes[0];
      expect(stash).toHaveProperty('index');
      expect(stash).toHaveProperty('message');
      expect(stash).toHaveProperty('branch');
    }
  });
});

describe('Domain branch naming conventions', () => {
  it('should create consistent branch names', () => {
    const campaignBranch = getCampaignBranchName('puzldai-orchestrator');
    const uiBranch = getDomainBranchName('puzldai-orchestrator', 'ui');
    const apiBranch = getDomainBranchName('puzldai-orchestrator', 'api');
    const infraBranch = getDomainBranchName('puzldai-orchestrator', 'infra');

    expect(campaignBranch).toBe('campaign/puzldai-orchestrator');
    expect(uiBranch).toBe('campaign/puzldai-orchestrator/ui');
    expect(apiBranch).toBe('campaign/puzldai-orchestrator/api');
    expect(infraBranch).toBe('campaign/puzldai-orchestrator/infra');

    // All domain branches should start with campaign branch
    expect(uiBranch.startsWith(campaignBranch)).toBe(true);
    expect(apiBranch.startsWith(campaignBranch)).toBe(true);
    expect(infraBranch.startsWith(campaignBranch)).toBe(true);
  });

  it('should handle various domain names', () => {
    const testCases = [
      { domain: 'ui', expected: 'campaign/test/ui' },
      { domain: 'api', expected: 'campaign/test/api' },
      { domain: 'database', expected: 'campaign/test/database' },
      { domain: 'frontend-components', expected: 'campaign/test/frontend-components' },
      { domain: 'UPPERCASE', expected: 'campaign/test/uppercase' },
      { domain: 'with spaces', expected: 'campaign/test/with-spaces' },
    ];

    for (const { domain, expected } of testCases) {
      const result = getDomainBranchName('test', domain);
      expect(result).toBe(expected);
    }
  });
});

describe('Git operation error handling', () => {
  it('should handle operations in non-existent directory gracefully', async () => {
    const fakeCwd = '/non/existent/path';

    // These should return null/empty/false rather than throwing
    const branch = await getCurrentBranch(fakeCwd);
    expect(branch).toBeNull();

    const commit = await getBranchCommit(fakeCwd, 'HEAD');
    expect(commit).toBeNull();

    const exists = await branchExists(fakeCwd, 'main');
    expect(exists).toBe(false);

    const branches = await listBranches(fakeCwd);
    expect(branches).toEqual([]);
  });
});
