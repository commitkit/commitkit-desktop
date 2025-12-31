/**
 * GitHub Plugin Tests
 *
 * Tests the GitHub integration for fetching PR data.
 */

import { GitHubPlugin } from '../../src/integrations/github';
import { Commit, EnrichmentContext } from '../../src/types';

// Mock axios
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GitHubPlugin', () => {
  let plugin: GitHubPlugin;

  beforeEach(() => {
    plugin = new GitHubPlugin('test-token');
    jest.clearAllMocks();
  });

  describe('metadata', () => {
    it('should have correct id and layer', () => {
      expect(plugin.id).toBe('github');
      expect(plugin.layer).toBe('hosting');
      expect(plugin.priority).toBe(10);
    });
  });

  describe('isRelevant', () => {
    it('should return true for github.com remote', () => {
      const commit: Commit = {
        hash: 'abc123',
        message: 'Test commit',
        author: 'Test',
        email: 'test@test.com',
        timestamp: new Date(),
        remoteUrl: 'https://github.com/owner/repo.git',
      };

      expect(plugin.isRelevant(commit, {})).toBe(true);
    });

    it('should return true for git@ SSH remote', () => {
      const commit: Commit = {
        hash: 'abc123',
        message: 'Test commit',
        author: 'Test',
        email: 'test@test.com',
        timestamp: new Date(),
        remoteUrl: 'git@github.com:owner/repo.git',
      };

      expect(plugin.isRelevant(commit, {})).toBe(true);
    });

    it('should return false for non-GitHub remote', () => {
      const commit: Commit = {
        hash: 'abc123',
        message: 'Test commit',
        author: 'Test',
        email: 'test@test.com',
        timestamp: new Date(),
        remoteUrl: 'https://gitlab.com/owner/repo.git',
      };

      expect(plugin.isRelevant(commit, {})).toBe(false);
    });

    it('should return false when no remote URL', () => {
      const commit: Commit = {
        hash: 'abc123',
        message: 'Test commit',
        author: 'Test',
        email: 'test@test.com',
        timestamp: new Date(),
      };

      expect(plugin.isRelevant(commit, {})).toBe(false);
    });
  });

  describe('parseRepoFromUrl', () => {
    it('should parse HTTPS URL', () => {
      const result = plugin.parseRepoFromUrl('https://github.com/owner/repo.git');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should parse SSH URL', () => {
      const result = plugin.parseRepoFromUrl('git@github.com:owner/repo.git');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should handle URL without .git suffix', () => {
      const result = plugin.parseRepoFromUrl('https://github.com/owner/repo');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should return null for invalid URL', () => {
      const result = plugin.parseRepoFromUrl('not-a-valid-url');
      expect(result).toBeNull();
    });
  });

  describe('enrich', () => {
    const mockCommit: Commit = {
      hash: 'abc123def456',
      message: 'Fix bug in feature',
      author: 'Test User',
      email: 'test@test.com',
      timestamp: new Date(),
      remoteUrl: 'https://github.com/owner/repo.git',
    };

    it('should fetch PR data for a commit', async () => {
      // Mock the search API response
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          items: [{
            number: 42,
            title: 'Fix important bug',
            body: 'This PR fixes the bug',
            state: 'merged',
            labels: [{ name: 'bug' }],
          }],
        },
      });

      const result = await plugin.enrich(mockCommit, {});

      expect(result).not.toBeNull();
      expect(result?.data.pr).toEqual({
        number: 42,
        title: 'Fix important bug',
        description: 'This PR fixes the bug',
        state: 'merged',
        labels: ['bug'],
      });
    });

    it('should return null when no PR found', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { items: [] },
      });

      const result = await plugin.enrich(mockCommit, {});

      expect(result).toBeNull();
    });

    it('should handle API errors gracefully', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('API error'));

      const result = await plugin.enrich(mockCommit, {});

      expect(result).toBeNull();
    });
  });
});
