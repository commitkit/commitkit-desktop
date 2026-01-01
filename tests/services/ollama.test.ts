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
});
