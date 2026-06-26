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
// null means "no repo selected yet" — distinct from any real repoType value the backend
// returns (including 'unsupported'), which means a repo IS selected but isn't compatible.
let currentRepoType = null;
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
    setFrameworkSettingsEnabled(isFrameworkCompatibleRepo(currentRepoType));
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
  currentRepoType = status.repoType ?? null;
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
  setFrameworkSettingsEnabled(isFrameworkCompatibleRepo(currentRepoType));
  updateSettingsSaveState();
}

// null (no repo selected) is explicitly NOT framework-compatible — it's a distinct state from
// an unrecognized/incompatible repoType string, but the gated UI stays disabled either way.
function isFrameworkCompatibleRepo(repoType) {
  return repoType === 'framework';
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

function openTestsDialog() {
  draftSelectedTestIds = new Set(selectedTestIds);
  testsDialog.showModal();
  visibleTests = [];
  renderTestResults('Enter search criteria or leave it blank, then click Search.');
  testSearchInput.focus();
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
  let contextBundle = formData.get('useMcp') === 'on'
    ? await prepareAutomationContext({ silent: true })
    : null;

  if ((stage === 'mapping' || stage === 'design') && contextBundle && promptInput.analysis) {
    contextBundle = await includeWorkflowReuseMatches(contextBundle, promptInput.analysis);
  }

  if (stage === 'code' && promptInput.analysis && promptInput.design) {
    await stageWorkflowReuseCandidates(promptInput);
  }

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
    'Non-goals (do not do these):',
    '- Do not inspect repository files.',
    '- Do not write code.',
    '- Do not propose framework artifacts.',
    '- Do not approve or reject framework implementation.',
    'Only describe recorder facts, observed UI state, inferred intent, and locator risk.',
    'Return the JSON object only. No planning narration, no markdown commentary, no text before or after it.',
    '',
    'Free-text field length: every reason, evidence, reviewNote, note, intentHint, and uiContextHint field must be a fragment of 15 words or fewer — state the decision and its key cause, not a full sentence or narration. EXCEPTION: assumptions[] and ambiguities[] entries are NOT capped — these carry surprising or multi-rule findings and need room; keep them as complete as needed.',
    '',
    'Omit empty/default fields rather than emitting them. Do not omit any enum field, candidateLocators when non-empty, sourceOperationOrders, or any structured selector data.',
    '',
    '---',
    'STRUCTURAL CHANGE FROM PRIOR VERSIONS — read this before Phase A:',
    '',
    'Previously this prompt emitted a flat operationTrace array plus a separate uiBoundaries array, cross-referenced by operation order. This version instead builds page boundaries as the primary structure, with each operation living INSIDE the boundary it belongs to. This removes a downstream inference step — page ownership is no longer something a later stage has to reconstruct from a flat list; it is structural fact from the moment you emit it.',
    '',
    'The walk is still linear, one operation at a time, in recorded order. The difference is where each operation gets WRITTEN: into the "operations" array of whichever pageBoundary object is currently open, not into one global flat array.',
    '',
    '---',
    'PHASE A — Establish entry point and open the first boundary',
    '- Treat the first page.goto URL as the candidate app entry point. Normalize origin, path, queryParams, normalizedStartPath.',
    '- Entry contract: the entry navigation PLUS the first readiness assertion confirming the landing page are SETUP — they do not belong to any workflow and are recorded in `entry`, not inside a pageBoundary\'s operations array. Setup ends at the first readiness assertion confirming the landing page.',
    '- Immediately after setup ends, OPEN pageBoundary[0] for the landing page. Its pageIdentifier is derived from the landing assertion. Its transitionTier is ALWAYS the literal string "entry" — boundary 0 is never detected via Tier 1/2/3 (it is established by the entry contract, not discovered), so there is nothing to evaluate here; state it directly, do not infer or leave it to judgment. This boundary is now "open" — every subsequent operation is appended to ITS operations array until a transition closes it.',
    '',
    '---',
    'PHASE B — Walk operations one at a time, writing into the currently-open boundary',
    'For each operation after setup, in recorded order:',
    '',
    '1. Classify it exactly as before: operationType, triggerClass (navCapable | inPageControl | overlayOpener | none — mechanical, from function + role + name), assertionRole (assign in a single pass per the precedence rules in Phase D below — do not revise later), isMeaningful, locatorParts (parentScope/childTarget decomposition), candidateFallback.',
    '',
    '2. triggerClass mechanism-over-enumeration rule: a click on an item INSIDE an overlay container (tippy/popover/menu/listbox — by id pattern or aria role) is overlayOpener-family regardless of what state it changes. inPageControl is only for controls rendered in the page body, not inside any overlay container. The example words (Apply, Filter, Next, Login, etc.) in this taxonomy are illustrative, not an exhaustive list — classify by mechanism (does it navigate, does it open a transient overlay, does it update the current view in place) not by matching a word.',
    '',
    '4. Append the fully-classified operation object to the CURRENTLY OPEN pageBoundary\'s `operations` array.',
    '',
    '---',
    'PHASE C — Detect transitions; close current boundary, open next',
    'At each operation, BEFORE appending it (this check happens first, then Phase B\'s classification applies to decide which boundary it lands in), evaluate the transition hierarchy. Check tiers in order; STOP at the first tier whose guard passes.',
    '',
    '  TIER 1 — URL change. A goto, waitForURL, or recorded URL delta is present.',
    '    GUARD: the path changed (not just query/hash). Match => transition, "certain".',
    '  TIER 2 — Trigger + IMMEDIATE confirmation only. A navCapable trigger occurred, AND the assertion IMMEDIATELY following it (no other operation in between) is page-level (h1, heading role, nav, main/landmark) with content distinctly new versus the currently-open boundary\'s identifier.',
    '    DETERMINISM RULE: confirmation must be the immediate next operation. If the immediate next assertion is NOT page-level, Tier 2 does NOT match — even if a stronger page-level assertion appears later after other operations. A later assertion never retroactively upgrades an earlier weak confirmation to Tier 2. If you find yourself reasoning "the immediate confirmation is weak, but a later assertion proves the transition" — STOP, that reasoning pattern is forbidden by this rule. Fall through to Tier 3 using only the immediate evidence.',
    '    Match => transition, "confirmed".',
    '  TIER 3 — Corroboration (only if Tiers 1-2 do not match). A distinctly-new page-level landmark cluster appears later in the trace AND no inPageControl trigger since the last transition explains it. Match => transition, "ambiguous"; add an ambiguities entry naming the competing same-page interpretation.',
    '  DEFAULT — no tier matches => SAME PAGE. Continue appending to the currently-open boundary.',
    '',
    'Bias rule: navCapable trigger + weak immediate confirmation → prefer transition ("ambiguous") over merging. Log the assumption.',
    '',
    'When a transition is detected:',
    '- The TRIGGERING operation (the navCapable click) is the LAST operation appended to the CURRENTLY OPEN boundary, before closing it.',
    '- CLOSE the current pageBoundary (no more operations append to it after this point).',
    '- OPEN a new pageBoundary. Its FIRST operation is the CONFIRMING readiness assertion (Tier 1/2\'s immediate evidence, or Tier 3\'s corroborating evidence) — this readiness assertion is the new boundary\'s arrival confirmation and its first array entry.',
    '- Resolve the new boundary\'s pageIdentifier per R1-R4 (unchanged from prior versions):',
    '  R1 prefer strongest identifier anywhere in trace for that page even if asserted late;',
    '  R2 if immediate confirmation is weak but a stronger heading appears later for the SAME page, use the later one and note it was asserted late (impact medium);',
    '  R3 fallback chain if no identifier exists: first page-level landmark, else first asserted element, else the triggering click\'s destination;',
    '  R4 entry page with only app-shell identifier: accept as-is, no ambiguity needed.',
    '',
    'Phase G integrity self-audit for Tier 2 (run before output): for every pageBoundary whose boundaryMechanismConfidence is "confirmed" (Tier 2), verify its FIRST operation (the confirming assertion) is genuinely the operation that immediately followed the trigger with nothing between them. If anything intervened, this is a Tier 2 VIOLATION — change confidence to "ambiguous" and tier to "3" before output.',
    '',
    'Self-audit for false-merge (run before output): for every pair of consecutive operations within the SAME open boundary that includes a navCapable trigger with no following boundary close, explicitly ask — was destination evidence for this trigger dismissed as too weak, defaulting to no-split? If yes, this is a candidate false-merge. Re-run the Tier 2/3 check on it specifically; if it still doesn\'t qualify, add an ambiguities entry stating the merge was considered and rejected, with the reason — do not let a merge happen silently with no record of having been evaluated.',
    '',
    '---',
    'PHASE D — Assertion role precedence (apply once per assertion, in this order)',
    '1. Recorded text/value directly matches the stated pass condition: success, certain.',
    '2. Else, part of the trailing assertion group (consecutive assertions ending the trace): success, inferred; ambiguity noting no literal match was found.',
    '3. Else, no trailing group exists at all: do not assign success to anything; set successCoverage.status: inferredRequired, list final operations as possibleEvidence, add a loud ambiguity flagging a possible recording gap.',
    'For all other assertions: confirms a Phase C transition\'s destination → readiness. Otherwise protects a later interaction → readiness. Carries state through → intermediate. Fits more than one → first matching in this order. None clear → intermediate + ambiguity.',
    '',
    'Readiness-gap rule: for every pageBoundary that opens with no immediate (Tier 1/2) confirming readiness assertion — i.e. its first operation was resolved via Tier 3 corroboration or R3\'s fallback chain, not a direct match — add a readinessGaps entry: { boundaryIndex, expectedReadyState, reason }. The gap is identified by WHICH BOUNDARY lacks strong immediate evidence, not by citing operation order numbers — the boundary itself is the structural location of the gap.',
    '',
    '---',
    'PHASE E — Data candidates',
    'From fill/select/check values, clicked variable business text, selected options, recorded expected assertion text, and scenario-specific values — emit a dataCandidates entry: nameHint, value, dataKind, ownershipHint, reason (≤15 words). Do not flag pure UI mechanics (focus-only clicks, fixed navigation with no variable content) — only operations carrying actual business-meaningful values. Do not treat the entry goto as ordinary test data — it lives under `entry` with ownershipHint "navigation".',
    '',
    '---',
    'PHASE G — Final integrity pass (self-check before output)',
    '- Every operation has exactly one operationType, triggerClass, assertionRole — assigned once, not revised. Step 2 derives "needs locator resolution" from candidateFallback.strategy !== "useAsIs" and "is a data candidate" from membership in dataCandidates[] — both already fully expressed by existing fields, no separate flag needed.',
    '- Every pageBoundary\'s first operation (except boundary 0, whose first op is whatever follows setup) is the confirming readiness assertion; every boundary\'s last operation, if a transition follows, is the triggering action. A boundary\'s readiness scope is always and only its own first operation — no separate field needed.',
    '- Run both self-audits from Phase C (Tier 2 violation check, false-merge check).',
    '- successCoverage populated per Phase D rules. readinessGaps lists every boundaryIndex whose opening readiness was not a direct Tier 1/2 match.',
    '- No corrupted Unicode — retain raw value and flag an ambiguity instead of guessing.',
    '- Output is the JSON object only — no narration, no markdown fences.',
    '',
    'Return JSON with this shape:',
    '```json',
    '{',
    '  "entry": { "recordedUrl": "", "origin": "", "path": "", "queryParams": {}, "normalizedStartPath": "", "notes": "" },',
    '  "setupOperations": [{ "order": 1, "rawOperation": "", "operationType": "goto | assertion", "value": "", "reason": "" }],',
    '  "pageBoundaries": [',
    '    {',
    '      "boundaryIndex": 0,',
    '      "observedLabel": "",',
    '      "boundaryType": "routeChange | headingState | modal | drawer | popover | menu | tab | panel | wizardStep | unknown",',
    '      "boundaryMechanismConfidence": "certain | confirmed | ambiguous",',
    '      "transitionTier": "1 | 2 | 3 | entry",',
    '      "pageIdentifierSelector": "",',
    '      "pageIdentifierText": "",',
    '      "pageIdentifierQuality": "strong | weak | missing",',
    '      "triggerFromPriorBoundary": { "sourceOperationOrder": null, "rawOperation": "" },',
    '      "operations": [',
    '        {',
    '          "order": 1,',
    '          "rawOperation": "",',
    '          "operationType": "click | fill | select | check | assertion | popup | wait",',
    '          "triggerClass": "navCapable | inPageControl | overlayOpener | none",',
    '          "assertionRole": "readiness | success | intermediate | none",',
    '          "uiContextHint": "",',
    '          "rawLocator": "",',
    '          "locatorParts": { "parentScope": "", "parentScopeRisk": "stable | dynamic | broad | none | unknown", "childTarget": "", "childTargetType": "role | text | label | testId | css | xpath | unknown", "childTargetValue": "" },',
    '          "value": "",',
    '          "intentHint": "",',
    '          "isMeaningful": true,',
    '          "riskFlags": [],',
    '          "candidateFallback": { "strategy": "useAsIs | stripDynamicParent | scopeRequired | firstMatchProvisional | block | none", "candidateLocator": "", "reason": "" }',
    '        }',
    '      ]',
    '    }',
    '  ],',
    '  "dataCandidates": [{ "nameHint": "", "sourceOperationOrder": 1, "rawLocator": "", "value": "", "dataKind": "input | selection | expectedText | expectedRoute | clickedVariableText", "ownershipHint": "testData | assertion | navigation", "reason": "" }],',
    '  "successCoverage": { "status": "covered | inferredRequired", "confidence": "certain | inferred", "possibleEvidence": [], "reason": "" },',
    '  "readinessGaps": [{ "boundaryIndex": 1, "expectedReadyState": "", "reason": "" }],',
    '  "recorderNoise": [{ "sourceOperationOrder": 1, "rawOperation": "", "reason": "" }],',
    '  "ambiguities": [{ "sourceOperationOrder": 1, "question": "", "impact": "" }]',
    '}',
    '```',
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
    'You are the Framework Mapper for a framework-compatible Playwright test generation workflow. You receive Prompt 1\'s nested pageBoundaries output (v3 shape — operations already live inside the boundary they belong to; page ownership is given, not inferred).',
    '',
    'Non-goals:',
    '- Do not redesign, merge, or split pageBoundaries. Prompt 1 already determined how many pages exist and which operations belong to each — ONE pageBoundary ALWAYS maps to EXACTLY ONE page artifact. Do not infer a different page count.',
    '- Do not decide workflow boundaries from business-meaning judgment. Workflow boundary placement is supplied externally (a human/recording-structure marker, described in the request input) — if no marker is supplied, default to ONE workflow spanning all behavior operations. Never auto-split workflows by inferring intent.',
    '- Do not invent a directory or naming convention. The directory structure is FIXED (below) — never deviate from it.',
    '',
    'Free-text field length: every reason, evidence, reviewNote field ≤15 words. EXCEPTION: assumptions[] is NOT capped.',
    '',
    '---',
    'FIXED FACT — directory taxonomy (do not discover, do not infer, this is constant):',
    '',
    'The automation directory structure is FIXED and identical across every project on this framework, regardless of what currently exists inside it:',
    '  _automation/models/',
    '  _automation/pages/',
    '  _automation/test-data/',
    '  _automation/workflows/',
    '  _automation/tests/api/',
    '  _automation/tests/database/',
    '  _automation/tests/ui/',
    '',
    'Every filePath this prompt assigns MUST use exactly one of these directories — models in models/, pages in pages/, test-data in test-data/, workflows in workflows/, UI specs in tests/ui/ (api/database reserved for non-UI test types, not used by this prompt unless the scenario is explicitly non-UI). NEVER invent a different directory name (no "testData/", no "tests/regression/", no new subfolder under tests/) — this structure holds even on a brand-new project with nothing in it yet.',
    '',
    '---',
    'PHASE A — Setup handling and base URL (carried forward, unchanged from v2)',
    '- Prompt 1\'s setupOperations are setup, never behavior. baseUrlHandling: the entry point is Prompt 1\'s entry.recordedUrl, used to confirm match against the framework\'s configured base URL. Generated code must read the base URL via contextBundle.configAccess.baseUrl.expression — never invent a symbol name like "config.appBaseUrl". If contextBundle.configAccess.available is false, flag as a blocking gap, do not guess.',
    '',
    '---',
    'PHASE A.5 — Operation order is global, not per-boundary',
    'Prompt 1\'s operation `order` numbers are sequential across the ENTIRE recording, not reset per pageBoundary. A sourceOperationOrder reference resolves the same way regardless of which boundary\'s operations array it lives in — no translation needed when citing an operation across boundary lines (e.g. in successCriteria, dataPlan).',
    '',
    'PHASE A.6 — Carry forward Prompt 1\'s flagged findings, do not silently drop them',
    '- Build scenarioPlan.successCriteria from Prompt 1\'s successCoverage: if status is "covered", build successCriteria from the trailing assertion group\'s operations directly (the consecutive assertion operations at the end of the trace, each with assertionRole "success" — Prompt 1\'s Phase D already identified these; use their recorded expectedValue). If status is "inferredRequired" (no trailing assertion group existed; Prompt 1 could not confirm success evidence), build successCriteria from possibleEvidence instead, but ALSO add an assumptions[] entry at impact "high" stating that success criteria are inferred, not confirmed, and a human should verify this test\'s actual pass condition before trusting it — this must be visible, not silently treated the same as confirmed coverage.',
    '- For every entry in Prompt 1\'s readinessGaps[], add a corresponding reviewNote on that pageBoundary\'s page artifact (Phase B) noting the weak/missing immediate readiness — this affects which readiness signal the artifact\'s waitUntilReady should rely on, and a human reviewing the contract should see it was a recorded gap, not an assumption you are introducing now.',
    '- For every entry in Prompt 1\'s ambiguities[] with impact "medium" or "high", carry it forward as an assumptions[] entry in this prompt\'s own output (do not just leave it in Prompt 1\'s output and ignore it here) — these are findings that affect design decisions you are making in this prompt, not just Prompt 1\'s own observations.',
    '- recorderNoise-flagged operations are already excluded from methods (Phase B) — no further action needed beyond that exclusion.',
    '',
    '---',
    'PHASE B — Page-to-artifact mapping (now near-transcription, not inference)',
    'For each pageBoundary in Prompt 1\'s output, in order:',
    '- pageBoundaryIndex on this artifact is Prompt 1\'s boundaryIndex for this boundary, copied directly — the same number, never recounted or reassigned.',
    '- Create exactly one page artifact entry. Do NOT merge two pageBoundaries into one artifact and do NOT split one pageBoundary into two artifacts under any circumstance — this 1:1 mapping is fixed by Prompt 1\'s boundary detection, which you do not re-evaluate.',
    '- The artifact\'s readiness signal is the pageBoundary\'s own pageIdentifierSelector/Text (already resolved by Prompt 1\'s R1-R4) — carry forward, do not re-derive.',
    '- The artifact\'s responsibilities/methods: group the boundary\'s own operations into logical methods (one method per distinct user-facing action — e.g. a click sequence that opens a menu is one method, a separate click that selects an item is another). Prefer fewer, coherent methods over one-method-per-operation; do not create a separate method for trivial mechanics (recorderNoise-flagged operations are excluded entirely, never become a method).',
    '',
    '---',
    'PHASE C — Reuse matching (tiered, locator-based, against narrow per-candidate fetches)',
    'For each new page artifact from Phase B, before assigning action: "create":',
    '1. Take the boundary\'s STABLE locators only (candidateFallback.strategy === "useAsIs" from Prompt 1, page-level, semantic, no risk flags) — these are the most reliable match signal because they don\'t vary between recordings of the same page.',
    '2. Query existing page artifacts (via the narrow per-candidate signature fetch — request ONLY {filePath, stableLocatorExpressions} for plausible candidates, never a full artifact dump) for verbatim matches against this boundary\'s stable locator expressions.',
    '3. Apply the tiered decision:',
    '   - 0 matches against any single existing file → action: "create". No further check.',
    '   - EXACTLY 1 match against one file → escalate: fetch a secondary signal for that candidate (its own pageIdentifierText, or its recorded entry context if available) and compare against this boundary\'s pageIdentifierText. Agree → action: "reuse". Disagree or signal unavailable → action: "create".',
    '   - 2 OR MORE matches against the SAME file → strong signal, but still requires the same secondary-signal check before committing — do not auto-commit on count alone. Confirms → action: "reuse". Does not confirm → flag as an ambiguity and default to action: "create" rather than risk a wrong reuse.',
    '4. If action: "reuse" is chosen but this boundary\'s operations include something the existing artifact\'s methods don\'t cover (a new interaction this recording exercises that the existing page object has no method for), set action: "update" instead of "reuse" — list the new method(s) needed, leave existing methods/locators untouched.',
    '5. Record which tier fired and why in a reviewNote (≤15 words) for traceability.',
    '',
    'Workflow reuse-matching (page-sequence-only, deliberately simple to start): after all pageBoundaries in this recording have been resolved (action: reuse/create) per the steps above, build the ordered list of resolved page artifact references this recording\'s workflow touches — e.g. [cricinfoHomePage, seriesDetailPage, scheduleFixturesPage]. Compare against existing workflows\' own ordered page sequences read DIRECTLY from each workflow\'s actual source file (e.g. its imported/instantiated page-object classes, in order) — do NOT use workflowIndex.json as the comparison source. A pre-built index is a second source of truth that can silently go stale relative to the real files; comparing against the real files removes that risk entirely, and this lookup happens once per recording, not per operation, so the cost of reading actual files directly is not a performance concern at this scale.',
    'FALLBACK (temporary, until the direct-comparison approach is validated): if reading workflow source files directly is unavailable for any reason, workflowIndex.json may be consulted as a fallback signal only — flag this explicitly as an assumption when used, since it carries the staleness risk above. Do not remove or stop maintaining workflowIndex.json; keep it as this fallback path until direct comparison is proven reliable in production.',
    '',
    'WHEN IN DOUBT, CREATE — and name it visibly as provisional. Any time this comparison cannot confidently resolve to "reuse" or "reuse + create remainder" (the only two genuinely safe outcomes), default to action: "create" and prefix the new workflow\'s ref/className with "dupe" (e.g. "dupeFilterSeriesAndTeamWorkflow") so the uncertainty is visible in the file system itself, not just in a reviewNote a human might miss. This is a temporary, reviewable artifact a human can rename or consolidate — never a silent guess.',
    '',
    'Apply this comparison, four cases:',
    '- NO existing workflow matches at all: action: "create", normal naming.',
    '- EXACT match against exactly ONE existing workflow (same pages, same order, same count): action: "reuse". The underlying business action and data may differ — that is what the workflow\'s parameters and the test\'s data file carry, not something workflow-matching needs to inspect. While reading the file to confirm this match, also capture matchedSignature (methodName, params, returnType, returnFields) from that same read — do not re-open the file later for this. If the signature can\'t be clearly resolved from that file even though the sequence matched, leave matchedSignature absent and add a high-impact assumptions[] entry instead of guessing.',
    '- The NEW recording\'s sequence is LONGER, and an existing workflow\'s sequence is an exact prefix of it (the existing workflow is the smaller, fully-contained piece): action: "reuse" for that existing workflow (call it whole, never split), action: "create" (normal naming) for a new workflow covering only the remainder the new recording continues into past where the existing one ends. Safe: the existing workflow is always reused whole; only genuinely new content becomes a new artifact. While reading the file to confirm this prefix match, also capture matchedSignature (methodName, params, returnType, returnFields) from that same read, same as the exact-match case above — if the signature can\'t be clearly resolved, leave matchedSignature absent and add a high-impact assumptions[] entry instead of guessing.',
    '- ELSE (exact match against multiple existing workflows; new recording shorter than an existing workflow that contains it as a prefix; same pages in a different order; any other overlap that isn\'t a clean prefix match): action: "create", DUPE-PREFIXED. If this "else" was triggered because one or more existing workflows share or contain this sequence, flag each as a refactor candidate in assumptions[] — their relationship to this newly-recorded, independently-confirmed workflow is evidence a safe extraction may later be possible, for a deliberate human/AI second pass. Never auto-split an existing workflow here. (Exact-match-against-multiple is realistically a later-scale concern, unlikely with few recorded workflows — it costs nothing to state the rule now rather than retrofit it once it occurs.)',
    '',
    'This intentionally does NOT inspect which methods are called on each page or what data flows through them — page sequence alone is the match signal. This is a known simplification: it will occasionally call two recordings "the same workflow" when they exercise different actions on an identical page sequence. That miss is cheap (the generated test still has correct, working steps; it is only mis-filed under a reused workflow name) and is accepted deliberately rather than building a more precise mechanism before real evidence shows page-sequence-alone is insufficient.',
    '',
    '---',
    'PHASE D — Locator resolution (only for operations where candidateFallback.strategy is NOT "useAsIs")',
    'Operations where Prompt 1 set candidateFallback.strategy: "useAsIs" are TRANSCRIBED as a single stable candidate — do not re-evaluate or generate alternate candidates for them. For all other operations (strategy is stripDynamicParent, scopeRequired, firstMatchProvisional, or block), build candidates per the existing tiered system:',
    '- Tier 1/2: strip dynamic parent, keep semantic child; or use a stable-prefix variant for ids matching a dynamic pattern.',
    '- Tier 3: child scoped under the pageBoundary\'s readiness anchor — this is ALWAYS the boundary\'s own first operation, regardless of which operation within the boundary is being resolved (every boundary opens with its readiness assertion as entry 1 of its operations array). SKIP this tier entirely (do not generate the candidate) when the target is page-level (h1, heading, nav, main, a top-level container id) OR when the readiness anchor is itself page-level/a heading/an overlay — a page-level element cannot plausibly be a descendant of either. Also skip when the operation BEING RESOLVED is itself the readiness anchor (self-nesting under itself is meaningless) — fall straight to Tier 4 in that case.',
    '- Tier 4: the bare child target alone, always included as the final fallback.',
    'classification: "stable" if only one candidate resulted (no Tier 3 generated, or candidateFallback.strategy was "useAsIs"); "resolvableViaHelper" if 2+ candidates exist; "provisional" if Prompt 1 flagged a generic/broad risk with no stronger alternative.',
    'dataDependency: "parameterized" whenever the clicked/typed text corresponds to a dataCandidate with ownershipHint "testData" — never classify a business-selected value as "fixed" just because only one recording exists; classify by what the value REPRESENTS (a business choice that could vary) not by whether it varied in this trace.',
    '',
    '---',
    'PHASE E — Data consolidation',
    'Group Prompt 1\'s dataCandidates[] entries by page/scenario, into the FEWEST coherent data concepts possible. Default to ONE model + ONE testData entry per scenario unless fields are genuinely unrelated business concepts (e.g. login credentials vs. checkout address are unrelated; denomination + quantity + expected cart text for one purchase action are NOT unrelated — keep them together). Do not create a new model file just because fields come from different operations or different pages — page-spanning data belonging to one scenario still consolidates into one file.',
    '',
    '---',
    'PHASE F — Workflow assembly',
    'Workflow boundaries are given (a human/recording-structure marker in the request, or default to one workflow spanning all behavior). Within each given workflow boundary, sequence operations into method calls in recorded order — this is mechanical transcription of order, not a new decision. A workflow\'s LAST step, when it triggers a page transition, is the trigger call; the confirming readiness call belongs to the DESTINATION page\'s own waitUntilReady, called as the first step of whatever comes next (workflow or test) — never duplicated into the source workflow\'s own assertions.',
    '',
    '---',
    'PHASE G — Final checks',
    '- Every pageBoundary has exactly one corresponding page artifact (no merges, no splits).',
    '- Every filePath matches the fixed directory taxonomy exactly.',
    '- Every reuse/create/update decision has a recorded tier and reviewNote.',
    '- Data consolidated to the fewest coherent files per Phase E.',
    '- Every Prompt 1 readinessGap has a corresponding page-artifact reviewNote (Phase A.6).',
    '- Every medium/high-impact Prompt 1 ambiguity is carried forward into this prompt\'s assumptions[] (Phase A.6) — not left stranded in Prompt 1\'s output only.',
    '- Flag any decision made with low confidence as an assumption, not silently.',
    '',
    'Return JSON with this shape:',
    '```json',
    '{',
    '  "scenarioPlan": { "objective": "", "baseUrlHandling": { "decision": "reuse existing | mismatch", "recordedEntryUrl": "", "configuredBaseUrl": "", "reason": "" }, "successCriteria": [{ "criterion": "", "source": "recordedAssertion", "sourceOperationOrder": 1, "expectedValue": "" }] },',
    '  "locatorPlan": [{ "locatorRef": "", "classification": "stable | resolvableViaHelper | provisional", "candidateLocator": "", "candidateLocators": [], "helperRef": "", "sourceOperationOrders": [], "dataDependency": "fixed | parameterized", "parameters": [], "evidence": "", "reviewNote": "" }],',
    '  "dataPlan": [{ "dataRef": "", "kind": "model | testData", "action": "create", "sourceOperationOrders": [], "fields": [], "reason": "" }],',
    '  "pageArtifactPlan": [{ "pageBoundaryIndex": 0, "ownerRef": "", "action": "create | reuse | update", "matchTier": "0 | 1 | 2plus | n/a", "existingArtifact": "", "filePath": "", "stateIdentity": "", "readinessEvidence": [], "responsibilities": [], "newMethodsIfUpdate": [], "reviewNote": "" }],',
    '  "workflowPlan": [{ "workflowRef": "", "action": "create | reuse", "matchTier": "noMatch | exactMatch | prefixMatch | else", "dupePrefixed": false, "existingArtifact": "", "filePath": "", "matchedSignature": { "methodName": "", "params": [{ "name": "", "type": "" }], "returnType": "", "returnFields": [{ "name": "", "type": "" }] }, "ownedActionOperationOrders": [], "entryState": "", "exitState": "" }],',
    '  "testPlan": { "action": "create", "filePath": "", "workflowSequence": [], "assertionCriteria": [{ "sourceOperationOrder": 1, "successCriterion": "", "requiredObservedValue": "" }] },',
    '  "proceedDecision": { "status": "proceed | proceedWithProvisionalLocators | blocked", "reason": "", "requiredClarifications": [], "provisionalLocatorReview": [] },',
    '  "assumptions": [{ "statement": "", "sourceOperationOrders": [], "impact": "" }]',
    '}',
    '```',
    '',
    guidedRequestSection(input),
    '',
    'Recorder Parser Output:',
    fenced(input.analysis || 'No recorder parser output pasted yet. Ask for Prompt 1 output before mapping.'),
    '',
    guidedContextSection(contextBundle),
    '',
    workflowReusePromptSection(contextBundle)
  ].join('\n');
}

function buildArtifactDesignPrompt(input, contextBundle) {
  return [
    'You are the Artifact Contract Designer for a framework-compatible Playwright test generation workflow.',
    '',
    'Non-goals:',
    '- Do not write code or reopen architecture, ownership, success criteria, data ownership, or locator classification — Prompt 2\'s decisions are authoritative.',
    '- Do not invent behavior. If required behavior or a runtime value has no approved source, produce a blocked contract only.',
    '',
    'Your job is routine wiring: declare runtime inputs, bind call arguments and results, and bind return fields — exact expansion of Prompt 2\'s decisions, never new judgment.',
    '',
    'Free-text field length: every reason, evidence, reviewNote, note, intentHint, and uiContextHint field must be a fragment of 15 words or fewer — state the decision and its key cause, not a full sentence or narration. EXCEPTION: assumptions[] entries (the statement text within them) are NOT capped — these carry surprising or multi-rule findings and need room; keep them as complete as needed.',
    '',
    'Omit empty/default fields rather than emitting them. Specifically: do not emit a field whose value is an empty string, an empty array, or null UNLESS a downstream consumer requires its presence. Consumers treat an absent field as empty/none. This applies to fields like existingArtifact, helperRef (on non-helper locators), params, imports, fieldName, finalLocatorExpression when empty. Do NOT omit: any enum field (operationType, classification, assertionRole, triggerClass — these stay explicit even when "none"), candidateLocators when non-empty, sourceOperationOrders, or any structured selector data.',
    '',
    'Work through the following phases in order.',
    '',
    '---',
    'PHASE A — Runtime inputs',
    '- Translate scenarioPlan.baseUrlHandling into a runtime input. The base URL access expression is contextBundle.configAccess.baseUrl.expression — never a literal string in generated code. If contextBundle.configAccess.available is false, this is a blocking gap (do not invent or guess a symbol) UNLESS baseUrlHandling.decision indicates this is a first-time configuration (no configuredBaseUrl exists in prepared context yet, not a mismatch — check baseUrlHandling.reason for which case Prompt 2 identified): in that one specific case, use recordedEntryUrl as a literal runtime input value and carry the config-update recommendation forward as a non-blocking note — Prompt 2 already classified this as an expected outcome, not an error.',
    '- runtimeInputs.value carries the actual resolved URL string for traceability only — never emit it literally in generated code. sourceRef is contextBundle.configAccess.baseUrl.expression when available.',
    '- Output: runtimeInputs[].',
    '',
    '---',
    'PHASE A2 — Carry forward Prompt 2\'s setup handling and prior-stage findings',
    '- Prompt 1\'s setupOperations and Prompt 2\'s setup handling already determined which operations are setup versus behavior, and which page each operation belongs to (every operation lives inside its owning pageBoundary in Prompt 1\'s nested output — there is no placement question to re-solve here; that entire problem only existed under the old flat structure and does not exist in this one).',
    '- Setup steps in tests[].steps call a UI owner\'s method directly, never a workflow — use tests[].steps[].call.ownerRef (not workflowRef) for these. Set workflowRef only for steps that invoke a workflow\'s method; set ownerRef only for steps that invoke a UI owner\'s method directly. Exactly one of the two must be populated per step, never both, never neither.',
    '- For every entry in Prompt 2\'s pageArtifactPlan that carries a readinessGap reviewNote (Prompt 1 flagged weak/missing immediate readiness for that page): carry that reviewNote forward verbatim onto the corresponding uiOwner\'s readinessMethods entry — do not resolve, soften, or silently drop it.',
    '- For every assumption already present in Prompt 2\'s own output (which already includes Prompt 1\'s carried-forward medium/high-impact ambiguities, per Prompt 2\'s own Phase A.6): carry these forward verbatim into this prompt\'s own assumptions[] — do not leave them stranded in Prompt 2\'s output only.',
    '- Output: include setup steps in tests[].steps, ordered before any workflow step, using the same structured-step shape as workflow/test steps elsewhere.',
    '',
    '---',
    'PHASE B — Expand artifacts (models, test data, UI owners, workflows, tests)',
    'For each Prompt 2 ref, expand exactly once. Apply these rules uniformly across all five artifact categories:',
    '- Before naming any new method, field, or class, check contextBundle.frameworkCapabilities. If there is an exact match, do not use the name.',
    '- Preserve exact identities for reused artifacts. Name new artifacts from Prompt 2 refs using the FIXED directory taxonomy (_automation/models|pages|test-data|workflows|tests/{api,database,ui}/) — this structure is constant across every project on this framework; never invent a different directory name regardless of what currently exists inside it. Use filePath consistently.',
    '- Copy imports only from prepared context or resolvable existing artifacts. Do not invent or normalize package names. Conflicting or unresolved required imports block.',
    '- Keep owned actions, readiness evidence, and assertion evidence in separate operation-order fields — never enlarge action ownership with readiness or assertions. (Prompt 2 already partitioned these; you are only carrying the partition forward.)',
    '- action for every model/testData/uiOwner — including "update" where applicable — and for every workflow (only "reuse" | "create", workflows never get "update" under Prompt 2 v3\'s page-sequence matching): COPY Prompt 2\'s value verbatim. Do not re-evaluate reuse/create/update here — Prompt 2\'s tiered matching already decided this with real evidence (locator matches for pages, page-sequence matches for workflows). matchTier and, for workflows, dupePrefixed are carried forward for traceability even though they are not themselves consumed by Code Generator.',
    '',
    'B1. Models — from Prompt 2\'s dataPlan entries (kind: "model"): business fields only; execution metadata is never a model field. Action is always "create" — Prompt 2 v3 does not reuse-match models/testData; data stays per-recording by design.',
    '',
    'B2. Test data — from Prompt 2\'s dataPlan entries (kind: "testData"): compose its model with typed expected values and metadata.enabled true. Preserve recorded values and Unicode exactly. Action is always "create", same as B1.',
    '',
    'B3. UI owners (page/component):',
    '   - Every locatorPlan entry, regardless of classification, gets exactly one structured entry in this owner\'s locators[] array. The contract is the only artifact Prompt 4 receives — never describe a locator by name only in prose (e.g. "per locatorPlan seriesNavLink"); the literal selector data must be physically present in locators[].',
    '   - locators[].status carries Prompt 2\'s classification forward verbatim as its STARTING value: stable | resolvableViaHelper | provisional. "blocked" is a real, confirmed value that halts code generation when present — if THIS prompt\'s own Phase A preflight finds an internal inconsistency on a locator (its candidateLocators is empty despite a non-"stable" classification, or its finalLocatorExpression is empty despite "stable" classification, or its helperRef does not match any real signature in frameworkCapabilities), set this locator\'s status to "blocked" and ALSO set contractStatus to "blocked" with the specific item in blockedItems (the confirmed scope of what "blocked" halts is the whole contract, not verified as locator-scoped only — treat it conservatively as a full stop until that scope is confirmed). Record the specific reason in this locator\'s reviewNote — this must never happen silently.',
    '   - stable/provisional: kind is field or factory (factory only when every parameter changes finalLocatorExpression; otherwise field with no parameters). Populate finalLocatorExpression with Prompt 2\'s candidateLocator, preserving scopes, filters, .first(), .nth() structurally — only page-to-this.page owner context and declared parameter substitution are permitted. Leave candidateLocators/helperRef empty and manualOverride false.',
    '   - resolvableViaHelper: kind is helper. Leave fieldName and finalLocatorExpression empty — do not collapse this into a single locator field or factory. Copy candidateLocators verbatim from Prompt 2\'s locatorPlan: the full ordered array, same priority order, each entry a zero-arg locator-builder matching the named helper\'s expected parameter shape. Copy helperRef verbatim, looked up by exact method signature in frameworkCapabilities — do not guess parameter shape. Set manualOverride: true — Prompt 4 emits the standard override comment text from this flag; do not emit comment text yourself.',
    '   - UI methods reference a locators[] entry by locatorRef rather than restating its candidates or helper inline. Methods consume parameters through behavior, locator factories, or (for resolvableViaHelper) the parameterized candidateLocators already declared on the owning locators[] entry. Use routine syntax only when one prepared framework helper directly matches the approved operation.',
    '   - readinessMethods built from Prompt 2\'s readinessEvidence/stateIdentity verbatim — these already carry the resolved page-identity signal. Carry forward any readinessGap reviewNote per Phase A2.',
    '',
    'B4. Workflows — express execution as structured steps (see Phase C for the valueRef rules governing these steps). Bind every return field through returnBindings to a step result. Return only observed values required by assertions; never echo input data.',
    '   - If Prompt 2\'s workflowPlan.dupePrefixed is true, preserve the "dupe"-prefixed ref/className EXACTLY as Prompt 2 wrote it — this is a deliberate, visible uncertainty marker, not a naming-convention violation to clean up. Never strip this prefix or rename it to look like a normal artifact.',
    '   - For action: reuse workflows, do not derive a returnShape from this generation\'s own evidence and do not re-open the existing workflow file yourself — Prompt 2 already read it to confirm the page-sequence match. Use workflowPlan.matchedSignature (methodName, params, returnType, returnFields) directly to build this workflow\'s method/steps/returnShape. If matchedSignature is absent, this is a dependenciesResolvable failure in Phase E, not a value to guess.',
    '   - Page sequence and owned operations: COPY Prompt 2\'s workflowPlan verbatim — do not merge, split, or reassign which pages a workflow touches.',
    '   - If Prompt 2 flagged any existing workflow as a refactor candidate (a workflowPlan entry\'s matchTier of "else" arising from a shared/contained page sequence), carry that flag forward into this prompt\'s own assumptions[] verbatim — do not resolve it, do not act on it, do not drop it. It is information for a later deliberate pass, not something this generation should respond to.',
    '',
    'B5. Tests — express execution as structured steps (same valueRef rules). Bind every assertion\'s actualValueRef to a produced result and expectedValueRef to test data or a runtime input. Recorded content-text assertions set whitespaceNormalized true.',
    '   - filePath and which workflows the test calls: COPY Prompt 2\'s testPlan verbatim — do not re-derive the test\'s file path or workflow sequence.',
    '   - Every assertion is built from scenarioPlan.successCriteria verbatim — one assertion per successCriteria entry (criterion, sourceOperationOrder, expectedValue), comparing the workflow\'s returned value against that expectedValue. This is the ONLY source of test assertions — never invent an assertion successCriteria does not list, never omit one it does.',
    '',
    '- Output: models[], testData[], uiOwners[], workflows[], tests[].',
    '',
    '---',
    'PHASE C — Resolve the value-flow symbol table',
    'This phase governs every valueRef used anywhere in Phase B\'s output (workflow steps, test steps, return bindings, assertion bindings). Apply it as one consistent pass after drafting Phase B, not as a separate set of rules to track simultaneously while drafting each artifact.',
    '- Permitted valueRef forms only: runtime.<ref>, data.<binding>, data.<binding>.<field>, params.<name>, params.<name>.<field>, results.<assignTo>, results.<assignTo>.<field>.',
    '- Each ref must resolve in its method/test scope, and every assignTo must have exactly one producer.',
    '- Optional interruptions remain conditional only at recorded or profile-defined points. Readiness uses approved destination evidence only.',
    '- If any valueRef in Phase B\'s output does not resolve under these forms, fix it now (you may revise Phase B\'s step/binding wiring to fix a value-flow error — this is still routine wiring, not new judgment) or, if it cannot be resolved, route the item to blockedItems in Phase E.',
    '',
    '---',
    'PHASE D — Build manifest',
    '- List each created or updated file once, in dependency order.',
    '- List only available static validation commands. Runtime execution is deferred to QA.',
    '- Output: buildManifest.filesToCreate/filesToUpdate/filesToLeaveUnchanged/implementationOrder/validationCommands.',
    '',
    '---',
    'PHASE E — Validate and set contract status',
    'First: if Prompt 2\'s own proceedDecision.status is "blocked", carry that block forward verbatim (same requiredClarifications) — do not re-evaluate whether Prompt 2 was right to block. This is checked BEFORE the six checks below, not instead of them.',
    '',
    'Run these six checks. This is a check of what you produced in Phases A-D, not a new design pass:',
    '- schemaConformant: exact schema keys and enums are used.',
    '- operationTraceabilityComplete: every meaningful operation remains an owned action, readiness/assertion evidence, a Prompt 2 discard, or a Phase A2 setup step (referenced or newly expanded).',
    '- architecturePreserved: Prompt 2 ownership, locators, artifact decisions, and success criteria are unchanged — this check FAILS if this prompt changed any of them, by design.',
    '- valueFlowComplete: all valueRefs, assignments, arguments, return bindings, and assertion inputs resolve in a closed symbol table (per Phase C).',
    '- dependenciesResolvable: every artifact ref, filePath, import, and build dependency resolves.',
    '- frameworkCompatible: signatures and imports match prepared context.',
    '',
    '- Provisional locators, approved reasonable assumptions, and unambiguous routine framework syntax do NOT block.',
    '- Block only when Prompt 2 already blocked, or one of the six checks above is false. If blocking: report the exact item in blockedItems with which check failed and why, and leave artifact arrays and build lists empty. contractStatus: blocked.',
    '- If all six pass and provisional/resolvableViaHelper locators exist: contractStatus: readyWithProvisionalLocators.',
    '- If all six pass with every locator "stable": contractStatus: ready.',
    '- Output: contractStatus, contractValidation (all six keys), blockedItems[], provisionalLocatorReview[], assumptions[].',
    '',
    'Return JSON matching this schema exactly. Unknown, missing, renamed, or aliased keys make the contract invalid:',
    '```json',
    '{',
    '  "contractStatus": "ready | readyWithProvisionalLocators | blocked",',
    '  "blockedItems": [{ "check": "", "itemRef": "", "reason": "" }],',
    '  "contractValidation": { "schemaConformant": true, "operationTraceabilityComplete": true, "architecturePreserved": true, "valueFlowComplete": true, "dependenciesResolvable": true, "frameworkCompatible": true },',
    '  "runtimeInputs": [{ "ref": "", "type": "", "value": null, "sourceRef": "" }],',
    '  "models": [{ "ref": "", "action": "create", "filePath": "", "interfaceName": "", "fields": [{ "name": "", "type": "", "sourceOperationOrders": [] }], "imports": [], "dependsOn": [] }],',
    '  "testData": [{ "ref": "", "action": "create", "filePath": "", "exportName": "", "modelRef": "", "typeExpression": "", "values": [{ "name": "", "value": null, "sourceOperationOrders": [] }], "metadataEnabled": true, "imports": [], "dependsOn": [] }],',
    '  "uiOwners": [{ "ref": "", "ownerType": "page | component", "action": "reuse | create | update", "matchTier": "0 | 1 | 2plus | n/a", "existingArtifact": "", "filePath": "", "className": "", "imports": [], "dependsOn": [], "ownedActionOperationOrders": [], "readinessOperationOrders": [], "assertionOperationOrders": [], "locators": [{ "locatorRef": "", "fieldName": "", "kind": "field | factory | helper", "params": [{ "name": "", "type": "" }], "finalLocatorExpression": "", "candidateLocators": [], "helperRef": "", "manualOverride": false, "status": "stable | resolvableViaHelper | provisional | blocked", "sourceOperationOrders": [] }], "methods": [{ "methodRef": "", "name": "", "params": [{ "name": "", "type": "" }], "returnType": "", "sourceOperationOrders": [], "behavior": "" }], "readinessMethods": [{ "methodRef": "", "name": "", "params": [{ "name": "", "type": "" }], "signal": "", "reviewNote": "", "sourceOperationOrders": [] }] }],',
    '  "workflows": [{ "ref": "", "action": "reuse | create", "matchTier": "noMatch | exactMatch | prefixMatch | else", "dupePrefixed": false, "existingArtifact": "", "filePath": "", "className": "", "imports": [], "dependsOn": [], "ownedActionOperationOrders": [], "readinessOperationOrders": [], "assertionOperationOrders": [], "methods": [{ "methodRef": "", "name": "", "params": [{ "name": "", "type": "" }], "returnType": "", "steps": [{ "stepRef": "", "call": { "ownerRef": "", "methodRef": "", "args": [{ "param": "", "valueRef": "" }] }, "assignTo": null }], "returnBindings": [{ "fieldName": "", "valueRef": "" }] }], "returnShape": { "typeName": "", "fields": [{ "name": "", "type": "", "sourceAssertionOrders": [], "observedFrom": "" }] } }],',
    '  "tests": [{ "ref": "", "action": "create | update", "existingArtifact": "", "filePath": "", "suiteName": "", "testName": "", "imports": [], "dependsOn": [], "dataBindings": [{ "name": "", "dataRef": "" }], "steps": [{ "stepRef": "", "call": { "workflowRef": "", "ownerRef": "", "methodRef": "", "args": [{ "param": "", "valueRef": "" }] }, "assignTo": null }], "assertions": [{ "sourceOperationOrder": 1, "actualValueRef": "", "matcher": "", "expectedValueRef": "", "whitespaceNormalized": false }] }],',
    '  "provisionalLocatorReview": [{ "locatorRef": "", "ownerRef": "", "reason": "", "sourceOperationOrders": [] }],',
    '  "buildManifest": { "filesToCreate": [], "filesToUpdate": [], "filesToLeaveUnchanged": [], "implementationOrder": [], "validationCommands": [] },',
    '  "assumptions": [{ "statement": "", "sourceOperationOrders": [], "impact": "low | medium | high" }]',
    '}',
    '```',
    '',
    guidedRequestSection(input),
    '',
    // guidedContextSection/workflowReuseSourceOnlySection are placed before the verbatim Prompt 1/2
    // re-embeds below: those two upstream JSON blobs (~9-10K + ~6-7K chars) are by far the largest
    // content in this prompt, so putting them last ensures a truncation cuts into them first,
    // not into frameworkCapabilities/conventions/artifacts — same principle as the field-order fix
    // in buildAutomationContext().
    guidedContextSection(omitSamplesForArtifactDesign(contextBundle)),
    '',
    workflowReuseSourceOnlySection(contextBundle),
    '',
    'Recorder Parser Output:',
    fenced(compactAnalysisForArtifactDesign(input.analysis)),
    '',
    'Scenario Planner / Framework Mapping:',
    fenced(input.mapping || 'No Scenario Planner / Framework Mapping output pasted yet. Ask for Prompt 2 output before designing artifacts.')
  ].join('\n');
}

function buildCodeGenerationPrompt(input, contextBundle) {
  return [
    'You are the Code Generator for a framework-compatible Playwright test generation workflow.',
    '',
    'Non-goal: the contract is the only implementation authority. Do not redesign, rename, reclassify, repair, or reinterpret it.',
    '',
    'Work through the following phases in order. Do not begin writing code until Phase A passes.',
    '',
    '---',
    'PHASE A — Preflight (stop/proceed gate)',
    'Check, in order, and stop without writing if any of these is true:',
    '- The contract does not match the exact Prompt 3 schema, or its six contractValidation keys are missing/renamed/aliased.',
    '- contractStatus is blocked.',
    '- Any contractValidation value is false.',
    '- A buildManifest item lacks its corresponding contract entry.',
    '- An import conflicts with prepared context.',
    '- A locator differs from its finalLocatorExpression.',
    '- The closed value-flow graph has an unresolved or duplicate symbol.',
    '',
    'Not blockers (proceed normally through these): provisional locators, and routine syntax supplied by one directly-matching prepared framework API.',
    '',
    'If you stop here: output only the exact blocking items. Do not proceed to Phase B.',
    'If you proceed: report contractStatus, implementationOrder, validation commands, and provisional locator count, before writing anything.',
    '',
    '---',
    'PHASE B — Emit code, file by file, in buildManifest.implementationOrder',
    'Implement only filesToCreate and filesToUpdate, in that exact order. Leave reuse-only and filesToLeaveUnchanged artifacts untouched.',
    '',
    'For each file, apply these rules (same rules for every file — process one file at a time rather than holding all files in mind together):',
    '- Preserve every filePath, symbol, import, dependency, locator expression, method order, structured step, assignment, return binding, and assertion exactly as contracted.',
    '- Use prepared framework APIs only for routine syntax implicit in contracted behavior. Add no artifacts, behavior, assertions, fields, fallback locators, or runtime inputs beyond the contract.',
    '- Emit locator expressions exactly, including parameters, scopes, filters, .first(), .nth(). Add one short review comment beside provisional fields.',
    '- When a locator has manualOverride: true, emit this exact comment as the last line inside its resolveLocator candidate array, before the closing bracket: `// Manual override: if every automatic candidate above fails, a QA can add a manually-supplied locator (e.g. a confirmed XPath) as a new first entry — expected maintenance, not an error.`',
    '- Resolve each valueRef from runtimeInputs, dataBindings, method parameters, or earlier assignTo symbols. Never invent a value or ignore a parameter.',
    '- For whitespaceNormalized assertions, normalize actual and expected with value.replace(/\\s+/g, " ").trim(), using an existing helper when available.',
    '- Preserve Unicode and metadataEnabled exactly.',
    '',
    'Apply by artifact category:',
    '- UI owners: contain UI actions only.',
    '- Workflows: execute their steps, bind assignTo values, construct returns from returnBindings.',
    '- Tests: execute workflow steps, bind results, assert resolved values.',
    '',
    'Scope constraint: modify only the selected app\'s _automation directory. Do not run Git commands.',
    '',
    '---',
    'PHASE C — Validate',
    'Run only buildManifest.validationCommands. Runtime Playwright execution is deferred to QA through the dashboard UI — do not attempt to run tests.',
    '',
    '---',
    'PHASE D — Report',
    '- If write access is available: report changed files, static validation results, provisional locator notes, every high-impact entry from the contract\'s assumptions[] (these are findings a human should see before trusting this test — do not omit them from the report just because code generation succeeded), and a note that runtime execution is deferred.',
    '- If write access is unavailable: output code grouped by contracted filePath, or a unified diff.',
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
    'Non-goal: do not write unrelated code. You are auditing, not fixing.',
    '',
    'If generated code or patch text is not pasted below, inspect the current repo working tree and review only changed files under _automation.',
    '',
    'Work through the following phases in order. Each phase checks one category of correctness against a specific upstream source — do not mix categories within a phase.',
    '',
    '---',
    'PHASE A — Contract conformance (compare generated code against Artifact Contract)',
    '- Verify the generated files match buildManifest exactly: files created/updated, entry point, implementation order, stop conditions.',
    '- Identify unauthorized artifact renames and any mismatch between the Artifact Contract and generated code.',
    '- Identify out-of-scope edits (anything outside _automation, or outside what buildManifest specified).',
    '- Identify placeholder imports, exact generated ids leaking into code, hardcoded or unscoped variable-entity locators, raw locator leakage into specs (specs should call workflows/pages, not raw Playwright locators).',
    '',
    '---',
    'PHASE B — Cross-stage consistency (compare Artifact Contract against Scenario Mapping, and Scenario Mapping against Recorder Parser Output)',
    '- Identify naming convention violations.',
    '- Identify mismatches between Scenario Planner/Framework Mapping, Artifact Contract, and generated code (three-way check — a drift can appear at either handoff).',
    '- Identify ownership mistakes (an action implemented in the wrong artifact relative to what Prompt 2 assigned).',
    '',
    'Setup-placement check (generic — this is the one ownership category not covered by uiOwnershipPlan/workflowOperationOwnership, so it needs its own explicit check):',
    '- For every operation in Scenario Mapping\'s scenarioPlan.setupHandling that was expanded into a new step (coveredByExisting: false), independently determine which page/owner was actually current in the recording at that operation\'s order — using Recorder Parser Output\'s uiBoundaries/stateTransitions to establish which page transition, if any, had already occurred by that operation\'s order.',
    '- Flag a violation if the generated artifact hosting that setup step does not match the page that was actually current at that point in the recording (e.g. a setup step recorded before the first page transition was placed on a page object that only comes into existence after a later transition).',
    '- Do not rely solely on the Artifact Contract\'s own stated placement for this check — the contract itself may have made this mistake; this check must independently re-derive correct placement from Recorder Parser Output\'s operation-order evidence, the same way correct placement should have been derived upstream.',
    '',
    '---',
    'PHASE C — Behavioral correctness (read the generated code on its own terms)',
    '- Identify missing assertions, missing test data/models, echoed-input assertions (asserting a value that was only ever an input, never an independently observed result).',
    '- Identify workflow return-shape or assertion-input mismatches, such as a spec using a string matcher against a Locator or object.',
    '- Identify unused parameters and corrupted source text.',
    '',
    '---',
    'PHASE D — Navigation and readiness correctness',
    '- Verify the workflow calls the entry page open/navigation method before the first interaction, and follows mapped baseUrlHandling.',
    '- Verify recorder readiness assertions before important interactions were preserved as page/component readiness where needed.',
    '- Verify trigger-plus-item interactions (e.g. header menus) are implemented as a composite page/component method, using a framework helper when available.',
    '- Identify: missing waitUntilReady() methods, missing workflow transition waits, destination readiness that redundantly reuses a signal already satisfied on the source step, raw readiness waits inside specs, fixed sleeps, or readiness logic placed in the wrong artifact.',
    '- Cross-reference Recorder Parser Output\'s readinessGaps field directly: for each entry, confirm the generated code either added an appropriate readiness check at that point, or — if none was added — that this is a known, accepted gap rather than a silent omission worth flagging as needs_changes. Do not rely on inferring this from general readiness review alone; readinessGaps names the specific points to check.',
    '',
    '---',
    'PHASE E — Framework idiom correctness',
    '- Identify raw Playwright interactions that should instead use framework interaction catalog helpers.',
    '',
    '---',
    'PHASE F — Compile findings',
    '- Merge findings from Phases A-E into violations[] and recommendedFixes[].',
    '- status: pass only if no phase produced a violation. needs_changes otherwise.',
    '- outOfScopeConcerns: anything noticed that\'s real but outside this review\'s authority to flag as a blocking violation (e.g. a pre-existing issue in reused code not touched by this generation).',
    '- validationCommands: carry forward from the contract/generated output if applicable.',
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

// Categories whose methods must be called by exact signature per a prompt rule (currently only
// Prompt 2 Phase D's framework helper check, which calls a locatorResolution method by name) get
// full name/params/returnType/description in the compact rendering below. Every other category
// only needs its method names enumerated so the prompt can recognize "a helper exists" and which
// one to prefer — full per-method JSON for those categories is reference detail the prompt itself
// never reads, and was the single largest contributor to contextBundle exceeding the copy-paste
// size budget into a chat session.
const FRAMEWORK_CAPABILITY_FULL_SIGNATURE_CATEGORIES = new Set(['locatorResolution']);

function renderCompactFrameworkCapabilities(frameworkCapabilities) {
  if (!frameworkCapabilities?.available) {
    return `Framework capabilities: ${frameworkCapabilities?.message ?? 'Not available.'}`;
  }

  const methods = Array.isArray(frameworkCapabilities.methods) ? frameworkCapabilities.methods : [];
  if (!methods.length) {
    return 'Framework capabilities: Available, but no methods were cataloged.';
  }

  const byCategory = new Map();
  for (const method of methods) {
    const category = method.category || 'uncategorized';
    if (!byCategory.has(category)) {
      byCategory.set(category, []);
    }
    byCategory.get(category).push(method);
  }

  const lines = [
    'Framework capabilities (compact — grouped by category; method names only, except categories a prompt rule must call by exact signature):'
  ];

  for (const category of [...byCategory.keys()].sort((left, right) => left.localeCompare(right))) {
    const categoryMethods = [...byCategory.get(category)].sort((left, right) => left.name.localeCompare(right.name));

    if (FRAMEWORK_CAPABILITY_FULL_SIGNATURE_CATEGORIES.has(category)) {
      lines.push(`- ${category}:`);
      for (const method of categoryMethods) {
        const params = (method.parameters ?? []).map((param) => `${param.name}: ${param.type}`).join(', ');
        const normalizedDescription = (method.description ?? '').replace(/\s+/g, ' ').trim();
        const description = normalizedDescription ? ` — ${normalizedDescription}` : '';
        lines.push(`  - ${method.name}(${params}): ${method.returnType}${description}`);
      }
    } else {
      lines.push(`- ${category}: ${categoryMethods.map((method) => method.name).join(', ')}`);
    }
  }

  return lines.join('\n');
}

function guidedContextSection(contextBundle) {
  if (!contextBundle) {
    return 'Prepared dashboard/MCP context: Not included or unavailable.';
  }

  // frameworkCapabilities is rendered separately (compact form) instead of inline in the JSON
  // blob — the full per-method objects (parameters, returnType, description for all 56+ methods)
  // are reference detail, not something any prompt phase reads field-by-field as JSON. It renders
  // BEFORE the JSON blob, not after: contextBundleForPrompt still contains samples/frameworkAi,
  // the two largest fields, and the entire point of this compact form is that it must survive
  // truncation ahead of them — placing it after the JSON would put it behind samples/frameworkAi
  // again, undoing the field-ordering fix this was built to complement.
  const { frameworkCapabilities, ...contextBundleForPrompt } = contextBundle;

  return [
    'Prepared dashboard/MCP context:',
    '',
    renderCompactFrameworkCapabilities(frameworkCapabilities),
    '',
    '```json',
    JSON.stringify(contextBundleForPrompt, null, 2),
    '```',
    '',
    'App-specific generation profile rules:',
    '- If appSpecificGenerationProfile.available is true, apply only the provided app-specific rules.',
    '- If appSpecificGenerationProfile is missing, unavailable, empty, or has no applicable entries, continue with the generic prompt rules and recorder output.',
    '- Do not invent app-specific rules, optional interruptions, locator shortcuts, or navigation behavior that are not present in the profile or recorder output.'
  ].join('\n');
}

function workflowReusePromptSection(contextBundle) {
  const reuse = contextBundle?.workflowReuseMatches;
  if (!reuse?.matches?.length) {
    return 'Workflow reuse matches: None confirmed for this recording. Continue with the existing mapping rules.';
  }

  return [
    'Deterministic workflow reuse matches:',
    '```json',
    JSON.stringify(stripMatchContent(reuse), null, 2),
    '```',
    'Reuse rules:',
    '- Treat a compatible match as the exclusive workflow-level owner of its operationOrders. Assign only unmatchedOperationOrders to new or updated workflows, prohibit overlap between workflow ranges, and compose all owners in source-operation order in the spec.',
    '- Preserve entry/exit-state compatibility. If a listed match is semantically invalid, record the reason, remove that ownership assignment, and remap its operations exactly once.',
    '',
    matchedWorkflowSourceSection(reuse.matches)
  ].join('\n');
}

function workflowReuseSourceOnlySection(contextBundle) {
  const reuse = contextBundle?.workflowReuseMatches;
  if (!reuse?.matches?.length) {
    return 'Reused workflow source: None confirmed for this recording.';
  }

  return [
    matchedWorkflowSourceSection(reuse.matches),
    '',
    'This source is reference-only evidence for artifacts Prompt 2 already decided to reuse. It does not reopen which workflows are reused, their operation ownership, or any other Prompt 2 decision; Scenario Planner / Framework Mapping workflowOperationOwnership remains authoritative. Use it only to read the exact existing method names, parameters, and return shape so the contract matches reality.'
  ].join('\n');
}

function matchedWorkflowSourceSection(matches) {
  const uniqueByPath = [...new Map(matches.map((match) => [match.artifactPath, match])).values()];
  return [
    'Matched workflow source (read existing method names, parameters, and return shape from here; do not invent them):',
    ...uniqueByPath.flatMap((match) => [
      '',
      `File: ${match.artifactPath}`,
      '```ts',
      match.content || 'File content unavailable.',
      '```'
    ])
  ].join('\n');
}

function stripMatchContent(reuse) {
  return {
    matches: reuse.matches.map(({ content, ...summary }) => summary),
    unmatchedOperationOrders: reuse.unmatchedOperationOrders
  };
}

async function includeWorkflowReuseMatches(contextBundle, parserOutput) {
  try {
    const result = await api('/api/workflow-reuse/match', {
      method: 'POST',
      body: withRepo({ parserOutput })
    });
    return {
      ...contextBundle,
      workflowReuseMatches: {
        matches: result.matches ?? [],
        unmatchedOperationOrders: result.unmatchedOperationOrders ?? []
      }
    };
  } catch (error) {
    console.warn(`Workflow reuse matching skipped: ${error instanceof Error ? error.message : String(error)}`);
    return contextBundle;
  }
}

async function stageWorkflowReuseCandidates(input) {
  try {
    const result = await api('/api/workflow-reuse/stage', {
      method: 'POST',
      body: withRepo({
        parserOutput: input.analysis,
        artifactContract: input.design,
        formattedCode: input.formattedCode
      })
    });
    if (result.staged?.length) {
      preparedAutomationContext = null;
    }
  } catch (error) {
    console.warn(`Workflow reuse staging skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function fenced(value) {
  return [
    '```',
    String(value || '').trim(),
    '```'
  ].join('\n');
}

// Prompt-3-embedding-only: kept whole — entry, pageBoundaries (with nested operations[] intact),
// dataCandidates, successCoverage, readinessGaps. v3's pageBoundaries IS the page-ownership/operation
// structure Prompt 3 needs; there is no flat operationTrace/uiBoundaries left to selectively trim, so
// nested operations are never cherry-picked apart from the boundary they live in. This does not change
// Prompt 1's actual output, the schema returned to the dashboard, or what Prompt 2 receives — only what
// gets re-embedded inside Prompt 3's own prompt text.
function compactAnalysisForArtifactDesign(analysisJson) {
  const raw = String(analysisJson || '').trim();
  if (!raw) {
    return raw;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  const compact = {
    entry: parsed.entry,
    pageBoundaries: parsed.pageBoundaries,
    dataCandidates: parsed.dataCandidates,
    successCoverage: parsed.successCoverage,
    readinessGaps: parsed.readinessGaps
  };
  return JSON.stringify(compact, null, 2);
}

// Prompt-3-embedding-only: samples exist to demonstrate naming/import/composition conventions
// (extends BasePage, .js import extensions, expect/test from the framework package, workflow
// return-shape composition) already stated explicitly in conventions and the frameworkAi compact
// digest. Confirmed buildArtifactDesignPrompt's own phase text never references "samples" by name.
// Strips it only from what guidedContextSection embeds here — not from contextBundle itself (the
// object this function receives is never mutated), not from what Prompt 2/4/5 receive through the
// same guidedContextSection call, and not from buildAutomationContext()'s returned object or the
// /api/automation-context response shape.
function omitSamplesForArtifactDesign(contextBundle) {
  if (!contextBundle || !('samples' in contextBundle)) {
    return contextBundle;
  }
  const { samples, ...rest } = contextBundle;
  return rest;
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
