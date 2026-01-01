/**
 * Config Service
 *
 * Stores user configuration (credentials, preferences) in a JSON file.
 * Location: ~/.commitkit-desktop/config.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SavedRepo {
  path: string;
  name: string;  // Display name (usually folder name)
  addedAt: string;
}

export interface AppConfig {
  repositories?: SavedRepo[];
  github?: {
    token: string;
  };
  jira?: {
    baseUrl: string;
    email: string;
    apiToken: string;
    sprintField?: string;
    storyPointsField?: string;
  };
  ollama?: {
    host: string;
    model: string;
  };
}

const CONFIG_DIR = path.join(os.homedir(), '.commitkit-desktop');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function getConfig(): AppConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return {};
    }
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export function saveConfig(config: AppConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function updateConfig(partial: Partial<AppConfig>): AppConfig {
  const current = getConfig();
  const updated = { ...current, ...partial };
  saveConfig(updated);
  return updated;
}

export function clearConfig(): void {
  if (fs.existsSync(CONFIG_FILE)) {
    fs.unlinkSync(CONFIG_FILE);
  }
}

// Repository management helpers
export function getSavedRepos(): SavedRepo[] {
  return getConfig().repositories || [];
}

export function addRepo(repoPath: string): SavedRepo {
  const config = getConfig();
  const repos = config.repositories || [];

  // Check if already exists
  const existing = repos.find(r => r.path === repoPath);
  if (existing) return existing;

  const newRepo: SavedRepo = {
    path: repoPath,
    name: path.basename(repoPath),
    addedAt: new Date().toISOString(),
  };

  repos.push(newRepo);
  saveConfig({ ...config, repositories: repos });
  return newRepo;
}

export function removeRepo(repoPath: string): void {
  const config = getConfig();
  const repos = config.repositories || [];
  const filtered = repos.filter(r => r.path !== repoPath);
  saveConfig({ ...config, repositories: filtered });
}
