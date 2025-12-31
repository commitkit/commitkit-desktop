/**
 * JIRA Plugin - Layer 2 (Enrichment)
 *
 * Extracts JIRA ticket keys from commit messages and fetches issue data.
 */

import axios from 'axios';
import { Plugin, Commit, EnrichmentContext, EnrichmentData, DiscoveryPattern, JiraIssue } from '../types';

export interface JiraConfig {
  baseUrl: string;      // e.g., https://company.atlassian.net
  email: string;        // User email for auth
  apiToken: string;     // API token from Atlassian
  sprintField?: string; // Custom field ID for sprint (default: customfield_10001)
  storyPointsField?: string; // Custom field ID for story points (default: customfield_10002)
}

export class JiraPlugin implements Plugin {
  id = 'jira';
  name = 'JIRA';
  layer = 'enrichment' as const;
  priority = 20; // Enrichment runs after hosting

  private config: JiraConfig;
  private sprintField: string;
  private storyPointsField: string;

  // Regex to match JIRA ticket keys: PROJECT-123
  private ticketKeyRegex = /\b([A-Z][A-Z0-9]+-\d+)\b/gi;

  constructor(config: JiraConfig) {
    this.config = config;
    this.sprintField = config.sprintField || 'customfield_10001';
    this.storyPointsField = config.storyPointsField || 'customfield_10002';
  }

  getDiscoveryPatterns(): DiscoveryPattern[] {
    return [{
      description: 'JIRA ticket references',
      regexHints: [/[A-Z]+-\d+/],
      llmPrompt: 'Look for JIRA ticket keys like PROJ-123 in commit messages',
      exampleMatches: ['PROJ-123', 'TICKET-456', '[ABC-789]'],
    }];
  }

  /**
   * Extract JIRA ticket keys from a commit message
   */
  extractTicketKeys(message: string): string[] {
    const matches = message.match(this.ticketKeyRegex);
    if (!matches) return [];

    // Uppercase and deduplicate
    const unique = [...new Set(matches.map(m => m.toUpperCase()))];
    return unique;
  }

  isRelevant(commit: Commit, _context: EnrichmentContext): boolean {
    return this.extractTicketKeys(commit.message).length > 0;
  }

  async enrich(commit: Commit, _context: EnrichmentContext): Promise<EnrichmentData | null> {
    const ticketKeys = this.extractTicketKeys(commit.message);
    if (ticketKeys.length === 0) return null;

    try {
      const issues: JiraIssue[] = [];

      for (const key of ticketKeys) {
        const issue = await this.getIssue(key);
        if (issue) {
          issues.push(issue);
        }
      }

      if (issues.length === 0) return null;

      return {
        pluginId: this.id,
        data: { issues },
      };
    } catch (error) {
      console.error('JIRA enrichment failed:', error);
      return null;
    }
  }

  /**
   * Fetch a single JIRA issue by key
   */
  async getIssue(key: string): Promise<JiraIssue | null> {
    try {
      const response = await axios.get(
        `${this.config.baseUrl}/rest/api/3/issue/${key}`,
        { headers: this.getHeaders() }
      );

      const { fields } = response.data;

      return {
        key: response.data.key,
        summary: fields.summary,
        issueType: fields.issuetype?.name,
        status: fields.status?.name,
        priority: fields.priority?.name,
        labels: fields.labels || [],
        sprint: fields[this.sprintField]?.name,
        storyPoints: fields[this.storyPointsField],
        epicKey: fields.parent?.key,
        epicName: fields.parent?.fields?.summary,
      };
    } catch {
      return null;
    }
  }

  /**
   * Test the connection with the provided credentials
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await axios.get(
        `${this.config.baseUrl}/rest/api/3/myself`,
        { headers: this.getHeaders() }
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  private getHeaders() {
    // JIRA Cloud uses Basic Auth with email:apiToken
    const auth = Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString('base64');
    return {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    };
  }
}
