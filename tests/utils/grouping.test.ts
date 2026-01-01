/**
 * Commit Grouping Tests
 */

import { extractJiraKeys, groupCommitsByFeature } from '../../src/utils/grouping';
import { Commit, JiraIssue } from '../../src/types';

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
