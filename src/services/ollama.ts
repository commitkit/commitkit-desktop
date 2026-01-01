/**
 * Ollama LLM Provider
 *
 * Generates CV bullets from commits using local Ollama models.
 * All processing happens locally for privacy.
 */

import { Ollama } from 'ollama';
import { AIProvider, Commit, EnrichmentContext, CVBullet, JiraIssue, GitHubPR, CommitGroup, GroupedBullet, ClusteringSensitivity, ClusteringResult, CommitTags, TopicTag, TOPIC_TAGS } from '../types';

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

  /**
   * Confidence thresholds by sensitivity level
   */
  private getConfidenceThresholds(sensitivity: ClusteringSensitivity): { perCommit: number; perGroup: number } {
    switch (sensitivity) {
      case 'strict':
        return { perCommit: 0.9, perGroup: 0.85 };
      case 'balanced':
        return { perCommit: 0.8, perGroup: 0.7 };
      case 'loose':
        return { perCommit: 0.6, perGroup: 0.5 };
    }
  }

  /**
   * Build prompt for commit clustering analysis
   */
  buildClusteringPrompt(commits: Array<{
    hash: string;
    message: string;
    filesChanged: string[];
    diffSample: string;
  }>): string {
    const commitDescriptions = commits.map((c, i) => {
      const firstLine = c.message.split('\n')[0];
      const files = c.filesChanged.length > 0
        ? `Files: ${c.filesChanged.slice(0, 5).join(', ')}${c.filesChanged.length > 5 ? ` (+${c.filesChanged.length - 5} more)` : ''}`
        : 'Files: (none)';
      const diff = c.diffSample
        ? `\n   Changes:\n   \`\`\`diff\n${c.diffSample.split('\n').slice(0, 20).join('\n')}\n   \`\`\``
        : '';

      // Use 1-based index for easier human readability
      return `COMMIT ${i + 1}: ${firstLine}
   ${files}${diff}`;
    }).join('\n\n');

    return `Analyze these git commits and group them by feature, component, or logical change.

${commitDescriptions}

OUTPUT FORMAT - Respond with ONLY valid JSON, no other text.
IMPORTANT: Use commit NUMBERS (1, 2, 3, etc.) to reference commits, NOT hashes.

{
  "groups": [
    {
      "name": "Short descriptive name (2-5 words)",
      "theme": "authentication|api|ui|testing|refactor|bugfix|docs|config|other",
      "commits": [
        {"index": 1, "confidence": 0.95},
        {"index": 5, "confidence": 0.82}
      ],
      "overall_confidence": 0.88,
      "reasoning": "Brief explanation (1 sentence)"
    }
  ],
  "ungrouped": [3, 7, 12]
}

CONFIDENCE SCORING (0.0 to 1.0):
- 0.9+ = Very confident - commits clearly belong together (same feature, same files)
- 0.8-0.9 = Confident - strong connection (related functionality, similar patterns)
- 0.7-0.8 = Moderate - some connection but not certain
- Below 0.7 = Low confidence - leave in ungrouped

RULES:
1. Group by logical feature or component, not just file path
2. Minimum 2 commits per group (otherwise leave ungrouped)
3. Use clear, CV-friendly group names (e.g., "User Authentication", "API Error Handling")
4. Be CONSERVATIVE with confidence scores - when in doubt, score lower
5. Consider: shared files, related functionality, sequential work on same feature
6. overall_confidence = average of commit confidences in that group

Respond with only the JSON:`;
  }

  /**
   * Analyze commits for intelligent grouping using LLM
   */
  async analyzeCommitsForGrouping(
    commits: Array<{
      hash: string;
      message: string;
      filesChanged: string[];
      diffSample: string;
    }>,
    sensitivity: ClusteringSensitivity = 'balanced'
  ): Promise<ClusteringResult> {
    // Skip if too few commits
    if (commits.length < 2) {
      return { groups: [], ungrouped: commits.map(c => c.hash) };
    }

    const prompt = this.buildClusteringPrompt(commits);

    try {
      const response = await this.generateText(prompt);

      // Parse JSON from response (handle potential markdown code blocks)
      let jsonStr = response;
      if (response.includes('```json')) {
        jsonStr = response.split('```json')[1]?.split('```')[0] || response;
      } else if (response.includes('```')) {
        jsonStr = response.split('```')[1]?.split('```')[0] || response;
      }

      const parsed = JSON.parse(jsonStr.trim()) as {
        groups: Array<{
          name: string;
          theme: string;
          commits: Array<{ index: number; confidence: number }>;
          overall_confidence: number;
          reasoning: string;
        }>;
        ungrouped: number[];
      };

      console.log('[OLLAMA] Raw AI response groups:', parsed.groups.length);
      for (const g of parsed.groups) {
        console.log('[OLLAMA] Group:', g.name, 'commits:', g.commits.length, 'confidence:', g.overall_confidence);
        console.log('[OLLAMA] Commit indices:', g.commits.slice(0, 5).map(c => c.index));
      }

      // Apply confidence filtering
      const thresholds = this.getConfidenceThresholds(sensitivity);
      const filteredGroups: ClusteringResult['groups'] = [];
      // Convert ungrouped indices to hashes (indices are 1-based)
      const allUngrouped: string[] = (parsed.ungrouped || [])
        .filter(idx => idx >= 1 && idx <= commits.length)
        .map(idx => commits[idx - 1].hash);

      for (const group of parsed.groups) {
        // Filter commits by per-commit confidence threshold
        const confidentCommits = group.commits.filter(c => c.confidence >= thresholds.perCommit);
        const lowConfidenceCommits = group.commits.filter(c => c.confidence < thresholds.perCommit);

        // Move low-confidence commits to ungrouped (convert indices to hashes)
        for (const c of lowConfidenceCommits) {
          if (c.index >= 1 && c.index <= commits.length) {
            allUngrouped.push(commits[c.index - 1].hash);
          }
        }

        // Check if group meets per-group threshold and has enough commits
        if (group.overall_confidence >= thresholds.perGroup && confidentCommits.length >= 2) {
          // Convert indices to hashes (indices are 1-based)
          const commitHashes = confidentCommits
            .filter(c => c.index >= 1 && c.index <= commits.length)
            .map(c => commits[c.index - 1].hash);

          if (commitHashes.length >= 2) {
            filteredGroups.push({
              name: group.name,
              theme: group.theme,
              commitHashes,
              reasoning: group.reasoning,
              confidence: group.overall_confidence,
            });
          } else {
            // Not enough valid indices, dissolve group
            allUngrouped.push(...commitHashes);
          }
        } else {
          // Dissolve group - move all commits to ungrouped
          for (const c of confidentCommits) {
            if (c.index >= 1 && c.index <= commits.length) {
              allUngrouped.push(commits[c.index - 1].hash);
            }
          }
        }
      }

      // Deduplicate ungrouped (in case of duplicates)
      const uniqueUngrouped = [...new Set(allUngrouped)];

      return {
        groups: filteredGroups,
        ungrouped: uniqueUngrouped,
      };
    } catch (error) {
      console.error('Failed to analyze commits for grouping:', error);
      // Fallback: all commits ungrouped
      return {
        groups: [],
        ungrouped: commits.map(c => c.hash),
      };
    }
  }

  /**
   * Build prompt for topic tagging (batch of commits)
   */
  buildTaggingPrompt(commits: Array<{ hash: string; message: string; filesChanged?: string[] }>): string {
    const tagList = TOPIC_TAGS.join(', ');

    const commitList = commits.map((c, i) => {
      const firstLine = c.message.split('\n')[0];
      const files = c.filesChanged?.slice(0, 5).join(', ') || '';
      return `${i + 1}. "${firstLine}"${files ? ` [Files: ${files}]` : ''}`;
    }).join('\n');

    return `Assign 1-3 topic tags to each commit from this list: ${tagList}

COMMITS:
${commitList}

OUTPUT FORMAT - Respond with ONLY valid JSON, no other text:
{
  "tags": [
    [1, ["api", "testing"]],
    [2, ["ui", "bugfix"]],
    [3, ["documentation"]]
  ]
}

RULES:
1. Each commit gets 1-3 tags maximum
2. Use ONLY tags from the provided list
3. Choose tags based on the commit message AND file paths
4. If unsure, use "other"

Respond with only the JSON:`;
  }

  /**
   * Assign topic tags to commits for visualization
   * Batches commits to reduce API calls (10 per batch)
   */
  async assignTopicTags(
    commits: Array<{ hash: string; message: string; filesChanged?: string[] }>,
    onProgress?: (completed: number, total: number) => void
  ): Promise<CommitTags[]> {
    const BATCH_SIZE = 10;
    const results: CommitTags[] = [];
    const batches: Array<Array<{ hash: string; message: string; filesChanged?: string[] }>> = [];

    // Split into batches
    for (let i = 0; i < commits.length; i += BATCH_SIZE) {
      batches.push(commits.slice(i, i + BATCH_SIZE));
    }

    let completed = 0;
    for (const batch of batches) {
      try {
        const prompt = this.buildTaggingPrompt(batch);
        const response = await this.generateText(prompt);

        // Parse JSON response
        let jsonStr = response;
        if (response.includes('```json')) {
          jsonStr = response.split('```json')[1]?.split('```')[0] || response;
        } else if (response.includes('```')) {
          jsonStr = response.split('```')[1]?.split('```')[0] || response;
        }

        const parsed = JSON.parse(jsonStr.trim()) as {
          tags: Array<[number, string[]]>;
        };

        // Map results back to commits
        for (const [index, tags] of parsed.tags) {
          const commit = batch[index - 1]; // 1-based index
          if (commit) {
            // Validate tags against allowed list
            const validTags = tags.filter((t): t is TopicTag =>
              TOPIC_TAGS.includes(t as TopicTag)
            );
            results.push({
              hash: commit.hash,
              message: commit.message.split('\n')[0],
              tags: validTags.length > 0 ? validTags : ['other'],
            });
          }
        }

        // Handle any commits not in response
        for (let i = 0; i < batch.length; i++) {
          const commit = batch[i];
          if (!results.find(r => r.hash === commit.hash)) {
            results.push({
              hash: commit.hash,
              message: commit.message.split('\n')[0],
              tags: ['other'],
            });
          }
        }
      } catch (error) {
        console.error('Failed to tag batch:', error);
        // Fallback: tag all in batch as "other"
        for (const commit of batch) {
          if (!results.find(r => r.hash === commit.hash)) {
            results.push({
              hash: commit.hash,
              message: commit.message.split('\n')[0],
              tags: ['other'],
            });
          }
        }
      }

      completed += batch.length;
      if (onProgress) {
        onProgress(completed, commits.length);
      }
    }

    return results;
  }
}
