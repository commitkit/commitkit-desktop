/**
 * GitHub Plugin - Layer 1 (Hosting)
 *
 * Fetches PR data from GitHub for commits.
 */

import axios from 'axios';
import { Plugin, Commit, EnrichmentContext, EnrichmentData, DiscoveryPattern, GitHubPR } from '../types';

export class GitHubPlugin implements Plugin {
  id = 'github';
  name = 'GitHub';
  layer = 'hosting' as const;
  priority = 10; // Hosting runs after VCS

  private token: string;
  private baseUrl = 'https://api.github.com';

  constructor(token: string) {
    this.token = token;
  }

  getDiscoveryPatterns(): DiscoveryPattern[] {
    return [{
      description: 'GitHub repository references',
      regexHints: [/github\.com\/[\w-]+\/[\w-]+/],
      llmPrompt: 'Look for references to GitHub repositories, PRs, or issues',
      exampleMatches: ['github.com/owner/repo', 'PR #123'],
    }];
  }

  isRelevant(commit: Commit, _context: EnrichmentContext): boolean {
    if (!commit.remoteUrl) return false;
    return commit.remoteUrl.includes('github.com');
  }

  async enrich(commit: Commit, _context: EnrichmentContext): Promise<EnrichmentData | null> {
    if (!commit.remoteUrl) return null;

    const repoInfo = this.parseRepoFromUrl(commit.remoteUrl);
    if (!repoInfo) return null;

    try {
      const pr = await this.findPRForCommit(repoInfo.owner, repoInfo.repo, commit.hash);
      if (!pr) return null;

      return {
        pluginId: this.id,
        data: { pr },
      };
    } catch (error) {
      console.error('GitHub enrichment failed:', error);
      return null;
    }
  }

  /**
   * Parse owner and repo from a GitHub URL
   */
  parseRepoFromUrl(url: string): { owner: string; repo: string } | null {
    // Handle HTTPS: https://github.com/owner/repo.git
    const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
    if (httpsMatch) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }

    // Handle SSH: git@github.com:owner/repo.git
    const sshMatch = url.match(/github\.com:([^/]+)\/([^/.]+)/);
    if (sshMatch) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    return null;
  }

  /**
   * Find the PR that contains a commit
   */
  private async findPRForCommit(owner: string, repo: string, commitHash: string): Promise<GitHubPR | null> {
    const response = await axios.get(
      `${this.baseUrl}/search/issues`,
      {
        params: {
          q: `${commitHash} repo:${owner}/${repo} type:pr`,
        },
        headers: this.getHeaders(),
      }
    );

    if (response.data.items.length === 0) return null;

    const prData = response.data.items[0];
    return {
      number: prData.number,
      title: prData.title,
      description: prData.body || '',
      state: prData.state,
      labels: prData.labels?.map((l: { name: string }) => l.name) || [],
    };
  }

  /**
   * Get PR details by number
   */
  async getPR(owner: string, repo: string, prNumber: number): Promise<GitHubPR | null> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/repos/${owner}/${repo}/pulls/${prNumber}`,
        { headers: this.getHeaders() }
      );

      const pr = response.data;
      return {
        number: pr.number,
        title: pr.title,
        description: pr.body || '',
        state: pr.state,
        labels: pr.labels?.map((l: { name: string }) => l.name) || [],
      };
    } catch {
      return null;
    }
  }

  /**
   * Get reviews for a PR
   */
  async getPRReviews(owner: string, repo: string, prNumber: number): Promise<Array<{ author: string; state: string; body?: string }>> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
        { headers: this.getHeaders() }
      );

      return response.data.map((review: { user: { login: string }; state: string; body?: string }) => ({
        author: review.user.login,
        state: review.state,
        body: review.body,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get PRs for multiple commits using GraphQL
   * Batches up to 50 commits per request for efficiency
   * Returns a map of commit hash to PR (for commits that have PRs)
   */
  async getPRsForCommits(
    owner: string,
    repo: string,
    commitHashes: string[]
  ): Promise<Map<string, GitHubPR>> {
    const result = new Map<string, GitHubPR>();

    if (commitHashes.length === 0) {
      return result;
    }

    // GraphQL can handle ~50 commits per request efficiently
    const BATCH_SIZE = 50;

    for (let i = 0; i < commitHashes.length; i += BATCH_SIZE) {
      const batch = commitHashes.slice(i, i + BATCH_SIZE);

      try {
        // Build GraphQL query with aliases for each commit
        const commitQueries = batch
          .map((hash, idx) => `c${idx}: object(oid: "${hash}") {
            ... on Commit {
              associatedPullRequests(first: 1) {
                nodes {
                  number
                  title
                  body
                  state
                  labels(first: 10) {
                    nodes { name }
                  }
                }
              }
            }
          }`)
          .join('\n');

        const query = `
          query {
            repository(owner: "${owner}", name: "${repo}") {
              ${commitQueries}
            }
          }
        `;

        const response = await axios.post(
          `${this.baseUrl}/graphql`,
          { query },
          { headers: this.getHeaders() }
        );

        // Process results
        const repoData = response.data?.data?.repository;
        if (repoData) {
          batch.forEach((hash, idx) => {
            const commitData = repoData[`c${idx}`];
            const prNodes = commitData?.associatedPullRequests?.nodes;
            if (prNodes && prNodes.length > 0) {
              const prData = prNodes[0];
              result.set(hash, {
                number: prData.number,
                title: prData.title,
                description: prData.body || '',
                state: prData.state.toLowerCase(),
                labels: prData.labels?.nodes?.map((l: { name: string }) => l.name) || [],
              });
            }
          });
        }
      } catch (error) {
        console.error(`GitHub GraphQL error for batch starting at ${i}:`, error);
        // Continue with other batches
      }
    }

    console.log(`[GitHub] Fetched PRs for ${result.size}/${commitHashes.length} commits`);
    return result;
  }

  /**
   * Test the connection with the provided token
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await axios.get(`${this.baseUrl}/user`, { headers: this.getHeaders() });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  private getHeaders() {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github.v3+json',
    };
  }
}
