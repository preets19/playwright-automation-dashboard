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
const wizardAiPromptPreview = document.querySelector('#wizardAiPromptPreview');
const backBuildTestWizardButton = document.querySelector('#backBuildTestWizardButton');
const closeBuildTestWizardButton = document.querySelector('#closeBuildTestWizardButton');
const formatRawCodeButton = document.querySelector('#formatRawCodeButton');
const generateAiPromptButton = document.querySelector('#generateAiPromptButton');
const copyAiPromptButton = document.querySelector('#copyAiPromptButton');
const generateTestWithAiButton = document.querySelector('#generateTestWithAiButton');
const doneBuildTestWizardButton = document.querySelector('#doneBuildTestWizardButton');
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
let preparedAutomationContext = null;
let automationContextPromise = null;
let hiddenAutomationContextSection = '';
let feedbackCaptureSessionId = '';
let feedbackCaptureTimer = 0;
const hiddenAutomationContextNotice = 'Prepared dashboard automation context: Included. Hidden from this editor, but included when copying or sending to AI.';

document.querySelector('#backHomeButton').addEventListener('click', backToHomeDashboard);
loadRepoButton.addEventListener('click', loadSelectedRepo);
document.querySelector('#stopAutomationButton').addEventListener('click', () => stopDialog.showModal());
document.querySelector('#confirmStopButton').addEventListener('click', stopAutomation);
document.querySelector('#buildAutomatedTestButton').addEventListener('click', openBuildTestWizard);
backBuildTestWizardButton.addEventListener('click', goBackBuildTestWizard);
closeBuildTestWizardButton.addEventListener('click', closeBuildTestWizard);
formatRawCodeButton.addEventListener('click', formatRawCode);
generateAiPromptButton.addEventListener('click', generateAiPrompt);
copyAiPromptButton.addEventListener('click', copyAiPrompt);
generateTestWithAiButton.addEventListener('click', generateTestWithAi);
doneBuildTestWizardButton.addEventListener('click', closeBuildTestWizard);
document.querySelectorAll('[data-guided-prompt]').forEach((button) => {
  button.addEventListener('click', () => copyGuidedPrompt(button.dataset.guidedPrompt));
});
document.querySelector('#wizardCodegenCode').addEventListener('input', clearCodegenValidation);
document.querySelectorAll('.guided-result-textarea').forEach((textarea) => {
  textarea.addEventListener('input', () => queueFeedbackCapture('guided_output_changed'));
});
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
  visibleTests = [];
  renderTestResults('Searching tests...');
  void searchTests();
}

function closeBuildTestWizard() {
  clearGuidedCopyStatuses();
  buildTestWizardDialog.close();
}

function clearGuidedCopyStatuses() {
  document.querySelectorAll('.guided-copy-status').forEach((status) => {
    status.textContent = '';
    status.classList.remove('is-visible');
  });
}

function openBuildTestWizard() {
  void prepareAutomationContext({ silent: false });
  resetFeedbackCaptureSession();
  clearGuidedCopyStatuses();
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
  doneBuildTestWizardButton.hidden = true;
  generateTestWithAiButton.hidden = true;
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
  doneBuildTestWizardButton.hidden = true;
  generateTestWithAiButton.hidden = true;
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
  doneBuildTestWizardButton.hidden = false;
  generateTestWithAiButton.hidden = true;
  generateTestWithAiButton.disabled = true;
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
  resetAiResult();
  void captureFeedbackSnapshot('formatted_code_created', { promptFlow: 'guided' });
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

async function generateAiPrompt() {
  const formData = new FormData(buildTestWizardForm);
  const formattedCode = document.querySelector('#wizardFormattedCode').value;
  const useMcp = formData.get('useMcp') === 'on';
  const contextBundle = useMcp ? await prepareAutomationContext({ silent: true }) : null;
  const aiPrompt = buildAiPrompt({
    testType: formData.get('testType'),
    testSuite: formData.get('testSuite'),
    scenario: formData.get('scenario'),
    testObjective: formData.get('testObjective'),
    passCondition: formData.get('passCondition'),
    useMcp,
    selfLearn: formData.get('selfLearn') === 'on',
    formattedCode,
    contextBundle
  });

  hiddenAutomationContextSection = extractPreparedContextSection(aiPrompt);
  document.querySelector('#wizardAiPrompt').value = createVisibleAiPrompt(aiPrompt);
  renderAiPromptPreview({
    testType: formData.get('testType'),
    testSuite: formData.get('testSuite'),
    scenario: formData.get('scenario'),
    contextIncluded: Boolean(contextBundle),
    selfLearn: formData.get('selfLearn') === 'on'
  });
  resetAiResult();
  void captureFeedbackSnapshot('quick_prompt_generated', {
    promptFlow: 'quick',
    quickPrompt: aiPrompt
  });
  lastCommand.textContent = 'Generated: AI Prompt';
  writeOutput(contextBundle
    ? 'AI prompt generated with prepared dashboard context. Review or edit it before copying.'
    : 'AI prompt generated from the formatted code. Review or edit it before copying.');
  showBuildTestWizardPromptStep();
}

function renderAiPromptPreview({ testType, testSuite, scenario, contextIncluded, selfLearn }) {
  wizardAiPromptPreview.innerHTML = [
    promptPreviewRow('Test type', formatTestType(testType)),
    promptPreviewRow('Test suite', stringOrFallback(testSuite, 'New Test Suite')),
    promptPreviewRow('Scenario', stringOrFallback(scenario, 'new test scenario')),
    promptPreviewRow('Repository', stringOrFallback(currentRepoDir, 'Not provided by dashboard.')),
    promptPreviewRow('Context', contextIncluded ? 'Prepared dashboard context included' : 'Prepared dashboard context not included'),
    promptPreviewRow('Guardrails', 'Enabled: _automation write scope, framework proposal-only, validation required'),
    promptPreviewRow('Feedback loop', selfLearn ? 'Enabled for reviewable notes' : 'Disabled')
  ].join('');
}

function promptPreviewRow(label, value) {
  return `<div class="ai-prompt-preview-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
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
  formattedCode,
  contextBundle
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
  const preparedContextSection = useMcp && contextBundle
    ? `Prepared dashboard automation context:\n\`\`\`json\n${JSON.stringify(contextBundle, null, 2)}\n\`\`\`\n`
    : '';

  return [
    'You are converting raw Playwright recorder output into a framework-compatible automation test.',
    '',
    'Important execution rule:',
    '- Before making file changes or running generation commands, read the entire prompt, including generation rules, repo safety guardrails, scenario analysis instructions, repository paths, prepared dashboard context, and formatted recorder code.',
    '- Complete the Scenario Analysis section before creating or editing files.',
    '- Do not begin implementation from the formatted recorder code alone. Recorder code is raw source material and must be interpreted through framework rules, existing artifacts, and prepared dashboard context.',
    '',
    'Apply these generation rules:',
    '- Prefer reuse before creating new framework artifacts.',
    '- Before creating artifacts, check whether existing workflows, pages, models, test data, or tests fully or partially map to the requested scenario.',
    '- If an existing artifact partially matches, prefer updating or composing it when that keeps ownership clear and avoids unrelated behavior.',
    '- Treat sample* artifacts as reference examples for framework style. When real app artifacts exist, prefer reusing and extending those real artifacts before copying or modifying sample artifacts.',
    '- Clearly explain why any new artifact is needed instead of reusing or extending an existing one.',
    '- Naming contract: use camelCase for files, variables, methods, and locator fields; PascalCase for classes and types; full suffixes such as Button, Input, Select, Link, Menu, MenuItem, Modal, Toast, Message, Heading, or Title; no abbreviated UI prefixes such as btn, dd, ddl, txt, lbl, or msg.',
    '- Contract discipline: define page method signatures, workflow method signatures, workflow return shape, assertion inputs, data ownership, and wait ownership before writing code.',
    '- Implement the approved names and contracts without renaming artifacts or changing workflow return shapes during code generation.',
    '- Specs should assert against resolved strings, booleans, numbers, or typed result objects returned by workflows, not raw Locator objects, unless the repo has explicit page-owned assertion helper conventions.',
    '- Tests should express business intent and stay concise.',
    '- Do not automate every recorded action by default. Preserve interactions that prove the stated behavior and shorten setup steps when a stable direct route or existing workflow is more reliable.',
    '- Page objects should own locators and page-level actions.',
    '- Page objects should provide or override waitUntilReady() when a page, modal, panel, wizard step, or dynamic component has a stable readiness signal.',
    '- Workflows should compose pages into reusable user journeys.',
    '- Workflows should call waitUntilReady() after navigation, route changes, search/filter actions, modal or drawer opens, checkout/wizard step changes, add-to-cart operations, form submissions, and other actions that change visible application state.',
    '- Models should represent reusable structured business or test data.',
    '- Test data should live outside specs when values are reusable or meaningful.',
    '- Map reusable interactions to the framework interaction catalog before writing raw Playwright calls. Examples include click, fill, selectByText, selectByValue, check, uncheck, uploadFile, press, clickMenuItem, selectComboboxOption, clickTab, closeModal, waits.forToastVisible, waits.forResults, clickTableRowByText, and paginateNext.',
    '- Use shared framework waits/actions such as this.waits.forVisible(...), this.waits.forHidden(...), this.waits.forEditable(...), and this.actions.click(...) instead of fixed sleeps or raw wait mechanics in specs.',
    '- Prefer observable readiness signals such as visible headings, hidden spinners, editable fields, enabled buttons, loaded result counts, URL/path changes, updated cart count, or confirmation text.',
    '- Do not use page.waitForTimeout() for normal readiness. If no observable signal exists, call out the risk and keep any fallback isolated and justified.',
    '- Discard or generalize dynamic query params, cache-busting values, redundant clicks, timing artifacts, and recorder noise.',
    '- Treat the first recorded page.goto URL as the candidate application start URL. Strip dynamic query params before comparing it with configured app base URL or test data.',
    '- In the output, explicitly state whether the starting URL should reuse the existing app base URL, recommend a config base URL update, or remain test-specific navigation data.',
    '- Do not hard-code the full recorded start URL in the final test unless there is a clear test-specific reason.',
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
    '0. Scenario Analysis',
    '   - App entry point',
    '   - Intended user journey',
    '   - Stable selectors and page ownership',
    '   - Reusable data',
    '   - Success criteria',
    '   - Special conditions and risks',
    '   - Readiness signals and state transitions',
    '1. Framework Mapping',
    '   - Models: reuse/create/update',
    '   - Pages: reuse/create/update',
    '   - Test Data: reuse/create/update',
    '   - Workflows: reuse/create/update',
    '   - Tests: create/update',
    '   - Base URL handling: reuse existing | recommend config update | test-specific URL',
    '2. Recorder Cleanup',
    '3. Naming And Contracts',
    '   - Artifact names',
    '   - Page/workflow method signatures',
    '   - Workflow return shape',
    '   - Assertion input types',
    '4. Recommended Assertions',
    '5. Readiness And Waiting Plan',
    '   - Page/component waitUntilReady methods',
    '   - Workflow transition waits',
    '   - Any fallback wait risks',
    '6. Proposed File Changes',
    '7. Generated Code grouped by file path',
    '8. Assumptions',
    '9. Framework Enhancement Proposal: None | Recommended',
    '10. Confidence: High | Medium | Low',
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
    'Repo safety guardrails:',
    '- Before editing, check whether the selected app repo is a Git repository.',
    '- If Git is available, check the current branch and working tree status.',
    '- If Git is available, prefer working on a generated-test branch or sandbox worktree. If you cannot create one, tell the user before applying changes.',
    '- If Git is not available, do not attempt Git commands. Tell the user this is a non-Git workspace and recommend making a folder backup before applying changes.',
    '- If unrelated local changes exist, do not overwrite them; call them out before editing.',
    '- Create or update files only under the selected app repo _automation folder.',
    '- Do not modify app source, package files, Playwright config, base framework files, dashboard files, scripts, or sibling repos.',
    '- If a required change appears outside _automation, stop and include it as a recommendation instead of editing it.',
    '- Use the prepared dashboard context as the primary source of truth.',
    '- You may inspect files referenced by existing automation imports.',
    '- Inspect base framework src and .ai only to understand shared APIs, rules, or conventions.',
    '- Avoid unrelated repos, dashboard implementation files, and app source unless explicitly requested or needed to explain a blocker.',
    '- Do not modify the base framework. If an existing helper does not support a widget, implement the interaction in an app page object or app component under _automation.',
    '- If a missing helper is broadly reusable, include a Framework Enhancement Proposal instead of editing the framework.',
    '- Run typecheck and the targeted generated spec when available.',
    '- If validation fails, report the failure and fix only within _automation.',
    '- Do not expand write scope to fix unrelated infrastructure.',
    '- If generated work is rejected and Git is available, rollback by deleting the generated branch or sandbox worktree.',
    '- If Git is not available, rollback requires restoring the user folder backup or manually reverting generated files.',
    '- Do not use destructive reset commands on the user original branch.',
    '',
    'Scenario analysis instructions:',
    '- Derive the app entry point from the first recorded page.goto URL, the configured appBaseUrl in prepared context, and any existing app navigation conventions.',
    '- State whether the test should use the existing configured base URL, recommend a config update, or keep test-specific navigation data.',
    '- Infer the intended user journey from the scenario name, test objective, pass condition, and recorder code.',
    '- Convert raw recorder actions into high-level business steps before choosing framework artifacts.',
    '- Identify meaningful selectors/signals from recorder code and decide which page object or app component should own them.',
    '- Prefer existing page objects and workflows that already own matching pages, selectors, or journey segments.',
    '- Identify reusable values from recorder code, including users, products, addresses, payment details, form inputs, search terms, expected messages, URLs, or other business data.',
    '- Reuse existing models and test data when they match. Create or update app-owned test data only when values are meaningful or reusable.',
    '- Use the pass condition as the primary assertion source. If it is incomplete, infer meaningful assertions from the final state and mark assumptions.',
    '- Identify special conditions such as popups, new tabs, dynamic ids, duplicate actions, timing artifacts, ambiguous actions, login/account state, shared data risks, or missing helper APIs, and explain how each was handled.',
    '- Identify readiness boundaries where Playwright actionability is not enough, such as async data load, spinner overlays, route changes, modal transitions, cart count updates, wizard step changes, and post-submit confirmations.',
    '- Identify whether recorded navigation steps are setup or behavior under test. If they are setup, prefer direct navigation when the route is stable and app conventions allow it.',
    '',
    'Artifact decomposition using prepared context:',
    '- Do not infer artifact structure from the recorder alone. Map the recorder-derived scenario onto the prepared dashboard/MCP context and existing app automation conventions.',
    '- Treat each distinct visited application page, route, tab, wizard step, modal, drawer, or stable panel in the recorder as a candidate page object or app component.',
    '- Create or update a page object or component when that UI area owns meaningful locators, actions, state, or assertions.',
    '- Hidden modals, drawers, wizard steps, and reusable panels may be represented as app components or page-level methods when that matches existing repo conventions.',
    '- Do not create a separate page object for incidental transient UI unless it has reusable behavior or important assertions.',
    '- Compare every candidate page/component against existing pages/components from prepared context before creating a new file.',
    '- Capture meaningful recorded form inputs, search terms, selected options, addresses, payment values, account/user values, expected messages, and other business data as structured test data.',
    '- Compare every candidate model/test-data shape against existing models and test data from prepared context before creating or updating files.',
    '- If the scenario spans multiple pages, routes, tabs, wizard steps, or meaningful business actions, model it as a workflow that composes page/page-component actions.',
    '- Workflows should return the page object or result state needed by the spec for assertions.',
    '- Specs must use workflows, page objects, models, and test data. Specs must not contain raw recorder locator chains.',
    '- Specs must not contain normal readiness waits when a page object or workflow can own them.',
    '- If recorder output opens a menu/dropdown/popover and then clicks an item, use a page/component method backed by the framework menu interaction helper when that navigation is under test.',
    '- Place new artifacts in the same folder and naming pattern used by similar existing artifacts. If the repo has grouped folders by app area or category, follow that grouping.',
    '- If no grouping exists, follow the current repo convention and mention grouping as a separate recommendation instead of silently reorganizing existing files.',
    '- Use readable naming: camelCase files/variables/methods/locators, PascalCase classes/types, full element-type suffixes, and no abbreviated UI prefixes.',
    '- Define workflow return values as resolved assertion-ready data. For example, return a string for a message assertion, not a Locator.',
    '',
    'Repository paths:',
    `- Selected app automation repo: ${stringOrFallback(currentRepoDir, 'Not provided by dashboard.')}`,
    `- App automation folder: ${stringOrFallback(appAutomationRoot, 'Not provided by dashboard.')}`,
    `- Base framework package: @your-org/playwright-base-framework`,
    `- Base framework repo, if available: ${stringOrFallback(baseFrameworkRepo, 'Not provided by dashboard.')}`,
    `- Base framework source folder, if available: ${stringOrFallback(baseFrameworkSourceRoot, 'Not provided by dashboard.')}`,
    '',
    preparedContextSection,
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

async function copyGuidedPrompt(stage) {
  const prompt = await buildGuidedPrompt(stage);
  if (!prompt.trim()) {
    writeOutput('Unable to build guided AI prompt.');
    return;
  }

  void captureFeedbackSnapshot('guided_prompt_copied', {
    promptFlow: 'guided',
    guidedStage: stage,
    guidedPrompt: prompt
  });

  try {
    await navigator.clipboard.writeText(prompt);
    showGuidedCopyStatus(stage);
    lastCommand.textContent = `Copied: ${guidedStageName(stage)} Prompt`;
    writeOutput(`${guidedStageName(stage)} prompt copied to clipboard.`);
  } catch {
    writeOutput('Clipboard access was blocked. Open the advanced prompt editor and copy manually from the generated quick prompt, or try again.');
  }
}

function showGuidedCopyStatus(stage) {
  const status = document.querySelector(`[data-guided-copy-status="${stage}"]`);
  if (!status) {
    return;
  }

  status.textContent = 'Copied!';
  status.classList.add('is-visible');
}

async function buildGuidedPrompt(stage) {
  const formData = new FormData(buildTestWizardForm);
  const promptInput = {
    testType: formData.get('testType'),
    testSuite: formData.get('testSuite'),
    scenario: formData.get('scenario'),
    testObjective: formData.get('testObjective'),
    passCondition: formData.get('passCondition'),
    formattedCode: document.querySelector('#wizardFormattedCode').value,
    analysis: document.querySelector('#guidedAnalysisResult').value.trim(),
    mapping: document.querySelector('#guidedMappingResult').value.trim(),
    design: document.querySelector('#guidedDesignResult').value.trim(),
    generatedCode: document.querySelector('#guidedCodeResult').value.trim()
  };
  const contextBundle = formData.get('useMcp') === 'on'
    ? await prepareAutomationContext({ silent: true })
    : null;

  switch (stage) {
    case 'analysis':
      return buildRecorderAnalysisPrompt(promptInput);
    case 'mapping':
      return buildFrameworkMappingPrompt(promptInput, contextBundle);
    case 'design':
      return buildArtifactDesignPrompt(promptInput, contextBundle);
    case 'code':
      return buildCodeGenerationPrompt(promptInput, contextBundle);
    case 'review':
      return buildGeneratedCodeReviewPrompt(promptInput, contextBundle);
    default:
      return '';
  }
}

function buildRecorderAnalysisPrompt(input) {
  return [
    'You are the Recorder Parser for a framework-compatible Playwright test generation workflow.',
    '',
    'Task:',
    '- Parse the formatted Playwright recorder code into deterministic facts.',
    '- Do not inspect repository files.',
    '- Do not write code.',
    '- Do not propose framework artifacts.',
    '- Do not approve or reject framework implementation. Only describe recorder facts, inferred intent, and locator risk.',
    '',
    'Return JSON with this shape:',
    '```json',
    '{',
    '  "entry": { "recordedUrl": "", "origin": "", "path": "", "queryParams": {}, "normalizedStartPath": "", "notes": "" },',
    '  "operationTrace": [{ "order": 1, "rawOperation": "", "operationType": "goto | click | fill | select | check | assertion | popup | wait | noise", "assertionRole": "readiness | success | intermediate | none", "pageOrStepHint": "", "rawLocator": "", "locatorParts": { "parentScope": "", "parentScopeRisk": "stable | dynamic | broad | none | unknown", "childTarget": "", "childTargetType": "role | text | label | testId | css | xpath | unknown", "childTargetValue": "" }, "value": "", "intentHint": "", "isMeaningful": true, "riskFlags": [], "candidateFallback": { "strategy": "useAsIs | stripDynamicParent | scopeRequired | firstMatchProvisional | block | none", "candidateLocator": "", "reason": "" } }],',
    '  "dataCandidates": [{ "nameHint": "", "sourceOperationOrder": 1, "rawLocator": "", "value": "", "dataKind": "input | selection | expectedText | expectedRoute | clickedVariableText", "reason": "" }],',
    '  "pageStepCandidates": [{ "nameHint": "", "type": "page | component | modal | drawer | panel | tab | wizardStep | popup", "evidenceOperationOrders": [], "reason": "" }],',
    '  "assertions": [{ "sourceOperationOrder": 1, "rawAssertion": "", "assertionRole": "readiness | success | intermediate", "expectedValue": "", "reason": "" }],',
    '  "stateTransitions": [{ "triggerOperationOrder": 1, "triggerIntent": "", "expectedReadyState": "", "waitOwnerHint": "page | workflow | test", "reason": "" }],',
    '  "recorderNoise": [{ "sourceOperationOrder": 1, "rawOperation": "", "reason": "" }],',
    '  "ambiguities": [{ "sourceOperationOrder": 1, "question": "", "impact": "" }]',
    '}',
    '```',
    '',
    'Parsing rules:',
    '- Treat the first page.goto URL as the candidate app entry point. Normalize origin with protocol and host, path, queryParams, and normalizedStartPath.',
    '- Preserve every recorder operation in operationTrace order. Mark focus-only clicks, duplicate clicks, Tab presses, arrow-key corrections, and incidental container clicks as noise only when they do not trigger meaningful UI state.',
    '- Classify operationType from the Playwright function: goto, click, fill, select, check, assertion, popup, wait, or noise.',
    '- Classify assertions as readiness when they protect a later action, success when they match the stated pass condition or final state, and intermediate otherwise.',
    '- Extract dataCandidates from fill/select/check values, clicked variable business text, selected options, expected assertion text, expected routes, and scenario-specific values.',
    '- Capture candidate page or step boundaries from route changes, popups/new tabs, modals, drawers, tabs, panels, wizard steps, stable headings, and major workflow transitions.',
    '- Capture stateTransitions for navigation, menu open, modal/panel open, filter/search apply, form submit, add/remove, checkout/wizard step, popup handling, and final result load.',
    '',
    'Locator decomposition rules:',
    '- Do not treat a locator as a single opaque string when it has chained parts. Split it into parentScope and childTarget when possible.',
    '- Example: page.locator(\'#tippy-85\').getByText(\'India Women\') has parentScope #tippy-85, parentScopeRisk dynamic, childTarget getByText(\'India Women\'), childTargetType text, childTargetValue India Women.',
    '- Dynamic parent scopes include generated ids, tippy/popover ids, framework-generated ids, changing ids, and transient overlay containers.',
    '- Broad parent scopes include generic div/body/container locators, class-only layout locators, nth/first ordinal selection, and unscoped CSS classes.',
    '- Stable parent scopes include test ids, semantic regions, named dialogs, named forms, named navigation/menus, stable headings/sections, or other specific business containers.',
    '- Child targets can be role/name, text, label, testId, css, xpath, or unknown. Capture their visible value when present.',
    '- Candidate fallback should use the recorded locator as the basis: useAsIs for stable locator, stripDynamicParent when parent is dynamic but child target is meaningful, scopeRequired when uniqueness depends on a missing parent/container, firstMatchProvisional when first-match could be a low-risk fallback, block when no meaningful target exists, none for non-locator operations.',
    '- Prompt 1 does not decide whether provisional fallback is acceptable. It only provides candidateFallback facts for Prompt 2.',
    '',
    guidedRequestSection(input),
    '',
    'Formatted recorder code:',
    '```ts',
    input.formattedCode,
    '```'
  ].join('\n');
}

function buildFrameworkMappingPrompt(input, contextBundle) {
  return [
    'You are the Framework Mapper and Scenario Planner for a framework-compatible Playwright test generation workflow.',
    '',
    'Task:',
    '- Consume the Recorder Parser output and prepared dashboard/MCP context.',
    '- Decide whether the scenario can proceed, can proceed with provisional locators, or is blocked.',
    '- Map the scenario to framework concepts at a high level: models, test data, pages/components, workflows, and tests.',
    '- Do not write code.',
    '- Do not produce final artifact contracts or implementation-ready files yet.',
    '',
    'Framework concept guide:',
    '- Model: typed object template with attributes only, no concrete values.',
    '- Test data: concrete values for model attributes, including metadata.enabled true by default.',
    '- Page/component: owns locators, readiness, and low-level UI actions for a page or stable UI region.',
    '- Workflow: class that stitches page/component methods into reusable business steps and returns assertion-ready values.',
    '- Test/spec: thin objective validation that stitches workflows and test data together.',
    '',
    'Return JSON with this shape:',
    '```json',
    '{',
    '  "baseUrlHandling": { "decision": "reuse existing | recommend config update | direct setup url | test-specific URL", "recordedEntryUrl": "", "configuredBaseUrl": "", "startPath": "", "directSetupUrl": "", "reason": "" },',
    '  "scenarioPlan": { "objective": "", "setupSteps": [], "behaviorSteps": [], "successCriteria": [], "riskLevel": "low | medium | high" },',
    '  "locatorPlan": { "stable": [], "provisional": [], "blocked": [] },',
    '  "dataPlan": { "modelCandidates": [], "testDataCandidates": [], "expectedValues": [] },',
    '  "pageStepPlan": { "pages": [], "components": [], "modalsOrPanels": [] },',
    '  "frameworkMapping": { "models": [], "testData": [], "pagesOrComponents": [], "workflows": [], "tests": [] },',
    '  "assertionPlan": { "readiness": [], "success": [], "workflowReturnValues": [] },',
    '  "proceedDecision": { "status": "proceed | proceedWithProvisionalLocators | blocked", "reason": "", "requiredClarifications": [], "provisionalLocatorReview": [] },',
    '  "outOfScopeRecommendations": [],',
    '  "assumptions": []',
    '}',
    '```',
    '',
    'Planning rules:',
    '- First decide setup vs behavior. Setup gets the app into position; behavior is what the scenario objective proves.',
    '- If setup navigation has risky locators but a direct target URL/path is recorded, known, or inferable from a stable route signal, prefer direct setup URL rather than blocking.',
    '- Do not replace behavior-under-test with a direct URL unless the behavior itself is not part of the stated objective.',
    '- Preserve meaningful behavior actions from Recorder Parser operationTrace, especially selections between search/input and Apply/Submit/Next/Save/Continue.',
    '- Map dataCandidates into model/test-data candidates but do not design exact TypeScript yet.',
    '- Prefer creating/reusing the full framework concept chain for new UI scenarios: model, test data, pages/components, workflow class, spec.',
    '- Use prepared context as the ownership and convention source. Treat sample* artifacts as reference examples; prefer real app artifacts once they exist.',
    '- Normalize URL trailing slashes before comparing recorded entry URL and configured base URL.',
    '',
    'Locator planning rules:',
    '- Use the Recorder Parser locatorParts and candidateFallback as the source of truth.',
    '- stable: use only when the locator can be implemented as a concrete expression now and is expected to resolve to the intended element without ordinal fallback.',
    '- provisional: use when the locator is imperfect but has a meaningful fallback expression suitable for low/medium-risk UI flows. The candidateLocator must include the full fallback, including .first(), .nth(), or parent scope when that is the disambiguation strategy.',
    '- blocked: use only for generation blockers: no meaningful target, unsafe/high-risk behavior, missing required data/intent/assertion, or no concrete fallback expression.',
    '- Do not put vague advice such as "scope to a stable container" into stable or provisional. If a stable container is not known but generation can proceed, use a concrete provisional locator and put the missing ideal scope in provisionalLocatorReview.',
    '- A stable candidateLocator must be directly executable as written. If it depends on an unresolved scope variable or missing parent container, classify it as provisional instead.',
    '- When stripping a dynamic/broad parent from a role/text child locator, assume the stripped locator may match multiple elements unless uniqueness is proven by recorder output or context. If proceeding provisionally, include .first() or the recorded/approved .nth(index) directly in candidateLocator.',
    '- If multiple matches are possible and first-match is acceptable for low-risk setup/navigation/content filtering, candidateLocator must explicitly include .first() or the chosen .nth(index). Do not rely on Prompt 3 to add it later.',
    '- For option selection after opening a menu, dropdown, combobox, filter panel, popover, or after filling a search input, prefer a locator scoped to the active interaction surface: visible dialog, panel, listbox, menu, popover, or recorded parent scope. Do not use page-level getByText(...).first() when the same option text may appear in page content.',
    '- If no concrete active interaction surface is available for a searched/filtered option, keep the locator high-risk provisional, keep the selection inside a page/component method, and call out that QA may need to harden the option scope after local run.',
    '- If multiple matches are possible for destructive, financial, security, approval, deletion, or high-risk data-changing behavior, mark blocked.',
    '- locatorPlan.blocked means code generation should not proceed for that item. Missing ideal scopes for provisional locators belong in provisionalLocatorReview or outOfScopeRecommendations, not in blocked.',
    '- Keep every provisional locator visible in proceedDecision.provisionalLocatorReview with locatorName, full provisionalLocator, risk, and notes so QA can harden it after local run.',
    '',
    guidedRequestSection(input),
    '',
    'Recorder Parser Output:',
    fenced(input.analysis || 'No recorder parser output pasted yet. Ask for Prompt 1 output before mapping.'),
    '',
    guidedContextSection(contextBundle)
  ].join('\n');
}

function buildArtifactDesignPrompt(input, contextBundle) {
  return [
    'You are the Artifact Contract Designer for a framework-compatible Playwright test generation workflow.',
    '',
    'Task:',
    '- Convert the Scenario Planner / Framework Mapper output into an exact build contract for code generation.',
    '- Do not write implementation code.',
    '- Do not reinterpret raw recorder code or invent new locator strategy beyond the approved/provisional locator plan.',
    '- If the scenario is blocked, produce a blocked contract only.',
    '',
    'Return JSON with this shape:',
    '```json',
    '{',
    '  "contractStatus": "ready | readyWithProvisionalLocators | blocked",',
    '  "blockedItems": [],',
    '  "models": [],',
    '  "testData": [],',
    '  "pagesOrComponents": [],',
    '  "workflows": [],',
    '  "tests": [],',
    '  "locators": [{ "owner": "", "fieldName": "", "businessMeaning": "", "finalLocatorExpression": "", "status": "stable | provisional | blocked", "sourceOperationOrders": [], "reason": "" }],',
    '  "methods": [{ "owner": "", "name": "", "params": [], "returnType": "", "sourceOperationOrders": [], "description": "" }],',
    '  "workflowReturnShape": {},',
    '  "assertions": [],',
    '  "provisionalLocatorReview": [],',
    '  "buildManifest": { "filesToCreate": [], "filesToUpdate": [], "filesToLeaveUnchanged": [], "implementationOrder": [], "validationCommands": [] },',
    '  "assumptions": []',
    '}',
    '```',
    '',
    'Contract status rules:',
    '- If proceedDecision.status is blocked, set contractStatus to blocked, populate blockedItems, leave filesToCreate/filesToUpdate/implementationOrder empty, and do not provide implementation-ready locators.',
    '- If proceedDecision.status is proceedWithProvisionalLocators, set contractStatus to readyWithProvisionalLocators and include every provisional locator from Prompt 2 in locators and provisionalLocatorReview.',
    '- If proceedDecision.status is proceed, set contractStatus to ready.',
    '- status blocked is only valid when contractStatus is blocked. If contractStatus is readyWithProvisionalLocators, do not include locators with status blocked; represent missing ideal scopes as provisionalLocatorReview notes or assumptions.',
    '- Do not turn provisional locators into blocked locators unless Prompt 2 marked them blocked or they lack a concrete finalLocatorExpression.',
    '',
    'Artifact contract rules:',
    '- Produce exact file paths, class names, method names, export names, model fields, test-data object names, locator field names, workflow return shape, and assertions.',
    '- Use framework conventions from prepared context and sample artifacts.',
    '- Models export TypeScript interfaces only and contain structure, not concrete values.',
    '- Test-data imports model types and exports typed objects with metadata.enabled true by default.',
    '- Page/components own locators, readiness, and UI actions.',
    '- Workflows are classes with constructor(page: Page), accept typed model/test-data objects, stitch page methods together, and return assertion-ready values.',
    '- Specs import framework test/expect, workflow classes, and typed test data. Specs avoid raw locators and page.goto unless explicitly approved.',
    '- Every locator must have a concrete finalLocatorExpression. No placeholder English such as "stable container here" is allowed.',
    '- A locator may be marked stable only when finalLocatorExpression is directly executable and self-contained as written. If the reason says the locator must be scoped but the expression is not scoped, mark it provisional.',
    '- If a provisional locator may match multiple elements, finalLocatorExpression must include the exact approved disambiguation from Prompt 2, such as .first(), .nth(index), or a concrete parent scope.',
    '- If a provisional locator was created by stripping a dynamic/broad parent from a role/text child locator and no concrete parent scope exists, include .first() or the recorded/approved .nth(index) in finalLocatorExpression.',
    '- For menu/dropdown/combobox/filter-panel option selection, finalLocatorExpression should prefer the active interaction surface from Prompt 2. Avoid page-level getByText(...).first() for option values that can also appear in page content unless Prompt 2 explicitly approved that high-risk fallback.',
    '- Provisional locator expressions may use stripped dynamic parent targets or first()/nth() only when Prompt 2 approved that provisional use. Mark them status provisional and add a review note.',
    '- Every method must reference sourceOperationOrders from Prompt 1 so Prompt 4 can preserve action order.',
    '- Every model/test-data field must trace to Prompt 1 dataCandidates or expected assertion values.',
    '- Assertions should use resolved workflow result values or page-owned helper outputs, not raw spec locators.',
    '- For recorded text assertions from page content, cards, lists, grids, menus, or result rows, preserve the recorded expected text but make the assertion whitespace-tolerant. Prefer a normalized whitespace comparison over changing the expected text into unrelated tokens.',
    '- BuildManifest is the exact checklist for Prompt 4. If contractStatus is ready or readyWithProvisionalLocators, include all files and validation commands. If blocked, keep build lists empty.',
    '',
    guidedRequestSection(input),
    '',
    'Recorder Parser Output:',
    fenced(input.analysis),
    '',
    'Scenario Planner / Framework Mapping:',
    fenced(input.mapping || 'No Scenario Planner / Framework Mapping output pasted yet. Ask for Prompt 2 output before designing artifacts.'),
    '',
    guidedContextSection(contextBundle)
  ].join('\n');
}

function buildCodeGenerationPrompt(input, contextBundle) {
  return [
    'You are the Code Generator for a framework-compatible Playwright test generation workflow.',
    '',
    'Task:',
    '- Mechanically implement the Artifact Contract.',
    '- Do not redesign architecture, data shape, workflow shape, locator strategy, or assertions.',
    '- Do not reinterpret raw recorder code.',
    '- Use exact files/classes/methods/locators/data names from the Artifact Contract.',
    '',
    'Execution rules:',
    '- If contractStatus is blocked, do not write files. Report blockedItems and required clarification only.',
    '- If contractStatus is ready, write the approved files normally.',
    '- If contractStatus is readyWithProvisionalLocators, write the approved files and include provisional locator review notes in the final output.',
    '- Implement provisional locators exactly as listed in the Artifact Contract. Do not silently replace them or make them stricter.',
    '- When parameterizing a locator from the Artifact Contract, preserve every executable disambiguation step from the contract, including .first(), .nth(index), filters, and parent scopes. Do not simplify a concrete locator into a broader parameterized locator.',
    '- Add a short code comment beside provisional locator fields in page/component objects so QA can find them if a local run fails.',
    '- Do not invent locators. If a required locator expression is missing, placeholder English, or internally inconsistent, stop and report the contract item.',
    '- Keep specs at business intent level using workflows/models/test data. Specs should not use raw page locators unless the Artifact Contract explicitly requires it.',
    '- Put locators and UI actions in page objects/components. Use framework actions/waits/helpers before raw Playwright calls.',
    '- Implement waitUntilReady() and transition waits exactly as specified by the Artifact Contract.',
    '- Preserve action order using sourceOperationOrders and method contracts.',
    '- For whitespace-tolerant recorded text assertions, add a small local normalizeText helper in the spec or use an existing repo helper if one exists. Normalize both actual and expected strings with value.replace(/\\s+/g, " ").trim() before comparing.',
    '- Do not create or modify files outside selected app _automation.',
    '- If a required change appears outside _automation, stop and list it as out-of-scope.',
    '- If the selected app repo is not a Git repository, do not run Git commands.',
    '',
    'Output rules:',
    '- Include a short pre-code checklist: contractStatus, files, entry point, workflow return shape, assertion inputs, validation commands, and provisional locator count.',
    '- If files were written, list changed files, validation results, and provisional locator review notes only.',
    '- If repository write access is unavailable, output generated code grouped by file path or a unified diff patch.',
    '- If generation stops because of a contract issue, do not provide implementation code; report the exact missing or inconsistent contract item.',
    '- After writing files, run the validation commands available in the selected repo. If validation cannot run, report the blocker.',
    '',
    guidedRequestSection(input),
    '',
    'Recorder Parser Output:',
    fenced(input.analysis),
    '',
    'Scenario Planner / Framework Mapping:',
    fenced(input.mapping),
    '',
    'Artifact Contract:',
    fenced(input.design || 'No Artifact Contract pasted yet. Ask for Prompt 3 output before generating code.'),
    '',
    guidedContextSection(contextBundle)
  ].join('\n');
}

function buildGeneratedCodeReviewPrompt(input, contextBundle) {
  return [
    'You are the Reviewer for a framework-compatible Playwright test generation workflow.',
    '',
    'Task:',
    '- Review the generated code or patch against the Recorder Parser Output, Scenario Planner / Framework Mapping, Artifact Contract, and repo guardrails.',
    '- If generated code or patch text is not pasted below, inspect the current repo working tree and review only changed files under _automation.',
    '- Identify violations, missing assertions, raw locator leakage into specs, missing test data/models, ownership mistakes, or out-of-scope edits.',
    '- Verify the generated files match Artifact Contract buildManifest exactly: files created/updated, entry point, implementation order, and stop conditions.',
    '- Identify naming convention violations, unauthorized artifact renames, and mismatches between Scenario Planner / Framework Mapping, Artifact Contract, and generated code.',
    '- Identify workflow return-shape or assertion-input mismatches, such as a spec using a string matcher against a Locator or object.',
    '- Verify the workflow calls the entry page open/navigation method before the first interaction and follows mapped baseUrlHandling.',
    '- Verify recorder readiness assertions before important interactions were preserved as page/component readiness where needed.',
    '- Verify trigger-plus-item interactions such as header menus are implemented as a composite page/component method using a framework helper when available.',
    '- Identify missing waitUntilReady() methods, missing workflow transition waits, raw readiness waits inside specs, fixed sleeps, or readiness logic placed in the wrong artifact.',
    '- Identify raw Playwright interactions that should use framework interaction catalog helpers.',
    '- Do not write unrelated code.',
    '',
    'Return JSON with this shape:',
    '```json',
    '{',
    '  "status": "pass | needs_changes",',
    '  "violations": [],',
    '  "recommendedFixes": [],',
    '  "validationCommands": [],',
    '  "outOfScopeConcerns": []',
    '}',
    '```',
    '',
    guidedRequestSection(input),
    '',
    'Recorder Parser Output:',
    fenced(input.analysis),
    '',
    'Scenario Planner / Framework Mapping:',
    fenced(input.mapping),
    '',
    'Artifact Contract:',
    fenced(input.design),
    '',
    'Generated Code or Patch:',
    fenced(input.generatedCode || 'No generated code pasted. If you are running as an IDE/repo agent, inspect the current working tree changes under _automation and review those generated changes.'),
    '',
    guidedContextSection(contextBundle)
  ].join('\n');
}

function guidedRequestSection(input) {
  return [
    'Test request:',
    `- Test type: ${formatTestType(input.testType)}`,
    `- Test suite: ${stringOrFallback(input.testSuite, 'New Test Suite')}`,
    `- Scenario: ${stringOrFallback(input.scenario, 'new test scenario')}`,
    '',
    'Test objective:',
    stringOrFallback(input.testObjective, 'Not provided. Infer from recorder code and mark assumptions.'),
    '',
    'What should prove that the test passed?',
    stringOrFallback(input.passCondition, 'Not provided. Infer meaningful assertions and mark assumptions.')
  ].join('\n');
}

function guidedContextSection(contextBundle) {
  return contextBundle
    ? [
      'Prepared dashboard/MCP context:',
      '```json',
      JSON.stringify(contextBundle, null, 2),
      '```',
      '',
      'App-specific generation profile rules:',
      '- If appSpecificGenerationProfile.available is true, apply only the provided app-specific rules.',
      '- If appSpecificGenerationProfile is missing, unavailable, empty, or has no applicable entries, continue with the generic prompt rules and recorder output.',
      '- Do not invent app-specific rules, optional interruptions, locator shortcuts, or navigation behavior that are not present in the profile or recorder output.'
    ].join('\n')
    : 'Prepared dashboard/MCP context: Not included or unavailable.';
}

function fenced(value) {
  return [
    '```',
    String(value || '').trim(),
    '```'
  ].join('\n');
}

function guidedStageName(stage) {
  return ({
    analysis: 'Recorder Parser',
    mapping: 'Scenario Planner / Framework Mapping',
    design: 'Artifact Contract',
    code: 'Code Generator',
    review: 'Generated Code Review'
  })[stage] ?? 'Guided AI';
}

function resetFeedbackCaptureSession() {
  feedbackCaptureSessionId = '';
  if (feedbackCaptureTimer) {
    clearTimeout(feedbackCaptureTimer);
    feedbackCaptureTimer = 0;
  }
}

function queueFeedbackCapture(eventName, extra = {}) {
  if (feedbackCaptureTimer) {
    clearTimeout(feedbackCaptureTimer);
  }

  feedbackCaptureTimer = window.setTimeout(() => {
    feedbackCaptureTimer = 0;
    void captureFeedbackSnapshot(eventName, extra);
  }, 750);
}

async function captureFeedbackSnapshot(eventName, extra = {}) {
  if (!currentRepoDir || !buildTestWizardDialog.open) {
    return;
  }

  try {
    const formData = new FormData(buildTestWizardForm);
    const payload = {
      sessionId: feedbackCaptureSessionId || undefined,
      eventName,
      promptFlow: extra.promptFlow ?? 'guided',
      request: {
        testType: formData.get('testType'),
        testSuite: formData.get('testSuite'),
        scenario: formData.get('scenario'),
        testObjective: formData.get('testObjective'),
        passCondition: formData.get('passCondition')
      },
      rawCode: document.querySelector('#wizardCodegenCode').value,
      formattedCode: document.querySelector('#wizardFormattedCode').value,
      quickPrompt: extra.quickPrompt ?? safeCurrentQuickPrompt(),
      guided: {
        stage: extra.guidedStage ?? null,
        prompt: extra.guidedPrompt ?? null,
        analysis: document.querySelector('#guidedAnalysisResult').value,
        mapping: document.querySelector('#guidedMappingResult').value,
        design: document.querySelector('#guidedDesignResult').value,
        generatedCode: document.querySelector('#guidedCodeResult').value,
        review: document.querySelector('#guidedReviewResult').value
      },
      context: {
        useMcp: formData.get('useMcp') === 'on',
        preparedContextAvailable: Boolean(preparedAutomationContext),
        preparedContextGeneratedAt: preparedAutomationContext?.generatedAt ?? null
      },
      metadata: {
        wizardStep: buildTestWizardStep,
        capturedBy: 'dashboard-passive-capture'
      },
      ...extra
    };

    delete payload.guidedPrompt;

    const response = await fetch('/api/feedback/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: withRepo(payload)
    });
    const json = await response.json().catch(() => ({}));
    if (response.ok && json.sessionId) {
      feedbackCaptureSessionId = json.sessionId;
    }
  } catch (error) {
    console.warn(`Feedback capture skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function safeCurrentQuickPrompt() {
  try {
    return getAiPromptForSubmission();
  } catch {
    return document.querySelector('#wizardAiPrompt').value;
  }
}

async function prepareAutomationContext(options = {}) {
  if (!currentRepoDir) {
    return null;
  }

  if (preparedAutomationContext?.repo?.path === currentRepoDir) {
    return preparedAutomationContext;
  }

  if (automationContextPromise) {
    return automationContextPromise;
  }

  if (!options.silent) {
    writeOutput('Preparing framework and app context for AI generation...');
  }

  automationContextPromise = api('/api/automation-context')
    .then((context) => {
      preparedAutomationContext = context;
      if (!options.silent) {
        const counts = context.artifacts ?? {};
        writeOutput(`Prepared AI context: ${counts.pages?.length ?? 0} pages, ${counts.workflows?.length ?? 0} workflows, ${counts.models?.length ?? 0} models, ${counts.testData?.length ?? 0} test data files, ${counts.tests?.length ?? 0} tests.`);
      }
      return context;
    })
    .catch((error) => {
      preparedAutomationContext = null;
      if (!options.silent) {
        writeOutput(`Unable to prepare AI context: ${error instanceof Error ? error.message : String(error)}`);
      }
      return null;
    })
    .finally(() => {
      automationContextPromise = null;
    });

  return automationContextPromise;
}
function getAiPromptForSubmission() {
  const visiblePrompt = document.querySelector('#wizardAiPrompt').value;
  if (!hiddenAutomationContextSection) {
    return visiblePrompt;
  }

  if (visiblePrompt.includes(hiddenAutomationContextNotice)) {
    return visiblePrompt.replace(hiddenAutomationContextNotice, hiddenAutomationContextSection.trimEnd());
  }

  return [visiblePrompt.trimEnd(), '', hiddenAutomationContextSection.trimEnd()].filter(Boolean).join('\n');
}

function createVisibleAiPrompt(prompt) {
  if (!hiddenAutomationContextSection) {
    return prompt;
  }

  return prompt.replace(hiddenAutomationContextSection, `${hiddenAutomationContextNotice}\n`);
}

function extractPreparedContextSection(prompt) {
  const match = prompt.match(/Prepared dashboard automation context:\n```json\n[\s\S]*?\n```\n?/);
  return match?.[0] ?? '';
}
async function generateTestWithAi() {
  const prompt = getAiPromptForSubmission();
  if (!prompt.trim()) {
    writeOutput('Generate the AI prompt before calling AI.');
    return;
  }

  setBusy(true);
  try {
    lastCommand.textContent = 'Running: Generate Test with AI';
    writeOutput('Sending prompt to configured AI connector. Please wait...');
    const result = await api('/api/ai/generate-test', {
      method: 'POST',
      body: withRepo({ prompt })
    }, false);

    showAiResult(result.text ?? '');
    lastCommand.textContent = `Generated with AI: ${result.provider ?? 'AI connector'}${result.model ? ` (${result.model})` : ''}`;
    writeOutput('AI generated a framework-compatible test proposal. Review and edit the result before applying changes.');
  } catch (error) {
    lastCommand.textContent = 'Failed: Generate Test with AI';
    writeOutput(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

function showAiResult(value) {
  document.querySelector('#wizardAiResult').value = value;
  document.querySelector('#wizardAiResult').hidden = false;
  document.querySelector('#wizardAiResultLabel').hidden = false;
  document.querySelector('#wizardAiResultHelper').hidden = false;
}

function resetAiResult() {
  document.querySelector('#wizardAiResult').value = '';
  document.querySelector('#wizardAiResult').hidden = true;
  document.querySelector('#wizardAiResultLabel').hidden = true;
  document.querySelector('#wizardAiResultHelper').hidden = true;
}
async function copyAiPrompt() {
  const prompt = getAiPromptForSubmission();
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
    const result = await api('/api/tests');
    discoveredTests = result.tests ?? [];
    hasDiscoveredAllTests = true;
    pruneUnavailableSelectedTests(discoveredTests);

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

function pruneUnavailableSelectedTests(currentTests) {
  const validTestIds = new Set(currentTests.map((test) => test.id).filter(Boolean));
  const unavailableTestIds = new Set(
    [...selectedTestIds, ...draftSelectedTestIds].filter((id) => !validTestIds.has(id))
  );

  selectedTestIds = new Set([...selectedTestIds].filter((id) => validTestIds.has(id)));
  draftSelectedTestIds = new Set([...draftSelectedTestIds].filter((id) => validTestIds.has(id)));

  const removedCount = unavailableTestIds.size;
  if (!removedCount) {
    return;
  }

  renderSelectedTestsGrid();
  if (currentRepoType === 'framework') {
    updateSettingsSaveState();
  }

  writeOutput(`Removed ${removedCount} unavailable selected test${removedCount === 1 ? '' : 's'} after rediscovery.`);
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
