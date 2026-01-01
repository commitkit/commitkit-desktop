/**
 * Git Plugin Tests
 *
 * Tests the Git integration for reading commits from repositories.
 */

import { GitPlugin } from '../../src/integrations/git';
import path from 'path';
import os from 'os';

import { execSync } from 'child_process';

// Expand ~ to home directory
const expandTilde = (p: string) => p.startsWith('~') ? p.replace('~', os.homedir()) : p;

// Use TEST_REPO env var if provided, otherwise default to commitkit-desktop repo
const TEST_REPO_PATH = process.env.TEST_REPO
  ? path.resolve(expandTilde(process.env.TEST_REPO))
  : path.resolve(__dirname, '../../');

// Auto-detect main branch: check for 'main', then 'master'
function detectMainBranch(repoPath: string): string {
  if (process.env.TEST_BRANCH) {
    return process.env.TEST_BRANCH;
  }
  try {
    // Check if 'main' branch exists
    execSync(`git rev-parse --verify main`, { cwd: repoPath, stdio: 'ignore' });
    return 'main';
  } catch {
    try {
      // Check if 'master' branch exists
      execSync(`git rev-parse --verify master`, { cwd: repoPath, stdio: 'ignore' });
      return 'master';
    } catch {
      // Default to 'main' if neither exists
      return 'main';
    }
  }
}

const TEST_BRANCH = detectMainBranch(TEST_REPO_PATH);

describe('GitPlugin', () => {
  let plugin: GitPlugin;

  beforeEach(() => {
    plugin = new GitPlugin(TEST_REPO_PATH, TEST_BRANCH);
  });

  describe('metadata', () => {
    it('should have correct id and layer', () => {
      expect(plugin.id).toBe('git');
      expect(plugin.layer).toBe('vcs');
      expect(plugin.priority).toBe(0);
    });
  });

  describe('isRelevant', () => {
    it('should always return true for git plugin', () => {
      const mockCommit = {
        hash: 'abc123',
        message: 'Test commit',
        author: 'Test',
        email: 'test@test.com',
        timestamp: new Date(),
      };

      expect(plugin.isRelevant(mockCommit, {})).toBe(true);
    });
  });

  describe('getCommits', () => {
    it('should return commits from the repository', async () => {
      const commits = await plugin.getCommits({ maxCount: 5 });

      // Should return at least 1 commit (repo has commits)
      expect(commits.length).toBeGreaterThanOrEqual(1);
      // Should not exceed maxCount
      expect(commits.length).toBeLessThanOrEqual(5);
      expect(commits[0]).toHaveProperty('hash');
      expect(commits[0]).toHaveProperty('message');
      expect(commits[0]).toHaveProperty('author');
      expect(commits[0]).toHaveProperty('timestamp');
    });

    it('should include remote URL in commits if remote exists', async () => {
      const commits = await plugin.getCommits({ maxCount: 1 });

      // Remote URL may be undefined if no remote is configured
      // This is valid - not all repos have remotes
      expect(commits[0]).toHaveProperty('remoteUrl');
    });
  });

  describe('getRemoteUrl', () => {
    it('should return remote URL or undefined', async () => {
      const url = await plugin.getRemoteUrl();

      // If remote exists, should be a string; otherwise undefined
      if (url !== undefined) {
        expect(typeof url).toBe('string');
        expect(url.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getCurrentBranch', () => {
    it('should return the current branch name', async () => {
      const branch = await plugin.getCurrentBranch();

      expect(branch).toBeDefined();
      expect(typeof branch).toBe('string');
      expect(branch.length).toBeGreaterThan(0);
    });
  });

  describe('isGitRepo', () => {
    it('should return true for a valid git repo', async () => {
      const isRepo = await GitPlugin.isGitRepo(TEST_REPO_PATH);
      expect(isRepo).toBe(true);
    });

    it('should return false for a non-repo directory', async () => {
      const isRepo = await GitPlugin.isGitRepo('/tmp');
      expect(isRepo).toBe(false);
    });
  });

  describe('getDiff', () => {
    it('should return actual diff content for commits with changes', async () => {
      // Get several commits to find one with real changes
      const commits = await plugin.getCommits({ maxCount: 20 });
      expect(commits.length).toBeGreaterThan(0);

      // Find a commit with actual diff content
      let foundDiff = false;
      for (const commit of commits) {
        const diff = await plugin.getDiff(commit.hash);
        if (diff.length > 0) {
          // Verify it looks like a real diff
          expect(diff).toMatch(/diff --git|^@@|\+|\-/m);
          foundDiff = true;
          break;
        }
      }

      // We should find at least one commit with changes in recent history
      expect(foundDiff).toBe(true);
    });

    it('should return empty string for invalid commit hash', async () => {
      const diff = await plugin.getDiff('nonexistent123456');
      expect(diff).toBe('');
    });
  });

  describe('getDiffSampled', () => {
    it('should return actual sampled diff content', async () => {
      const commits = await plugin.getCommits({ maxCount: 20 });
      expect(commits.length).toBeGreaterThan(0);

      // Find a commit with actual changes
      let foundDiff = false;
      for (const commit of commits) {
        const sampledDiff = await plugin.getDiffSampled(commit.hash);
        if (sampledDiff.length > 0) {
          // Verify it looks like a real diff
          expect(sampledDiff).toMatch(/diff --git|^@@|\+|\-/m);
          foundDiff = true;
          break;
        }
      }

      // We should find at least one commit with changes
      expect(foundDiff).toBe(true);
    });

    it('should return empty string for invalid commit', async () => {
      const diff = await plugin.getDiffSampled('nonexistent123456');
      expect(diff).toBe('');
    });

    it('should respect maxTotalLines option', async () => {
      const commits = await plugin.getCommits({ maxCount: 20 });

      // Find a commit with a large diff
      let testedSampling = false;
      for (const commit of commits) {
        const fullDiff = await plugin.getDiff(commit.hash);
        const fullLines = fullDiff.split('\n').length;

        if (fullLines > 50) {
          const sampledDiff = await plugin.getDiffSampled(commit.hash, {
            maxTotalLines: 20,
            chunkSize: 5,
          });

          const sampledLines = sampledDiff.split('\n').length;

          // Sampled should be significantly smaller than full
          expect(sampledLines).toBeLessThan(fullLines);
          expect(sampledLines).toBeLessThanOrEqual(40); // Allow some overhead for headers
          testedSampling = true;
          break;
        }
      }

      // If no large diffs found, that's okay - test is skipped implicitly
      // But log it so we know
      if (!testedSampling) {
        console.log('Note: No commits with large diffs found to test sampling');
      }
    });

    it('should preserve file headers in sampled output', async () => {
      const commits = await plugin.getCommits({ maxCount: 20 });

      let foundHeaders = false;
      for (const commit of commits) {
        const sampledDiff = await plugin.getDiffSampled(commit.hash);
        if (sampledDiff.length > 0) {
          // Must contain the diff --git header
          expect(sampledDiff).toContain('diff --git');
          foundHeaders = true;
          break;
        }
      }

      expect(foundHeaders).toBe(true);
    });
  });
});
