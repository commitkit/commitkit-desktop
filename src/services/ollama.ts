/**
 * Ollama LLM Provider
 *
 * Generates CV bullets from commits using local Ollama models.
 * All processing happens locally for privacy.
 */

import { Ollama } from 'ollama';
import { AIProvider, Commit, EnrichmentContext, CVBullet, JiraIssue, GitHubPR, CommitGroup, GroupedBullet } from '../types';

export interface OllamaConfig {
  host?: string;        // Default: http://localhost:11434
  model?: string;       // Default: llama3.2
  temperature?: number; // Default: 0.7
}

/**
 * Build a STAR format prompt for CV bullet generation
 * Exported for use in evals and testing
 */
export function buildStarPrompt(epicName: string, tickets: string[], commits: string[]): string {
  return `You are summarizing a software engineering project/feature for a CV/resume using the STAR format.

CONTEXT:
- ${commits.length} commits over this feature/project
- Epic: ${epicName}

JIRA TICKETS IN THIS FEATURE:
${tickets.map(t => `- ${t}`).join('\n')}

SAMPLE COMMIT MESSAGES:
${commits.map(c => `- ${c}`).join('\n')}

OUTPUT FORMAT - Generate a STAR format summary with these exact labels:

**Situation:** [1-2 sentences describing the business problem, user need, or opportunity that prompted this work.]

**Task:** [1 sentence describing your specific responsibility or goal.]

**Action:** [2-3 sentences describing what you actually built/implemented. Be specific about technologies.]

**Result:** [Leave this as a placeholder for the user to fill in with metrics]

STRICT RULES:
1. Use ONLY information from the JIRA tickets and commit messages
2. For Result, ALWAYS output exactly: "[Add metrics: e.g., reduced X by Y%, improved Z for N users]"

Generate the STAR format summary now:`;
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

  /**
   * Generate a consolidated CV bullet from a group of related commits
   */
  async generateGroupedBullet(group: CommitGroup): Promise<GroupedBullet> {
    const prompt = this.buildGroupedPrompt(group);
    const text = await this.generateText(prompt);

    return {
      text,
      group,
      generatedAt: new Date(),
      aiProvider: this.id,
      aiModel: this.model,
    };
  }

  /**
   * Build prompt for generating a consolidated bullet from multiple commits
   * Uses STAR format (Situation, Task, Action, Result placeholder)
   */
  buildGroupedPrompt(group: CommitGroup): string {
    const parts: string[] = [];

    // Base instruction for grouped bullets in STAR format
    parts.push(`You are summarizing a software engineering project/feature for a CV/resume using the STAR format.

CONTEXT:
- ${group.commits.length} commits over this feature/project
- Epic: ${group.groupName}
${group.sprint ? `- Sprint: ${group.sprint}` : ''}
${group.labels.length > 0 ? `- Labels: ${group.labels.join(', ')}` : ''}

JIRA TICKETS IN THIS FEATURE:`);

    // Add JIRA issue summaries (limit to first 10 to avoid prompt overload)
    const issuesToShow = group.jiraIssues.slice(0, 10);
    for (const issue of issuesToShow) {
      parts.push(`
- ${issue.key}: ${issue.summary}
  Type: ${issue.issueType}${issue.description ? `
  Description: ${issue.description.substring(0, 300)}` : ''}`);
    }
    if (group.jiraIssues.length > 10) {
      parts.push(`\n... and ${group.jiraIssues.length - 10} more tickets`);
    }

    // Add commit message samples (first 5 and last 5 for context)
    parts.push(`\n\nSAMPLE COMMIT MESSAGES:`);
    const commitSamples = group.commits.length <= 10
      ? group.commits
      : [...group.commits.slice(0, 5), ...group.commits.slice(-5)];
    for (const commit of commitSamples) {
      const shortMsg = commit.message.split('\n')[0].substring(0, 100);
      parts.push(`- ${shortMsg}`);
    }

    parts.push(`

OUTPUT FORMAT - Generate a STAR format summary with these exact labels:

**Situation:** [1-2 sentences describing the business problem, user need, or opportunity that prompted this work. What was the context?]

**Task:** [1 sentence describing your specific responsibility or goal. What were you asked to do?]

**Action:** [2-3 sentences describing what you actually built/implemented. Be specific about technologies, architecture decisions, and scope. Use past tense action verbs.]

**Result:** [Leave this as a placeholder for the user to fill in with metrics]

STRICT RULES:
1. Use ONLY information from the JIRA tickets and commit messages - do NOT invent details
2. Focus on the OVERALL accomplishment, not individual tickets
3. Situation should explain WHY this work was needed (infer from ticket descriptions)
4. Task should be YOUR specific responsibility (what you owned)
5. Action should highlight technical accomplishments (technologies, scale, complexity)
6. For Result, ALWAYS output exactly: "[Add metrics: e.g., reduced X by Y%, improved Z for N users]"
7. Use professional language suitable for a senior engineer's resume
8. Do NOT include ticket numbers in the output

EXAMPLE OUTPUT:
**Situation:** Content administrators needed to update terminology across thousands of learning materials manually, a process that took hours per change and was prone to human error.

**Task:** Design and implement an enterprise-scale find-and-replace system for the learning management platform.

**Action:** Built a comprehensive search service supporting 15+ content types with real-time progress tracking. Implemented authorization policies, audit history, and a user-friendly frontend with batch selection and status indicators.

**Result:** [Add metrics: e.g., reduced content update time by 95%, enabled updates across 10,000+ documents]

Generate the STAR format summary now:`);

    return parts.join('\n');
  }
}
