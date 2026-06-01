const repoPathInput = document.querySelector('#repoPathInput');
const repoSelect = document.querySelector('#repoSelect');
const discoverReposButton = document.querySelector('#discoverReposButton');
const loadRepoButton = document.querySelector('#loadRepoButton');
const setupAutomationButton = document.querySelector('#setupAutomationButton');
const updateFrameworkButton = document.querySelector('#updateFrameworkButton');
const checkGitStatusButton = document.querySelector('#checkGitStatusButton');
const openDashboardButton = document.querySelector('#openDashboardButton');
const buildFrameworkButton = document.querySelector('#buildFrameworkButton');
const checkUpdatesButton = document.querySelector('#checkUpdatesButton');
const securityAuditButton = document.querySelector('#securityAuditButton');
const installBrowsersButton = document.querySelector('#installBrowsersButton');
const lastCommand = document.querySelector('#lastCommand');
const output = document.querySelector('#output');
const repoStatusGrid = document.querySelector('#repoStatusGrid');
const stopDialog = document.querySelector('#stopDialog');
const dashboardProcessId = document.querySelector('#dashboardProcessId');

const storageKeys = {
  repoPath: 'dashboardHome.repoPath',
  repos: 'dashboardHome.repos',
  selectedRepo: 'dashboardHome.selectedRepo',
  loadedRepo: 'dashboardHome.loadedRepo'
};

let loadedRepoStatus = null;

discoverReposButton.addEventListener('click', discoverRepos);
loadRepoButton.addEventListener('click', loadSelectedRepo);
setupAutomationButton.addEventListener('click', () => runHomeCommand('/api/setup', 'Setup Automation'));
updateFrameworkButton.addEventListener('click', () => runHomeCommand('/api/update-framework', 'Update Framework'));
checkGitStatusButton.addEventListener('click', () => runHomeCommand('/api/git-status', 'Check Git Status'));
openDashboardButton.addEventListener('click', openTestDashboard);
buildFrameworkButton.addEventListener('click', () => runMaintenanceCommand('build', 'Build Framework'));
checkUpdatesButton.addEventListener('click', () => runMaintenanceCommand('outdated', 'Check Updates'));
securityAuditButton.addEventListener('click', () => runMaintenanceCommand('audit', 'Security Audit'));
installBrowsersButton.addEventListener('click', () => {
  if (confirm('Install or update Playwright browser binaries?')) {
    runMaintenanceCommand('installBrowsers', 'Install Browsers', { confirm: true });
  }
});
document.querySelector('#stopDashboardButton').addEventListener('click', () => stopDialog.showModal());
document.querySelector('#confirmStopButton').addEventListener('click', stopDashboard);

repoPathInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    discoverRepos();
  }
});

repoSelect.addEventListener('change', () => {
  localStorage.setItem(storageKeys.selectedRepo, repoSelect.value);
});

initialize();

async function initialize() {
  await loadProcessInfo();
  repoPathInput.value = localStorage.getItem(storageKeys.repoPath) || repoPathInput.value;
  renderRepoOptions(readStoredRepos(), localStorage.getItem(storageKeys.selectedRepo) ?? '');
  renderStatus({});
  updateToolButtons(null);

  const loadedRepo = localStorage.getItem(storageKeys.loadedRepo);
  if (!loadedRepo) {
    return;
  }

  if (![...repoSelect.options].some((option) => option.value === loadedRepo)) {
    addStoredRepoOption(loadedRepo);
  }

  repoSelect.value = loadedRepo;
  await loadRepo(loadedRepo, false);
}

async function loadProcessInfo() {
  try {
    const processInfo = await api('/api/process');
    dashboardProcessId.textContent = processInfo.pid ?? '';
  } catch {
    dashboardProcessId.textContent = 'Unavailable';
  }
}

async function discoverRepos() {
  const repoPath = repoPathInput.value.trim();
  lastCommand.textContent = 'Running: Discover Repos';
  writeOutput('Discovering repos...');

  try {
    const result = await api(`/api/repos?repoPath=${encodeURIComponent(repoPath)}`);
    localStorage.setItem(storageKeys.repoPath, repoPath);
    localStorage.setItem(storageKeys.repos, JSON.stringify(result.repos));

    const previousSelection = localStorage.getItem(storageKeys.selectedRepo) ?? '';
    renderRepoOptions(result.repos, previousSelection);

    if (repoSelect.value) {
      localStorage.setItem(storageKeys.selectedRepo, repoSelect.value);
    }

    if (loadedRepoStatus && !result.repos.some((repo) => repo.path === loadedRepoStatus.rootDir)) {
      loadedRepoStatus = null;
      localStorage.removeItem(storageKeys.loadedRepo);
      renderStatus({});
      updateToolButtons(null);
    }

    lastCommand.textContent = 'Passed: Discover Repos';
    writeOutput(result.repos.length
      ? `Discovered ${result.repos.length} compatible repo(s).`
      : 'No compatible repos were found.');
  } catch (error) {
    renderRepoOptions([]);
    loadedRepoStatus = null;
    localStorage.removeItem(storageKeys.loadedRepo);
    renderStatus({});
    updateToolButtons(null);
    lastCommand.textContent = 'Failed: Discover Repos';
    writeOutput(error.message);
  }
}

async function loadSelectedRepo() {
  if (!repoSelect.value) {
    lastCommand.textContent = 'Failed: Load Repo';
    writeOutput('Select a repo before loading.');
    return;
  }

  await loadRepo(repoSelect.value, true);
}

async function loadRepo(repoDir, announce) {
  lastCommand.textContent = 'Running: Load Repo';
  writeOutput('Loading repo...');

  try {
    const status = await api(`/api/status?repoDir=${encodeURIComponent(repoDir)}`);
    loadedRepoStatus = status;
    localStorage.setItem(storageKeys.selectedRepo, repoDir);
    localStorage.setItem(storageKeys.loadedRepo, repoDir);
    repoSelect.value = repoDir;
    renderStatus(status);
    updateToolButtons(status);
    lastCommand.textContent = 'Passed: Load Repo';
    writeOutput(announce ? `Loaded repo: ${status.repoName}` : `Loaded previous repo: ${status.repoName}`);
  } catch (error) {
    loadedRepoStatus = null;
    localStorage.removeItem(storageKeys.loadedRepo);
    renderStatus({});
    updateToolButtons(null);
    lastCommand.textContent = 'Failed: Load Repo';
    writeOutput(error.message);
  }
}

async function stopDashboard() {
  stopDialog.close();
  lastCommand.textContent = 'Stopping dashboard';
  writeOutput('Dashboard is stopping. You can close this browser tab.');

  try {
    await fetch('/api/stop-automation', { method: 'POST' });
    document.body.innerHTML = '<main class="stopped-page"><h1>Playwright Dashboard Home stopped.</h1><p>You can close this browser tab.</p></main>';
  } catch (error) {
    lastCommand.textContent = 'Failed: Stop Dashboard';
    writeOutput(`Unable to stop dashboard: ${error.message}`);
  }
}

async function runHomeCommand(endpoint, label) {
  if (!loadedRepoStatus?.rootDir) {
    lastCommand.textContent = `Failed: ${label}`;
    writeOutput('Load a repo before running dashboard tools.');
    return;
  }

  setBusy(true);
  lastCommand.textContent = `Running: ${label}`;
  writeOutput('Running command. Please wait...');

  try {
    const result = await commandApi(endpoint, { repoDir: loadedRepoStatus.rootDir });
    lastCommand.textContent = `${result.ok ? 'Passed' : 'Failed'}: ${label}`;
    writeOutput([result.stdout, result.stderr].filter(Boolean).join('\n') || 'No output.');
  } catch (error) {
    lastCommand.textContent = `Failed: ${label}`;
    writeOutput(error.message);
  } finally {
    setBusy(false);
    updateToolButtons(loadedRepoStatus);
  }
}

async function openTestDashboard() {
  if (!loadedRepoStatus?.rootDir) {
    lastCommand.textContent = 'Failed: Open Test Dashboard';
    writeOutput('Load a repo before opening Test Dashboard.');
    return;
  }

  setBusy(true);
  lastCommand.textContent = 'Running: Open Test Dashboard';
  writeOutput('Opening Test Dashboard...');

  try {
    localStorage.setItem('selectedRepoDir', loadedRepoStatus.rootDir);
    const result = await commandApi('/api/open-test-dashboard', { repoDir: loadedRepoStatus.rootDir });
    lastCommand.textContent = 'Passed: Open Test Dashboard';
    writeOutput(result.message ?? 'Test Dashboard is opening.');
    window.setTimeout(() => {
      window.location.href = result.url ?? '/';
    }, 900);
  } catch (error) {
    lastCommand.textContent = 'Failed: Open Test Dashboard';
    writeOutput(error.message);
    setBusy(false);
    updateToolButtons(loadedRepoStatus);
  }
}

async function runMaintenanceCommand(id, label, options = {}) {
  if (!loadedRepoStatus?.rootDir) {
    lastCommand.textContent = `Failed: ${label}`;
    writeOutput('Load a repo before running maintenance tools.');
    return;
  }

  setBusy(true);
  lastCommand.textContent = `Running: ${label}`;
  writeOutput('Running command. Please wait...');

  try {
    const result = await commandApi('/api/maintenance', {
      repoDir: loadedRepoStatus.rootDir,
      id,
      ...options
    });
    lastCommand.textContent = `${result.ok ? 'Passed' : 'Failed'}: ${label}`;
    writeOutput([result.stdout, result.stderr].filter(Boolean).join('\n') || 'No output.');
  } catch (error) {
    lastCommand.textContent = `Failed: ${label}`;
    writeOutput(error.message);
  } finally {
    setBusy(false);
    updateToolButtons(loadedRepoStatus);
  }
}

function renderRepoOptions(repos, selectedRepo = '') {
  repoSelect.innerHTML = '';

  if (!repos.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No repos discovered';
    repoSelect.append(option);
    return;
  }

  for (const repo of repos) {
    const option = document.createElement('option');
    option.value = repo.path;
    option.textContent = repo.name;
    repoSelect.append(option);
  }

  if (selectedRepo && repos.some((repo) => repo.path === selectedRepo)) {
    repoSelect.value = selectedRepo;
  }
}

function addStoredRepoOption(repoDir) {
  const option = document.createElement('option');
  option.value = repoDir;
  option.textContent = repoDir.split(/[\\/]/).filter(Boolean).at(-1) ?? repoDir;
  repoSelect.append(option);
}

function readStoredRepos() {
  try {
    const repos = JSON.parse(localStorage.getItem(storageKeys.repos) ?? '[]');
    return Array.isArray(repos) ? repos : [];
  } catch {
    return [];
  }
}

function renderStatus(status) {
  const rows = [
    ['Repo', status.repoName],
    ['Repo Type', formatRepoType(status.repoType)],
    ['Path', status.rootDir],
    ['Node.js', status.node],
    ['npm', status.npm],
    ['Playwright', status.playwright]
  ];

  repoStatusGrid.innerHTML = rows
    .map(([label, value]) => `
      <div class="status-item">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value ?? '')}</strong>
      </div>
    `)
    .join('');
}

function updateToolButtons(status) {
  const hasLoadedRepo = Boolean(status?.rootDir);
  const isFrameworkRepo = status?.repoType === 'framework';

  setupAutomationButton.disabled = !hasLoadedRepo || !isFrameworkRepo;
  checkGitStatusButton.disabled = !hasLoadedRepo;
  openDashboardButton.disabled = !hasLoadedRepo;
  updateFrameworkButton.disabled = !hasLoadedRepo || !isFrameworkRepo;
  buildFrameworkButton.disabled = !hasLoadedRepo;
  checkUpdatesButton.disabled = !hasLoadedRepo;
  securityAuditButton.disabled = !hasLoadedRepo;
  installBrowsersButton.disabled = !hasLoadedRepo;
}

async function api(path) {
  const response = await fetch(path);
  const payload = await response.json();

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? 'Request failed');
  }

  return payload;
}

async function commandApi(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? 'Request failed');
  }

  return payload;
}

function setBusy(isBusy) {
  [
    discoverReposButton,
    loadRepoButton,
    setupAutomationButton,
    updateFrameworkButton,
    checkGitStatusButton,
    openDashboardButton,
    buildFrameworkButton,
    checkUpdatesButton,
    securityAuditButton,
    installBrowsersButton
  ].forEach((button) => {
    button.disabled = isBusy;
  });
  repoPathInput.disabled = isBusy;
  repoSelect.disabled = isBusy;
}

function writeOutput(message) {
  output.textContent = message;
}

function formatRepoType(repoType) {
  if (repoType === 'framework') {
    return 'Compatible with framework';
  }

  if (repoType === 'generic-playwright') {
    return 'Incompatible with framework';
  }

  return repoType ?? '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
