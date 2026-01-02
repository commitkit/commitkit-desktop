/**
 * Core types for CommitKit Desktop
 */

// Commit from git
export interface Commit {
  hash: string;
  message: string;
  author: string;
  email: string;
  timestamp: Date;
  remoteUrl?: string;
  filesChanged?: string[];
}

// Repository configuration
export interface RepoConfig {
  path: string;
  mainBranch: string;  // User specifies: main, master, develop, trunk, etc.
  remoteUrl?: string;
}

// Enrichment data from plugins
export interface EnrichmentData {
  pluginId: string;
  data: Record<string, unknown>;
}

// Context passed between plugins
export interface EnrichmentContext {
  [pluginId: string]: EnrichmentData;
}

// Discovery pattern for suggesting new integrations
export interface DiscoveryPattern {
  description: string;
  regexHints: RegExp[];
  llmPrompt: string;
  exampleMatches: string[];
}

// Plugin interface - all plugins implement this
export interface Plugin {
  id: string;
  name: string;
  layer: 'vcs' | 'hosting' | 'enrichment';
  priority: number;

  // For integration discovery
  getDiscoveryPatterns(): DiscoveryPattern[];

  // Check if this plugin applies to the given commit/repo
  isRelevant(commit: Commit, context: EnrichmentContext): boolean;

  // Fetch enrichment data
  enrich(commit: Commit, context: EnrichmentContext): Promise<EnrichmentData | null>;
}

// JIRA-specific types
export interface JiraIssue {
  key: string;
  summary: string;
  description?: string;
  issueType: string;
  status: string;
  priority?: string;
  epicKey?: string;
  epicName?: string;
  sprint?: string;
  storyPoints?: number;
  labels?: string[];
}

// GitHub-specific types
export interface GitHubPR {
  number: number;
  title: string;
  description: string;
  state: string;
  labels?: string[];
  reviews?: GitHubReview[];
  linkedIssues?: string[];
}

export interface GitHubReview {
  author: string;
  state: string;
  body?: string;
}

// CV Bullet output
export interface CVBullet {
  text: string;
  commit: Commit;
  enrichments: EnrichmentContext;
  generatedAt: Date;
  aiProvider: string;
  aiModel: string;
}

// Grouped commits for consolidated bullet generation
export interface CommitGroup {
  groupKey: string;           // e.g., "ES1-1234" (epic), "PR-123", or commit hash
  groupType: 'pr' | 'epic' | 'sprint' | 'file-overlap' | 'individual';
  groupName: string;          // e.g., "AI Assistant Feature" or ticket summary
  commits: Commit[];
  jiraIssues: JiraIssue[];    // All unique JIRA issues in this group
  sprint?: string;            // Most common sprint in the group
  labels: string[];           // All unique labels across the group
  prNumber?: number;          // For PR-based groups
}

// Topic tags for commit visualization
export const TOPIC_TAGS = [
  'authentication',
  'api',
  'ui',
  'database',
  'testing',
  'documentation',
  'config',
  'deployment',
  'ci-cd',
  'bugfix',
  'refactor',
  'performance',
  'security',
  'logging',
  'email',
  'payments',
  'other',
] as const;

export type TopicTag = typeof TOPIC_TAGS[number];

// Tagged commit for visualization
export interface CommitTags {
  hash: string;
  message: string;
  tags: TopicTag[];
}

// Grouped bullet output
export interface GroupedBullet {
  text: string;
  group: CommitGroup;
  generatedAt: Date;
  aiProvider: string;
  aiModel: string;
}

// AI Provider interface
export interface AIProvider {
  id: string;
  name: string;
  isLocal: boolean;
  requiresApiKey: boolean;
  privacyPolicyUrl?: string;

  generateText(prompt: string): Promise<string>;
  supportsToolCalling(): boolean;
  testConnection(): Promise<{ success: boolean; error?: string }>;
}
