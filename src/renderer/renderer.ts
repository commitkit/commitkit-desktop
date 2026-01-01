/**
 * CommitKit Renderer - UI Logic
 */

// vis-network is loaded via script tag in index.html
// These types are declared for TypeScript
declare const vis: {
  Network: new (container: HTMLElement, data: { nodes: unknown; edges: unknown }, options: unknown) => {
    on: (event: string, callback: (params: { nodes: string[]; event: { srcEvent: { shiftKey: boolean } } }) => void) => void;
    destroy: () => void;
  };
  DataSet: new (data: unknown[]) => unknown;
};

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
  reasoning?: string;  // AI explanation for grouping (ai-suggested only)
  confidence?: number; // AI confidence score 0-1 (ai-suggested only)
}

interface ErrorResult {
  error: string;
}

interface TaggedCommit {
  hash: string;
  message: string;
  tags: string[];
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

// Group management state
let expandedCommits: Set<string> = new Set();
let commitGroupOverrides: Map<string, string | null> = new Map(); // commit hash -> group key (null = no group)
let availableGroups: Array<{ key: string; name: string }> = [];

// STAR card editing state
interface StarEdits {
  situation?: string;
  task?: string;
  action?: string;
  result?: string;
}
let bulletEditMode: Set<number> = new Set(); // indices of bullets in edit mode
let bulletEdits: Map<number, StarEdits> = new Map(); // index -> edited STAR values
let bulletContext: Map<number, string> = new Map(); // index -> user context notes
let expandedStarSections: Map<number, Set<string>> = new Map(); // index -> set of expanded sections (s/t/a/r)

// Graph visualization state
let currentView: 'list' | 'graph' = 'list';
let taggedCommits: TaggedCommit[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let graphNetwork: any = null;
let graphSelectedNodes: Set<string> = new Set();
let isTagging = false;

// Topic tag colors (matching the tag taxonomy)
const TAG_COLORS: Record<string, string> = {
  authentication: '#ef4444',
  api: '#3b82f6',
  ui: '#8b5cf6',
  database: '#f59e0b',
  testing: '#10b981',
  documentation: '#6366f1',
  config: '#64748b',
  deployment: '#0891b2',
  'ci-cd': '#0d9488',
  bugfix: '#dc2626',
  refactor: '#7c3aed',
  performance: '#059669',
  security: '#b91c1c',
  logging: '#475569',
  email: '#ec4899',
  payments: '#22c55e',
  other: '#6b7280',
};

interface SavedRepo {
  path: string;
  name: string;
  addedAt: string;
  branch?: string;
  author?: string;
  maxCount?: string;
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
const clusteringSensitivity = document.getElementById('clusteringSensitivity') as HTMLSelectElement;

// Grouped mode elements
const groupedModeToggle = document.getElementById('groupedModeToggle') as HTMLInputElement;
const groupedBulletsContainer = document.getElementById('groupedBulletsContainer') as HTMLElement;

// Bulk group action elements
const bulkGroupAction = document.getElementById('bulkGroupAction') as HTMLElement;
const bulkGroupSelect = document.getElementById('bulkGroupSelect') as HTMLSelectElement;
const bulkMoveBtn = document.getElementById('bulkMoveBtn') as HTMLButtonElement;

// Graph visualization elements
const graphContainer = document.getElementById('graphContainer') as HTMLElement;
const graphNetworkDiv = document.getElementById('graphNetwork') as HTMLElement;
const graphLegendItems = document.getElementById('graphLegendItems') as HTMLElement;
const graphInfo = document.getElementById('graphInfo') as HTMLElement;
const graphSelectionInfo = document.getElementById('graphSelectionInfo') as HTMLElement;
const graphSelectedCount = document.getElementById('graphSelectedCount') as HTMLElement;
const listViewContainer = document.getElementById('listViewContainer') as HTMLElement;
const viewToggleBtns = document.querySelectorAll('.view-toggle-btn');

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

  // Bulk move button
  if (bulkMoveBtn) {
    bulkMoveBtn.addEventListener('click', handleBulkMove);
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

  // Listen for tagging progress
  window.commitkit.onTaggingProgress((progress) => {
    if (graphInfo) {
      graphInfo.textContent = progress.message;
    }
  });

  // View toggle event listeners
  viewToggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view') as 'list' | 'graph';
      switchView(view);
    });
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

  // Load saved repo settings (branch, author, maxCount)
  const settings = await window.commitkit.getRepoSettings(selectedPath);
  if (settings) {
    if (settings.branch) {
      branchInput.value = settings.branch;
    } else {
      branchInput.value = 'main'; // Default
    }
    // Set saved limit (maxCount)
    if (settings.maxCount !== undefined) {
      maxCountSelect.value = settings.maxCount;
    }
  }

  await loadAuthors();

  // Set saved author filter after authors are loaded
  if (settings?.author) {
    authorSelect.value = settings.author;
  }

  await loadCommits();
}

async function onBranchChanged() {
  if (!currentRepoPath) return;

  // Save branch setting
  const branch = branchInput.value.trim() || 'main';
  await window.commitkit.updateRepoSettings(currentRepoPath, { branch });

  // Reload authors for new branch, then reload commits
  await loadAuthors();

  // Clear existing state
  bullets.clear();
  selectedCommits.clear();
  groupedBullets = [];
  availableGroups = [];
  commitGroupOverrides.clear();
  expandedCommits.clear();
  await loadCommits();
}

async function onFiltersChanged() {
  if (!currentRepoPath) return;

  // Save author and maxCount filter settings
  const author = authorSelect.value || undefined;
  const maxCount = maxCountSelect.value;
  await window.commitkit.updateRepoSettings(currentRepoPath, { author, maxCount });

  // Clear existing state when filters change
  bullets.clear();
  selectedCommits.clear();
  groupedBullets = [];
  availableGroups = [];
  commitGroupOverrides.clear();
  expandedCommits.clear();
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

function getCommitGroup(hash: string): { key: string; name: string } | null {
  // Check for user override first
  if (commitGroupOverrides.has(hash)) {
    const overrideKey = commitGroupOverrides.get(hash);
    if (overrideKey === null) return null; // Explicitly set to no group
    const group = availableGroups.find(g => g.key === overrideKey);
    if (group) return group;
  }

  // Find the auto-detected group from grouped bullets
  for (const gb of groupedBullets) {
    if (gb.groupType === 'epic' && gb.commits.some(c => c.hash === hash)) {
      return { key: gb.groupKey, name: gb.groupName };
    }
  }

  return null;
}

function renderCommits() {
  commitsList.innerHTML = '';

  commits.forEach((commit) => {
    const bullet = bullets.get(commit.hash);
    const isSelected = selectedCommits.has(commit.hash);
    const isExpanded = expandedCommits.has(commit.hash);
    const group = getCommitGroup(commit.hash);
    const hasGroupsAvailable = availableGroups.length > 0;

    const div = document.createElement('div');
    div.className = 'commit-item';
    div.innerHTML = `
      <input type="checkbox" class="commit-checkbox" data-hash="${commit.hash}" ${isSelected ? 'checked' : ''}>
      <div class="commit-content">
        <div class="commit-row-header" data-expand-hash="${commit.hash}">
          <span class="expand-chevron ${isExpanded ? 'expanded' : ''}">▶</span>
          <div class="commit-main">
            <div>
              <div class="commit-message">${escapeHtml(commit.message.split('\n')[0])}</div>
              <div class="commit-meta">
                <span class="commit-hash">${commit.hash.substring(0, 7)}</span>
                <span>${commit.author}</span>
                <span>${formatDate(commit.timestamp)}</span>
              </div>
            </div>
            ${hasGroupsAvailable ? `
              <span class="group-pill ${group ? 'has-group' : ''}">${group ? escapeHtml(group.name) : 'No group'}</span>
            ` : ''}
          </div>
        </div>

        ${isExpanded ? `
          <div class="commit-expanded">
            <div class="commit-detail-row">
              <span class="commit-detail-label">Author</span>
              <span class="commit-detail-value">${escapeHtml(commit.author)} &lt;${escapeHtml(commit.email)}&gt;</span>
            </div>
            <div class="commit-detail-row">
              <span class="commit-detail-label">Date</span>
              <span class="commit-detail-value">${new Date(commit.timestamp).toLocaleString()}</span>
            </div>
            <div class="commit-detail-row">
              <span class="commit-detail-label">Hash</span>
              <span class="commit-detail-value" style="font-family: monospace;">${commit.hash}</span>
            </div>
            ${commit.message.includes('\n') ? `
              <div class="commit-detail-row" style="flex-direction: column; gap: 4px;">
                <span class="commit-detail-label">Full message</span>
                <span class="commit-detail-value" style="white-space: pre-wrap;">${escapeHtml(commit.message)}</span>
              </div>
            ` : ''}
            ${hasGroupsAvailable ? `
              <div class="group-select-row">
                <span class="commit-detail-label">Group</span>
                <select class="group-select" data-group-hash="${commit.hash}">
                  <option value="" ${!group ? 'selected' : ''}>No group</option>
                  ${availableGroups.map(g => `
                    <option value="${escapeHtml(g.key)}" ${group?.key === g.key ? 'selected' : ''}>${escapeHtml(g.name)}</option>
                  `).join('')}
                </select>
              </div>
            ` : ''}
          </div>
        ` : ''}

        ${bullet ? `
          <div class="bullet-section">
            <div class="bullet-text">${escapeHtml(bullet.text)}</div>
            <div class="enrichment-badges">
              ${bullet.hasGitHub ? '<span class="badge github">GitHub PR</span>' : ''}
              ${bullet.hasJira ? '<span class="badge jira">JIRA</span>' : ''}
              ${!bullet.hasGitHub && !bullet.hasJira ? '<span class="badge">Commit only</span>' : ''}
            </div>
            <div class="bullet-actions">
              <button data-copy-hash="${commit.hash}">Copy</button>
              <button data-regen-hash="${commit.hash}" class="secondary">Regenerate</button>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    // Event: checkbox toggle
    const checkbox = div.querySelector('.commit-checkbox') as HTMLInputElement;
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleCommit(commit.hash);
    });

    // Event: expand/collapse row
    const rowHeader = div.querySelector('.commit-row-header') as HTMLElement;
    rowHeader.addEventListener('click', (e) => {
      // Don't expand if clicking on checkbox
      if ((e.target as HTMLElement).classList.contains('commit-checkbox')) return;
      toggleExpandCommit(commit.hash);
    });

    // Event: group select change
    const groupSelect = div.querySelector('.group-select') as HTMLSelectElement | null;
    if (groupSelect) {
      groupSelect.addEventListener('change', () => {
        const newGroupKey = groupSelect.value || null;
        commitGroupOverrides.set(commit.hash, newGroupKey);
        renderCommits(); // Re-render to update the pill
      });
      // Prevent row expansion when clicking dropdown
      groupSelect.addEventListener('click', (e) => e.stopPropagation());
    }

    // Event: copy bullet
    const copyBtn = div.querySelector('[data-copy-hash]') as HTMLButtonElement | null;
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const b = bullets.get(commit.hash);
        if (b) await navigator.clipboard.writeText(b.text);
      });
    }

    // Event: regenerate bullet
    const regenBtn = div.querySelector('[data-regen-hash]') as HTMLButtonElement | null;
    if (regenBtn) {
      regenBtn.addEventListener('click', async () => {
        await regenerateBulletForHash(commit.hash);
      });
    }

    commitsList.appendChild(div);
  });

  updateSelectionCount();
}

function toggleExpandCommit(hash: string) {
  if (expandedCommits.has(hash)) {
    expandedCommits.delete(hash);
  } else {
    expandedCommits.add(hash);
  }
  renderCommits();
}

async function regenerateBulletForHash(hash: string) {
  if (!currentRepoPath) return;

  const result = await window.commitkit.generateBullet(hash, currentRepoPath) as GenerateBulletResult;

  if ('text' in result) {
    bullets.set(hash, result as BulletData);
    renderCommits();
  } else if (isError(result)) {
    alert(`Error: ${result.error}`);
  }
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

  // Show/hide bulk group action
  updateBulkGroupAction();
}

function updateBulkGroupAction() {
  const hasGroups = availableGroups.length > 0;
  const hasSelection = selectedCommits.size > 0;

  if (hasGroups && hasSelection) {
    bulkGroupAction.classList.remove('hidden');

    // Update dropdown options
    bulkGroupSelect.innerHTML = '<option value="">No group</option>';
    availableGroups.forEach(g => {
      const option = document.createElement('option');
      option.value = g.key;
      option.textContent = g.name;
      bulkGroupSelect.appendChild(option);
    });
  } else {
    bulkGroupAction.classList.add('hidden');
  }
}

function handleBulkMove() {
  const targetGroupKey = bulkGroupSelect.value || null;

  // Apply the group override to all selected commits
  selectedCommits.forEach(hash => {
    commitGroupOverrides.set(hash, targetGroupKey);
  });

  // Re-render to show updated pills
  renderCommits();
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

    // Extract available groups from epic and AI-suggested results
    availableGroups = results
      .filter(g => g.groupType === 'epic' || g.groupType === 'ai-suggested')
      .map(g => ({ key: g.groupKey, name: g.groupName }));

    // Clear any user overrides from previous sessions
    commitGroupOverrides.clear();

    renderGroupedBullets();
    renderCommits(); // Re-render to show group pills
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

/**
 * Parse STAR format text into sections
 */
function parseStarFormat(text: string): { situation?: string; task?: string; action?: string; result?: string } | null {
  const situationMatch = text.match(/\*\*Situation:\*\*\s*([\s\S]*?)(?=\*\*Task:|\*\*Action:|\*\*Result:|$)/i);
  const taskMatch = text.match(/\*\*Task:\*\*\s*([\s\S]*?)(?=\*\*Situation:|\*\*Action:|\*\*Result:|$)/i);
  const actionMatch = text.match(/\*\*Action:\*\*\s*([\s\S]*?)(?=\*\*Situation:|\*\*Task:|\*\*Result:|$)/i);
  const resultMatch = text.match(/\*\*Result:\*\*\s*([\s\S]*?)$/i);

  if (!situationMatch && !taskMatch && !actionMatch) {
    return null; // Not STAR format
  }

  return {
    situation: situationMatch?.[1]?.trim(),
    task: taskMatch?.[1]?.trim(),
    action: actionMatch?.[1]?.trim(),
    result: resultMatch?.[1]?.trim(),
  };
}

/**
 * Render STAR format text with styled sections
 */
function renderStarText(text: string, bulletIndex: number): string {
  const star = parseStarFormat(text);

  if (!star) {
    // Not STAR format, render as plain text
    return `<div style="color: #10b981; font-size: 14px; line-height: 1.5;">${escapeHtml(text)}</div>`;
  }

  const isEditing = bulletEditMode.has(bulletIndex);
  const edits = bulletEdits.get(bulletIndex) || {};
  const context = bulletContext.get(bulletIndex) || '';
  const expandedSections = expandedStarSections.get(bulletIndex) || new Set<string>();
  const hasContext = context.trim().length > 0;
  const hasEdits = Object.keys(edits).length > 0;
  const hasChanges = hasContext || hasEdits;

  const sections = [
    { key: 'situation', label: 'Situation', value: edits.situation ?? star.situation, original: star.situation },
    { key: 'task', label: 'Task', value: edits.task ?? star.task, original: star.task },
    { key: 'action', label: 'Action', value: edits.action ?? star.action, original: star.action },
    { key: 'result', label: 'Result', value: edits.result ?? star.result, original: star.result },
  ].filter(s => s.value);

  const truncate = (text: string | undefined, len: number) => {
    if (!text) return '';
    return text.length > len ? text.substring(0, len) + '...' : text;
  };

  return `
    <div class="star-card" data-bullet-index="${bulletIndex}">
      ${sections.map(section => {
        const isExpanded = expandedSections.has(section.key);
        const wasEdited = edits[section.key as keyof StarEdits] !== undefined;
        return `
          <div class="star-section ${isExpanded ? 'expanded' : ''}" data-section="${section.key}">
            <div class="star-section-header" data-toggle-star-section="${bulletIndex}-${section.key}">
              <span class="star-section-chevron">▶</span>
              <span class="star-section-label ${section.key}">${section.label}</span>
              ${!isExpanded ? `<span class="star-section-preview">${escapeHtml(truncate(section.value, 60))}</span>` : ''}
              ${wasEdited ? '<span style="color: #f59e0b; font-size: 10px; margin-left: 8px;">edited</span>' : ''}
            </div>
            <div class="star-section-content">
              ${isEditing ? `
                <textarea class="star-section-textarea" data-edit-section="${bulletIndex}-${section.key}" rows="3">${escapeHtml(section.value || '')}</textarea>
              ` : `
                <div>${escapeHtml(section.value || '')}</div>
              `}
            </div>
          </div>
        `;
      }).join('')}

      <div class="star-context-container ${hasContext || isEditing ? 'visible' : ''}" id="context-${bulletIndex}">
        <div class="star-context-label">Additional context for AI</div>
        <textarea class="star-context-input" data-context="${bulletIndex}" placeholder="e.g., 'emphasize cost savings', 'this was a team of 5', 'resulted in 30% improvement'">${escapeHtml(context)}</textarea>
      </div>

      <div class="star-card-actions">
        <button data-edit-bullet="${bulletIndex}" class="secondary" style="padding: 6px 12px; font-size: 12px;">
          ${isEditing ? 'Done' : 'Edit'}
        </button>
        <button data-toggle-context="${bulletIndex}" class="secondary" style="padding: 6px 12px; font-size: 12px;">
          ${hasContext ? 'Hide Context' : 'Add Context'}
        </button>
        ${hasChanges ? `
          <button data-regenerate-bullet="${bulletIndex}" style="background: #f59e0b; color: #1a1a2e; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;">
            Regenerate
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

function renderGroupedBullets() {
  if (!groupedBulletsContainer) return;

  if (!isGroupedMode || groupedBullets.length === 0) {
    groupedBulletsContainer.classList.add('hidden');
    return;
  }

  groupedBulletsContainer.classList.remove('hidden');
  // Separate groups by type
  const epicGroups = groupedBullets.filter(g => g.groupType === 'epic');
  const aiGroups = groupedBullets.filter(g => g.groupType === 'ai-suggested');
  const individualBullets = groupedBullets.filter(g => g.groupType === 'individual');

  // Check if any overrides exist
  const hasOverrides = commitGroupOverrides.size > 0;

  // Helper to format confidence as percentage
  const formatConfidence = (conf: number | undefined) => conf !== undefined ? `${Math.round(conf * 100)}%` : '';

  groupedBulletsContainer.innerHTML = `
    ${epicGroups.length > 0 ? `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="color: #f0f0f0; margin: 0;">Feature Bullets (${epicGroups.length} epics) - STAR Format</h3>
        ${hasOverrides ? `
          <button id="regenerateAllBtn" style="background: #f59e0b; color: #1a1a2e; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500;">
            ⟳ Regenerate with Changes
          </button>
        ` : ''}
      </div>
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
          <div class="bullet-text" style="margin-bottom: 12px;">
            ${renderStarText(group.text, index)}
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

    ${aiGroups.length > 0 ? `
      <h3 style="margin: 24px 0 16px 0; color: #f0f0f0;">AI-Suggested Groups (${aiGroups.length} clusters) - STAR Format</h3>
      <p style="color: #9ca3af; font-size: 12px; margin: -8px 0 16px 0;">Commits grouped by AI analysis of code changes and commit messages</p>
      ${aiGroups.map((group, i) => {
        const index = epicGroups.length + i;
        return `
        <div class="grouped-bullet-item" style="background: #2a2a2a; border-radius: 8px; padding: 16px; margin-bottom: 12px; border-left: 3px solid #14b8a6;">
          <div class="group-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
            <div>
              <span class="group-name" style="font-weight: 600; color: #f0f0f0; font-size: 14px;">${escapeHtml(group.groupName)}</span>
              <span class="group-meta" style="color: #888; font-size: 12px; margin-left: 8px;">
                ${group.commitCount} commits · AI Cluster
                ${group.confidence !== undefined ? `· ${formatConfidence(group.confidence)} confidence` : ''}
              </span>
            </div>
            <div class="group-badges">
              <span class="badge" style="background: #14b8a6; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px;">AI</span>
              ${group.labels.slice(0, 2).map(label =>
                `<span class="badge" style="background: #6b7280; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 4px;">${escapeHtml(label)}</span>`
              ).join('')}
            </div>
          </div>
          ${group.reasoning ? `
            <div class="ai-reasoning" style="background: #1f2937; border-radius: 4px; padding: 8px 12px; margin-bottom: 12px; font-size: 12px; color: #9ca3af; border-left: 2px solid #14b8a6;">
              <span style="color: #14b8a6; font-weight: 500;">AI Reasoning:</span> ${escapeHtml(group.reasoning)}
            </div>
          ` : ''}
          <div class="bullet-text" style="margin-bottom: 12px;">
            ${renderStarText(group.text, index)}
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
      `}).join('')}
    ` : ''}

    ${individualBullets.length > 0 ? `
      <h3 style="margin: 24px 0 16px 0; color: #f0f0f0;">Individual Bullets (${individualBullets.length} ungrouped commits)</h3>
      ${individualBullets.map((group, i) => {
        const index = epicGroups.length + aiGroups.length + i;
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

  // Regenerate all button
  const regenerateAllBtn = document.getElementById('regenerateAllBtn') as HTMLButtonElement | null;
  if (regenerateAllBtn) {
    regenerateAllBtn.addEventListener('click', handleRegenerateWithOverrides);
  }

  // STAR card section toggles
  groupedBulletsContainer.querySelectorAll('[data-toggle-star-section]').forEach(header => {
    header.addEventListener('click', () => {
      const [indexStr, sectionKey] = (header.getAttribute('data-toggle-star-section') || '').split('-');
      const bulletIndex = parseInt(indexStr, 10);

      if (!expandedStarSections.has(bulletIndex)) {
        expandedStarSections.set(bulletIndex, new Set());
      }
      const sections = expandedStarSections.get(bulletIndex)!;

      if (sections.has(sectionKey)) {
        sections.delete(sectionKey);
      } else {
        sections.add(sectionKey);
      }

      renderGroupedBullets();
    });
  });

  // Edit mode toggle
  groupedBulletsContainer.querySelectorAll('[data-edit-bullet]').forEach(btn => {
    btn.addEventListener('click', () => {
      const bulletIndex = parseInt(btn.getAttribute('data-edit-bullet') || '0', 10);

      if (bulletEditMode.has(bulletIndex)) {
        // Exiting edit mode - save any textarea values
        groupedBulletsContainer.querySelectorAll(`[data-edit-section^="${bulletIndex}-"]`).forEach(textarea => {
          const [, sectionKey] = (textarea.getAttribute('data-edit-section') || '').split('-');
          const value = (textarea as HTMLTextAreaElement).value;
          const group = groupedBullets[bulletIndex];
          const star = parseStarFormat(group?.text || '');
          const original = star?.[sectionKey as keyof typeof star];

          if (value !== original) {
            if (!bulletEdits.has(bulletIndex)) {
              bulletEdits.set(bulletIndex, {});
            }
            bulletEdits.get(bulletIndex)![sectionKey as keyof StarEdits] = value;
          }
        });
        bulletEditMode.delete(bulletIndex);
      } else {
        // Entering edit mode - expand all sections
        if (!expandedStarSections.has(bulletIndex)) {
          expandedStarSections.set(bulletIndex, new Set());
        }
        const sections = expandedStarSections.get(bulletIndex)!;
        sections.add('situation');
        sections.add('task');
        sections.add('action');
        sections.add('result');
        bulletEditMode.add(bulletIndex);
      }

      renderGroupedBullets();
    });
  });

  // Context toggle
  groupedBulletsContainer.querySelectorAll('[data-toggle-context]').forEach(btn => {
    btn.addEventListener('click', () => {
      const bulletIndex = parseInt(btn.getAttribute('data-toggle-context') || '0', 10);
      const contextContainer = document.getElementById(`context-${bulletIndex}`);

      if (contextContainer) {
        const isVisible = contextContainer.classList.contains('visible');
        if (isVisible) {
          // Save context value before hiding
          const textarea = contextContainer.querySelector('[data-context]') as HTMLTextAreaElement;
          if (textarea && textarea.value.trim()) {
            bulletContext.set(bulletIndex, textarea.value);
          } else {
            bulletContext.delete(bulletIndex);
          }
          contextContainer.classList.remove('visible');
        } else {
          contextContainer.classList.add('visible');
        }
        renderGroupedBullets();
      }
    });
  });

  // Context input blur - save on blur
  groupedBulletsContainer.querySelectorAll('[data-context]').forEach(textarea => {
    textarea.addEventListener('blur', () => {
      const bulletIndex = parseInt(textarea.getAttribute('data-context') || '0', 10);
      const value = (textarea as HTMLTextAreaElement).value;
      if (value.trim()) {
        bulletContext.set(bulletIndex, value);
      } else {
        bulletContext.delete(bulletIndex);
      }
    });
  });

  // Per-bullet regenerate (placeholder for now - will wire up fully in step 4)
  groupedBulletsContainer.querySelectorAll('[data-regenerate-bullet]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const bulletIndex = parseInt(btn.getAttribute('data-regenerate-bullet') || '0', 10);
      await handleRegenerateSingleBullet(bulletIndex);
    });
  });
}

async function handleRegenerateWithOverrides() {
  if (!currentRepoPath || selectedCommits.size === 0) return;

  generateBtn.disabled = true;
  progressContainer.classList.remove('hidden');
  progressFill.style.width = '0%';

  // Convert Map to plain object for IPC
  const overrides: Record<string, string | null> = {};
  commitGroupOverrides.forEach((value, key) => {
    overrides[key] = value;
  });

  const hashes = Array.from(selectedCommits);
  const results = await window.commitkit.generateGroupedBullets(hashes, currentRepoPath, overrides) as GenerateGroupedBulletsResult;

  if (Array.isArray(results)) {
    groupedBullets = results;

    // Update available groups from new results
    availableGroups = results
      .filter(g => g.groupType === 'epic' || g.groupType === 'ai-suggested')
      .map(g => ({ key: g.groupKey, name: g.groupName }));

    // Clear overrides after successful regeneration (they're now reflected in the data)
    commitGroupOverrides.clear();

    renderGroupedBullets();
    renderCommits();
  } else if (isError(results)) {
    alert(`Error: ${results.error}`);
  }

  progressContainer.classList.add('hidden');
  generateBtn.disabled = false;
}

async function handleRegenerateSingleBullet(bulletIndex: number) {
  if (!currentRepoPath) return;

  const group = groupedBullets[bulletIndex];
  if (!group) return;

  const edits = bulletEdits.get(bulletIndex) || {};
  const context = bulletContext.get(bulletIndex) || '';

  // For now, regenerate just this group's commits
  // Pass context via the overrides mechanism (we'll enhance the backend later)
  const hashes = group.commits.map(c => c.hash);

  // Show loading state
  const card = groupedBulletsContainer.querySelector(`[data-bullet-index="${bulletIndex}"]`);
  if (card) {
    card.classList.add('loading');
  }

  try {
    // TODO: Enhance backend to accept edits and context
    // For now, just regenerate the group
    const results = await window.commitkit.generateGroupedBullets(hashes, currentRepoPath) as GenerateGroupedBulletsResult;

    if (Array.isArray(results) && results.length > 0) {
      // Update just this bullet in our array
      const newBullet = results.find(r => r.groupKey === group.groupKey) || results[0];
      groupedBullets[bulletIndex] = newBullet;

      // Clear edits and context for this bullet after regeneration
      bulletEdits.delete(bulletIndex);
      bulletContext.delete(bulletIndex);
      bulletEditMode.delete(bulletIndex);

      renderGroupedBullets();
    } else if (isError(results)) {
      alert(`Error regenerating: ${results.error}`);
    }
  } catch (error) {
    alert(`Error: ${error}`);
  }

  if (card) {
    card.classList.remove('loading');
  }
}

// Global functions kept for backwards compatibility (CSP-safe event listeners are now used)
// These can be removed in a future cleanup

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

  // Load clustering sensitivity
  if (config.ollama?.clusteringSensitivity) {
    clusteringSensitivity.value = config.ollama.clusteringSensitivity;
  } else {
    clusteringSensitivity.value = 'balanced'; // Default
  }
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
  if (ollamaModel.value || clusteringSensitivity.value) {
    config.ollama = {
      model: ollamaModel.value || undefined,
      clusteringSensitivity: clusteringSensitivity.value as 'strict' | 'balanced' | 'loose' || 'balanced',
    };
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

// ============================================================
// Graph Visualization Functions
// ============================================================

/**
 * Switch between list and graph views
 */
async function switchView(view: 'list' | 'graph') {
  currentView = view;

  // Update toggle button states
  viewToggleBtns.forEach(btn => {
    if (btn.getAttribute('data-view') === view) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  if (view === 'list') {
    graphContainer.classList.add('hidden');
    listViewContainer.classList.remove('hidden');
  } else {
    listViewContainer.classList.add('hidden');
    graphContainer.classList.remove('hidden');

    // Tag commits if not already tagged
    if (taggedCommits.length === 0 && commits.length > 0 && !isTagging) {
      await tagCommitsForGraph();
    } else if (taggedCommits.length > 0) {
      renderGraph();
    }
  }
}

/**
 * Tag commits using AI for graph visualization
 */
async function tagCommitsForGraph() {
  if (!currentRepoPath || commits.length === 0 || isTagging) return;

  isTagging = true;
  graphNetworkDiv.innerHTML = `
    <div class="tagging-progress">
      <div class="loading"></div>
      <span>Analyzing commits for topic tags...</span>
    </div>
  `;

  try {
    const hashes = commits.map(c => c.hash);
    const result = await window.commitkit.tagCommits(hashes, currentRepoPath);

    if (result.error) {
      graphNetworkDiv.innerHTML = `<div class="tagging-progress" style="color: #ef4444;">Error: ${result.error}</div>`;
      isTagging = false;
      return;
    }

    if (result.taggedCommits) {
      taggedCommits = result.taggedCommits;
      renderGraph();
    }
  } catch (error) {
    graphNetworkDiv.innerHTML = `<div class="tagging-progress" style="color: #ef4444;">Error: ${error}</div>`;
  }

  isTagging = false;
}

/**
 * Render the force-directed graph
 */
function renderGraph() {
  if (taggedCommits.length === 0) return;

  // Clear existing graph
  graphNetworkDiv.innerHTML = '';

  // Build nodes and edges
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodes: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edges: any[] = [];

  // Track which tags are actually used
  const usedTags = new Set<string>();

  // Add tag hub nodes
  const tagCounts: Record<string, number> = {};
  taggedCommits.forEach(tc => {
    tc.tags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      usedTags.add(tag);
    });
  });

  // Add tag nodes (larger, central)
  Object.entries(tagCounts).forEach(([tag, count]) => {
    nodes.push({
      id: `tag-${tag}`,
      label: `${tag}\n(${count})`,
      color: TAG_COLORS[tag] || '#6b7280',
      shape: 'circle',
      size: 20 + Math.min(count * 2, 30),
      title: `${tag}: ${count} commits`,
      font: { color: '#ffffff' },
    });
  });

  // Add commit nodes (smaller, peripheral)
  taggedCommits.forEach(tc => {
    const commitData = commits.find(c => c.hash === tc.hash);
    const shortMessage = tc.message.substring(0, 40) + (tc.message.length > 40 ? '...' : '');
    const isSelected = selectedCommits.has(tc.hash);

    nodes.push({
      id: `commit-${tc.hash}`,
      label: tc.hash.substring(0, 7),
      color: isSelected ? '#3b82f6' : '#374151',
      shape: 'dot',
      size: isSelected ? 12 : 8,
      title: `${shortMessage}\n\nTags: ${tc.tags.join(', ')}\n${commitData ? commitData.author : ''}`,
      font: { color: '#9ca3af' },
    });

    // Add edges from commit to its tags
    tc.tags.forEach(tag => {
      edges.push({
        from: `commit-${tc.hash}`,
        to: `tag-${tag}`,
        color: { color: TAG_COLORS[tag] || '#6b7280', opacity: 0.3 },
      });
    });
  });

  // Create DataSets using global vis object
  const nodesDataSet = new vis.DataSet(nodes);
  const edgesDataSet = new vis.DataSet(edges);

  // Network options
  const options = {
    nodes: {
      borderWidth: 2,
      borderWidthSelected: 3,
      font: {
        size: 10,
        face: 'system-ui, sans-serif',
      },
    },
    edges: {
      width: 1,
      smooth: {
        enabled: true,
        type: 'continuous',
        roundness: 0.5,
      },
    },
    physics: {
      enabled: true,
      solver: 'forceAtlas2Based',
      forceAtlas2Based: {
        gravitationalConstant: -80,
        centralGravity: 0.01,
        springLength: 100,
        springConstant: 0.08,
        damping: 0.4,
      },
      stabilization: {
        enabled: true,
        iterations: 100,
        fit: true,
      },
    },
    interaction: {
      hover: true,
      multiselect: true,
      selectConnectedEdges: false,
    },
  };

  // Create the network using global vis object
  graphNetwork = new vis.Network(graphNetworkDiv, { nodes: nodesDataSet, edges: edgesDataSet }, options);

  // Handle node clicks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graphNetwork.on('click', (params: any) => {
    if (params.nodes.length > 0) {
      const nodeId = params.nodes[0] as string;

      if (nodeId.startsWith('commit-')) {
        // Clicked on a commit node
        const hash = nodeId.replace('commit-', '');
        handleGraphCommitClick(hash, params.event.srcEvent.shiftKey);
      } else if (nodeId.startsWith('tag-')) {
        // Clicked on a tag node - select all commits with this tag
        const tag = nodeId.replace('tag-', '');
        handleGraphTagClick(tag, params.event.srcEvent.shiftKey);
      }
    }
  });

  // Render legend
  renderGraphLegend(usedTags);

  // Update info text
  if (graphInfo) {
    graphInfo.textContent = `${taggedCommits.length} commits · ${usedTags.size} topics · Click nodes to explore`;
  }

  // Update selection display
  updateGraphSelection();
}

/**
 * Handle clicking on a commit node in the graph
 */
function handleGraphCommitClick(hash: string, isShiftKey: boolean) {
  if (isShiftKey) {
    // Multi-select mode
    if (graphSelectedNodes.has(hash)) {
      graphSelectedNodes.delete(hash);
      selectedCommits.delete(hash);
    } else {
      graphSelectedNodes.add(hash);
      selectedCommits.add(hash);
    }
  } else {
    // Single select - clear previous and select this one
    graphSelectedNodes.clear();
    graphSelectedNodes.add(hash);
    selectedCommits.clear();
    selectedCommits.add(hash);
  }

  updateGraphSelection();
  updateSelectionCount();
  renderGraph(); // Re-render to update node colors
}

/**
 * Handle clicking on a tag node - select all commits with that tag
 */
function handleGraphTagClick(tag: string, isShiftKey: boolean) {
  // Find all commits with this tag
  const hashesWithTag = taggedCommits
    .filter(tc => tc.tags.includes(tag))
    .map(tc => tc.hash);

  if (!isShiftKey) {
    // Clear previous selection
    graphSelectedNodes.clear();
    selectedCommits.clear();
  }

  // Add all commits with this tag
  hashesWithTag.forEach(hash => {
    graphSelectedNodes.add(hash);
    selectedCommits.add(hash);
  });

  updateGraphSelection();
  updateSelectionCount();
  renderGraph();
}

/**
 * Update the graph selection info display
 */
function updateGraphSelection() {
  const count = graphSelectedNodes.size;

  if (count > 0) {
    graphSelectionInfo.classList.add('visible');
    graphSelectedCount.textContent = String(count);
  } else {
    graphSelectionInfo.classList.remove('visible');
  }
}

/**
 * Render the graph legend showing used tags
 */
function renderGraphLegend(usedTags: Set<string>) {
  if (!graphLegendItems) return;

  const sortedTags = Array.from(usedTags).sort((a, b) => {
    const countA = taggedCommits.filter(tc => tc.tags.includes(a)).length;
    const countB = taggedCommits.filter(tc => tc.tags.includes(b)).length;
    return countB - countA;
  });

  graphLegendItems.innerHTML = sortedTags.slice(0, 10).map(tag => {
    const count = taggedCommits.filter(tc => tc.tags.includes(tag)).length;
    return `
      <div class="graph-legend-item">
        <div class="graph-legend-dot" style="background: ${TAG_COLORS[tag] || '#6b7280'}"></div>
        <span>${tag} (${count})</span>
      </div>
    `;
  }).join('');

  if (sortedTags.length > 10) {
    graphLegendItems.innerHTML += `<div class="graph-legend-item" style="color: #666;">+${sortedTags.length - 10} more</div>`;
  }
}

// Start
init();
