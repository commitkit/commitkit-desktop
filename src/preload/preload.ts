/**
 * Preload Script - Secure IPC Bridge
 *
 * Exposes safe API to renderer process via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('commitkit', {
  // Repository operations
  getSavedRepos: () => ipcRenderer.invoke('get-saved-repos'),
  addRepository: () => ipcRenderer.invoke('add-repository'),
  removeRepository: (repoPath: string) => ipcRenderer.invoke('remove-repository', repoPath),
  selectRepository: () => ipcRenderer.invoke('select-repository'),
  getAuthors: (repoPath: string, branch?: string) =>
    ipcRenderer.invoke('get-authors', repoPath, branch),
  loadCommits: (repoPath: string, options?: { maxCount?: number; branch?: string; author?: string }) =>
    ipcRenderer.invoke('load-commits', repoPath, options),

  // CV bullet generation
  generateBullet: (commitHash: string, repoPath: string) =>
    ipcRenderer.invoke('generate-bullet', commitHash, repoPath),
  generateBullets: (commitHashes: string[], repoPath: string) =>
    ipcRenderer.invoke('generate-bullets', commitHashes, repoPath),

  // Ollama status
  checkOllamaStatus: () => ipcRenderer.invoke('check-ollama-status'),
  getOllamaModels: () => ipcRenderer.invoke('get-ollama-models'),

  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('save-config', config),
  testGitHub: (token: string) => ipcRenderer.invoke('test-github', token),
  testJira: (config: { baseUrl: string; email: string; apiToken: string }) =>
    ipcRenderer.invoke('test-jira', config),

  // Events
  onProgress: (callback: (progress: { current: number; total: number; message: string }) => void) => {
    ipcRenderer.on('generation-progress', (_event, progress) => callback(progress));
  },
});

export interface SavedRepo {
  path: string;
  name: string;
  addedAt: string;
}

// TypeScript declaration for renderer
export interface CommitKitAPI {
  getSavedRepos: () => Promise<SavedRepo[]>;
  addRepository: () => Promise<SavedRepo | null | { error: string }>;
  removeRepository: (repoPath: string) => Promise<{ success: boolean }>;
  selectRepository: () => Promise<string | null>;
  getAuthors: (repoPath: string, branch?: string) => Promise<Array<{ name: string; email: string }>>;
  loadCommits: (repoPath: string, options?: { maxCount?: number; branch?: string; author?: string }) => Promise<CommitData[]>;
  generateBullet: (commitHash: string, repoPath: string) => Promise<BulletData>;
  generateBullets: (commitHashes: string[], repoPath: string) => Promise<BulletData[]>;
  checkOllamaStatus: () => Promise<{ connected: boolean; model?: string; error?: string }>;
  getOllamaModels: () => Promise<{ installed: string[]; recommended: Array<{ name: string; description: string }>; current: string; error?: string }>;
  getConfig: () => Promise<{ github?: { token: string }; jira?: { baseUrl: string; email: string; apiToken: string }; ollama?: { host?: string; model?: string } }>;
  saveConfig: (config: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  testGitHub: (token: string) => Promise<{ success: boolean; error?: string }>;
  testJira: (config: { baseUrl: string; email: string; apiToken: string }) => Promise<{ success: boolean; error?: string }>;
  onProgress: (callback: (progress: { current: number; total: number; message: string }) => void) => void;
}

export interface CommitData {
  hash: string;
  message: string;
  author: string;
  email: string;
  timestamp: string;
}

export interface BulletData {
  text: string;
  commitHash: string;
  generatedAt: string;
}

declare global {
  interface Window {
    commitkit: CommitKitAPI;
  }
}
