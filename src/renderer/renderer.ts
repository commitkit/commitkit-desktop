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

interface GroupedBulletData {
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
}

interface ErrorResult {
  error: string;
}

type LoadCommitsResult = CommitData[] | ErrorResult;
type GenerateBulletResult = BulletData | ErrorResult;
type GenerateBulletsResult = BulletData[] | ErrorResult;
type GenerateGroupedBulletsResult = GroupedBulletData[] | ErrorResult;
type SelectRepoResult = string | null | ErrorResult;

// State
let currentRepoPath: string | null = null;
let commits: CommitData[] = [];
let selectedCommits: Set<string> = new Set();
let bullets: Map<string, BulletData> = new Map();
let groupedBullets: GroupedBulletData[] = [];
let isGroupedMode = false;

interface SavedRepo {
  path: string;
  name: string;
  addedAt: string;
}

// DOM Elements
const repoSelect = document.getElementById('repoSelect') as HTMLSelectElement;
const branchInput = document.getElementById('branchInput') as HTMLInputElement;
const authorSelect = document.getElementById('authorSelect') as HTMLSelectElement;
const maxCountSelect = document.getElementById('maxCountSelect') as HTMLSelectElement;
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
const ollamaModel = document.getElementById('ollamaModel') as HTMLSelectElement;

// Grouped mode elements
const groupedModeToggle = document.getElementById('groupedModeToggle') as HTMLInputElement;
const groupedBulletsContainer = document.getElementById('groupedBulletsContainer') as HTMLElement;

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
  maxCountSelect.addEventListener('change', onFiltersChanged);
  addRepoBtn.addEventListener('click', addRepository);
  addRepoBtn2.addEventListener('click', addRepository);
  selectAllBtn.addEventListener('click', toggleSelectAll);
  generateBtn.addEventListener('click', handleGenerateBullets);

  // Grouped mode toggle
  if (groupedModeToggle) {
    groupedModeToggle.addEventListener('change', () => {
      isGroupedMode = groupedModeToggle.checked;
      updateGenerateButtonText();
      // Clear existing results when switching modes
      if (isGroupedMode) {
        bullets.clear();
      } else {
        groupedBullets = [];
      }
      renderCommits();
      renderGroupedBullets();
    });
  }

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
  const maxCountValue = maxCountSelect.value;
  const maxCount = maxCountValue ? parseInt(maxCountValue, 10) : undefined;
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
  const selected = selectedCommits.size;
  const total = commits.length;
  selectionCount.textContent = `${total} loaded, ${selected} selected`;
  generateBtn.disabled = selected === 0;
  selectAllBtn.textContent = selected === total ? 'Deselect All' : 'Select All';
}

async function handleGenerateBullets() {
  if (isGroupedMode) {
    await generateGroupedBulletsAction();
  } else {
    await generateBullets();
  }
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

async function generateGroupedBulletsAction() {
  if (!currentRepoPath || selectedCommits.size === 0) return;

  generateBtn.disabled = true;
  progressContainer.classList.remove('hidden');
  progressFill.style.width = '0%';

  const hashes = Array.from(selectedCommits);
  const results = await window.commitkit.generateGroupedBullets(hashes, currentRepoPath) as GenerateGroupedBulletsResult;

  if (Array.isArray(results)) {
    groupedBullets = results;
    renderGroupedBullets();
  } else if (isError(results)) {
    alert(`Error: ${results.error}`);
  }

  progressContainer.classList.add('hidden');
  generateBtn.disabled = false;
}

function updateGenerateButtonText() {
  if (isGroupedMode) {
    generateBtn.textContent = 'Generate Grouped Bullets';
  } else {
    generateBtn.textContent = 'Generate Bullets';
  }
}

function renderGroupedBullets() {
  if (!groupedBulletsContainer) return;

  if (!isGroupedMode || groupedBullets.length === 0) {
    groupedBulletsContainer.classList.add('hidden');
    return;
  }

  groupedBulletsContainer.classList.remove('hidden');
  // Separate epic groups from individual bullets
  const epicGroups = groupedBullets.filter(g => g.groupType === 'epic');
  const individualBullets = groupedBullets.filter(g => g.groupType === 'individual');

  groupedBulletsContainer.innerHTML = `
    ${epicGroups.length > 0 ? `
      <h3 style="margin-bottom: 16px; color: #f0f0f0;">Feature Bullets (${epicGroups.length} epics)</h3>
      ${epicGroups.map((group, index) => `
        <div class="grouped-bullet-item" style="background: #2a2a2a; border-radius: 8px; padding: 16px; margin-bottom: 12px; border-left: 3px solid #8b5cf6;">
          <div class="group-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
            <div>
              <span class="group-name" style="font-weight: 600; color: #f0f0f0; font-size: 14px;">${escapeHtml(group.groupName)}</span>
              <span class="group-meta" style="color: #888; font-size: 12px; margin-left: 8px;">
                ${group.commitCount} commits · ${group.issueCount} tickets · Epic
              </span>
            </div>
            <div class="group-badges">
              ${group.sprint ? `<span class="badge" style="background: #3b82f6; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 4px;">${escapeHtml(group.sprint)}</span>` : ''}
              ${group.labels.slice(0, 3).map(label =>
                `<span class="badge" style="background: #6b7280; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 4px;">${escapeHtml(label)}</span>`
              ).join('')}
              ${group.labels.length > 3 ? `<span style="color: #888; font-size: 11px; margin-left: 4px;">+${group.labels.length - 3} more</span>` : ''}
            </div>
          </div>
          <div class="bullet-text" style="background: #1a1a1a; padding: 12px; border-radius: 6px; color: #10b981; font-size: 14px; line-height: 1.5; margin-bottom: 12px;">
            ${escapeHtml(group.text)}
          </div>
          <div class="bullet-actions" style="display: flex; gap: 8px;">
            <button data-copy-group="${index}" style="background: #3b82f6; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">Copy</button>
            <button data-toggle-group="${index}" class="secondary" style="background: #374151; color: #d1d5db; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">Show Commits (${group.commitCount})</button>
          </div>
          <div id="group-commits-${index}" class="group-commits hidden" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #374151;">
            ${group.commits.map(c => `
              <div style="font-size: 12px; color: #9ca3af; padding: 4px 0; display: flex;">
                <span style="font-family: monospace; color: #6b7280; min-width: 70px;">${c.hash.substring(0, 7)}</span>
                <span style="color: #d1d5db;">${escapeHtml(c.message.substring(0, 80))}${c.message.length > 80 ? '...' : ''}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    ` : ''}

    ${individualBullets.length > 0 ? `
      <h3 style="margin: 24px 0 16px 0; color: #f0f0f0;">Individual Bullets (${individualBullets.length} commits without epics)</h3>
      ${individualBullets.map((group, i) => {
        const index = epicGroups.length + i;
        return `
        <div class="grouped-bullet-item" style="background: #252525; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div style="flex: 1;">
              <span style="font-family: monospace; color: #6b7280; font-size: 12px;">${group.groupKey}</span>
              ${group.issueCount > 0 ? `<span style="color: #888; font-size: 12px; margin-left: 8px;">· ${group.issueCount} ticket${group.issueCount > 1 ? 's' : ''}</span>` : ''}
            </div>
            <button data-copy-group="${index}" style="background: #3b82f6; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;">Copy</button>
          </div>
          <div class="bullet-text" style="color: #10b981; font-size: 13px; line-height: 1.4;">
            ${escapeHtml(group.text)}
          </div>
        </div>
      `}).join('')}
    ` : ''}
  `;

  // Attach event listeners (CSP blocks inline onclick)
  groupedBulletsContainer.querySelectorAll('[data-copy-group]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const index = parseInt(btn.getAttribute('data-copy-group') || '0', 10);
      const group = groupedBullets[index];
      if (group) {
        await navigator.clipboard.writeText(group.text);
      }
    });
  });

  groupedBulletsContainer.querySelectorAll('[data-toggle-group]').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = btn.getAttribute('data-toggle-group');
      const el = document.getElementById(`group-commits-${index}`);
      if (el) {
        el.classList.toggle('hidden');
        // Update button text
        const isHidden = el.classList.contains('hidden');
        const group = groupedBullets[parseInt(index || '0', 10)];
        btn.textContent = isHidden ? `Show Commits (${group?.commitCount || 0})` : 'Hide Commits';
      }
    });
  });
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
async function openSettings() {
  settingsModal.classList.remove('hidden');
  // Clear status messages
  githubStatus.textContent = '';
  githubStatus.className = 'status-text';
  jiraStatus.textContent = '';
  jiraStatus.className = 'status-text';

  // Load saved config into form fields
  const config = await window.commitkit.getConfig();
  if (config.github?.token) {
    githubToken.value = config.github.token;
  }
  if (config.jira) {
    jiraBaseUrl.value = config.jira.baseUrl || '';
    jiraEmail.value = config.jira.email || '';
    jiraApiToken.value = config.jira.apiToken || '';
  }

  // Load available models
  await loadOllamaModels();
}

async function loadOllamaModels() {
  ollamaModel.innerHTML = '<option value="">Loading models...</option>';

  const result = await window.commitkit.getOllamaModels();

  ollamaModel.innerHTML = '';

  // Add installed models group
  if (result.installed.length > 0) {
    const installedGroup = document.createElement('optgroup');
    installedGroup.label = 'Installed';
    result.installed.forEach((model: string) => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      if (model === result.current || model.startsWith(result.current)) {
        option.selected = true;
      }
      installedGroup.appendChild(option);
    });
    ollamaModel.appendChild(installedGroup);
  }

  // Add recommended models group (not yet installed)
  if (result.recommended.length > 0) {
    const recommendedGroup = document.createElement('optgroup');
    recommendedGroup.label = 'Available to Download';
    result.recommended.forEach((model: { name: string; description: string }) => {
      const option = document.createElement('option');
      option.value = model.name;
      option.textContent = `${model.name} - ${model.description}`;
      if (model.name === result.current) {
        option.selected = true;
      }
      recommendedGroup.appendChild(option);
    });
    ollamaModel.appendChild(recommendedGroup);
  }

  // If no models at all, show a message
  if (result.installed.length === 0 && result.recommended.length === 0) {
    const option = document.createElement('option');
    option.value = 'qwen2.5:14b';
    option.textContent = 'qwen2.5:14b (will download on first use)';
    ollamaModel.appendChild(option);
  }
}

function closeSettings() {
  settingsModal.classList.add('hidden');
}

async function saveSettings() {
  const config: Record<string, unknown> = {};

  // Ollama config
  if (ollamaModel.value) {
    config.ollama = { model: ollamaModel.value };
  }

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
    // Refresh Ollama status to show new model
    await checkOllamaStatus();
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
