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
  private mainBranch: string;

  constructor(repoPath: string, mainBranch: string = 'main') {
    this.repoPath = repoPath;
    this.mainBranch = mainBranch;
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
   * Get commits from the repository's main branch
   * Only returns commits that have been merged to main (i.e., shipped work)
   */
  async getCommits(options: {
    since?: string;
    until?: string;
    maxCount?: number;
    author?: string;
  } = {}): Promise<Commit[]> {
    const logOptions: string[] = [this.mainBranch];

    if (options.since) logOptions.push(`--since=${options.since}`);
    if (options.until) logOptions.push(`--until=${options.until}`);
    if (options.maxCount) logOptions.push(`-n ${options.maxCount}`);
    if (options.author) logOptions.push(`--author=${options.author}`);

    const log = await this.git.log(logOptions);
    const remoteUrl = await this.getRemoteUrl();

    return log.all.map(entry => ({
      hash: entry.hash,
      message: entry.body ? `${entry.message}\n\n${entry.body}` : entry.message,
      author: entry.author_name,
      email: entry.author_email,
      timestamp: new Date(entry.date),
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
   * Get full diff for a commit
   */
  async getDiff(commitHash: string): Promise<string> {
    try {
      return await this.git.diff([`${commitHash}^`, commitHash]);
    } catch {
      return '';
    }
  }

  /**
   * Get diff with smart sampling (per-file chunks)
   * Ensures every file is represented while keeping total size bounded
   */
  async getDiffSampled(
    commitHash: string,
    options: {
      maxLinesPerFile?: number;
      maxTotalLines?: number;
      chunkSize?: number;
    } = {}
  ): Promise<string> {
    const {
      maxLinesPerFile = 30,
      maxTotalLines = 100,
      chunkSize = 10,
    } = options;

    try {
      const fullDiff = await this.getDiff(commitHash);
      if (!fullDiff) return '';

      // Split diff by file (each file starts with "diff --git")
      const fileDiffs = fullDiff.split(/(?=^diff --git)/m).filter(d => d.trim());

      if (fileDiffs.length === 0) return '';

      // Calculate lines budget per file
      const linesPerFile = Math.min(
        maxLinesPerFile,
        Math.floor(maxTotalLines / fileDiffs.length)
      );

      const sampledParts: string[] = [];
      let totalLines = 0;

      for (const fileDiff of fileDiffs) {
        if (totalLines >= maxTotalLines) break;

        const lines = fileDiff.split('\n');

        // Extract file header (diff --git line and any @@ markers)
        const headerLines: string[] = [];
        const contentLines: string[] = [];

        for (const line of lines) {
          if (
            line.startsWith('diff --git') ||
            line.startsWith('index ') ||
            line.startsWith('---') ||
            line.startsWith('+++') ||
            line.startsWith('@@')
          ) {
            headerLines.push(line);
          } else {
            contentLines.push(line);
          }
        }

        // Sample content lines using chunk strategy
        const sampled = this.sampleLines(contentLines, linesPerFile, chunkSize);
        const sampledWithHeader = [...headerLines, ...sampled].join('\n');

        sampledParts.push(sampledWithHeader);
        totalLines += headerLines.length + sampled.length;
      }

      return sampledParts.join('\n\n');
    } catch {
      return '';
    }
  }

  /**
   * Sample lines from content using first/middle/last chunk strategy
   */
  private sampleLines(lines: string[], maxLines: number, chunkSize: number): string[] {
    if (lines.length <= maxLines) {
      return lines;
    }

    const result: string[] = [];

    // First chunk
    const firstChunk = lines.slice(0, chunkSize);
    result.push(...firstChunk);

    // If we have room for more and there's content between first and last
    const remaining = maxLines - chunkSize * 2; // Reserve space for last chunk
    if (remaining > 0 && lines.length > chunkSize * 2) {
      // Pick a random middle chunk
      const middleStart = chunkSize;
      const middleEnd = lines.length - chunkSize;
      const middleRange = middleEnd - middleStart;

      if (middleRange > 0) {
        // Random position in middle section
        const randomStart = middleStart + Math.floor(Math.random() * Math.max(1, middleRange - chunkSize));
        const middleChunk = lines.slice(randomStart, randomStart + Math.min(chunkSize, remaining));
        result.push('... [sampled] ...');
        result.push(...middleChunk);
      }
    }

    // Last chunk
    if (lines.length > chunkSize) {
      result.push('... [sampled] ...');
      const lastChunk = lines.slice(-chunkSize);
      result.push(...lastChunk);
    }

    return result;
  }

  /**
   * Get unique authors from the branch
   */
  async getAuthors(): Promise<Array<{ name: string; email: string }>> {
    try {
      const log = await this.git.log([this.mainBranch]);
      const seen = new Set<string>();
      const authors: Array<{ name: string; email: string }> = [];

      for (const entry of log.all) {
        const key = entry.author_email;
        if (key && !seen.has(key)) {
          seen.add(key);
          authors.push({
            name: entry.author_name,
            email: entry.author_email,
          });
        }
      }

      // Sort by name
      return authors.sort((a, b) => a.name.localeCompare(b.name));
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
