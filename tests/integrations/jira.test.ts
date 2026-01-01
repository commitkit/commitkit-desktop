/**
 * JIRA Plugin Tests
 *
 * Tests the JIRA integration for fetching ticket data.
 */

import { JiraPlugin } from '../../src/integrations/jira';
import { Commit, JiraIssue } from '../../src/types';

// Mock axios
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('JiraPlugin', () => {
  let plugin: JiraPlugin;

  beforeEach(() => {
    plugin = new JiraPlugin({
      baseUrl: 'https://company.atlassian.net',
      email: 'user@company.com',
      apiToken: 'test-token',
    });
    jest.clearAllMocks();
  });

  describe('metadata', () => {
    it('should have correct id and layer', () => {
      expect(plugin.id).toBe('jira');
      expect(plugin.layer).toBe('enrichment');
      expect(plugin.priority).toBe(20);
    });
  });

  describe('extractTicketKeys', () => {
    it('should extract single ticket key from commit message', () => {
      const keys = plugin.extractTicketKeys('PROJ-123: Fix login bug');
      expect(keys).toEqual(['PROJ-123']);
    });

    it('should extract multiple ticket keys', () => {
      const keys = plugin.extractTicketKeys('PROJ-123 PROJ-456: Implement feature');
      expect(keys).toEqual(['PROJ-123', 'PROJ-456']);
    });

    it('should extract ticket key with brackets', () => {
      const keys = plugin.extractTicketKeys('[PROJ-123] Fix bug');
      expect(keys).toEqual(['PROJ-123']);
    });

    it('should handle lowercase project keys', () => {
      const keys = plugin.extractTicketKeys('proj-123: fix bug');
      expect(keys).toEqual(['PROJ-123']);
    });

    it('should return empty array when no ticket key found', () => {
      const keys = plugin.extractTicketKeys('Fix bug without ticket reference');
      expect(keys).toEqual([]);
    });

    it('should deduplicate ticket keys', () => {
      const keys = plugin.extractTicketKeys('PROJ-123: relates to PROJ-123');
      expect(keys).toEqual(['PROJ-123']);
    });
  });

  describe('isRelevant', () => {
    it('should return true when commit message contains ticket key', () => {
      const commit: Commit = {
        hash: 'abc123',
        message: 'PROJ-123: Fix bug',
        author: 'Test',
        email: 'test@test.com',
        timestamp: new Date(),
      };

      expect(plugin.isRelevant(commit, {})).toBe(true);
    });

    it('should return false when no ticket key in message', () => {
      const commit: Commit = {
        hash: 'abc123',
        message: 'Fix bug without ticket',
        author: 'Test',
        email: 'test@test.com',
        timestamp: new Date(),
      };

      expect(plugin.isRelevant(commit, {})).toBe(false);
    });
  });

  describe('enrich', () => {
    const mockCommit: Commit = {
      hash: 'abc123def456',
      message: 'PROJ-123: Fix critical bug',
      author: 'Test User',
      email: 'test@test.com',
      timestamp: new Date(),
    };

    it('should fetch JIRA issue data for a commit', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          key: 'PROJ-123',
          fields: {
            summary: 'Critical bug in login flow',
            issuetype: { name: 'Bug' },
            status: { name: 'Done' },
            priority: { name: 'High' },
            labels: ['critical', 'security'],
            customfield_10001: { name: 'Sprint 5' }, // sprint field
            customfield_10002: 3, // story points
            parent: {
              key: 'PROJ-100',
              fields: { summary: 'Epic: Authentication' },
            },
          },
        },
      });

      const result = await plugin.enrich(mockCommit, {});

      expect(result).not.toBeNull();
      const issues = result?.data.issues as JiraIssue[];
      expect(issues).toHaveLength(1);
      expect(issues[0]).toEqual({
        key: 'PROJ-123',
        summary: 'Critical bug in login flow',
        issueType: 'Bug',
        status: 'Done',
        priority: 'High',
        labels: ['critical', 'security'],
        sprint: 'Sprint 5',
        storyPoints: 3,
        epicKey: 'PROJ-100',
        epicName: 'Epic: Authentication',
      });
    });

    it('should return null when no ticket keys in message', async () => {
      const commitNoTicket: Commit = {
        ...mockCommit,
        message: 'Fix bug without ticket reference',
      };

      const result = await plugin.enrich(commitNoTicket, {});

      expect(result).toBeNull();
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('API error'));

      const result = await plugin.enrich(mockCommit, {});

      expect(result).toBeNull();
    });

    it('should handle missing optional fields', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          key: 'PROJ-123',
          fields: {
            summary: 'Simple task',
            issuetype: { name: 'Task' },
            status: { name: 'To Do' },
            // No priority, labels, sprint, story points, or parent
          },
        },
      });

      const result = await plugin.enrich(mockCommit, {});

      expect(result).not.toBeNull();
      const issues = result?.data.issues as JiraIssue[];
      expect(issues[0]).toEqual({
        key: 'PROJ-123',
        summary: 'Simple task',
        issueType: 'Task',
        status: 'To Do',
        priority: undefined,
        labels: [],
        sprint: undefined,
        storyPoints: undefined,
        epicKey: undefined,
        epicName: undefined,
      });
    });
  });

  describe('testConnection', () => {
    it('should return success when API is accessible', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { displayName: 'Test User' },
      });

      const result = await plugin.testConnection();

      expect(result.success).toBe(true);
    });

    it('should return failure with error message', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Unauthorized'));

      const result = await plugin.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unauthorized');
    });
  });

  describe('parseAdfToText (via parseIssue)', () => {
    // We test ADF parsing through the enrich method since parseAdfToText is private
    it('should parse ADF description to plain text', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          key: 'PROJ-123',
          fields: {
            summary: 'Test issue',
            description: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'This is the ' },
                    { type: 'text', text: 'description text.' },
                  ],
                },
              ],
            },
            issuetype: { name: 'Story' },
            status: { name: 'In Progress' },
          },
        },
      });

      const commit: Commit = {
        hash: 'abc123',
        message: 'PROJ-123: Test',
        author: 'Test',
        email: 'test@test.com',
        timestamp: new Date(),
      };

      const result = await plugin.enrich(commit, {});
      const issues = result?.data.issues as JiraIssue[];

      expect(issues[0].description).toBe('This is the  description text.');
    });

    it('should handle nested ADF content like bullet lists', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          key: 'PROJ-123',
          fields: {
            summary: 'Test issue',
            description: {
              type: 'doc',
              content: [
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'paragraph',
                          content: [{ type: 'text', text: 'Item 1' }],
                        },
                      ],
                    },
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'paragraph',
                          content: [{ type: 'text', text: 'Item 2' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            issuetype: { name: 'Story' },
            status: { name: 'Done' },
          },
        },
      });

      const commit: Commit = {
        hash: 'abc123',
        message: 'PROJ-123: Test',
        author: 'Test',
        email: 'test@test.com',
        timestamp: new Date(),
      };

      const result = await plugin.enrich(commit, {});
      const issues = result?.data.issues as JiraIssue[];

      expect(issues[0].description).toBe('Item 1 Item 2');
    });

    it('should handle null/undefined description', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          key: 'PROJ-123',
          fields: {
            summary: 'Test issue',
            description: null,
            issuetype: { name: 'Bug' },
            status: { name: 'Open' },
          },
        },
      });

      const commit: Commit = {
        hash: 'abc123',
        message: 'PROJ-123: Test',
        author: 'Test',
        email: 'test@test.com',
        timestamp: new Date(),
      };

      const result = await plugin.enrich(commit, {});
      const issues = result?.data.issues as JiraIssue[];

      expect(issues[0].description).toBeUndefined();
    });
  });

  describe('getIssuesBulk', () => {
    it('should fetch multiple issues in a single API call', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          issues: [
            {
              key: 'PROJ-123',
              fields: {
                summary: 'First issue',
                issuetype: { name: 'Story' },
                status: { name: 'Done' },
              },
            },
            {
              key: 'PROJ-456',
              fields: {
                summary: 'Second issue',
                issuetype: { name: 'Bug' },
                status: { name: 'In Progress' },
              },
            },
          ],
        },
      });

      const results = await plugin.getIssuesBulk(['PROJ-123', 'PROJ-456']);

      expect(results.size).toBe(2);
      expect(results.get('PROJ-123')?.summary).toBe('First issue');
      expect(results.get('PROJ-456')?.summary).toBe('Second issue');
    });

    it('should return empty map for empty keys array', async () => {
      const results = await plugin.getIssuesBulk([]);

      expect(results.size).toBe(0);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: { status: 500, data: 'Server error' },
      });

      const results = await plugin.getIssuesBulk(['PROJ-123']);

      expect(results.size).toBe(0);
    });

    it('should batch requests for more than 50 keys', async () => {
      // Create 60 keys to trigger batching
      const keys = Array.from({ length: 60 }, (_, i) => `PROJ-${i + 1}`);

      mockedAxios.post
        .mockResolvedValueOnce({
          data: {
            issues: keys.slice(0, 50).map(key => ({
              key,
              fields: {
                summary: `Issue ${key}`,
                issuetype: { name: 'Story' },
                status: { name: 'Done' },
              },
            })),
          },
        })
        .mockResolvedValueOnce({
          data: {
            issues: keys.slice(50).map(key => ({
              key,
              fields: {
                summary: `Issue ${key}`,
                issuetype: { name: 'Story' },
                status: { name: 'Done' },
              },
            })),
          },
        });

      const results = await plugin.getIssuesBulk(keys);

      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      expect(results.size).toBe(60);
    });
  });
});
