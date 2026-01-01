/**
 * CommitKit Renderer - UI Logic
 */

interface CommitData {
  hash: string;
  message: string;
  author: string;
  email: string;
  timestamp: string;
}

interface BulletData {
  text: string;
  commitHash: string;
  generatedAt: string;
  hasGitHub?: boolean;
  hasJira?: boolean;
}

interface ErrorResult {
  error: string;
}

type LoadCommitsResult = CommitData[] | ErrorResult;
type GenerateBulletResult = BulletData | ErrorResult;
type GenerateBulletsResult = BulletData[] | ErrorResult;
type SelectRepoResult = string | null | ErrorResult;

// State
let currentRepoPath: string | null = null;
let commits: CommitData[] = [];
let selectedCommits: Set<string> = new Set();
let bullets: Map<string, BulletData> = new Map();

interface SavedRepo {
  path: string;
  name: string;
  addedAt: string;
}

// DOM Elements
const repoSelect = document.getElementById('repoSelect') as HTMLSelectElement;
const branchInput = document.getElementById('branchInput') as HTMLInputElement;
const authorSelect = document.getElementById('authorSelect') as HTMLSelectElement;
const maxCountInput = document.getElementById('maxCountInput') as HTMLInputElement;
const addRepoBtn = document.getElementById('addRepoBtn') as HTMLButtonElement;
const addRepoBtn2 = document.getElementById('addRepoBtn2') as HTMLButtonElement;
const repoPath = document.getElementById('repoPath') as HTMLElement;
const emptyState = document.getElementById('emptyState') as HTMLElement;
const commitsSection = document.getElementById('commitsSection') as HTMLElement;
const commitsList = document.getElementById('commitsList') as HTMLElement;
const selectionCount = document.getElementById('selectionCount') as HTMLElement;
const selectAllBtn = document.getElementById('selectAllBtn') as HTMLButtonElement;
const generateBtn = document.getElementById('generateBtn') as HTMLButtonElement;
const progressContainer = document.getElementById('progressContainer') as HTMLElement;
const progressText = document.getElementById('progressText') as HTMLElement;
const progressFill = document.getElementById('progressFill') as HTMLElement;
const statusDot = document.getElementById('statusDot') as HTMLElement;
const statusText = document.getElementById('statusText') as HTMLElement;

// Settings modal elements
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
const settingsModal = document.getElementById('settingsModal') as HTMLElement;
const closeSettingsBtn = document.getElementById('closeSettingsBtn') as HTMLButtonElement;
const saveSettingsBtn = document.getElementById('saveSettingsBtn') as HTMLButtonElement;
const githubToken = document.getElementById('githubToken') as HTMLInputElement;
const testGithubBtn = document.getElementById('testGithubBtn') as HTMLButtonElement;
const githubStatus = document.getElementById('githubStatus') as HTMLElement;
const jiraBaseUrl = document.getElementById('jiraBaseUrl') as HTMLInputElement;
const jiraEmail = document.getElementById('jiraEmail') as HTMLInputElement;
const jiraApiToken = document.getElementById('jiraApiToken') as HTMLInputElement;
const testJiraBtn = document.getElementById('testJiraBtn') as HTMLButtonElement;
const jiraStatus = document.getElementById('jiraStatus') as HTMLElement;

// Initialize
async function init() {
  // Check Ollama status
  await checkOllamaStatus();

  // Load saved repos
  await loadSavedRepos();

  // Set up event listeners
  repoSelect.addEventListener('change', onRepoSelected);
  branchInput.addEventListener('change', onBranchChanged);
  authorSelect.addEventListener('change', onFiltersChanged);
  maxCountInput.addEventListener('change', onFiltersChanged);
  addRepoBtn.addEventListener('click', addRepository);
  addRepoBtn2.addEventListener('click', addRepository);
  selectAllBtn.addEventListener('click', toggleSelectAll);
  generateBtn.addEventListener('click', generateBullets);

  // Settings modal listeners
  settingsBtn.addEventListener('click', openSettings);
  closeSettingsBtn.addEventListener('click', closeSettings);
  saveSettingsBtn.addEventListener('click', saveSettings);
  testGithubBtn.addEventListener('click', testGitHubConnection);
  testJiraBtn.addEventListener('click', testJiraConnection);
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettings();
  });

  // Listen for progress updates
  window.commitkit.onProgress((progress) => {
    progressText.textContent = progress.message;
    progressFill.style.width = `${(progress.current / progress.total) * 100}%`;
  });
}

async function loadSavedRepos() {
  const repos = await window.commitkit.getSavedRepos();

  // Clear existing options except the placeholder
  repoSelect.innerHTML = '<option value="">-- Select saved repo --</option>';

  // Add saved repos
  repos.forEach((repo: SavedRepo) => {
    const option = document.createElement('option');
    option.value = repo.path;
    option.textContent = repo.name;
    repoSelect.appendChild(option);
  });
}

async function onRepoSelected() {
  const selectedPath = repoSelect.value;
  if (!selectedPath) return;

  currentRepoPath = selectedPath;
  repoPath.textContent = selectedPath;
  await loadAuthors();
  await loadCommits();
}

async function onBranchChanged() {
  if (!currentRepoPath) return;
  // Reload authors for new branch, then reload commits
  await loadAuthors();
  bullets.clear();
  selectedCommits.clear();
  await loadCommits();
}

async function onFiltersChanged() {
  if (!currentRepoPath) return;
  // Clear existing bullets and selection when filters change
  bullets.clear();
  selectedCommits.clear();
  await loadCommits();
}

async function loadAuthors() {
  if (!currentRepoPath) return;

  const branch = branchInput.value.trim() || 'main';
  const authors = await window.commitkit.getAuthors(currentRepoPath, branch);

  // Clear existing options except "All authors"
  authorSelect.innerHTML = '<option value="">All authors</option>';

  // Add author options
  if (Array.isArray(authors)) {
    authors.forEach((author: { name: string; email: string }) => {
      const option = document.createElement('option');
      option.value = author.email;
      option.textContent = author.name;
      authorSelect.appendChild(option);
    });
  }
}

async function addRepository() {
  const result = await window.commitkit.addRepository();

  if (!result) return;

  if ('error' in result) {
    alert(result.error);
    return;
  }

  // Reload the dropdown
  await loadSavedRepos();

  // Select the newly added repo
  repoSelect.value = result.path;
  currentRepoPath = result.path;
  repoPath.textContent = result.path;
  await loadCommits();
}

async function checkOllamaStatus() {
  try {
    const status = await window.commitkit.checkOllamaStatus();
    if (status.connected) {
      statusDot.classList.add('connected');
      statusText.textContent = `Ollama: ${status.model || 'connected'}`;
    } else {
      statusDot.classList.add('error');
      statusText.textContent = 'Ollama: not running';
    }
  } catch {
    statusDot.classList.add('error');
    statusText.textContent = 'Ollama: error';
  }
}

function isError(result: unknown): result is ErrorResult {
  return typeof result === 'object' && result !== null && 'error' in result;
}

async function loadCommits() {
  if (!currentRepoPath) return;

  commitsList.innerHTML = '<div class="loading"></div>';
  emptyState.classList.add('hidden');
  commitsSection.classList.remove('hidden');

  const branch = branchInput.value.trim() || 'main';
  const author = authorSelect.value || undefined;
  const maxCount = parseInt(maxCountInput.value, 10) || 50;
  const result = await window.commitkit.loadCommits(currentRepoPath, { maxCount, branch, author }) as LoadCommitsResult;

  if (Array.isArray(result)) {
    commits = result;
    renderCommits();
  } else if (isError(result)) {
    commitsList.innerHTML = `<p style="color: #ef4444;">Error: ${result.error}</p>`;
  }
}

function renderCommits() {
  commitsList.innerHTML = '';

  commits.forEach((commit) => {
    const bullet = bullets.get(commit.hash);
    const isSelected = selectedCommits.has(commit.hash);

    const div = document.createElement('div');
    div.className = 'commit-item';
    div.innerHTML = `
      <input type="checkbox" class="commit-checkbox" data-hash="${commit.hash}" ${isSelected ? 'checked' : ''}>
      <div class="commit-content">
        <div class="commit-message">${escapeHtml(commit.message)}</div>
        <div class="commit-meta">
          <span class="commit-hash">${commit.hash.substring(0, 7)}</span>
          <span>${commit.author}</span>
          <span>${formatDate(commit.timestamp)}</span>
        </div>
        ${bullet ? `
          <div class="bullet-section">
            <div class="bullet-text">${escapeHtml(bullet.text)}</div>
            <div class="enrichment-badges">
              ${bullet.hasGitHub ? '<span class="badge github">GitHub PR</span>' : ''}
              ${bullet.hasJira ? '<span class="badge jira">JIRA</span>' : ''}
              ${!bullet.hasGitHub && !bullet.hasJira ? '<span class="badge">Commit only</span>' : ''}
            </div>
            <div class="bullet-actions">
              <button onclick="copyBullet('${commit.hash}')">Copy</button>
              <button onclick="regenerateBullet('${commit.hash}')" class="secondary">Regenerate</button>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    const checkbox = div.querySelector('.commit-checkbox') as HTMLInputElement;
    checkbox.addEventListener('change', () => toggleCommit(commit.hash));

    commitsList.appendChild(div);
  });

  updateSelectionCount();
}

function toggleCommit(hash: string) {
  if (selectedCommits.has(hash)) {
    selectedCommits.delete(hash);
  } else {
    selectedCommits.add(hash);
  }
  updateSelectionCount();
}

function toggleSelectAll() {
  if (selectedCommits.size === commits.length) {
    selectedCommits.clear();
  } else {
    commits.forEach(c => selectedCommits.add(c.hash));
  }
  renderCommits();
}

function updateSelectionCount() {
  const count = selectedCommits.size;
  selectionCount.textContent = `${count} commit${count !== 1 ? 's' : ''} selected`;
  generateBtn.disabled = count === 0;
  selectAllBtn.textContent = selectedCommits.size === commits.length ? 'Deselect All' : 'Select All';
}

async function generateBullets() {
  if (!currentRepoPath || selectedCommits.size === 0) return;

  generateBtn.disabled = true;
  progressContainer.classList.remove('hidden');
  progressFill.style.width = '0%';

  const hashes = Array.from(selectedCommits);
  const results = await window.commitkit.generateBullets(hashes, currentRepoPath) as GenerateBulletsResult;

  if (Array.isArray(results)) {
    results.forEach((bullet) => {
      bullets.set(bullet.commitHash, bullet);
    });
    renderCommits();
  } else if (isError(results)) {
    alert(`Error: ${results.error}`);
  }

  progressContainer.classList.add('hidden');
  generateBtn.disabled = false;
}

// Global functions for button onclick handlers
(window as any).copyBullet = async (hash: string) => {
  const bullet = bullets.get(hash);
  if (bullet) {
    await navigator.clipboard.writeText(bullet.text);
  }
};

(window as any).regenerateBullet = async (hash: string) => {
  if (!currentRepoPath) return;

  const result = await window.commitkit.generateBullet(hash, currentRepoPath) as GenerateBulletResult;

  if ('text' in result) {
    bullets.set(hash, result as BulletData);
    renderCommits();
  } else if (isError(result)) {
    alert(`Error: ${result.error}`);
  }
};

// Utilities
function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Settings functions
function openSettings() {
  settingsModal.classList.remove('hidden');
  // Clear status messages
  githubStatus.textContent = '';
  githubStatus.className = 'status-text';
  jiraStatus.textContent = '';
  jiraStatus.className = 'status-text';
}

function closeSettings() {
  settingsModal.classList.add('hidden');
}

async function saveSettings() {
  const config: Record<string, unknown> = {};

  // GitHub config
  if (githubToken.value.trim()) {
    config.github = { token: githubToken.value.trim() };
  }

  // JIRA config
  if (jiraBaseUrl.value.trim() && jiraEmail.value.trim() && jiraApiToken.value.trim()) {
    config.jira = {
      baseUrl: jiraBaseUrl.value.trim(),
      email: jiraEmail.value.trim(),
      apiToken: jiraApiToken.value.trim(),
    };
  }

  const result = await window.commitkit.saveConfig(config);
  if (result.success) {
    closeSettings();
  } else {
    alert('Failed to save settings: ' + result.error);
  }
}

async function testGitHubConnection() {
  const token = githubToken.value.trim();
  if (!token) {
    githubStatus.textContent = 'Please enter a token';
    githubStatus.className = 'status-text error';
    return;
  }

  githubStatus.textContent = 'Testing...';
  githubStatus.className = 'status-text';

  const result = await window.commitkit.testGitHub(token);
  if (result.success) {
    githubStatus.textContent = 'Connected!';
    githubStatus.className = 'status-text success';
  } else {
    githubStatus.textContent = 'Failed: ' + (result.error || 'Unknown error');
    githubStatus.className = 'status-text error';
  }
}

async function testJiraConnection() {
  const baseUrl = jiraBaseUrl.value.trim();
  const email = jiraEmail.value.trim();
  const apiToken = jiraApiToken.value.trim();

  if (!baseUrl || !email || !apiToken) {
    jiraStatus.textContent = 'Please fill all fields';
    jiraStatus.className = 'status-text error';
    return;
  }

  jiraStatus.textContent = 'Testing...';
  jiraStatus.className = 'status-text';

  const result = await window.commitkit.testJira({ baseUrl, email, apiToken });
  if (result.success) {
    jiraStatus.textContent = 'Connected!';
    jiraStatus.className = 'status-text success';
  } else {
    jiraStatus.textContent = 'Failed: ' + (result.error || 'Unknown error');
    jiraStatus.className = 'status-text error';
  }
}

// Start
init();
