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
    this.model = config.model || 'qwen2.5:14b';
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
   * Get list of installed models
   */
  async getInstalledModels(): Promise<string[]> {
    try {
      const result = await this.client.list();
      return result.models.map(m => m.name);
    } catch {
      return [];
    }
  }

  /**
   * Recommended models for CV bullet generation
   * Ordered by quality/size tradeoff
   */
  static getRecommendedModels(): Array<{ name: string; description: string }> {
    return [
      { name: 'qwen2.5:14b', description: 'Best quality (9GB)' },
      { name: 'qwen2.5:7b', description: 'Good balance (4.7GB)' },
      { name: 'qwen2.5:3b', description: 'Fast & light (1.9GB)' },
      { name: 'llama3.2:3b', description: 'Meta Llama (2GB)' },
      { name: 'llama3.2:1b', description: 'Smallest Llama (1.3GB)' },
      { name: 'mistral:7b', description: 'Mistral 7B (4.1GB)' },
      { name: 'gemma2:9b', description: 'Google Gemma (5.4GB)' },
      { name: 'phi3:medium', description: 'Microsoft Phi-3 (7.9GB)' },
    ];
  }

  /**
   * Pull the model from Ollama registry
   */
  async pullModel(onProgress?: (status: string, completed?: number, total?: number) => void): Promise<boolean> {
    try {
      const stream = await this.client.pull({ model: this.model, stream: true });
      for await (const progress of stream) {
        if (onProgress && progress.status) {
          onProgress(progress.status, progress.completed, progress.total);
        }
      }
      return true;
    } catch (error) {
      console.error('Failed to pull model:', error);
      return false;
    }
  }

  /**
   * Ensure model is available, pulling if necessary
   */
  async ensureModelAvailable(onProgress?: (status: string, completed?: number, total?: number) => void): Promise<boolean> {
    const available = await this.isModelAvailable();
    if (available) {
      return true;
    }

    // Try to pull the model
    if (onProgress) {
      onProgress(`Downloading ${this.model}...`);
    }
    return await this.pullModel(onProgress);
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
    parts.push(`Transform this git commit into a single professional CV/resume bullet point.

STRICT RULES:
1. Respond in English only
2. Start with a strong past-tense action verb (Implemented, Developed, Fixed, etc.)
3. Maximum 20 words - be concise
4. Summarize the overall accomplishment, don't list individual files or changes
5. NEVER invent metrics, percentages, or impact claims not in the original
6. NEVER start with a dash, bullet marker, or quotation mark
7. Use natural phrasing (say "Updated Brakeman to v7.1.2" not "Implemented update of Brakeman")
8. For "Empty commit" or commits with no meaningful content, output exactly: "Made minor project housekeeping changes"
9. Do NOT include the author's name in the output

Commit message:
${commit.message}`);

    // Add JIRA context if available
    const jiraData = enrichments['jira'];
    if (jiraData?.data?.issues) {
      const issues = jiraData.data.issues as JiraIssue[];
      if (issues.length > 0) {
        const issue = issues[0];
        // Truncate description to avoid overwhelming the prompt
        const descSnippet = issue.description
          ? issue.description.substring(0, 500) + (issue.description.length > 500 ? '...' : '')
          : '';
        parts.push(`
JIRA Ticket: ${issue.key}
Summary: ${issue.summary}
Type: ${issue.issueType}
${descSnippet ? `Description: ${descSnippet}` : ''}
${issue.epicName ? `Epic: ${issue.epicName}` : ''}
${issue.sprint ? `Sprint: ${issue.sprint}` : ''}
${issue.labels && issue.labels.length > 0 ? `Labels: ${issue.labels.join(', ')}` : ''}
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
