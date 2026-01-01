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
import { getConfig, updateConfig, AppConfig, getSavedRepos, addRepo, removeRepo } from '../services/config';
import { Commit, EnrichmentContext } from '../types';

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
      maxCount: options?.maxCount || 50,
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
    const commits = commitCache.get(repoPath);
    if (!commits) {
      return { error: 'Repository not loaded' };
    }

    const config = getConfig();
    const ollama = new OllamaProvider({
      host: config.ollama?.host,
      model: config.ollama?.model,
    });

    // Ensure model is available, pull if needed
    const modelReady = await ollama.ensureModelAvailable((status) => {
      if (mainWindow) {
        mainWindow.webContents.send('generation-progress', {
          current: 0,
          total: commitHashes.length,
          message: status,
        });
      }
    });

    if (!modelReady) {
      return { error: `Model ${config.ollama?.model || 'qwen2.5:14b'} could not be downloaded. Please run: ollama pull ${config.ollama?.model || 'qwen2.5:14b'}` };
    }

    const results: Array<{ text: string; commitHash: string; generatedAt: string; hasGitHub?: boolean; hasJira?: boolean }> = [];

    for (let i = 0; i < commitHashes.length; i++) {
      const hash = commitHashes[i];
      const commit = commits.find(c => c.hash === hash);

      if (!commit) continue;

      // Send progress update
      if (mainWindow) {
        mainWindow.webContents.send('generation-progress', {
          current: i + 1,
          total: commitHashes.length,
          message: `Generating bullet ${i + 1} of ${commitHashes.length}...`,
        });
      }

      // Enrich commit with GitHub/JIRA data
      const enrichments = await enrichCommit(commit);
      const bullet = await ollama.generateCVBullet(commit, enrichments);

      results.push({
        text: bullet.text,
        commitHash: commit.hash,
        generatedAt: bullet.generatedAt.toISOString(),
        hasGitHub: !!enrichments['github'],
        hasJira: !!enrichments['jira'],
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

// Get current config
ipcMain.handle('get-config', () => {
  const config = getConfig();
  // Return config without sensitive fields for display
  return {
    github: config.github ? { configured: true } : undefined,
    jira: config.jira ? { configured: true, baseUrl: config.jira.baseUrl } : undefined,
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
