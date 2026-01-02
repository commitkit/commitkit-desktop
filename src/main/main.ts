/**
 * CommitKit Desktop - Main Process
 *
 * Electron main process entry point.
 */

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { GitPlugin } from '../integrations/git';
import { GitHubPlugin } from '../integrations/github';
import { JiraPlugin } from '../integrations/jira';
import { OllamaProvider } from '../services/ollama';
import { getConfig, updateConfig, AppConfig, getSavedRepos, addRepo, removeRepo, updateRepoSettings, getRepoSettings } from '../services/config';
import { Commit, EnrichmentContext, JiraIssue, GitHubPR } from '../types';
import { groupCommitsMultiSignal } from '../utils/grouping';

// Set app name for macOS menu bar
app.setName('CommitKit');

let mainWindow: BrowserWindow | null = null;

// Cache for loaded commits
const commitCache: Map<string, Commit[]> = new Map();

/**
 * Enrich a commit with GitHub and JIRA data based on config
 */
async function enrichCommit(commit: Commit): Promise<EnrichmentContext> {
  const config = getConfig();
  const enrichments: EnrichmentContext = {};

  // GitHub enrichment
  if (config.github?.token && commit.remoteUrl?.includes('github.com')) {
    try {
      const github = new GitHubPlugin(config.github.token);
      const data = await github.enrich(commit, {});
      if (data) {
        enrichments['github'] = data;
      }
    } catch (error) {
      console.error('GitHub enrichment error:', error);
    }
  }

  // JIRA enrichment
  if (config.jira?.baseUrl && config.jira?.email && config.jira?.apiToken) {
    try {
      const jira = new JiraPlugin({
        baseUrl: config.jira.baseUrl,
        email: config.jira.email,
        apiToken: config.jira.apiToken,
        sprintField: config.jira.sprintField,
        storyPointsField: config.jira.storyPointsField,
      });
      if (jira.isRelevant(commit, {})) {
        const data = await jira.enrich(commit, {});
        if (data) {
          enrichments['jira'] = data;
        }
      }
    } catch (error) {
      console.error('JIRA enrichment error:', error);
    }
  }

  return enrichments;
}

// JIRA ticket key regex
const JIRA_KEY_REGEX = /\b([A-Z][A-Z0-9]+-\d+)\b/gi;

/**
 * Extract all unique JIRA ticket keys from commits
 */
function extractAllJiraKeys(commits: Commit[]): string[] {
  const keys = new Set<string>();
  for (const commit of commits) {
    const matches = commit.message.match(JIRA_KEY_REGEX);
    if (matches) {
      matches.forEach(m => keys.add(m.toUpperCase()));
    }
  }
  return Array.from(keys);
}

/**
 * Enrich a commit using pre-fetched JIRA data (for bulk operations)
 */
function enrichCommitWithCache(
  commit: Commit,
  jiraCache: Map<string, import('../types').JiraIssue>
): EnrichmentContext {
  const enrichments: EnrichmentContext = {};

  // Check for JIRA tickets in commit message
  const matches = commit.message.match(JIRA_KEY_REGEX);
  if (matches && jiraCache.size > 0) {
    const issues: import('../types').JiraIssue[] = [];
    for (const match of matches) {
      const issue = jiraCache.get(match.toUpperCase());
      if (issue) {
        issues.push(issue);
      }
    }
    if (issues.length > 0) {
      enrichments['jira'] = {
        pluginId: 'jira',
        data: { issues },
      };
    }
  }

  return enrichments;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // For now, load a simple HTML file
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers

// Get saved repositories
ipcMain.handle('get-saved-repos', () => {
  return getSavedRepos();
});

// Add a new repository (browse and save)
ipcMain.handle('add-repository', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Git Repository',
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const selectedPath = result.filePaths[0];

  // Verify it's a git repo
  const isRepo = await GitPlugin.isGitRepo(selectedPath);
  if (!isRepo) {
    return { error: 'Selected folder is not a git repository' };
  }

  // Save to config and return
  const repo = addRepo(selectedPath);
  return repo;
});

// Remove a saved repository
ipcMain.handle('remove-repository', (_event, repoPath: string) => {
  removeRepo(repoPath);
  return { success: true };
});

// Update repo settings (branch, author, maxCount)
ipcMain.handle('update-repo-settings', (_event, repoPath: string, settings: { branch?: string; author?: string; maxCount?: string }) => {
  const updated = updateRepoSettings(repoPath, settings);
  return updated ? { success: true, repo: updated } : { success: false, error: 'Repository not found' };
});

// Get repo settings
ipcMain.handle('get-repo-settings', (_event, repoPath: string) => {
  return getRepoSettings(repoPath);
});

// Select a repository folder (legacy - for backward compatibility)
ipcMain.handle('select-repository', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Git Repository',
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const selectedPath = result.filePaths[0];

  // Verify it's a git repo
  const isRepo = await GitPlugin.isGitRepo(selectedPath);
  if (!isRepo) {
    return { error: 'Selected folder is not a git repository' };
  }

  return selectedPath;
});

// Get authors from a repository
ipcMain.handle('get-authors', async (_event, repoPath: string, branch?: string) => {
  try {
    const git = new GitPlugin(repoPath, branch || 'main');
    return await git.getAuthors();
  } catch (error) {
    return { error: String(error) };
  }
});

// Load commits from a repository
ipcMain.handle('load-commits', async (_event, repoPath: string, options?: { maxCount?: number; branch?: string; author?: string }) => {
  try {
    const git = new GitPlugin(repoPath, options?.branch || 'main');
    const commits = await git.getCommits({
      maxCount: options?.maxCount,
      author: options?.author,
    });

    // Cache commits for later use
    commitCache.set(repoPath, commits);

    return commits.map(c => ({
      hash: c.hash,
      message: c.message,
      author: c.author,
      email: c.email,
      timestamp: c.timestamp.toISOString(),
    }));
  } catch (error) {
    return { error: String(error) };
  }
});

// Generate a single CV bullet
ipcMain.handle('generate-bullet', async (_event, commitHash: string, repoPath: string) => {
  try {
    const commits = commitCache.get(repoPath);
    const commit = commits?.find(c => c.hash === commitHash);

    if (!commit) {
      return { error: 'Commit not found' };
    }

    const config = getConfig();
    const ollama = new OllamaProvider({
      host: config.ollama?.host,
      model: config.ollama?.model,
    });

    // Enrich commit with GitHub/JIRA data
    const enrichments = await enrichCommit(commit);

    const bullet = await ollama.generateCVBullet(commit, enrichments);

    return {
      text: bullet.text,
      commitHash: commit.hash,
      generatedAt: bullet.generatedAt.toISOString(),
      hasGitHub: !!enrichments['github'],
      hasJira: !!enrichments['jira'],
    };
  } catch (error) {
    return { error: String(error) };
  }
});

// Generate bullets for multiple commits
ipcMain.handle('generate-bullets', async (_event, commitHashes: string[], repoPath: string) => {
  try {
    const allCommits = commitCache.get(repoPath);
    if (!allCommits) {
      return { error: 'Repository not loaded' };
    }

    // Get selected commits
    const selectedCommits = commitHashes
      .map(hash => allCommits.find(c => c.hash === hash))
      .filter((c): c is Commit => c !== undefined);

    const config = getConfig();
    const ollama = new OllamaProvider({
      host: config.ollama?.host,
      model: config.ollama?.model,
    });

    // Ensure model is available, pull if needed
    const modelReady = await ollama.ensureModelAvailable((status, completed, total) => {
      if (mainWindow) {
        // Calculate download percentage for the current layer
        const percent = (completed && total) ? Math.round((completed / total) * 100) : 0;
        const sizeInfo = (completed && total)
          ? ` (${Math.round(completed / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB)`
          : '';
        mainWindow.webContents.send('generation-progress', {
          current: percent,
          total: 100,
          message: `Downloading model: ${status}${sizeInfo}`,
        });
      }
    });

    if (!modelReady) {
      return { error: `Model ${config.ollama?.model || 'qwen2.5:14b'} could not be downloaded. Please run: ollama pull ${config.ollama?.model || 'qwen2.5:14b'}` };
    }

    // Bulk fetch JIRA issues (one API call for all tickets)
    let jiraCache = new Map<string, import('../types').JiraIssue>();
    console.log('[JIRA] Config check:', {
      hasBaseUrl: !!config.jira?.baseUrl,
      hasEmail: !!config.jira?.email,
      hasToken: !!config.jira?.apiToken,
    });
    if (config.jira?.baseUrl && config.jira?.email && config.jira?.apiToken) {
      const jiraKeys = extractAllJiraKeys(selectedCommits);
      console.log('[JIRA] Found ticket keys:', jiraKeys);
      if (jiraKeys.length > 0) {
        if (mainWindow) {
          mainWindow.webContents.send('generation-progress', {
            current: 0,
            total: commitHashes.length,
            message: `Fetching ${jiraKeys.length} JIRA tickets...`,
          });
        }
        const jira = new JiraPlugin({
          baseUrl: config.jira.baseUrl,
          email: config.jira.email,
          apiToken: config.jira.apiToken,
          sprintField: config.jira.sprintField,
          storyPointsField: config.jira.storyPointsField,
        });
        jiraCache = await jira.getIssuesBulk(jiraKeys);
        console.log('[JIRA] Fetched issues:', jiraCache.size);
      }
    } else {
      console.log('[JIRA] Skipping - missing config');
    }

    const results: Array<{ text: string; commitHash: string; generatedAt: string; hasGitHub?: boolean; hasJira?: boolean }> = [];

    for (let i = 0; i < selectedCommits.length; i++) {
      const commit = selectedCommits[i];

      // Send progress update
      if (mainWindow) {
        mainWindow.webContents.send('generation-progress', {
          current: i + 1,
          total: selectedCommits.length,
          message: `Generating bullet ${i + 1} of ${selectedCommits.length}...`,
        });
      }

      // Enrich commit with cached JIRA data (no API calls)
      const enrichments = enrichCommitWithCache(commit, jiraCache);
      const hasJira = !!enrichments['jira'];
      console.log('[JIRA] Commit enrichment:', {
        hash: commit.hash.substring(0, 7),
        message: commit.message.substring(0, 50),
        hasJira,
        issueCount: hasJira ? (enrichments['jira']?.data as { issues: unknown[] }).issues.length : 0,
      });
      const bullet = await ollama.generateCVBullet(commit, enrichments);

      results.push({
        text: bullet.text,
        commitHash: commit.hash,
        generatedAt: bullet.generatedAt.toISOString(),
        hasGitHub: false, // TODO: Add bulk GitHub fetching
        hasJira,
      });
    }

    return results;
  } catch (error) {
    return { error: String(error) };
  }
});

// Generate grouped bullets (consolidated by epic/project)
ipcMain.handle('generate-grouped-bullets', async (_event, commitHashes: string[], repoPath: string, groupOverrides?: Record<string, string | null>) => {
  try {
    const allCommits = commitCache.get(repoPath);
    if (!allCommits) {
      return { error: 'Repository not loaded' };
    }

    // Get selected commits
    const selectedCommits = commitHashes
      .map(hash => allCommits.find(c => c.hash === hash))
      .filter((c): c is Commit => c !== undefined);

    const config = getConfig();
    const ollama = new OllamaProvider({
      host: config.ollama?.host,
      model: config.ollama?.model,
    });

    // Ensure model is available
    const modelReady = await ollama.ensureModelAvailable((status, completed, total) => {
      if (mainWindow) {
        const percent = (completed && total) ? Math.round((completed / total) * 100) : 0;
        const sizeInfo = (completed && total)
          ? ` (${Math.round(completed / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB)`
          : '';
        mainWindow.webContents.send('generation-progress', {
          current: percent,
          total: 100,
          message: `Downloading model: ${status}${sizeInfo}`,
        });
      }
    });

    if (!modelReady) {
      return { error: `Model ${config.ollama?.model || 'qwen2.5:14b'} could not be downloaded.` };
    }

    // Bulk fetch JIRA issues
    let jiraCache = new Map<string, JiraIssue>();
    if (config.jira?.baseUrl && config.jira?.email && config.jira?.apiToken) {
      const jiraKeys = extractAllJiraKeys(selectedCommits);
      if (jiraKeys.length > 0) {
        if (mainWindow) {
          mainWindow.webContents.send('generation-progress', {
            current: 0,
            total: 100,
            message: `Fetching ${jiraKeys.length} JIRA tickets...`,
          });
        }
        const jira = new JiraPlugin({
          baseUrl: config.jira.baseUrl,
          email: config.jira.email,
          apiToken: config.jira.apiToken,
          sprintField: config.jira.sprintField,
          storyPointsField: config.jira.storyPointsField,
        });
        jiraCache = await jira.getIssuesBulk(jiraKeys);
        console.log('[GROUPED] Fetched JIRA issues:', jiraCache.size);
      }
    }

    // Bulk fetch GitHub PRs (if configured)
    let prCache = new Map<string, GitHubPR>();
    if (config.github?.token && selectedCommits[0]?.remoteUrl?.includes('github.com')) {
      if (mainWindow) {
        mainWindow.webContents.send('generation-progress', {
          current: 0,
          total: 100,
          message: 'Fetching GitHub PRs...',
        });
      }
      const github = new GitHubPlugin(config.github.token);
      const repoInfo = github.parseRepoFromUrl(selectedCommits[0].remoteUrl);
      if (repoInfo) {
        prCache = await github.getPRsForCommits(
          repoInfo.owner,
          repoInfo.repo,
          selectedCommits.map(c => c.hash)
        );
        console.log('[GROUPED] Fetched GitHub PRs:', prCache.size);
      }
    }

    // Fetch file changes for commits (needed for file overlap grouping)
    if (mainWindow) {
      mainWindow.webContents.send('generation-progress', {
        current: 0,
        total: 100,
        message: 'Analyzing file changes...',
      });
    }
    const git = new GitPlugin(repoPath);
    for (const commit of selectedCommits) {
      if (!commit.filesChanged) {
        commit.filesChanged = await git.getFilesChanged(commit.hash);
      }
    }

    // Group commits using multi-signal approach: PR → Epic → Sprint+Time → File Overlap
    const { groups, ungroupedCommits } = groupCommitsMultiSignal(
      selectedCommits,
      jiraCache,
      prCache,
      { timeWindowDays: 7, overlapThreshold: 0.5 }
    );
    console.log('[GROUPED] Created groups:', groups.map(g => ({
      key: g.groupKey,
      type: g.groupType,
      name: g.groupName,
      commits: g.commits.length,
      issues: g.jiraIssues.length,
    })));
    console.log('[GROUPED] Ungrouped commits:', ungroupedCommits.length);

    const totalItems = groups.length + ungroupedCommits.length;

    // Generate a bullet for each group
    const results: Array<{
      groupKey: string;
      groupName: string;
      groupType: string;
      commitCount: number;
      issueCount: number;
      text: string;
      generatedAt: string;
      commits: Array<{ hash: string; message: string }>;
      labels: string[];
      sprint?: string;
    }> = [];

    // Generate grouped bullets for epic-based groups
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];

      if (mainWindow) {
        mainWindow.webContents.send('generation-progress', {
          current: i + 1,
          total: totalItems,
          message: `Generating bullet for "${group.groupName}" (${group.commits.length} commits)...`,
        });
      }

      const bullet = await ollama.generateGroupedBullet(group);

      results.push({
        groupKey: group.groupKey,
        groupName: group.groupName,
        groupType: group.groupType,
        commitCount: group.commits.length,
        issueCount: group.jiraIssues.length,
        text: bullet.text,
        generatedAt: bullet.generatedAt.toISOString(),
        commits: group.commits.map(c => ({ hash: c.hash, message: c.message.split('\n')[0] })),
        labels: group.labels,
        sprint: group.sprint,
      });
    }

    // Generate individual bullets for ungrouped commits
    for (let i = 0; i < ungroupedCommits.length; i++) {
      const { commit, issues } = ungroupedCommits[i];

      if (mainWindow) {
        mainWindow.webContents.send('generation-progress', {
          current: groups.length + i + 1,
          total: totalItems,
          message: `Generating bullet ${groups.length + i + 1} of ${totalItems}...`,
        });
      }

      // Build enrichment context from cached issues
      const enrichments: EnrichmentContext = {};
      if (issues.length > 0) {
        enrichments['jira'] = {
          pluginId: 'jira',
          data: { issues },
        };
      }

      const bullet = await ollama.generateCVBullet(commit, enrichments);

      // Add as individual "group" with single commit
      const ticketKey = issues[0]?.key || commit.hash.substring(0, 7);
      const ticketSummary = issues[0]?.summary || commit.message.split('\n')[0];
      results.push({
        groupKey: ticketKey,
        groupName: ticketSummary.substring(0, 60) + (ticketSummary.length > 60 ? '...' : ''),
        groupType: 'individual',
        commitCount: 1,
        issueCount: issues.length,
        text: bullet.text,
        generatedAt: bullet.generatedAt.toISOString(),
        commits: [{ hash: commit.hash, message: commit.message.split('\n')[0] }],
        labels: issues.flatMap(i => i.labels || []),
        sprint: issues[0]?.sprint,
      });
    }

    return results;
  } catch (error) {
    return { error: String(error) };
  }
});

// Check Ollama connection status
ipcMain.handle('check-ollama-status', async () => {
  try {
    const config = getConfig();
    const ollama = new OllamaProvider({
      host: config.ollama?.host,
      model: config.ollama?.model,
    });
    const status = await ollama.testConnection();

    if (status.success) {
      const hasModel = await ollama.isModelAvailable();
      return {
        connected: true,
        model: config.ollama?.model || 'qwen2.5:14b',
        modelAvailable: hasModel,
      };
    }

    return { connected: false, error: status.error };
  } catch (error) {
    return { connected: false, error: String(error) };
  }
});

// Get available Ollama models (installed + recommended)
ipcMain.handle('get-ollama-models', async () => {
  try {
    const config = getConfig();
    const ollama = new OllamaProvider({
      host: config.ollama?.host,
    });

    const installed = await ollama.getInstalledModels();
    const recommended = OllamaProvider.getRecommendedModels();
    const currentModel = config.ollama?.model || 'qwen2.5:14b';

    // Build list: installed models first, then recommended ones not yet installed
    const installedSet = new Set(installed.map(m => m.split(':')[0])); // normalize names
    const availableRecommended = recommended.filter(r => {
      const baseName = r.name.split(':')[0];
      return !installedSet.has(baseName);
    });

    return {
      installed,
      recommended: availableRecommended,
      current: currentModel,
    };
  } catch (error) {
    return { installed: [], recommended: OllamaProvider.getRecommendedModels(), current: 'qwen2.5:14b', error: String(error) };
  }
});

// Get current config (includes credentials for settings form)
ipcMain.handle('get-config', () => {
  const config = getConfig();
  return {
    github: config.github,
    jira: config.jira,
    ollama: config.ollama,
  };
});

// Save config
ipcMain.handle('save-config', (_event, newConfig: Partial<AppConfig>) => {
  try {
    updateConfig(newConfig);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Test GitHub connection
ipcMain.handle('test-github', async (_event, token: string) => {
  console.log('[DEBUG] test-github received token:', token ? `${token.substring(0, 10)}...` : 'EMPTY');
  try {
    const github = new GitHubPlugin(token);
    return await github.testConnection();
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Test JIRA connection
ipcMain.handle('test-jira', async (_event, config: { baseUrl: string; email: string; apiToken: string }) => {
  try {
    const jira = new JiraPlugin(config);
    return await jira.testConnection();
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Tag commits for visualization
ipcMain.handle('tag-commits', async (_event, commitHashes: string[], repoPath: string) => {
  try {
    const allCommits = commitCache.get(repoPath);
    if (!allCommits) {
      return { error: 'Repository not loaded' };
    }

    // Get selected commits
    const selectedCommits = commitHashes
      .map(hash => allCommits.find(c => c.hash === hash))
      .filter((c): c is Commit => c !== undefined);

    const config = getConfig();
    const ollama = new OllamaProvider({
      host: config.ollama?.host,
      model: config.ollama?.model,
    });

    // Ensure model is available
    const modelReady = await ollama.ensureModelAvailable();
    if (!modelReady) {
      return { error: `Model ${config.ollama?.model || 'qwen2.5:14b'} not available` };
    }

    // Get file changes for each commit (for better tagging)
    const git = new GitPlugin(repoPath);
    const commitsWithFiles = await Promise.all(
      selectedCommits.map(async (commit) => ({
        hash: commit.hash,
        message: commit.message,
        filesChanged: await git.getFilesChanged(commit.hash),
      }))
    );

    // Tag commits with progress updates
    const taggedCommits = await ollama.assignTopicTags(commitsWithFiles, (completed, total) => {
      if (mainWindow) {
        mainWindow.webContents.send('tagging-progress', {
          current: completed,
          total: total,
          message: `Tagging commit ${completed} of ${total}...`,
        });
      }
    });

    return { taggedCommits };
  } catch (error) {
    return { error: String(error) };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
