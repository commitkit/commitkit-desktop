/**
 * Commit Grouping Tests
 */

import {
  extractJiraKeys,
  groupCommitsByFeature,
  groupByPR,
  groupBySprintAndTime,
  calculateFileOverlap,
  groupByFileOverlap,
  groupCommitsMultiSignal,
} from '../../src/utils/grouping';
import { Commit, JiraIssue, GitHubPR } from '../../src/types';

describe('extractJiraKeys', () => {
  it('should extract single JIRA key', () => {
    expect(extractJiraKeys('ES1-1234: Fix bug')).toEqual(['ES1-1234']);
  });

  it('should extract multiple JIRA keys', () => {
    expect(extractJiraKeys('ES1-1234, ES1-5678: Batch fix')).toEqual(['ES1-1234', 'ES1-5678']);
  });

  it('should uppercase keys', () => {
    expect(extractJiraKeys('es1-1234: lowercase')).toEqual(['ES1-1234']);
  });

  it('should deduplicate keys', () => {
    expect(extractJiraKeys('ES1-1234 relates to ES1-1234')).toEqual(['ES1-1234']);
  });

  it('should return empty array for no matches', () => {
    expect(extractJiraKeys('No ticket reference here')).toEqual([]);
  });
});

describe('groupCommitsByFeature', () => {
  const createCommit = (hash: string, message: string): Commit => ({
    hash,
    message,
    author: 'Test Author',
    email: 'test@test.com',
    timestamp: new Date(),
  });

  const createIssue = (key: string, epicKey?: string, epicName?: string, labels: string[] = []): JiraIssue => ({
    key,
    summary: `Summary for ${key}`,
    issueType: 'Story',
    status: 'Done',
    epicKey,
    epicName,
    labels,
  });

  it('should group commits by epic', () => {
    const commits = [
      createCommit('abc1', 'ES1-100: First feature commit'),
      createCommit('abc2', 'ES1-101: Second feature commit'),
      createCommit('abc3', 'ES1-200: Different feature'),
    ];

    const jiraCache = new Map<string, JiraIssue>([
      ['ES1-100', createIssue('ES1-100', 'EPIC-1', 'Feature A')],
      ['ES1-101', createIssue('ES1-101', 'EPIC-1', 'Feature A')],
      ['ES1-200', createIssue('ES1-200', 'EPIC-2', 'Feature B')],
    ]);

    const result = groupCommitsByFeature(commits, jiraCache);

    expect(result.groups).toHaveLength(2);
    expect(result.ungroupedCommits).toHaveLength(0);

    const featureA = result.groups.find(g => g.groupKey === 'EPIC-1');
    expect(featureA?.commits).toHaveLength(2);
    expect(featureA?.groupName).toBe('Feature A');
    expect(featureA?.groupType).toBe('epic');

    const featureB = result.groups.find(g => g.groupKey === 'EPIC-2');
    expect(featureB?.commits).toHaveLength(1);
  });

  it('should put commits without epics in ungroupedCommits', () => {
    const commits = [
      createCommit('abc1', 'ES1-100: Has epic'),
      createCommit('abc2', 'ES1-200: No epic'),
      createCommit('abc3', 'No ticket at all'),
    ];

    const jiraCache = new Map<string, JiraIssue>([
      ['ES1-100', createIssue('ES1-100', 'EPIC-1', 'Feature A')],
      ['ES1-200', createIssue('ES1-200')], // No epic
    ]);

    const result = groupCommitsByFeature(commits, jiraCache);

    expect(result.groups).toHaveLength(1);
    expect(result.ungroupedCommits).toHaveLength(2);

    // Check ungrouped commits have their issues attached
    const noEpicCommit = result.ungroupedCommits.find(
      u => u.commit.message.includes('ES1-200')
    );
    expect(noEpicCommit?.issues).toHaveLength(1);
    expect(noEpicCommit?.issues[0].key).toBe('ES1-200');
  });

  it('should deduplicate JIRA issues within a group', () => {
    const commits = [
      createCommit('abc1', 'ES1-100: First commit'),
      createCommit('abc2', 'ES1-100: Second commit same ticket'),
    ];

    const jiraCache = new Map<string, JiraIssue>([
      ['ES1-100', createIssue('ES1-100', 'EPIC-1', 'Feature A')],
    ]);

    const result = groupCommitsByFeature(commits, jiraCache);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].commits).toHaveLength(2);
    expect(result.groups[0].jiraIssues).toHaveLength(1);
  });

  it('should merge labels from all issues in a group', () => {
    const commits = [
      createCommit('abc1', 'ES1-100: First commit'),
      createCommit('abc2', 'ES1-101: Second commit'),
    ];

    const jiraCache = new Map<string, JiraIssue>([
      ['ES1-100', createIssue('ES1-100', 'EPIC-1', 'Feature A', ['label1', 'label2'])],
      ['ES1-101', createIssue('ES1-101', 'EPIC-1', 'Feature A', ['label2', 'label3'])],
    ]);

    const result = groupCommitsByFeature(commits, jiraCache);

    expect(result.groups[0].labels).toEqual(['label1', 'label2', 'label3']);
  });

  it('should sort groups by commit count descending', () => {
    const commits = [
      createCommit('abc1', 'ES1-100: Small feature'),
      createCommit('abc2', 'ES1-200: Big feature 1'),
      createCommit('abc3', 'ES1-201: Big feature 2'),
      createCommit('abc4', 'ES1-202: Big feature 3'),
    ];

    const jiraCache = new Map<string, JiraIssue>([
      ['ES1-100', createIssue('ES1-100', 'EPIC-SMALL', 'Small Feature')],
      ['ES1-200', createIssue('ES1-200', 'EPIC-BIG', 'Big Feature')],
      ['ES1-201', createIssue('ES1-201', 'EPIC-BIG', 'Big Feature')],
      ['ES1-202', createIssue('ES1-202', 'EPIC-BIG', 'Big Feature')],
    ]);

    const result = groupCommitsByFeature(commits, jiraCache);

    expect(result.groups[0].groupKey).toBe('EPIC-BIG');
    expect(result.groups[0].commits).toHaveLength(3);
    expect(result.groups[1].groupKey).toBe('EPIC-SMALL');
    expect(result.groups[1].commits).toHaveLength(1);
  });

  it('should handle commits with multiple JIRA keys (uses first epic found)', () => {
    const commits = [
      createCommit('abc1', 'ES1-100, ES1-200: Multi-ticket commit'),
    ];

    const jiraCache = new Map<string, JiraIssue>([
      ['ES1-100', createIssue('ES1-100', 'EPIC-1', 'First Epic')],
      ['ES1-200', createIssue('ES1-200', 'EPIC-2', 'Second Epic')],
    ]);

    const result = groupCommitsByFeature(commits, jiraCache);

    // Should use first epic found (ES1-100's epic)
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].groupKey).toBe('EPIC-1');
    expect(result.groups[0].jiraIssues).toHaveLength(2);
  });

  it('should handle empty commits array', () => {
    const result = groupCommitsByFeature([], new Map());

    expect(result.groups).toHaveLength(0);
    expect(result.ungroupedCommits).toHaveLength(0);
  });

  it('should handle commits with JIRA keys not in cache', () => {
    const commits = [
      createCommit('abc1', 'ES1-999: Unknown ticket'),
    ];

    const jiraCache = new Map<string, JiraIssue>();

    const result = groupCommitsByFeature(commits, jiraCache);

    expect(result.groups).toHaveLength(0);
    expect(result.ungroupedCommits).toHaveLength(1);
    expect(result.ungroupedCommits[0].issues).toHaveLength(0);
  });

  it('should use epic key as group name if epicName is missing', () => {
    const commits = [
      createCommit('abc1', 'ES1-100: Commit'),
    ];

    const jiraCache = new Map<string, JiraIssue>([
      ['ES1-100', createIssue('ES1-100', 'EPIC-1', undefined)], // No epic name
    ]);

    const result = groupCommitsByFeature(commits, jiraCache);

    expect(result.groups[0].groupName).toBe('EPIC-1');
  });

  it('should set sprint from first issue in group', () => {
    const commits = [
      createCommit('abc1', 'ES1-100: Commit'),
    ];

    const issue = createIssue('ES1-100', 'EPIC-1', 'Feature');
    issue.sprint = 'Sprint 5';

    const jiraCache = new Map<string, JiraIssue>([
      ['ES1-100', issue],
    ]);

    const result = groupCommitsByFeature(commits, jiraCache);

    expect(result.groups[0].sprint).toBe('Sprint 5');
  });
});

describe('groupByPR', () => {
  const createCommit = (hash: string, message: string): Commit => ({
    hash,
    message,
    author: 'Test Author',
    email: 'test@test.com',
    timestamp: new Date(),
  });

  const createPR = (number: number, title: string, labels: string[] = []): GitHubPR => ({
    number,
    title,
    description: `Description for PR #${number}`,
    state: 'merged',
    labels,
  });

  it('should group commits by PR', () => {
    const commits = [
      createCommit('abc1', 'First commit'),
      createCommit('abc2', 'Second commit'),
      createCommit('abc3', 'Third commit'),
    ];

    const prCache = new Map<string, GitHubPR>([
      ['abc1', createPR(100, 'Feature PR')],
      ['abc2', createPR(100, 'Feature PR')],
      ['abc3', createPR(200, 'Another PR')],
    ]);

    const result = groupByPR(commits, prCache);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].groupKey).toBe('PR-100');
    expect(result.groups[0].commits).toHaveLength(2);
    expect(result.groups[0].groupType).toBe('pr');
    expect(result.ungrouped).toHaveLength(1); // Single-commit PRs go to ungrouped
  });

  it('should put commits without PRs in ungrouped', () => {
    const commits = [
      createCommit('abc1', 'With PR'),
      createCommit('abc2', 'Without PR'),
    ];

    const prCache = new Map<string, GitHubPR>([
      ['abc1', createPR(100, 'Feature PR')],
    ]);

    const result = groupByPR(commits, prCache);

    expect(result.groups).toHaveLength(0); // Single commit PR
    expect(result.ungrouped).toHaveLength(2);
  });

  it('should include labels from PR', () => {
    const commits = [
      createCommit('abc1', 'First'),
      createCommit('abc2', 'Second'),
    ];

    const prCache = new Map<string, GitHubPR>([
      ['abc1', createPR(100, 'Feature PR', ['feature', 'priority-high'])],
      ['abc2', createPR(100, 'Feature PR', ['feature', 'priority-high'])],
    ]);

    const result = groupByPR(commits, prCache);

    expect(result.groups[0].labels).toEqual(['feature', 'priority-high']);
  });

  it('should sort groups by commit count descending', () => {
    const commits = [
      createCommit('abc1', 'PR100-1'),
      createCommit('abc2', 'PR100-2'),
      createCommit('abc3', 'PR200-1'),
      createCommit('abc4', 'PR200-2'),
      createCommit('abc5', 'PR200-3'),
    ];

    const prCache = new Map<string, GitHubPR>([
      ['abc1', createPR(100, 'Small PR')],
      ['abc2', createPR(100, 'Small PR')],
      ['abc3', createPR(200, 'Big PR')],
      ['abc4', createPR(200, 'Big PR')],
      ['abc5', createPR(200, 'Big PR')],
    ]);

    const result = groupByPR(commits, prCache);

    expect(result.groups[0].groupKey).toBe('PR-200');
    expect(result.groups[1].groupKey).toBe('PR-100');
  });
});

describe('calculateFileOverlap', () => {
  it('should return 0 for no overlap', () => {
    expect(calculateFileOverlap(['a.ts', 'b.ts'], ['c.ts', 'd.ts'])).toBe(0);
  });

  it('should return 1 for complete overlap', () => {
    expect(calculateFileOverlap(['a.ts', 'b.ts'], ['a.ts', 'b.ts'])).toBe(1);
  });

  it('should return correct value for partial overlap', () => {
    // Jaccard: intersection / union = 1 / 3 = 0.333...
    const result = calculateFileOverlap(['a.ts', 'b.ts'], ['b.ts', 'c.ts']);
    expect(result).toBeCloseTo(0.333, 2);
  });

  it('should return 0 for empty arrays', () => {
    expect(calculateFileOverlap([], ['a.ts'])).toBe(0);
    expect(calculateFileOverlap(['a.ts'], [])).toBe(0);
    expect(calculateFileOverlap([], [])).toBe(0);
  });

  it('should handle single file overlap', () => {
    // Jaccard: 1 / 1 = 1
    expect(calculateFileOverlap(['a.ts'], ['a.ts'])).toBe(1);
  });
});

describe('groupBySprintAndTime', () => {
  const createCommitWithIssues = (
    hash: string,
    message: string,
    timestamp: Date,
    sprint?: string
  ): { commit: Commit; issues: JiraIssue[] } => ({
    commit: {
      hash,
      message,
      author: 'Test Author',
      email: 'test@test.com',
      timestamp,
    },
    issues: sprint
      ? [{ key: `JIRA-${hash}`, summary: message, issueType: 'Story', status: 'Done', sprint }]
      : [],
  });

  it('should group commits in same sprint within time window', () => {
    const baseDate = new Date('2024-01-15');
    const commits = [
      createCommitWithIssues('abc1', 'Commit 1', new Date(baseDate.getTime()), 'Sprint 1'),
      createCommitWithIssues('abc2', 'Commit 2', new Date(baseDate.getTime() + 2 * 24 * 60 * 60 * 1000), 'Sprint 1'), // 2 days later
      createCommitWithIssues('abc3', 'Commit 3', new Date(baseDate.getTime() + 4 * 24 * 60 * 60 * 1000), 'Sprint 1'), // 4 days later
    ];

    const result = groupBySprintAndTime(commits, 7);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].groupType).toBe('sprint');
    expect(result.groups[0].commits).toHaveLength(3);
  });

  it('should split commits outside time window', () => {
    const baseDate = new Date('2024-01-01');
    const commits = [
      createCommitWithIssues('abc1', 'Commit 1', new Date(baseDate.getTime()), 'Sprint 1'),
      createCommitWithIssues('abc2', 'Commit 2', new Date(baseDate.getTime() + 2 * 24 * 60 * 60 * 1000), 'Sprint 1'), // 2 days
      createCommitWithIssues('abc3', 'Commit 3', new Date(baseDate.getTime() + 20 * 24 * 60 * 60 * 1000), 'Sprint 1'), // 20 days later
    ];

    const result = groupBySprintAndTime(commits, 7);

    // First two should be grouped, third should be ungrouped (single in its cluster)
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].commits).toHaveLength(2);
    expect(result.ungrouped).toHaveLength(1);
  });

  it('should put commits without sprint in ungrouped', () => {
    const commits = [
      createCommitWithIssues('abc1', 'No sprint', new Date()),
    ];

    const result = groupBySprintAndTime(commits, 7);

    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(1);
  });

  it('should keep different sprints separate', () => {
    const baseDate = new Date('2024-01-15');
    const commits = [
      createCommitWithIssues('abc1', 'Commit 1', new Date(baseDate.getTime()), 'Sprint 1'),
      createCommitWithIssues('abc2', 'Commit 2', new Date(baseDate.getTime() + 1 * 24 * 60 * 60 * 1000), 'Sprint 1'),
      createCommitWithIssues('abc3', 'Commit 3', new Date(baseDate.getTime()), 'Sprint 2'),
      createCommitWithIssues('abc4', 'Commit 4', new Date(baseDate.getTime() + 1 * 24 * 60 * 60 * 1000), 'Sprint 2'),
    ];

    const result = groupBySprintAndTime(commits, 7);

    expect(result.groups).toHaveLength(2);
    expect(result.groups.find(g => g.sprint === 'Sprint 1')?.commits).toHaveLength(2);
    expect(result.groups.find(g => g.sprint === 'Sprint 2')?.commits).toHaveLength(2);
  });
});

describe('groupByFileOverlap', () => {
  const createCommitWithFiles = (hash: string, message: string, files: string[]): Commit => ({
    hash,
    message,
    author: 'Test Author',
    email: 'test@test.com',
    timestamp: new Date(),
    filesChanged: files,
  });

  it('should group commits with high file overlap', () => {
    const commits = [
      createCommitWithFiles('abc1', 'Commit 1', ['src/api/auth.ts', 'src/api/users.ts']),
      createCommitWithFiles('abc2', 'Commit 2', ['src/api/auth.ts', 'src/api/session.ts']),
      createCommitWithFiles('abc3', 'Commit 3', ['src/ui/button.tsx']),
    ];

    const result = groupByFileOverlap(commits, 0.3); // 30% threshold

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].commits).toHaveLength(2);
    expect(result.groups[0].groupType).toBe('file-overlap');
    expect(result.ungrouped).toHaveLength(1);
  });

  it('should not group commits with low file overlap', () => {
    const commits = [
      createCommitWithFiles('abc1', 'Commit 1', ['src/api/auth.ts']),
      createCommitWithFiles('abc2', 'Commit 2', ['src/ui/button.tsx']),
    ];

    const result = groupByFileOverlap(commits, 0.5);

    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(2);
  });

  it('should handle commits without files', () => {
    const commits = [
      createCommitWithFiles('abc1', 'Commit 1', []),
      createCommitWithFiles('abc2', 'Commit 2', []),
    ];

    const result = groupByFileOverlap(commits, 0.5);

    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(2);
  });

  it('should return empty for single commit', () => {
    const commits = [
      createCommitWithFiles('abc1', 'Commit 1', ['src/api/auth.ts']),
    ];

    const result = groupByFileOverlap(commits, 0.5);

    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(1);
  });

  it('should name group by common directory', () => {
    const commits = [
      createCommitWithFiles('abc1', 'Commit 1', ['src/api/auth.ts', 'src/api/users.ts']),
      createCommitWithFiles('abc2', 'Commit 2', ['src/api/auth.ts', 'src/api/session.ts']),
    ];

    const result = groupByFileOverlap(commits, 0.3);

    expect(result.groups[0].groupName).toContain('src/api');
  });
});

describe('groupCommitsMultiSignal', () => {
  const createCommit = (
    hash: string,
    message: string,
    files?: string[],
    timestamp?: Date
  ): Commit => ({
    hash,
    message,
    author: 'Test Author',
    email: 'test@test.com',
    timestamp: timestamp || new Date(),
    filesChanged: files,
  });

  const createIssue = (key: string, epicKey?: string, epicName?: string, sprint?: string): JiraIssue => ({
    key,
    summary: `Summary for ${key}`,
    issueType: 'Story',
    status: 'Done',
    epicKey,
    epicName,
    sprint,
  });

  const createPR = (number: number, title: string): GitHubPR => ({
    number,
    title,
    description: '',
    state: 'merged',
  });

  it('should prioritize PR grouping over epic grouping', () => {
    const commits = [
      createCommit('abc1', 'ES1-100: Feature commit 1'),
      createCommit('abc2', 'ES1-100: Feature commit 2'),
    ];

    const jiraCache = new Map<string, JiraIssue>([
      ['ES1-100', createIssue('ES1-100', 'EPIC-1', 'Epic Name')],
    ]);

    const prCache = new Map<string, GitHubPR>([
      ['abc1', createPR(100, 'Feature PR')],
      ['abc2', createPR(100, 'Feature PR')],
    ]);

    const result = groupCommitsMultiSignal(commits, jiraCache, prCache);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].groupType).toBe('pr');
  });

  it('should fall back to epic grouping when no PR', () => {
    const commits = [
      createCommit('abc1', 'ES1-100: Feature commit 1'),
      createCommit('abc2', 'ES1-100: Feature commit 2'),
    ];

    const jiraCache = new Map<string, JiraIssue>([
      ['ES1-100', createIssue('ES1-100', 'EPIC-1', 'Epic Name')],
    ]);

    const prCache = new Map<string, GitHubPR>();

    const result = groupCommitsMultiSignal(commits, jiraCache, prCache);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].groupType).toBe('epic');
  });

  it('should use sprint+time grouping for commits without epic', () => {
    const baseDate = new Date('2024-01-15');
    const commits = [
      createCommit('abc1', 'ES1-100: Commit 1', [], baseDate),
      createCommit('abc2', 'ES1-101: Commit 2', [], new Date(baseDate.getTime() + 2 * 24 * 60 * 60 * 1000)),
    ];

    const jiraCache = new Map<string, JiraIssue>([
      ['ES1-100', createIssue('ES1-100', undefined, undefined, 'Sprint 5')],
      ['ES1-101', createIssue('ES1-101', undefined, undefined, 'Sprint 5')],
    ]);

    const prCache = new Map<string, GitHubPR>();

    const result = groupCommitsMultiSignal(commits, jiraCache, prCache, { timeWindowDays: 7 });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].groupType).toBe('sprint');
  });

  it('should use file overlap for remaining commits', () => {
    const commits = [
      createCommit('abc1', 'Commit 1', ['src/api/auth.ts', 'src/api/users.ts']),
      createCommit('abc2', 'Commit 2', ['src/api/auth.ts', 'src/api/session.ts']),
    ];

    const jiraCache = new Map<string, JiraIssue>();
    const prCache = new Map<string, GitHubPR>();

    const result = groupCommitsMultiSignal(commits, jiraCache, prCache, { overlapThreshold: 0.3 });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].groupType).toBe('file-overlap');
  });

  it('should leave truly ungrouped commits as ungrouped', () => {
    const commits = [
      createCommit('abc1', 'Random commit 1', ['file1.ts']),
      createCommit('abc2', 'Random commit 2', ['file2.ts']),
    ];

    const jiraCache = new Map<string, JiraIssue>();
    const prCache = new Map<string, GitHubPR>();

    const result = groupCommitsMultiSignal(commits, jiraCache, prCache);

    expect(result.groups).toHaveLength(0);
    expect(result.ungroupedCommits).toHaveLength(2);
  });

  it('should handle empty commits array', () => {
    const result = groupCommitsMultiSignal([], new Map(), new Map());

    expect(result.groups).toHaveLength(0);
    expect(result.ungroupedCommits).toHaveLength(0);
  });
});
