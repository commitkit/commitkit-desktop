/**
 * Git Plugin - Layer 0 (VCS)
 *
 * Reads commit history from local git repositories.
 */

import simpleGit, { SimpleGit } from 'simple-git';
import { Plugin, Commit, EnrichmentContext, EnrichmentData, DiscoveryPattern } from '../types';

export class GitPlugin implements Plugin {
  id = 'git';
  name = 'Git';
  layer = 'vcs' as const;
  priority = 0; // VCS runs first

  private git: SimpleGit;
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
  }

  getDiscoveryPatterns(): DiscoveryPattern[] {
    // Git is always present if we're tracking a repo
    return [];
  }

  isRelevant(_commit: Commit, _context: EnrichmentContext): boolean {
    // Git plugin is always relevant - it provides the commits
    return true;
  }

  async enrich(commit: Commit, _context: EnrichmentContext): Promise<EnrichmentData | null> {
    // Git plugin populates the base commit data
    // Other plugins enrich on top of this
    return {
      pluginId: this.id,
      data: {
        repoPath: this.repoPath,
        remoteUrl: await this.getRemoteUrl(),
      },
    };
  }

  /**
   * Get commits from the repository
   */
  async getCommits(options: {
    since?: string;
    until?: string;
    maxCount?: number;
    author?: string;
  } = {}): Promise<Commit[]> {
    const logOptions: string[] = [];

    if (options.since) logOptions.push(`--since=${options.since}`);
    if (options.until) logOptions.push(`--until=${options.until}`);
    if (options.maxCount) logOptions.push(`-n ${options.maxCount}`);
    if (options.author) logOptions.push(`--author=${options.author}`);

    const log = await this.git.log(logOptions);
    const remoteUrl = await this.getRemoteUrl();
    const currentBranch = await this.getCurrentBranch();

    return log.all.map(entry => ({
      hash: entry.hash,
      message: entry.message,
      author: entry.author_name,
      email: entry.author_email,
      timestamp: new Date(entry.date),
      branch: currentBranch,
      remoteUrl,
    }));
  }

  /**
   * Get the remote URL (origin)
   */
  async getRemoteUrl(): Promise<string | undefined> {
    try {
      const remotes = await this.git.getRemotes(true);
      const origin = remotes.find(r => r.name === 'origin');
      return origin?.refs?.fetch || origin?.refs?.push;
    } catch {
      return undefined;
    }
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(): Promise<string> {
    try {
      const branch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
      return branch.trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Get files changed in a commit
   */
  async getFilesChanged(commitHash: string): Promise<string[]> {
    try {
      const diff = await this.git.diff([`${commitHash}^`, commitHash, '--name-only']);
      return diff.split('\n').filter(f => f.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Check if path is a valid git repository
   */
  static async isGitRepo(path: string): Promise<boolean> {
    try {
      const git = simpleGit(path);
      await git.revparse(['--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Scan common directories for git repositories
   */
  static async discoverRepositories(basePaths: string[]): Promise<string[]> {
    const repos: string[] = [];

    for (const basePath of basePaths) {
      // This is a simplified version - real implementation would recursively scan
      if (await GitPlugin.isGitRepo(basePath)) {
        repos.push(basePath);
      }
    }

    return repos;
  }
}
