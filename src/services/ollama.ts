/**
 * Ollama LLM Provider
 *
 * Generates CV bullets from commits using local Ollama models.
 * All processing happens locally for privacy.
 */

import { Ollama } from 'ollama';
import { AIProvider, Commit, EnrichmentContext, CVBullet, JiraIssue, GitHubPR } from '../types';

export interface OllamaConfig {
  host?: string;        // Default: http://localhost:11434
  model?: string;       // Default: llama3.2
  temperature?: number; // Default: 0.7
}

export class OllamaProvider implements AIProvider {
  id = 'ollama';
  name = 'Ollama (Local)';
  isLocal = true;
  requiresApiKey = false;

  private client: Ollama;
  private model: string;
  private temperature: number;

  constructor(config: OllamaConfig = {}) {
    this.client = new Ollama({ host: config.host || 'http://localhost:11434' });
    this.model = config.model || 'llama3.2';
    this.temperature = config.temperature ?? 0.7;
  }

  async generateText(prompt: string): Promise<string> {
    const response = await this.client.generate({
      model: this.model,
      prompt,
      options: {
        temperature: this.temperature,
      },
    });
    return response.response.trim();
  }

  supportsToolCalling(): boolean {
    // Most Ollama models don't support tool calling yet
    return false;
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      // Try to list models to verify connection
      await this.client.list();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Check if the configured model is available
   */
  async isModelAvailable(): Promise<boolean> {
    try {
      const models = await this.client.list();
      return models.models.some(m => m.name.startsWith(this.model));
    } catch {
      return false;
    }
  }

  /**
   * Generate a CV bullet from a commit and its enrichment data
   */
  async generateCVBullet(
    commit: Commit,
    enrichments: EnrichmentContext
  ): Promise<CVBullet> {
    const prompt = this.buildPrompt(commit, enrichments);
    const text = await this.generateText(prompt);

    return {
      text,
      commit,
      enrichments,
      generatedAt: new Date(),
      aiProvider: this.id,
      aiModel: this.model,
    };
  }

  /**
   * Build the prompt for CV bullet generation
   */
  buildPrompt(commit: Commit, enrichments: EnrichmentContext): string {
    const parts: string[] = [];

    // Base instruction
    parts.push(`Generate a professional CV/resume bullet point for the following work accomplishment.
The bullet should:
- Start with a strong action verb (e.g., Implemented, Developed, Optimized, Resolved)
- Quantify impact when possible
- Focus on business value, not just technical details
- Be 1-2 sentences maximum
- Be written in past tense

Commit message: ${commit.message}
Author: ${commit.author}`);

    // Add JIRA context if available
    const jiraData = enrichments['jira'];
    if (jiraData?.data?.issues) {
      const issues = jiraData.data.issues as JiraIssue[];
      if (issues.length > 0) {
        const issue = issues[0];
        parts.push(`
JIRA Ticket: ${issue.key}
Summary: ${issue.summary}
Type: ${issue.issueType}
${issue.epicName ? `Epic: ${issue.epicName}` : ''}
${issue.storyPoints ? `Story Points: ${issue.storyPoints}` : ''}`);
      }
    }

    // Add GitHub PR context if available
    const githubData = enrichments['github'];
    if (githubData?.data?.pr) {
      const pr = githubData.data.pr as GitHubPR;
      parts.push(`
Pull Request: #${pr.number} - ${pr.title}
${pr.description ? `Description: ${pr.description.substring(0, 200)}...` : ''}`);
    }

    parts.push(`
Generate only the bullet point text, nothing else:`);

    return parts.join('\n');
  }

  /**
   * Generate multiple CV bullets in batch
   */
  async generateCVBullets(
    commits: Array<{ commit: Commit; enrichments: EnrichmentContext }>
  ): Promise<CVBullet[]> {
    const bullets: CVBullet[] = [];

    for (const { commit, enrichments } of commits) {
      try {
        const bullet = await this.generateCVBullet(commit, enrichments);
        bullets.push(bullet);
      } catch (error) {
        console.error(`Failed to generate bullet for ${commit.hash}:`, error);
        // Continue with other commits
      }
    }

    return bullets;
  }
}
