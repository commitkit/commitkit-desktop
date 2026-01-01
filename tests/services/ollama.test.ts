/**
 * Ollama Provider Tests
 *
 * Unit tests for deterministic behavior.
 * LLM output quality is tested via evals (see evals/cv-bullets.eval.ts)
 */

import { OllamaProvider } from '../../src/services/ollama';
import { Commit, EnrichmentContext, JiraIssue, GitHubPR } from '../../src/types';

// Mock the ollama package
jest.mock('ollama', () => ({
  Ollama: jest.fn().mockImplementation(() => ({
    generate: jest.fn().mockResolvedValue({
      response: '  Implemented user authentication system with OAuth2 support  ',
    }),
    list: jest.fn().mockResolvedValue({
      models: [{ name: 'qwen2.5:14b' }],
    }),
  })),
}));

describe('OllamaProvider', () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    provider = new OllamaProvider();
    jest.clearAllMocks();
  });

  describe('metadata', () => {
    it('should have correct id and properties', () => {
      expect(provider.id).toBe('ollama');
      expect(provider.name).toBe('Ollama (Local)');
      expect(provider.isLocal).toBe(true);
      expect(provider.requiresApiKey).toBe(false);
    });
  });

  describe('configuration', () => {
    it('should use default config values', () => {
      const defaultProvider = new OllamaProvider();
      expect(defaultProvider).toBeDefined();
    });

    it('should accept custom config', () => {
      const customProvider = new OllamaProvider({
        host: 'http://custom:11434',
        model: 'mistral',
        temperature: 0.5,
      });
      expect(customProvider).toBeDefined();
    });
  });

  describe('generateText', () => {
    it('should return trimmed response', async () => {
      const result = await provider.generateText('Test prompt');
      expect(result).toBe('Implemented user authentication system with OAuth2 support');
    });
  });

  describe('supportsToolCalling', () => {
    it('should return false for Ollama models', () => {
      expect(provider.supportsToolCalling()).toBe(false);
    });
  });

  describe('testConnection', () => {
    it('should return success when Ollama is running', async () => {
      const result = await provider.testConnection();
      expect(result.success).toBe(true);
    });
  });

  describe('isModelAvailable', () => {
    it('should return true when model exists', async () => {
      const result = await provider.isModelAvailable();
      expect(result).toBe(true);
    });
  });

  describe('buildPrompt', () => {
    const baseCommit: Commit = {
      hash: 'abc123',
      message: 'Add user authentication with OAuth2',
      author: 'Jane Developer',
      email: 'jane@company.com',
      timestamp: new Date(),
    };

    it('should build prompt with commit only', () => {
      const prompt = provider.buildPrompt(baseCommit, {});

      expect(prompt).toContain('Add user authentication with OAuth2');
      expect(prompt).toContain('past-tense action verb');
      expect(prompt).toContain('NEVER invent metrics');
      expect(prompt).toContain('English only');
    });

    it('should include JIRA context when available', () => {
      const enrichments: EnrichmentContext = {
        jira: {
          pluginId: 'jira',
          data: {
            issues: [{
              key: 'AUTH-123',
              summary: 'Implement SSO for enterprise customers',
              issueType: 'Story',
              status: 'Done',
              epicName: 'Enterprise Authentication',
              storyPoints: 5,
            }] as JiraIssue[],
          },
        },
      };

      const prompt = provider.buildPrompt(baseCommit, enrichments);

      expect(prompt).toContain('AUTH-123');
      expect(prompt).toContain('Implement SSO for enterprise customers');
      expect(prompt).toContain('Enterprise Authentication');
      expect(prompt).toContain('Story Points: 5');
    });

    it('should include GitHub PR context when available', () => {
      const enrichments: EnrichmentContext = {
        github: {
          pluginId: 'github',
          data: {
            pr: {
              number: 456,
              title: 'Add OAuth2 authentication',
              description: 'This PR adds OAuth2 support for Google and GitHub login',
              state: 'merged',
            } as GitHubPR,
          },
        },
      };

      const prompt = provider.buildPrompt(baseCommit, enrichments);

      expect(prompt).toContain('#456');
      expect(prompt).toContain('Add OAuth2 authentication');
      expect(prompt).toContain('OAuth2 support for Google');
    });

    it('should include both JIRA and GitHub when available', () => {
      const enrichments: EnrichmentContext = {
        jira: {
          pluginId: 'jira',
          data: {
            issues: [{
              key: 'AUTH-123',
              summary: 'Implement SSO',
              issueType: 'Story',
              status: 'Done',
            }] as JiraIssue[],
          },
        },
        github: {
          pluginId: 'github',
          data: {
            pr: {
              number: 456,
              title: 'Add OAuth2',
              description: '',
              state: 'merged',
            } as GitHubPR,
          },
        },
      };

      const prompt = provider.buildPrompt(baseCommit, enrichments);

      expect(prompt).toContain('AUTH-123');
      expect(prompt).toContain('#456');
    });
  });

  describe('generateCVBullet', () => {
    it('should return a CVBullet with all required fields', async () => {
      const commit: Commit = {
        hash: 'abc123',
        message: 'Fix critical bug in payment processing',
        author: 'Test',
        email: 'test@test.com',
        timestamp: new Date(),
      };

      const result = await provider.generateCVBullet(commit, {});

      expect(result.text).toBeDefined();
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.commit).toBe(commit);
      expect(result.enrichments).toEqual({});
      expect(result.generatedAt).toBeInstanceOf(Date);
      expect(result.aiProvider).toBe('ollama');
      expect(result.aiModel).toBe('qwen2.5:14b');
    });
  });

  describe('generateCVBullets', () => {
    it('should generate bullets for multiple commits', async () => {
      const commits = [
        {
          commit: {
            hash: 'abc123',
            message: 'Add feature A',
            author: 'Test',
            email: 'test@test.com',
            timestamp: new Date(),
          },
          enrichments: {},
        },
        {
          commit: {
            hash: 'def456',
            message: 'Fix bug B',
            author: 'Test',
            email: 'test@test.com',
            timestamp: new Date(),
          },
          enrichments: {},
        },
      ];

      const results = await provider.generateCVBullets(commits);

      expect(results).toHaveLength(2);
      expect(results[0].commit.hash).toBe('abc123');
      expect(results[1].commit.hash).toBe('def456');
    });
  });

  describe('buildClusteringPrompt', () => {
    it('should include all commit data in prompt with numbered indices', () => {
      const commits = [
        {
          hash: 'abc123',
          message: 'Add user login',
          filesChanged: ['src/auth/login.ts', 'src/auth/session.ts'],
          diffSample: '+export function login() {}',
        },
        {
          hash: 'def456',
          message: 'Add user logout',
          filesChanged: ['src/auth/logout.ts'],
          diffSample: '+export function logout() {}',
        },
      ];

      const prompt = provider.buildClusteringPrompt(commits);

      // Should contain numbered commit indices (not hashes - LLMs hallucinate hashes)
      expect(prompt).toContain('COMMIT 1:');
      expect(prompt).toContain('COMMIT 2:');

      // Should contain commit messages
      expect(prompt).toContain('Add user login');
      expect(prompt).toContain('Add user logout');

      // Should contain file paths
      expect(prompt).toContain('src/auth/login.ts');
      expect(prompt).toContain('src/auth/logout.ts');

      // Should contain diff samples
      expect(prompt).toContain('+export function login()');
      expect(prompt).toContain('+export function logout()');

      // Should contain JSON structure guidance with index-based format
      expect(prompt).toContain('groups');
      expect(prompt).toContain('ungrouped');
      expect(prompt).toContain('confidence');
      expect(prompt).toContain('index');
    });

    it('should handle empty commits array', () => {
      const prompt = provider.buildClusteringPrompt([]);
      // Prompt should still contain instructions even with no commits
      expect(prompt).toContain('Analyze these git commits');
      expect(prompt).toContain('groups');
    });
  });

  describe('analyzeCommitsForGrouping', () => {
    it('should parse valid JSON response with indices and return groups with hashes', async () => {
      // Mock the generate function to return a valid clustering result using indices
      const mockOllama = require('ollama');
      mockOllama.Ollama.mockImplementation(() => ({
        generate: jest.fn().mockResolvedValue({
          response: JSON.stringify({
            groups: [
              {
                name: 'Authentication Feature',
                theme: 'authentication',
                commits: [
                  { index: 1, confidence: 0.95 },  // abc123
                  { index: 2, confidence: 0.88 },  // def456
                ],
                overall_confidence: 0.91,
                reasoning: 'Both commits relate to user auth',
              },
            ],
            ungrouped: [3],  // ghi789
          }),
        }),
        list: jest.fn().mockResolvedValue({ models: [{ name: 'qwen2.5:14b' }] }),
      }));

      const newProvider = new OllamaProvider();
      const commits = [
        { hash: 'abc123', message: 'Add login', filesChanged: [], diffSample: '' },
        { hash: 'def456', message: 'Add logout', filesChanged: [], diffSample: '' },
        { hash: 'ghi789', message: 'Update readme', filesChanged: [], diffSample: '' },
      ];

      const result = await newProvider.analyzeCommitsForGrouping(commits, 'balanced');

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].name).toBe('Authentication Feature');
      // The service converts indices back to hashes
      expect(result.groups[0].commitHashes).toContain('abc123');
      expect(result.groups[0].commitHashes).toContain('def456');
      expect(result.ungrouped).toContain('ghi789');
    });

    it('should filter low-confidence commits in strict mode', async () => {
      const mockOllama = require('ollama');
      mockOllama.Ollama.mockImplementation(() => ({
        generate: jest.fn().mockResolvedValue({
          response: JSON.stringify({
            groups: [
              {
                name: 'Auth Feature',
                theme: 'auth',
                commits: [
                  { index: 1, confidence: 0.95 },  // High - should stay
                  { index: 2, confidence: 0.75 },  // Below 0.9 - should be removed in strict
                ],
                overall_confidence: 0.85,
                reasoning: 'Auth related',
              },
            ],
            ungrouped: [],
          }),
        }),
        list: jest.fn().mockResolvedValue({ models: [{ name: 'qwen2.5:14b' }] }),
      }));

      const newProvider = new OllamaProvider();
      const commits = [
        { hash: 'abc123', message: 'Add login', filesChanged: [], diffSample: '' },
        { hash: 'def456', message: 'Fix typo', filesChanged: [], diffSample: '' },
      ];

      const result = await newProvider.analyzeCommitsForGrouping(commits, 'strict');

      // In strict mode (0.9 threshold), def456 should be filtered out
      // Group should be dissolved since it has < 2 commits after filtering
      expect(result.groups).toHaveLength(0);
      expect(result.ungrouped).toContain('abc123');
      expect(result.ungrouped).toContain('def456');
    });

    it('should keep groups with high confidence in strict mode', async () => {
      const mockOllama = require('ollama');
      mockOllama.Ollama.mockImplementation(() => ({
        generate: jest.fn().mockResolvedValue({
          response: JSON.stringify({
            groups: [
              {
                name: 'Auth Feature',
                theme: 'auth',
                commits: [
                  { index: 1, confidence: 0.95 },
                  { index: 2, confidence: 0.92 },
                ],
                overall_confidence: 0.93,
                reasoning: 'Auth related',
              },
            ],
            ungrouped: [],
          }),
        }),
        list: jest.fn().mockResolvedValue({ models: [{ name: 'qwen2.5:14b' }] }),
      }));

      const newProvider = new OllamaProvider();
      const commits = [
        { hash: 'abc123', message: 'Add login', filesChanged: [], diffSample: '' },
        { hash: 'def456', message: 'Add logout', filesChanged: [], diffSample: '' },
      ];

      const result = await newProvider.analyzeCommitsForGrouping(commits, 'strict');

      // Both commits are above 0.9 threshold, group should remain
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].commitHashes).toHaveLength(2);
    });

    it('should be more permissive in loose mode', async () => {
      const mockOllama = require('ollama');
      mockOllama.Ollama.mockImplementation(() => ({
        generate: jest.fn().mockResolvedValue({
          response: JSON.stringify({
            groups: [
              {
                name: 'Misc Feature',
                theme: 'misc',
                commits: [
                  { index: 1, confidence: 0.65 },
                  { index: 2, confidence: 0.62 },
                ],
                overall_confidence: 0.63,
                reasoning: 'Loosely related',
              },
            ],
            ungrouped: [],
          }),
        }),
        list: jest.fn().mockResolvedValue({ models: [{ name: 'qwen2.5:14b' }] }),
      }));

      const newProvider = new OllamaProvider();
      const commits = [
        { hash: 'abc123', message: 'Add feature', filesChanged: [], diffSample: '' },
        { hash: 'def456', message: 'Another feature', filesChanged: [], diffSample: '' },
      ];

      const result = await newProvider.analyzeCommitsForGrouping(commits, 'loose');

      // Loose mode threshold is 0.6, so both commits should stay
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].commitHashes).toHaveLength(2);
    });

    it('should return all commits as ungrouped on malformed JSON', async () => {
      const mockOllama = require('ollama');
      mockOllama.Ollama.mockImplementation(() => ({
        generate: jest.fn().mockResolvedValue({
          response: 'This is not valid JSON at all',
        }),
        list: jest.fn().mockResolvedValue({ models: [{ name: 'qwen2.5:14b' }] }),
      }));

      const newProvider = new OllamaProvider();
      const commits = [
        { hash: 'abc123', message: 'Add login', filesChanged: [], diffSample: '' },
        { hash: 'def456', message: 'Add logout', filesChanged: [], diffSample: '' },
      ];

      const result = await newProvider.analyzeCommitsForGrouping(commits, 'balanced');

      // On parse failure, all commits should be ungrouped
      expect(result.groups).toHaveLength(0);
      expect(result.ungrouped).toContain('abc123');
      expect(result.ungrouped).toContain('def456');
    });

    it('should dissolve groups with fewer than 2 commits after filtering', async () => {
      const mockOllama = require('ollama');
      mockOllama.Ollama.mockImplementation(() => ({
        generate: jest.fn().mockResolvedValue({
          response: JSON.stringify({
            groups: [
              {
                name: 'Solo Feature',
                theme: 'feature',
                commits: [
                  { index: 1, confidence: 0.95 },
                  { index: 2, confidence: 0.5 },  // Will be filtered in balanced mode
                ],
                overall_confidence: 0.72,
                reasoning: 'Related',
              },
            ],
            ungrouped: [],
          }),
        }),
        list: jest.fn().mockResolvedValue({ models: [{ name: 'qwen2.5:14b' }] }),
      }));

      const newProvider = new OllamaProvider();
      const commits = [
        { hash: 'abc123', message: 'Add feature', filesChanged: [], diffSample: '' },
        { hash: 'def456', message: 'Unrelated', filesChanged: [], diffSample: '' },
      ];

      const result = await newProvider.analyzeCommitsForGrouping(commits, 'balanced');

      // def456 is below 0.8 threshold for balanced, leaving only 1 commit
      // Group should be dissolved
      expect(result.groups).toHaveLength(0);
      expect(result.ungrouped).toContain('abc123');
      expect(result.ungrouped).toContain('def456');
    });
  });
});
