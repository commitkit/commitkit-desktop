/**
 * Git Plugin Tests
 *
 * Tests the Git integration for reading commits from repositories.
 */

import { GitPlugin } from '../../src/integrations/git';
import path from 'path';
import os from 'os';

// Expand ~ to home directory
const expandTilde = (p: string) => p.startsWith('~') ? p.replace('~', os.homedir()) : p;

// Use TEST_REPO env var if provided, otherwise default to commitkit-desktop repo
const TEST_REPO_PATH = process.env.TEST_REPO
  ? path.resolve(expandTilde(process.env.TEST_REPO))
  : path.resolve(__dirname, '../../');

describe('GitPlugin', () => {
  let plugin: GitPlugin;

  beforeEach(() => {
    plugin = new GitPlugin(TEST_REPO_PATH);
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
});
