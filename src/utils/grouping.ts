/**
 * Commit Grouping Utilities
 *
 * Pure functions for grouping commits by feature/epic.
 * Extracted from main.ts for testability.
 */

import { Commit, JiraIssue, CommitGroup } from '../types';

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
 */
export function groupCommitsByFeature(
  commits: Commit[],
  jiraCache: Map<string, JiraIssue>
): { groups: CommitGroup[]; ungroupedCommits: Array<{ commit: Commit; issues: JiraIssue[] }> } {
  const groups = new Map<string, CommitGroup>();
  const ungroupedCommits: Array<{ commit: Commit; issues: JiraIssue[] }> = [];

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
