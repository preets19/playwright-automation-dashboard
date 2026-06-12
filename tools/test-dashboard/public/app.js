const statusGrid = document.querySelector('#statusGrid');
const output = document.querySelector('#output');
const lastCommand = document.querySelector('#lastCommand');
const reportLink = document.querySelector('#reportLink');
const repoSelect = document.querySelector('#repoSelect');
const loadRepoButton = document.querySelector('#loadRepoButton');
const workspaceRoot = document.querySelector('#workspaceRoot');
const repoCompatibilityNotice = document.querySelector('#repoCompatibilityNotice');
const settingsForm = document.querySelector('#settingsForm');
const saveSettingsButton = document.querySelector('#saveSettingsButton');
const artifactList = document.querySelector('#artifactList');
const stopDialog = document.querySelector('#stopDialog');
const testsDialog = document.querySelector('#testsDialog');
const buildTestWizardDialog = document.querySelector('#buildTestWizardDialog');
const buildTestWizardForm = document.querySelector('#buildTestWizardForm');
const buildTestWizardInputStep = document.querySelector('#buildTestWizardInputStep');
const buildTestWizardFormattedStep = document.querySelector('#buildTestWizardFormattedStep');
const buildTestWizardPromptStep = document.querySelector('#buildTestWizardPromptStep');
const backBuildTestWizardButton = document.querySelector('#backBuildTestWizardButton');
const closeBuildTestWizardButton = document.querySelector('#closeBuildTestWizardButton');
const formatRawCodeButton = document.querySelector('#formatRawCodeButton');
const generateAiPromptButton = document.querySelector('#generateAiPromptButton');
const copyAiPromptButton = document.querySelector('#copyAiPromptButton');
const selectedTestsGrid = document.querySelector('#selectedTestsGrid');
const testSearchInput = document.querySelector('#testSearchInput');
const testResultsBody = document.querySelector('#testResultsBody');
const searchTestsButton = document.querySelector('#searchTestsButton');
const selectAllTestsButton = document.querySelector('#selectAllTestsButton');
const clearSelectedTestsButton = document.querySelector('#clearSelectedTestsButton');
const saveSelectedTestsButton = document.querySelector('#saveSelectedTestsButton');
const runSelectedTestsButton = document.querySelector('#runSelectedTestsButton');
const dashboardProcessId = document.querySelector('#dashboardProcessId');
const handoffOverlay = document.querySelector('#handoffOverlay');
const handoffMessage = document.querySelector('#handoffMessage');
const dashboardModeInputs = [...document.querySelectorAll('input[name="dashboardMode"]')];
const dashboardModeSections = [...document.querySelectorAll('.dashboard-mode-section, .dashboard-mode-panel')];

let currentSettings;
let currentRepoDir = localStorage.getItem('selectedRepoDir') ?? '';
let dashboardMode = localStorage.getItem('testDashboard.mode') ?? 'run';
let currentRepoType = 'framework';
let isStoppingAutomation = false;
let isDashboardHandoff = false;
let currentWorkspaceRoot = '';
let currentRepos = [];
let savedSettingsSnapshot = '';
let discoveredTests = [];
let visibleTests = [];
let selectedTestIds = new Set();
let draftSelectedTestIds = new Set();
let hasDiscoveredAllTests = false;
let buildTestWizardStep = 'input';

document.querySelector('#backHomeButton').addEventListener('click', backToHomeDashboard);
loadRepoButton.addEventListener('click', loadSelectedRepo);
document.querySelector('#stopAutomationButton').addEventListener('click', () => stopDialog.showModal());
document.querySelector('#confirmStopButton').addEventListener('click', stopAutomation);
document.querySelector('#buildAutomatedTestButton').addEventListener('click', openBuildTestWizard);
backBuildTestWizardButton.addEventListener('click', goBackBuildTestWizard);
closeBuildTestWizardButton.addEventListener('click', () => buildTestWizardDialog.close());
formatRawCodeButton.addEventListener('click', formatRawCode);
generateAiPromptButton.addEventListener('click', generateAiPrompt);
copyAiPromptButton.addEventListener('click', copyAiPrompt);
document.querySelector('#wizardCodegenCode').addEventListener('input', clearCodegenValidation);
document.querySelector('#selectTestsButton').addEventListener('click', openTestsDialog);
searchTestsButton.addEventListener('click', searchTests);
testSearchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    searchTests();
  }
});
selectAllTestsButton.addEventListener('click', selectVisibleTests);
clearSelectedTestsButton.addEventListener('click', clearSelectedTests);
saveSelectedTestsButton.addEventListener('click', applySelectedTests);
runSelectedTestsButton.addEventListener('click', runSelectedTests);
reportLink.addEventListener('click', (event) => {
  if (reportLink.getAttribute('aria-disabled') === 'true') {
    event.preventDefault();
    writeOutput('No test results found. Run tests first.');
  }
});
document.querySelector('#cleanupButton').addEventListener('click', cleanup);
document.querySelector('#loadArtifactsButton').addEventListener('click', loadArtifacts);
dashboardModeInputs.forEach((input) => {
  input.addEventListener('change', () => {
    if (input.checked) {
      setDashboardMode(input.value);
    }
  });
});

document.querySelectorAll('[data-command]').forEach((button) => {
  button.addEventListener('click', () => runCommand(button.dataset.command, getCommandBody(button.dataset.command)));
});

window.addEventListener('beforeunload', (event) => {
  if (isStoppingAutomation || isDashboardHandoff) {
    return;
  }

  event.preventDefault();
  event.returnValue = '';
});

document.querySelectorAll('input[name="browsers"]').forEach((input) => {
  input.addEventListener('change', () => {
    const selectedBrowsers = getSelectedBrowsers();
    if (!selectedBrowsers.length) {
      input.checked = true;
      writeOutput('At least one browser must stay selected.');
      return;
    }

    writeOutput('Browser selection changed. Save Test Run Settings before running tests.');
    updateSettingsSaveState();
  });
});

settingsForm.addEventListener('input', updateSettingsSaveState);
settingsForm.addEventListener('change', updateSettingsSaveState);

repoSelect.addEventListener('change', () => {
  loadRepoButton.disabled = repoSelect.value === currentRepoDir;
  writeOutput(`Selected repo: ${repoSelect.options[repoSelect.selectedIndex]?.textContent ?? repoSelect.value}`);
});

async function loadSelectedRepo() {
  currentRepoDir = repoSelect.value;
  if (!currentRepoDir) {
    writeOutput('Select a repo before loading.');
    return;
  }

  localStorage.setItem('selectedRepoDir', currentRepoDir);
  artifactList.innerHTML = '';
  discoveredTests = [];
  visibleTests = [];
  selectedTestIds = new Set();
  draftSelectedTestIds = new Set();
  hasDiscoveredAllTests = false;
  renderSelectedTestsGrid();
  renderTestResults();
  await refresh();
  writeOutput(`Loaded repo: ${repoSelect.options[repoSelect.selectedIndex]?.textContent ?? currentRepoDir}`);
}

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const selectedBrowsers = getSelectedBrowsers();
  if (!selectedBrowsers.length) {
    writeOutput('Select at least one browser for test runs.');
    return;
  }

  currentSettings.application.baseUrl = document.querySelector('#appBaseUrl').value;
  currentSettings.api.baseUrl = document.querySelector('#apiBaseUrl').value;
  currentSettings.browser.browsers = selectedBrowsers;
  currentSettings.browser.name = selectedBrowsers[0];
  currentSettings.browser.headless = document.querySelector('#headless').checked;
  currentSettings.browser.slowMo = Number(document.querySelector('#slowMo').value) || 0;
  currentSettings.testSelection = {
    tests: getSelectedTestsForSettings()
  };

  await api('/api/settings', {
    method: 'POST',
    body: withRepo(currentSettings)
  });
  await refresh();
  writeOutput('Settings saved. Reopen Playwright Test Runner UI to load browser selection changes.');
});

await initialize();
startDashboardHeartbeat();

async function initialize() {
  setDashboardMode(dashboardMode);
  await loadProcessInfo();
  const repoInfo = await api('/api/repos', {}, false);
  renderRepos(repoInfo);
  await refresh();
}

function setDashboardMode(mode) {
  dashboardMode = mode === 'build' ? 'build' : 'run';
  localStorage.setItem('testDashboard.mode', dashboardMode);

  dashboardModeInputs.forEach((input) => {
    input.checked = input.value === dashboardMode;
  });

  dashboardModeSections.forEach((section) => {
    section.hidden = section.dataset.dashboardMode !== dashboardMode;
  });

  writeOutput(
    dashboardMode === 'build'
      ? 'Build Tests mode selected. Recorder and automated test builder are available.'
      : 'Run Tests mode selected. Test execution, settings, maintenance, and artifacts are available.'
  );
}

async function loadProcessInfo() {
  try {
    const processInfo = await api('/api/process', {}, false);
    dashboardProcessId.textContent = processInfo.pid ?? '';
  } catch {
    dashboardProcessId.textContent = 'Unavailable';
  }
}

async function refresh() {
  if (!currentRepoDir) {
    renderStatus({
      repoName: '',
      rootDir: '',
      node: '',
      npm: '',
      playwright: '',
      appBaseUrl: '',
      apiBaseUrl: '',
      headless: '',
      slowMo: '',
      hasNodeModules: false,
      hasReport: false
    });
    writeOutput('No app automation repos found under the local Source\\Repo workspace.');
    return;
  }

  const [status, settings] = await Promise.all([
    api('/api/status'),
    api('/api/settings')
  ]);

  currentSettings = settings;
  renderStatus(status);
  renderSettings(settings);
  loadRepoButton.disabled = true;
}

function renderRepos(repoInfo) {
  currentWorkspaceRoot = repoInfo.workspaceRoot ?? '';
  currentRepos = repoInfo.repos ?? [];
  workspaceRoot.textContent = repoInfo.workspaceRoot ? `Workspace: ${repoInfo.workspaceRoot}` : '';
  repoSelect.innerHTML = repoInfo.repos.length
    ? repoInfo.repos
      .map((repo) => `<option value="${escapeHtml(repo.path)}">${escapeHtml(repo.name)}</option>`)
      .join('')
    : '<option value="">No app repos found</option>';

  const repoPaths = new Set(repoInfo.repos.map((repo) => repo.path));
  if (!repoPaths.has(currentRepoDir)) {
    currentRepoDir = repoInfo.defaultRepoDir ?? '';
  }

  repoSelect.value = currentRepoDir;
  if (currentRepoDir) {
    localStorage.setItem('selectedRepoDir', currentRepoDir);
  }
  loadRepoButton.disabled = true;
}

function renderStatus(status) {
  currentRepoType = status.repoType ?? 'framework';
  renderCompatibilityNotice(status);
  const items = [
    ['Repo', status.repoName ?? ''],
    ['Repo Type', formatRepoType(currentRepoType)],
    ['Browsers', status.browsers?.join(', ') ?? ''],
    ['Headless', String(status.headless)],
    ['Slow motion', `${status.slowMo} ms`],
    ['App URL', status.appBaseUrl],
    ['API URL', status.apiBaseUrl],
    ['Playwright', status.playwright],
    ['Report', status.hasReport ? 'Available' : 'Not generated']
  ];

  statusGrid.innerHTML = items
    .map(([label, value]) => `<div class="status-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join('');
  renderReportLink(status);
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

function renderCompatibilityNotice(status) {
  const message = status.compatibilityMessage ?? '';
  repoCompatibilityNotice.hidden = !message;
  repoCompatibilityNotice.textContent = message;
}

function renderReportLink(status) {
  reportLink.href = status.reportUrl ?? '#';
  reportLink.classList.remove('disabled-link');
  reportLink.setAttribute('aria-disabled', 'false');
}

function renderSettings(settings) {
  document.querySelector('#appBaseUrl').value = settings.application?.baseUrl ?? '';
  document.querySelector('#apiBaseUrl').value = settings.api?.baseUrl ?? '';
  setSelectedBrowsers(settings.browser?.browsers ?? [settings.browser?.name ?? 'chromium']);
  document.querySelector('#headless').checked = settings.browser?.headless !== false;
  document.querySelector('#slowMo').value = settings.browser?.slowMo ?? 0;
  const savedTests = currentRepoType === 'generic-playwright'
    ? getGenericRepoSelection()
    : Array.isArray(settings.testSelection?.tests) ? settings.testSelection.tests : [];
  discoveredTests = mergeTestsById(discoveredTests, savedTests);
  selectedTestIds = new Set(savedTests.map((test) => test.id).filter(Boolean));
  draftSelectedTestIds = new Set(selectedTestIds);
  renderSelectedTestsGrid();
  savedSettingsSnapshot = settingsSnapshotFromForm();
  setFrameworkSettingsEnabled(currentRepoType === 'framework');
  updateSettingsSaveState();
}

function setFrameworkSettingsEnabled(enabled) {
  [
    '#appBaseUrl',
    '#apiBaseUrl',
    '#headless',
    '#slowMo',
    'input[name="browsers"]'
  ].forEach((selector) => {
    document.querySelectorAll(selector).forEach((input) => {
      input.disabled = !enabled;
    });
  });
}

function getSelectedBrowsers() {
  return [...document.querySelectorAll('input[name="browsers"]:checked')]
    .map((input) => input.value);
}

function setSelectedBrowsers(browsers) {
  const selected = new Set((Array.isArray(browsers) ? browsers : ['chromium']).filter(Boolean));
  if (!selected.size) {
    selected.add('chromium');
  }

  document.querySelectorAll('input[name="browsers"]').forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

async function runCommand(id, body = {}) {
  setBusy(true);
  try {
    lastCommand.textContent = `Running: ${id}`;
    writeOutput('Running command. Please wait...');
    const result = await commandApi('/api/run', withRepo({ id, ...body }));
    renderCommandResult(result);
    await refresh();
  } catch (error) {
    lastCommand.textContent = `Failed: ${id}`;
    writeOutput(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

async function runSelectedTests() {
  if (currentRepoType === 'framework' && (!currentSettings || settingsSnapshotFromForm() !== savedSettingsSnapshot)) {
    writeOutput('Save Test Run Settings before running selected tests.');
    return;
  }

  if (!selectedTestIds.size) {
    writeOutput('Select one or more tests before running selected tests.');
    return;
  }

  await runCommand('testSelected', getCommandBody('testSelected'));
}

async function cleanup() {
  if (!confirm('Clean generated files: dist, reports, and test results?')) {
    return;
  }

  const result = await api('/api/cleanup', {
    method: 'POST',
    body: withRepo({})
  });
  writeOutput(result.message ?? 'Cleaned.');
  await refresh();
}

async function stopAutomation() {
  stopDialog.close();
  isStoppingAutomation = true;
  setBusy(true);

  try {
    await api('/api/stop-automation', { method: 'POST' });
    lastCommand.textContent = 'Stopping automation processes';
    writeOutput('Automation is stopping. This dashboard will disconnect and stop updating. You can close this browser tab.');
  } catch (error) {
    isStoppingAutomation = false;
    setBusy(false);
    writeOutput(error instanceof Error ? error.message : String(error));
  }
}

async function backToHomeDashboard() {
  isDashboardHandoff = true;
  setBusy(true);
  showHandoffOverlay('Loading Home Dashboard...');
  writeOutput('Loading Home Dashboard...');

  try {
    const repoDir = repoSelect.value || currentRepoDir;
    handoffSelectionToHome();
    const result = await api('/api/open-home-dashboard', {
      method: 'POST',
      body: JSON.stringify({ repoDir })
    });
    showHandoffOverlay('Loading Home Dashboard...');
    writeOutput(result.message ?? 'Loading Home Dashboard...');
    await waitForDashboardReady('Playwright Dashboard Home');
    window.location.href = result.url ?? '/';
  } catch (error) {
    isDashboardHandoff = false;
    setBusy(false);
    hideHandoffOverlay();
    writeOutput(error instanceof Error ? error.message : String(error));
  }
}

function handoffSelectionToHome() {
  const repoDir = repoSelect.value || currentRepoDir;
  if (currentWorkspaceRoot) {
    localStorage.setItem('dashboardHome.repoPath', currentWorkspaceRoot);
  }
  if (currentRepos.length) {
    localStorage.setItem('dashboardHome.repos', JSON.stringify(currentRepos));
  }
  if (repoDir) {
    localStorage.setItem('dashboardHome.selectedRepo', repoDir);
    localStorage.setItem('dashboardHome.loadedRepo', repoDir);
  }
}

function startDashboardHeartbeat() {
  sendHeartbeat();
  setInterval(sendHeartbeat, 15_000);
}

async function sendHeartbeat() {
  try {
    await fetch('/api/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      keepalive: true
    });
  } catch {
    // The dashboard may already be stopping.
  }
}

async function loadArtifacts() {
  const artifacts = await api('/api/artifacts');
  artifactList.innerHTML = artifacts.length
    ? artifacts.map((artifact) => `<li>${escapeHtml(artifact.file)}</li>`).join('')
    : '<li>No artifacts found.</li>';
}

async function openTestsDialog() {
  draftSelectedTestIds = new Set(selectedTestIds);
  testsDialog.showModal();
  visibleTests = discoveredTests.length
    ? filterTests(discoveredTests, testSearchInput.value)
    : [];
  renderTestResults('Click Search to discover tests. Leave search criteria blank to show all tests.');
}

function openBuildTestWizard() {
  buildTestWizardForm.reset();
  document.querySelector('#wizardUseMcp').checked = true;
  document.querySelector('#wizardSelfLearn').checked = false;
  clearCodegenValidation();
  showBuildTestWizardInputStep();
  buildTestWizardDialog.showModal();
}

function showBuildTestWizardInputStep() {
  buildTestWizardStep = 'input';
  buildTestWizardInputStep.hidden = false;
  buildTestWizardFormattedStep.hidden = true;
  buildTestWizardPromptStep.hidden = true;
  backBuildTestWizardButton.hidden = true;
  formatRawCodeButton.hidden = false;
  generateAiPromptButton.hidden = true;
  copyAiPromptButton.hidden = true;
}

function showBuildTestWizardFormattedStep() {
  buildTestWizardStep = 'formatted';
  buildTestWizardInputStep.hidden = true;
  buildTestWizardFormattedStep.hidden = false;
  buildTestWizardPromptStep.hidden = true;
  backBuildTestWizardButton.hidden = false;
  formatRawCodeButton.hidden = true;
  generateAiPromptButton.hidden = false;
  copyAiPromptButton.hidden = true;
}

function showBuildTestWizardPromptStep() {
  buildTestWizardStep = 'prompt';
  buildTestWizardInputStep.hidden = true;
  buildTestWizardFormattedStep.hidden = true;
  buildTestWizardPromptStep.hidden = false;
  backBuildTestWizardButton.hidden = false;
  formatRawCodeButton.hidden = true;
  generateAiPromptButton.hidden = true;
  copyAiPromptButton.hidden = false;
}

function goBackBuildTestWizard() {
  if (buildTestWizardStep === 'prompt') {
    showBuildTestWizardFormattedStep();
    return;
  }

  showBuildTestWizardInputStep();
}

function formatRawCode() {
  const formData = new FormData(buildTestWizardForm);
  const codegenCode = String(formData.get('codegenCode') ?? '').trim();
  if (!codegenCode) {
    showCodegenValidation();
    return;
  }

  const formattedCode = buildFormattedCode({
    testType: formData.get('testType'),
    testSuite: formData.get('testSuite'),
    scenario: formData.get('scenario'),
    codegenCode
  });

  document.querySelector('#wizardFormattedCode').value = formattedCode;
  document.querySelector('#wizardAiPrompt').value = '';
  lastCommand.textContent = 'Formatted: Build Automated Test';
  writeOutput('Raw recorder code formatted. Review or edit it before generating the AI prompt.');
  showBuildTestWizardFormattedStep();
}

function showCodegenValidation() {
  const codegenInput = document.querySelector('#wizardCodegenCode');
  const codegenError = document.querySelector('#wizardCodegenCodeError');
  codegenInput.setAttribute('aria-invalid', 'true');
  codegenError.hidden = false;
  codegenInput.focus();
  lastCommand.textContent = 'Validation: Build Automated Test';
  writeOutput('Paste recorded Playwright code before formatting.');
}

function clearCodegenValidation() {
  const codegenInput = document.querySelector('#wizardCodegenCode');
  const codegenError = document.querySelector('#wizardCodegenCodeError');
  codegenInput.removeAttribute('aria-invalid');
  codegenError.hidden = true;
}

function generateAiPrompt() {
  const formData = new FormData(buildTestWizardForm);
  const formattedCode = document.querySelector('#wizardFormattedCode').value;
  const aiPrompt = buildAiPrompt({
    testType: formData.get('testType'),
    testSuite: formData.get('testSuite'),
    scenario: formData.get('scenario'),
    testObjective: formData.get('testObjective'),
    passCondition: formData.get('passCondition'),
    useMcp: formData.get('useMcp') === 'on',
    selfLearn: formData.get('selfLearn') === 'on',
    formattedCode
  });

  document.querySelector('#wizardAiPrompt').value = aiPrompt;
  lastCommand.textContent = 'Generated: AI Prompt';
  writeOutput('AI prompt generated from the formatted code. Review or edit it before copying.');
  showBuildTestWizardPromptStep();
}

function buildFormattedCode({ testType, testSuite, scenario, codegenCode }) {
  const suiteName = String(testSuite || 'New Test Suite').trim() || 'New Test Suite';
  const scenarioName = String(scenario || 'new test scenario').trim() || 'new test scenario';
  const testBody = extractCodegenTestBody(String(codegenCode || '').trim());
  const indentedBody = indentCode(testBody || '// Paste recorded Playwright steps before formatting.', 4);
  const testFunction = String(testType || 'ui') === 'ui' ? 'async ({ page })' : 'async ({ request })';

  return [
    `test.describe('${escapeJsString(suiteName)}', () => {`,
    `  test('${escapeJsString(scenarioName)}', ${testFunction} => {`,
    indentedBody,
    '  });',
    '});'
  ].join('\n');
}

function buildAiPrompt({
  testType,
  testSuite,
  scenario,
  testObjective,
  passCondition,
  useMcp,
  selfLearn,
  formattedCode
}) {
  const learningMode = selfLearn
    ? [
      'Feedback loop: enabled for review.',
      'Capture suggested lessons from any later human refinements, but do not auto-update prompt files or lessons without explicit approval.'
    ].join('\n')
    : [
      'Feedback loop: disabled.',
      'Do not create evaluation records, lesson updates, or prompt-improvement suggestions for this generation.'
    ].join('\n');

  const mcpInstruction = useMcp
    ? 'Use MCP context when available. If the local automation-context MCP server is configured, call get_repo_context, list_automation_artifacts, summarize_repo_conventions, get_test_generation_rules, get_output_template, get_lessons_learned, and get_relevant_examples with the selected app repo path before generating code.'
    : 'Do not rely on MCP context for this generation. Use only the prompt, pasted code, and any repo context directly available in the AI session.';
  const appAutomationRoot = currentRepoDir ? joinWorkspacePath(currentRepoDir, '_automation') : '';
  const baseFrameworkRepo = currentWorkspaceRoot ? joinWorkspacePath(currentWorkspaceRoot, 'playwright-base-framework') : '';
  const baseFrameworkSourceRoot = baseFrameworkRepo ? joinWorkspacePath(baseFrameworkRepo, 'src') : '';

  return [
    'You are converting raw Playwright recorder output into a framework-compatible automation test.',
    '',
    'Apply these generation rules:',
    '- Prefer reuse before creating new framework artifacts.',
    '- Before creating artifacts, check whether existing workflows, pages, models, test data, or tests fully or partially map to the requested scenario.',
    '- If an existing artifact partially matches, prefer updating or composing it when that keeps ownership clear and avoids unrelated behavior.',
    '- Clearly explain why any new artifact is needed instead of reusing or extending an existing one.',
    '- Tests should express business intent and stay concise.',
    '- Page objects should own locators and page-level actions.',
    '- Workflows should compose pages into reusable user journeys.',
    '- Models should represent reusable structured business or test data.',
    '- Test data should live outside specs when values are reusable or meaningful.',
    '- Discard or generalize dynamic query params, cache-busting values, redundant clicks, timing artifacts, and recorder noise.',
    '- Identify duplicate or ambiguous recorded actions and decide whether to keep, discard, or explain them.',
    '- Add meaningful assertions when recorder output only contains actions.',
    '- When the pass condition mentions multiple pages or steps, propose assertions for each meaningful destination instead of only the final page.',
    '- When asserting intermediate destinations on the same browser page, capture immutable state such as URL/title at the moment each destination is reached, or assert before continuing navigation.',
    '- If recorder output opens a popup, new tab, or new page, identify which page object should own the resulting page and whether the workflow should return that page.',
    '- Clearly mark assumptions when intent or expected state is inferred.',
    '- The formatted recorder code is still raw source material. Do not preserve raw locator sequences in the final test when framework abstractions should own them.',
    '- If the scenario, test objective, pass condition, and formatted code conflict, call out the conflict before generating code.',
    '',
    'Required output format:',
    '1. Framework Mapping',
    '   - Models: reuse/create/update',
    '   - Pages: reuse/create/update',
    '   - Test Data: reuse/create/update',
    '   - Workflows: reuse/create/update',
    '   - Tests: create/update',
    '2. Recorder Cleanup',
    '3. Recommended Assertions',
    '4. Proposed File Changes',
    '5. Generated Code grouped by file path',
    '6. Assumptions',
    '7. Confidence: High | Medium | Low',
    '',
    'Repository context instructions:',
    '- Use the selected app automation repo as the source of truth for app-specific pages, workflows, models, test data, and tests.',
    '- Inspect the app repo _automation folder first before generating code.',
    '- Look for _automation/pages, _automation/workflows, _automation/models, _automation/test-data, and _automation/tests.',
    '- Use the base framework src folder only if needed to understand shared APIs such as BasePage, fixtures, assertions, waits, and actions.',
    '- Prefer app repo conventions over generic assumptions.',
    '- Do not add app-specific artifacts to the shared base framework package.',
    `- ${mcpInstruction}`,
    '',
    'Repository paths:',
    `- Selected app automation repo: ${stringOrFallback(currentRepoDir, 'Not provided by dashboard.')}`,
    `- App automation folder: ${stringOrFallback(appAutomationRoot, 'Not provided by dashboard.')}`,
    `- Base framework package: @your-org/playwright-base-framework`,
    `- Base framework repo, if available: ${stringOrFallback(baseFrameworkRepo, 'Not provided by dashboard.')}`,
    `- Base framework source folder, if available: ${stringOrFallback(baseFrameworkSourceRoot, 'Not provided by dashboard.')}`,
    '',
    'Narrowed inspection order:',
    '1. Inspect the selected app automation repo _automation folder first.',
    '2. Identify existing workflows that fully or partially match the requested journey.',
    '3. Identify existing pages, models, test data, and tests that fully or partially match the requested scenario.',
    '4. Prefer reuse, composition, or focused updates before creating new artifacts.',
    '5. Inspect the base framework src folder only for shared framework APIs and conventions.',
    '6. Generate app-specific files only under the selected app automation repo.',
    '',
    learningMode,
    '',
    'Test request:',
    `- Test type: ${formatTestType(testType)}`,
    `- Test suite: ${stringOrFallback(testSuite, 'New Test Suite')}`,
    `- Scenario: ${stringOrFallback(scenario, 'new test scenario')}`,
    '',
    'Test objective:',
    stringOrFallback(
      testObjective,
      'Not provided. Infer the test objective from the formatted recorder code and mark assumptions. Confidence may be lower.'
    ),
    '',
    'What should prove that the test passed?',
    stringOrFallback(
      passCondition,
      'Not provided. Infer meaningful assertions from the formatted recorder code and mark assumptions. Confidence may be lower.'
    ),
    '',
    'Formatted recorder code:',
    '```ts',
    formattedCode,
    '```'
  ].join('\n');
}

async function copyAiPrompt() {
  const prompt = document.querySelector('#wizardAiPrompt').value;
  if (!prompt.trim()) {
    writeOutput('Generate the AI prompt before copying.');
    return;
  }

  try {
    await navigator.clipboard.writeText(prompt);
    lastCommand.textContent = 'Copied: AI Prompt';
    writeOutput('AI prompt copied to clipboard.');
  } catch {
    document.querySelector('#wizardAiPrompt').focus();
    document.querySelector('#wizardAiPrompt').select();
    writeOutput('Clipboard access was blocked. The AI prompt is selected in the wizard.');
  }
}

function extractCodegenTestBody(codegenCode) {
  if (!codegenCode) {
    return '';
  }

  const lines = codegenCode.split(/\r?\n/);
  const testStartIndex = lines.findIndex((line) => isRecordedTestStart(line));
  if (testStartIndex >= 0) {
    return extractRecordedTestBody(lines, testStartIndex);
  }

  return cleanupExtractedTestBody(lines.filter((line) => !line.trim().startsWith('import '))).join('\n');
}

function isRecordedTestStart(line) {
  return /test\s*\(/.test(line) && /async\s*\(\s*\{\s*(page|request)\s*\}\s*\)/.test(line);
}

function extractRecordedTestBody(lines, testStartIndex) {
  const bodyLines = [];
  let braceDepth = countCharacter(lines[testStartIndex], '{') - countCharacter(lines[testStartIndex], '}');

  for (const line of lines.slice(testStartIndex + 1)) {
    braceDepth += countCharacter(line, '{') - countCharacter(line, '}');
    if (braceDepth <= 0) {
      break;
    }

    bodyLines.push(line);
  }

  return cleanupExtractedTestBody(bodyLines).join('\n');
}

function cleanupExtractedTestBody(lines) {
  let cleanedLines = trimEmptyLines(dedentLines(lines));
  let previousLength = -1;

  while (cleanedLines.length && cleanedLines.length !== previousLength) {
    previousLength = cleanedLines.length;
    cleanedLines = discardLeadingPlaywrightWrapper(cleanedLines);
    cleanedLines = trimEmptyLines(dedentLines(cleanedLines));
  }

  return cleanedLines;
}

function discardLeadingPlaywrightWrapper(lines) {
  const firstCodeIndex = lines.findIndex((line) => line.trim());
  if (firstCodeIndex < 0 || !isPlaywrightWrapperStart(lines[firstCodeIndex])) {
    return lines;
  }

  let braceDepth = 0;
  for (let index = firstCodeIndex; index < lines.length; index += 1) {
    braceDepth += countCharacter(lines[index], '{') - countCharacter(lines[index], '}');
    if (braceDepth <= 0 && index > firstCodeIndex) {
      return [
        ...lines.slice(0, firstCodeIndex),
        ...lines.slice(firstCodeIndex + 1, index),
        ...lines.slice(index + 1)
      ];
    }
  }

  return lines;
}

function isPlaywrightWrapperStart(line) {
  return /^\s*test(?:\.describe)?\s*\(/.test(line);
}

function dedentLines(lines) {
  const nonEmptyLines = lines.filter((line) => line.trim());
  const minIndent = nonEmptyLines.reduce((minimum, line) => {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    return Math.min(minimum, indent);
  }, Number.POSITIVE_INFINITY);

  if (!Number.isFinite(minIndent) || minIndent === 0) {
    return lines;
  }

  return lines.map((line) => line.slice(Math.min(minIndent, line.length)));
}

function trimEmptyLines(lines) {
  const trimmed = [...lines];
  while (trimmed.length && !trimmed[0].trim()) {
    trimmed.shift();
  }
  while (trimmed.length && !trimmed.at(-1).trim()) {
    trimmed.pop();
  }
  return trimmed;
}

function indentCode(code, spaces) {
  const prefix = ' '.repeat(spaces);
  return code
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function countCharacter(value, character) {
  return [...value].filter((item) => item === character).length;
}

function escapeJsString(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function stringOrFallback(value, fallback) {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function joinWorkspacePath(root, child) {
  const normalizedRoot = String(root ?? '').replace(/[\\/]+$/, '');
  const normalizedChild = String(child ?? '').replace(/^[\\/]+/, '');
  if (!normalizedRoot) {
    return normalizedChild;
  }

  return `${normalizedRoot}\\${normalizedChild}`;
}

function formatTestType(value) {
  const text = String(value ?? '').trim();
  return text ? text.toUpperCase() : 'UI';
}

async function searchTests() {
  testResultsBody.innerHTML = '<div class="test-results-empty">Searching tests...</div>';
  try {
    if (!hasDiscoveredAllTests) {
      const result = await api('/api/tests');
      discoveredTests = mergeTestsById(discoveredTests, result.tests ?? []);
      hasDiscoveredAllTests = true;
    }

    visibleTests = filterTests(discoveredTests, testSearchInput.value);
    renderTestResults();
  } catch (error) {
    testResultsBody.innerHTML = `<div class="test-results-empty">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  }
}

function filterTests(tests, criteria) {
  const term = criteria.trim().toLowerCase();
  if (!term) {
    return tests;
  }

  return tests.filter((test) => [
    getTestCategory(test),
    test.title,
    test.suite,
    getTestFileName(test),
    test.file,
    test.location,
    test.projects?.join(' ')
  ].some((value) => String(value ?? '').toLowerCase().includes(term)));
}

function renderTestResults(emptyMessage = 'No tests found.') {
  if (!visibleTests.length) {
    testResultsBody.innerHTML = `<div class="test-results-empty">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  testResultsBody.innerHTML = visibleTests
    .map((test) => `
      <label class="test-result-row">
        <span>
          <input type="checkbox" value="${escapeHtml(test.id)}" ${draftSelectedTestIds.has(test.id) ? 'checked' : ''}>
        </span>
        <span>${escapeHtml(getTestCategory(test))}</span>
        <span>${escapeHtml(test.title)}</span>
        <span>${escapeHtml(test.suite || 'No suite')}</span>
        <span>${escapeHtml(getTestFileName(test))}</span>
      </label>
    `)
    .join('');

  testResultsBody.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) {
        draftSelectedTestIds.add(input.value);
      } else {
        draftSelectedTestIds.delete(input.value);
      }
    });
  });
}

function selectVisibleTests() {
  visibleTests.forEach((test) => draftSelectedTestIds.add(test.id));
  renderTestResults();
}

function clearSelectedTests() {
  draftSelectedTestIds = new Set();
  renderTestResults();
}

function applySelectedTests() {
  selectedTestIds = new Set(draftSelectedTestIds);
  renderSelectedTestsGrid();
  if (currentRepoType === 'generic-playwright') {
    saveGenericRepoSelection(getSelectedTestsForSettings());
  } else {
    updateSettingsSaveState();
  }
  testsDialog.close();
}

function renderSelectedTestsGrid() {
  const selectedTests = getSelectedTestsForSettings();

  if (!selectedTests.length) {
    selectedTestsGrid.innerHTML = '<div class="empty-grid-state">No Tests Selected</div>';
    return;
  }

  selectedTestsGrid.innerHTML = selectedTests
    .map((test) => `
      <div class="selected-test-row">
        <span>${escapeHtml(getTestCategory(test))}</span>
        <span>${escapeHtml(test.title)}</span>
        <span>${escapeHtml(test.suite || 'No suite')}</span>
        <span>${escapeHtml(getTestFileName(test))}</span>
      </div>
    `)
    .join('');
  selectedTestsGrid.insertAdjacentHTML('afterbegin', `
    <div class="selected-test-header">
      <span>Category</span>
      <span>Test</span>
      <span>Suite</span>
      <span>File</span>
    </div>
  `);
}

function renderCommandResult(result) {
  lastCommand.textContent = `${result.ok ? 'Passed' : 'Failed'}: ${result.command} (exit ${result.exitCode})`;
  writeOutput([result.stdout, result.stderr].filter(Boolean).join('\n'));
}

function writeOutput(value) {
  output.textContent = value || 'No output.';
}

function showHandoffOverlay(message) {
  handoffMessage.textContent = message;
  handoffOverlay.hidden = false;
}

function hideHandoffOverlay() {
  handoffOverlay.hidden = true;
}

async function waitForDashboardReady(expectedTitle) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`/?handoff=${Date.now()}`, { cache: 'no-store' });
      const html = await response.text();
      if (response.ok && html.includes(`<title>${expectedTitle}</title>`)) {
        return;
      }
    } catch {
      // The port can be briefly unavailable while the dashboard process swaps.
    }

    await delay(250);
  }

  throw new Error(`${expectedTitle} did not become ready. Try starting the dashboard again.`);
}

async function waitForDashboardExit(currentTitle) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`/?handoff=${Date.now()}`, { cache: 'no-store' });
      const html = await response.text();
      if (!response.ok || !html.includes(`<title>${currentTitle}</title>`)) {
        return;
      }
    } catch {
      return;
    }

    await delay(250);
  }

  throw new Error(`${currentTitle} did not close. Try starting the dashboard again.`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function setBusy(busy) {
  document.querySelectorAll('button').forEach((button) => {
    button.disabled = busy;
  });
  repoSelect.disabled = busy;
  if (!busy) {
    loadRepoButton.disabled = repoSelect.value === currentRepoDir;
    updateSettingsSaveState();
  }
}

function updateSettingsSaveState() {
  saveSettingsButton.disabled = currentRepoType !== 'framework' || !currentSettings || settingsSnapshotFromForm() === savedSettingsSnapshot;
}

function settingsSnapshotFromForm() {
  return JSON.stringify({
    appBaseUrl: document.querySelector('#appBaseUrl').value,
    apiBaseUrl: document.querySelector('#apiBaseUrl').value,
    browsers: getSelectedBrowsers(),
    headless: document.querySelector('#headless').checked,
    slowMo: Number(document.querySelector('#slowMo').value) || 0,
    testSelection: getSelectedTestsForSettings()
  });
}

function getSelectedTestsForSettings() {
  const testsById = new Map(discoveredTests.map((test) => [test.id, test]));
  return [...selectedTestIds]
    .map((id) => testsById.get(id))
    .filter(Boolean)
    .map((test) => ({
      id: test.id,
      title: test.title,
      suite: test.suite,
      file: test.file,
      location: test.location
    }));
}

function mergeTestsById(existingTests, additionalTests) {
  const tests = new Map();
  [...existingTests, ...additionalTests].forEach((test) => {
    if (test?.id) {
      tests.set(test.id, test);
    }
  });
  return [...tests.values()];
}

function getCommandBody(id) {
  if (currentRepoType !== 'generic-playwright' || !['testSelected', 'testUi'].includes(id)) {
    return {};
  }

  const selectedTests = getSelectedTestsForSettings();
  return selectedTests.length
    ? { tests: selectedTests.map((test) => ({ id: test.id, location: test.location })) }
    : {};
}

function getGenericRepoSelection() {
  try {
    return JSON.parse(localStorage.getItem(getGenericRepoSelectionKey()) ?? '[]');
  } catch {
    return [];
  }
}

function saveGenericRepoSelection(tests) {
  localStorage.setItem(getGenericRepoSelectionKey(), JSON.stringify(tests));
}

function getGenericRepoSelectionKey() {
  return `genericTestSelection:${currentRepoDir}`;
}

function getTestCategory(test) {
  return splitTestPath(test.file)[0] ?? '';
}

function getTestFileName(test) {
  const parts = splitTestPath(test.file);
  return parts.at(-1) ?? '';
}

function splitTestPath(file) {
  return String(file ?? '').split(/[\\/]/).filter(Boolean);
}

function withRepo(body) {
  return JSON.stringify({ ...body, repoDir: currentRepoDir });
}

async function api(path, options = {}, includeRepo = true) {
  const url = new URL(path, window.location.origin);
  if (includeRepo && currentRepoDir && !options.body) {
    url.searchParams.set('repoDir', currentRepoDir);
  }

  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  const json = await response.json();
  if (!response.ok || json.ok === false) {
    throw new Error(json.error ?? 'Request failed');
  }

  return json;
}

async function commandApi(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error ?? 'Request failed');
  }

  return json;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
