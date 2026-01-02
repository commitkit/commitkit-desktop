/**
 * Commit Grouping Utilities
 *
 * Pure functions for grouping commits by feature/epic.
 * Extracted from main.ts for testability.
 */

import { Commit, JiraIssue, CommitGroup, GitHubPR } from '../types';

// JIRA key regex: PROJECT-123 format
const JIRA_KEY_REGEX = /\b([A-Z][A-Z0-9]+-\d+)\b/gi;

/**
 * Extract JIRA keys from a commit message
 */
export function extractJiraKeys(message: string): string[] {
  const matches = message.match(JIRA_KEY_REGEX);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.toUpperCase()))];
}

/**
 * Group commits by epic (hybrid approach)
 * - Commits with epics → grouped into feature groups
 * - Commits without epics → returned as ungrouped for individual bullets
 *
 * @param groupOverrides - Optional user overrides: commit hash → group key (or null for no group)
 */
export function groupCommitsByFeature(
  commits: Commit[],
  jiraCache: Map<string, JiraIssue>,
  groupOverrides?: Record<string, string | null>
): { groups: CommitGroup[]; ungroupedCommits: Array<{ commit: Commit; issues: JiraIssue[] }> } {
  const groups = new Map<string, CommitGroup>();
  const ungroupedCommits: Array<{ commit: Commit; issues: JiraIssue[] }> = [];

  // First pass: collect epic info for all potential groups (needed for override targets)
  const epicInfo = new Map<string, { epicKey: string; epicName: string }>();

  for (const commit of commits) {
    const matches = commit.message.match(JIRA_KEY_REGEX);
    if (matches) {
      for (const match of matches) {
        const issue = jiraCache.get(match.toUpperCase());
        if (issue?.epicKey && !epicInfo.has(issue.epicKey)) {
          epicInfo.set(issue.epicKey, {
            epicKey: issue.epicKey,
            epicName: issue.epicName || issue.epicKey,
          });
        }
      }
    }
  }

  for (const commit of commits) {
    const matches = commit.message.match(JIRA_KEY_REGEX);

    // Collect all JIRA issues for this commit
    const commitIssues: JiraIssue[] = [];
    let epicKey: string | null = null;
    let epicName = '';

    if (matches) {
      for (const match of matches) {
        const issue = jiraCache.get(match.toUpperCase());
        if (issue) {
          commitIssues.push(issue);
          // Find epic if available
          if (issue.epicKey && !epicKey) {
            epicKey = issue.epicKey;
            epicName = issue.epicName || issue.epicKey;
          }
        }
      }
    }

    // Check for user override
    if (groupOverrides && commit.hash in groupOverrides) {
      const overrideKey = groupOverrides[commit.hash];
      if (overrideKey === null) {
        // Explicitly set to no group
        ungroupedCommits.push({ commit, issues: commitIssues });
        continue;
      } else {
        // Override to a specific group
        epicKey = overrideKey;
        epicName = epicInfo.get(overrideKey)?.epicName || overrideKey;
      }
    }

    // Only group if we have an epic
    if (epicKey) {
      if (groups.has(epicKey)) {
        const group = groups.get(epicKey)!;
        group.commits.push(commit);
        // Add unique issues
        for (const issue of commitIssues) {
          if (!group.jiraIssues.find(i => i.key === issue.key)) {
            group.jiraIssues.push(issue);
          }
        }
        // Merge labels
        for (const issue of commitIssues) {
          for (const label of issue.labels || []) {
            if (!group.labels.includes(label)) {
              group.labels.push(label);
            }
          }
        }
      } else {
        const allLabels: string[] = [];
        for (const issue of commitIssues) {
          for (const label of issue.labels || []) {
            if (!allLabels.includes(label)) {
              allLabels.push(label);
            }
          }
        }
        groups.set(epicKey, {
          groupKey: epicKey,
          groupType: 'epic',
          groupName: epicName,
          commits: [commit],
          jiraIssues: [...commitIssues],
          sprint: commitIssues[0]?.sprint,
          labels: allLabels,
        });
      }
    } else {
      // No epic - will generate individual bullet
      ungroupedCommits.push({ commit, issues: commitIssues });
    }
  }

  // Sort groups by commit count (descending)
  const sortedGroups = Array.from(groups.values()).sort(
    (a, b) => b.commits.length - a.commits.length
  );

  return { groups: sortedGroups, ungroupedCommits };
}

/**
 * Group commits by PR
 * Commits that belong to the same PR are grouped together
 */
export function groupByPR(
  commits: Commit[],
  prCache: Map<string, GitHubPR>
): { groups: CommitGroup[]; ungrouped: Commit[] } {
  const prGroups = new Map<number, { pr: GitHubPR; commits: Commit[] }>();
  const ungrouped: Commit[] = [];

  for (const commit of commits) {
    const pr = prCache.get(commit.hash);
    if (pr) {
      if (prGroups.has(pr.number)) {
        prGroups.get(pr.number)!.commits.push(commit);
      } else {
        prGroups.set(pr.number, { pr, commits: [commit] });
      }
    } else {
      ungrouped.push(commit);
    }
  }

  // Convert to CommitGroup format, only include groups with 2+ commits
  const groups: CommitGroup[] = [];
  for (const [prNumber, { pr, commits: prCommits }] of prGroups) {
    if (prCommits.length >= 2) {
      groups.push({
        groupKey: `PR-${prNumber}`,
        groupType: 'pr',
        groupName: pr.title,
        commits: prCommits,
        jiraIssues: [],
        labels: pr.labels || [],
        prNumber,
      });
    } else {
      // Single commit PRs go to ungrouped
      ungrouped.push(...prCommits);
    }
  }

  // Sort by commit count descending
  groups.sort((a, b) => b.commits.length - a.commits.length);

  return { groups, ungrouped };
}

/**
 * Group commits by sprint + time proximity
 * Commits in the same sprint that are within timeWindowDays of each other
 */
export function groupBySprintAndTime(
  commits: Array<{ commit: Commit; issues: JiraIssue[] }>,
  timeWindowDays: number = 7
): { groups: CommitGroup[]; ungrouped: Array<{ commit: Commit; issues: JiraIssue[] }> } {
  // Group by sprint first
  const sprintBuckets = new Map<string, Array<{ commit: Commit; issues: JiraIssue[] }>>();
  const noSprint: Array<{ commit: Commit; issues: JiraIssue[] }> = [];

  for (const item of commits) {
    const sprint = item.issues[0]?.sprint;
    if (sprint) {
      if (sprintBuckets.has(sprint)) {
        sprintBuckets.get(sprint)!.push(item);
      } else {
        sprintBuckets.set(sprint, [item]);
      }
    } else {
      noSprint.push(item);
    }
  }

  const groups: CommitGroup[] = [];
  const ungrouped: Array<{ commit: Commit; issues: JiraIssue[] }> = [...noSprint];
  const timeWindowMs = timeWindowDays * 24 * 60 * 60 * 1000;

  // For each sprint, cluster by time proximity
  for (const [sprint, sprintCommits] of sprintBuckets) {
    if (sprintCommits.length < 2) {
      ungrouped.push(...sprintCommits);
      continue;
    }

    // Sort by timestamp
    const sorted = [...sprintCommits].sort(
      (a, b) => a.commit.timestamp.getTime() - b.commit.timestamp.getTime()
    );

    // Cluster commits within time window
    const clusters: Array<Array<{ commit: Commit; issues: JiraIssue[] }>> = [];
    let currentCluster: Array<{ commit: Commit; issues: JiraIssue[] }> = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prevTime = sorted[i - 1].commit.timestamp.getTime();
      const currTime = sorted[i].commit.timestamp.getTime();

      if (currTime - prevTime <= timeWindowMs) {
        currentCluster.push(sorted[i]);
      } else {
        clusters.push(currentCluster);
        currentCluster = [sorted[i]];
      }
    }
    clusters.push(currentCluster);

    // Convert clusters to groups (only if 2+ commits)
    for (const cluster of clusters) {
      if (cluster.length >= 2) {
        const allIssues: JiraIssue[] = [];
        const allLabels: string[] = [];

        for (const item of cluster) {
          for (const issue of item.issues) {
            if (!allIssues.find(i => i.key === issue.key)) {
              allIssues.push(issue);
            }
            for (const label of issue.labels || []) {
              if (!allLabels.includes(label)) {
                allLabels.push(label);
              }
            }
          }
        }

        groups.push({
          groupKey: `sprint-${sprint}`,
          groupType: 'sprint',
          groupName: `Sprint: ${sprint}`,
          commits: cluster.map(c => c.commit),
          jiraIssues: allIssues,
          sprint,
          labels: allLabels,
        });
      } else {
        ungrouped.push(...cluster);
      }
    }
  }

  groups.sort((a, b) => b.commits.length - a.commits.length);

  return { groups, ungrouped };
}

/**
 * Calculate file overlap between two sets of files
 * Returns a value between 0.0 (no overlap) and 1.0 (complete overlap)
 */
export function calculateFileOverlap(files1: string[], files2: string[]): number {
  if (files1.length === 0 || files2.length === 0) {
    return 0;
  }

  const set1 = new Set(files1);
  const set2 = new Set(files2);

  let intersection = 0;
  for (const file of set1) {
    if (set2.has(file)) {
      intersection++;
    }
  }

  // Jaccard similarity: intersection / union
  const union = set1.size + set2.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Group commits by file overlap
 * Commits that share >threshold of their files are grouped together
 */
export function groupByFileOverlap(
  commits: Commit[],
  overlapThreshold: number = 0.5
): { groups: CommitGroup[]; ungrouped: Commit[] } {
  if (commits.length < 2) {
    return { groups: [], ungrouped: commits };
  }

  // Build adjacency list based on file overlap
  const overlaps: Map<number, number[]> = new Map();

  for (let i = 0; i < commits.length; i++) {
    overlaps.set(i, []);
    const files1 = commits[i].filesChanged || [];

    for (let j = 0; j < commits.length; j++) {
      if (i === j) continue;

      const files2 = commits[j].filesChanged || [];
      const overlap = calculateFileOverlap(files1, files2);

      if (overlap >= overlapThreshold) {
        overlaps.get(i)!.push(j);
      }
    }
  }

  // Find connected components (simple BFS)
  const visited = new Set<number>();
  const clusters: number[][] = [];

  for (let i = 0; i < commits.length; i++) {
    if (visited.has(i)) continue;

    const cluster: number[] = [];
    const queue = [i];

    while (queue.length > 0) {
      const node = queue.shift()!;
      if (visited.has(node)) continue;

      visited.add(node);
      cluster.push(node);

      for (const neighbor of overlaps.get(node) || []) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    clusters.push(cluster);
  }

  // Convert clusters to groups
  const groups: CommitGroup[] = [];
  const ungrouped: Commit[] = [];

  for (const cluster of clusters) {
    if (cluster.length >= 2) {
      const clusterCommits = cluster.map(i => commits[i]);

      // Determine group name from common directory
      const allFiles = clusterCommits.flatMap(c => c.filesChanged || []);
      const commonDir = findCommonDirectory(allFiles);

      groups.push({
        groupKey: `files-${commonDir || 'mixed'}`,
        groupType: 'file-overlap',
        groupName: commonDir ? `Changes in ${commonDir}` : 'Related file changes',
        commits: clusterCommits,
        jiraIssues: [],
        labels: [],
      });
    } else {
      ungrouped.push(commits[cluster[0]]);
    }
  }

  groups.sort((a, b) => b.commits.length - a.commits.length);

  return { groups, ungrouped };
}

/**
 * Find common directory prefix for a set of file paths
 */
function findCommonDirectory(files: string[]): string {
  if (files.length === 0) return '';

  const parts = files.map(f => f.split('/'));
  const minLen = Math.min(...parts.map(p => p.length));

  let commonParts: string[] = [];
  for (let i = 0; i < minLen - 1; i++) {
    const part = parts[0][i];
    if (parts.every(p => p[i] === part)) {
      commonParts.push(part);
    } else {
      break;
    }
  }

  return commonParts.join('/');
}

/**
 * Multi-signal commit grouping
 * Uses a tiered approach: PR → Epic → Sprint+Time → File Overlap → Individual
 */
export function groupCommitsMultiSignal(
  commits: Commit[],
  jiraCache: Map<string, JiraIssue>,
  prCache: Map<string, GitHubPR>,
  options: {
    timeWindowDays?: number;
    overlapThreshold?: number;
  } = {}
): { groups: CommitGroup[]; ungroupedCommits: Array<{ commit: Commit; issues: JiraIssue[] }> } {
  const { timeWindowDays = 7, overlapThreshold = 0.5 } = options;

  const allGroups: CommitGroup[] = [];
  let remaining = commits;

  // Tier 1: Group by PR (if PR cache available)
  if (prCache.size > 0) {
    const { groups: prGroups, ungrouped: afterPR } = groupByPR(remaining, prCache);
    allGroups.push(...prGroups);
    remaining = afterPR;
  }

  // Tier 2: Group by Epic (existing logic)
  const { groups: epicGroups, ungroupedCommits: afterEpic } = groupCommitsByFeature(remaining, jiraCache);
  allGroups.push(...epicGroups);

  // Tier 3: Group by Sprint + Time
  const { groups: sprintGroups, ungrouped: afterSprint } = groupBySprintAndTime(afterEpic, timeWindowDays);
  allGroups.push(...sprintGroups);

  // Tier 4: Group by File Overlap
  const commitsForFileGrouping = afterSprint.map(u => u.commit);
  const { groups: fileGroups, ungrouped: finalUngroupedCommits } = groupByFileOverlap(
    commitsForFileGrouping,
    overlapThreshold
  );
  allGroups.push(...fileGroups);

  // Convert final ungrouped back to the expected format
  const finalUngrouped = finalUngroupedCommits.map(commit => {
    // Find the original issues for this commit
    const original = afterSprint.find(u => u.commit.hash === commit.hash);
    return { commit, issues: original?.issues || [] };
  });

  return { groups: allGroups, ungroupedCommits: finalUngrouped };
}
