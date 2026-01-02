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

  describe('getPRsForCommits', () => {
    it('should fetch PRs for multiple commits using GraphQL', async () => {
      // Mock GraphQL response
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          data: {
            repository: {
              c0: {
                associatedPullRequests: {
                  nodes: [{
                    number: 100,
                    title: 'Feature PR',
                    body: 'Adds new feature',
                    state: 'MERGED',
                    labels: { nodes: [{ name: 'feature' }] },
                  }],
                },
              },
              c1: {
                associatedPullRequests: {
                  nodes: [{
                    number: 100,
                    title: 'Feature PR',
                    body: 'Adds new feature',
                    state: 'MERGED',
                    labels: { nodes: [{ name: 'feature' }] },
                  }],
                },
              },
              c2: {
                associatedPullRequests: {
                  nodes: [],
                },
              },
            },
          },
        },
      });

      const result = await plugin.getPRsForCommits('owner', 'repo', ['abc123', 'def456', 'ghi789']);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.github.com/graphql',
        expect.objectContaining({
          query: expect.stringContaining('associatedPullRequests'),
        }),
        expect.any(Object)
      );

      expect(result.size).toBe(2); // Two commits have PRs
      expect(result.get('abc123')?.number).toBe(100);
      expect(result.get('def456')?.number).toBe(100);
      expect(result.has('ghi789')).toBe(false); // No PR
    });

    it('should return empty map for empty commits array', async () => {
      const result = await plugin.getPRsForCommits('owner', 'repo', []);

      expect(result.size).toBe(0);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should handle GraphQL errors gracefully', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('GraphQL error'));

      const result = await plugin.getPRsForCommits('owner', 'repo', ['abc123']);

      expect(result.size).toBe(0);
    });

    it('should batch large numbers of commits', async () => {
      // Create 60 commit hashes (should require 2 batches of 50)
      const commits = Array.from({ length: 60 }, (_, i) => `commit${i}`);

      // Mock two GraphQL responses
      mockedAxios.post
        .mockResolvedValueOnce({
          data: {
            data: {
              repository: Object.fromEntries(
                Array.from({ length: 50 }, (_, i) => [
                  `c${i}`,
                  { associatedPullRequests: { nodes: [{ number: i, title: `PR ${i}`, body: '', state: 'MERGED', labels: { nodes: [] } }] } },
                ])
              ),
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: {
              repository: Object.fromEntries(
                Array.from({ length: 10 }, (_, i) => [
                  `c${i}`,
                  { associatedPullRequests: { nodes: [{ number: 50 + i, title: `PR ${50 + i}`, body: '', state: 'MERGED', labels: { nodes: [] } }] } },
                ])
              ),
            },
          },
        });

      const result = await plugin.getPRsForCommits('owner', 'repo', commits);

      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      expect(result.size).toBe(60);
    });
  });
});
