const repoPathInput = document.querySelector('#repoPathInput');
const repoSelect = document.querySelector('#repoSelect');
const discoverReposButton = document.querySelector('#discoverReposButton');
const loadRepoButton = document.querySelector('#loadRepoButton');
const lastCommand = document.querySelector('#lastCommand');
const output = document.querySelector('#output');
const repoStatusGrid = document.querySelector('#repoStatusGrid');
const stopDialog = document.querySelector('#stopDialog');

discoverReposButton.addEventListener('click', discoverRepos);
loadRepoButton.addEventListener('click', loadSelectedRepo);
document.querySelector('#stopDashboardButton').addEventListener('click', () => stopDialog.showModal());
document.querySelector('#confirmStopButton').addEventListener('click', stopDashboard);

repoPathInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    discoverRepos();
  }
});

renderRepoOptions([]);
renderStatus({});

async function discoverRepos() {
  const repoPath = repoPathInput.value.trim();
  lastCommand.textContent = 'Running: Discover Repos';
  writeOutput('Discovering repos...');

  try {
    const result = await api(`/api/repos?repoPath=${encodeURIComponent(repoPath)}`);
    renderRepoOptions(result.repos);
    lastCommand.textContent = 'Passed: Discover Repos';
    writeOutput(result.repos.length
      ? `Discovered ${result.repos.length} compatible repo(s).`
      : 'No compatible repos were found.');
  } catch (error) {
    renderRepoOptions([]);
    renderStatus({});
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

  lastCommand.textContent = 'Running: Load Repo';
  writeOutput('Loading repo...');

  try {
    const status = await api(`/api/status?repoDir=${encodeURIComponent(repoSelect.value)}`);
    renderStatus(status);
    lastCommand.textContent = 'Passed: Load Repo';
    writeOutput(`Loaded repo: ${status.repoName}`);
  } catch (error) {
    renderStatus({});
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

function renderRepoOptions(repos) {
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
}

function renderStatus(status) {
  const rows = [
    ['Repo', status.repoName],
    ['Type', formatRepoType(status.repoType)],
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

async function api(path) {
  const response = await fetch(path);
  const payload = await response.json();

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? 'Request failed');
  }

  return payload;
}

function writeOutput(message) {
  output.textContent = message;
}

function formatRepoType(repoType) {
  if (repoType === 'framework') {
    return 'Framework compatible';
  }

  if (repoType === 'generic-playwright') {
    return 'Repo incompatible with framework.';
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
