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
    'Work through the following phases in order. Each phase narrows what you need to think about in the next — do not jump ahead or revisit a decided phase.',
    '',
    '---',
    'PHASE A — Establish entry point',
    '- Treat the first page.goto URL as the candidate app entry point.',
    '- Normalize origin (protocol + host), path, queryParams, normalizedStartPath.',
    '- This is the only phase that touches `entry`. Do not revisit it later.',
    '',
    '---',
    'PHASE B — Walk the operation trace mechanically',
    'For each recorder operation, in order:',
    '- Classify operationType strictly from its Playwright function (mechanical, not judgment).',
    '- Decompose the locator if it has chained parts (see locator rules below). Do this now, per-operation — do not defer locator decomposition to a later pass.',
    '- Mark isMeaningful. An incidental click remains operationType click; mark isMeaningful false only when it does not trigger meaningful UI state (this includes focus-only clicks, duplicate clicks, Tab presses, arrow-key corrections). When isMeaningful is false, also add a recorderNoise entry.',
    '- Do NOT classify assertionRole yet — leave it for Phase D. Do NOT decide dataCandidates yet — leave it for Phase E. Do NOT decide uiBoundaries yet — leave it for Phase F.',
    '',
    'Locator decomposition rules (apply per-operation, in this phase only):',
    '- Split into parentScope and childTarget when the locator has chained parts.',
    '- Example: page.locator(\'#tippy-85\').getByText(\'India Women\') has parentScope #tippy-85 (risk: dynamic), childTarget getByText(\'India Women\') (type: text, value: India Women).',
    '- If a locator has no chainable child call (the whole locator IS the target — e.g. a single class-based .first() selector), set childTarget to the full locator value with its matcher kind, and leave parentScope empty with parentScopeRisk "none". Do not force an artificial split.',
    '- parentScopeRisk classification: dynamic = generated/tippy/popover/framework-generated/changing ids, transient overlay containers. broad = generic div/body/container, class-only layout, nth/first ordinal, unscoped CSS classes. stable = test ids, semantic regions, named dialogs/forms/nav/menus, stable headings/sections, specific business containers.',
    '- childTargetType: role, text, label, testId, css, xpath, or unknown — capture visible value when present.',
    '- candidateFallback.strategy: useAsIs (stable locator) | stripDynamicParent (dynamic parent, meaningful child) | scopeRequired (uniqueness depends on missing parent/container) | firstMatchProvisional (first-match is a low-risk fallback) | block (no meaningful target exists) | none (non-locator operations).',
    '- You are providing facts for Prompt 2, not deciding whether a provisional fallback is acceptable. Do not soften or upgrade a classification to make it look safer.',
    '',
    '---',
    'PHASE C — Identify UI boundaries',
    '- Now that the trace is walked, mark uiBoundaries: observed state changes only — route/full-screen changes, browser popups/new tabs, modals, drawers, popovers, menus, tabs, panels, wizard steps, heading-defined states.',
    '- A DOM overlay/popover is NOT a browserPopup.',
    '- Do not infer page objects, component artifacts, classes, or ownership — boundaries are observations, not artifact proposals.',
    '- Reference evidenceOperationOrders from Phase B\'s trace.',
    '',
    'Boundary-mechanism ambiguity rule (applies to any app, not a special case):',
    '- Recorder code frequently cannot distinguish the underlying mechanism of a UI change — e.g. a full route change vs. an in-page tab swap vs. a panel/drawer toggle — when the only evidence is a click on a role/text target with no URL or framework signal attached.',
    '- When more than one boundaryType would fit the available evidence equally well, do not guess a single answer. Set boundaryType to your best-supported single classification, but add a boundaryMechanismConfidence field: "certain" when the evidence is unambiguous (e.g. a goto, a popup window event, a role:tab attribute), "ambiguous" when multiple mechanisms are equally plausible from recorder evidence alone.',
    '- When boundaryMechanismConfidence is "ambiguous", always add a corresponding ambiguities entry naming the specific competing boundaryTypes considered, so downstream stages know this classification is a best guess, not a confirmed fact, regardless of which app or UI pattern produced it.',
    '',
    '---',
    'PHASE D — Classify assertions (success-coverage logic)',
    'Apply this precedence to every assertion operation, in order — use the first row that matches:',
    '1. If the assertion\'s recorded text/value directly corresponds to the stated "what should prove the test passed" input: assertionRole success, confidence certain.',
    '2. Else if this assertion is part of the trailing assertion group (walk backward from the last operation, collect every consecutive assertion until a non-assertion operation): assertionRole success, confidence inferred, and add ambiguity: "no literal match to stated criterion; used terminal assertion(s) by position".',
    '3. Else if no trailing group exists at all (trace ends on a non-assertion operation, or contains no assertions) — atypical, likely a recording gap: this row does not assign assertionRole to anything (there is no assertion operation to classify). Instead set successCoverage.status: inferredRequired; list dataCandidates from the final meaningful operations as possibleEvidence (do not synthesize exact expected text); add a loud ambiguity flagging the recording may be missing an assertion.',
    '',
    'For all other (non-success) assertions, apply in this order:',
    '- Protects a later interaction: assertionRole readiness.',
    '- Carries other state through the journey: assertionRole intermediate.',
    '- Fits more than one of the above: use the first matching one in this stated order.',
    '- None is clear: assertionRole intermediate, and record an ambiguity.',
    '',
    'Preserve recorded text/value evidence exactly. Visibility alone records presence but does not supply unrecorded identity text. This is the only phase that assigns assertionRole — do not revise assertionRole in a later phase.',
    '',
    'Readiness-gap rule (applies to any app, not a special case):',
    '- Many state-changing operations (clicks that navigate, open a view, or trigger a transition) will have no recorded assertion confirming the destination loaded before the next interaction proceeds — the recording simply continues. This is common and is not itself an error in the recording.',
    '- Do not invent a readiness assertion that was not recorded, and do not retroactively relabel a later, unrelated assertion as if it covered this gap.',
    '- Instead, for every uiBoundary or stateTransition trigger operation that has no assertion directly confirming its destination state before the next meaningful operation, add an entry to readinessGaps: { "triggerOperationOrder": 1, "expectedReadyState": "", "nextOperationOrder": 2, "reason": "" }',
    '- This applies uniformly regardless of what kind of transition it is (route, tab, panel, modal, etc.) — the rule is about absence of evidence, not about the transition type.',
    '- Output successCoverage alongside assertions: { "status": "covered | inferredRequired", "supportingAssertionOrders": [], "confidence": "certain | inferred", "possibleEvidence": [], "reason": "" }',
    '',
    '---',
    'PHASE E — Extract data candidates',
    '- From fill/select/check values, clicked variable business text, selected options, recorded expected assertion text, asserted destination routes, and scenario-specific values.',
    '- Do not treat the initial page.goto URL as ordinary test data — keep it under entry with ownershipHint navigation.',
    '- Reference sourceOperationOrder from Phase B.',
    '',
    '---',
    'PHASE F — State transitions and noise sweep',
    '- Capture stateTransitions for navigation/state-changing operations. Describe the strongest recorded destination evidence. Record an ambiguity when a generic signal could also be satisfied in the source state — do not invent stronger evidence than what\'s recorded.',
    '- Confirm recorderNoise entries from Phase B are complete (final sweep, not a new classification pass).',
    '',
    'Readiness-scope rule (applies to any app, not a special case — compute this last in Phase F, after Phase D\'s assertionRole values are final, before Phase G\'s integrity pass):',
    '- For every operation in operationTrace, compute readinessScope: the NEAREST preceding operation whose assertionRole is "readiness" (or null if none precedes this operation), carrying that assertion\'s sourceOperationOrder and its locator (parentScope + childTarget, exactly as already decomposed for that operation in Phase B). Only the nearest one — do not include earlier readiness assertions further back; an earlier readiness scope is superseded the moment a nearer one exists, and is not a valid fallback scope to compute here.',
    '- If no readiness assertion precedes an operation, readinessScope is null — this is a valid, expected case meaning the scope is the whole page, not an error.',
    '- This value is independent of whether the operation\'s OWN locator has a recorded parentScope. Both apply simultaneously — an operation can have its own dynamic parent AND a readinessScope; both are facts to report, not alternatives to choose between.',
    '',
    '---',
    'PHASE G — Final integrity pass (self-check before output)',
    'Before producing output, verify:',
    '- Every operation in operationTrace has exactly one operationType, assigned once (Phase B), and exactly one assertionRole if applicable (Phase D only).',
    '- Every uiBoundary references valid evidenceOperationOrders from the actual trace, and every uiBoundary has a boundaryMechanismConfidence value — "ambiguous" entries must have a matching ambiguities entry.',
    '- successCoverage is populated according to the Phase D precedence — not left default/empty.',
    '- readinessGaps lists every trigger operation from Phase C/F that lacks a directly confirming assertion before the next meaningful operation — do not leave a known gap unlisted.',
    '- No Unicode character has been replaced with a corrupted byte-decoding sequence. If encoding appears corrupted, retain the raw source value and record an ambiguity instead of guessing.',
    '- Output contains the JSON object only — no narration, no commentary, no markdown fences around it.',
    '',
    'Return JSON with this shape:',
    '```json',
    '{',
    '  "entry": { "recordedUrl": "", "origin": "", "path": "", "queryParams": {}, "normalizedStartPath": "", "notes": "" },',
    '  "operationTrace": [{ "order": 1, "rawOperation": "", "operationType": "goto | click | fill | select | check | assertion | popup | wait", "assertionRole": "readiness | success | intermediate | none", "uiContextHint": "", "rawLocator": "", "locatorParts": { "parentScope": "", "parentScopeRisk": "stable | dynamic | broad | none | unknown", "childTarget": "", "childTargetType": "role | text | label | testId | css | xpath | unknown", "childTargetValue": "" }, "value": "", "intentHint": "", "isMeaningful": true, "riskFlags": [], "candidateFallback": { "strategy": "useAsIs | stripDynamicParent | scopeRequired | firstMatchProvisional | block | none", "candidateLocator": "", "reason": "" }, "readinessScope": { "sourceOperationOrder": null, "parentScope": "", "childTarget": "" } | null }],',
    '  "dataCandidates": [{ "nameHint": "", "sourceOperationOrder": 1, "rawLocator": "", "value": "", "dataKind": "input | selection | expectedText | expectedRoute | clickedVariableText", "ownershipHint": "testData | assertion | navigation", "reason": "" }],',
    '  "uiBoundaries": [{ "observedLabel": "", "boundaryType": "routeChange | fullScreenState | browserPopup | modal | drawer | popover | menu | tab | panel | wizardStep | headingState | unknown", "boundaryMechanismConfidence": "certain | ambiguous", "evidenceOperationOrders": [], "reason": "" }],',
    '  "assertions": [{ "sourceOperationOrder": 1, "rawAssertion": "", "assertionRole": "readiness | success | intermediate", "expectedValue": "", "reason": "" }],',
    '  "successCoverage": { "status": "covered | inferredRequired", "supportingAssertionOrders": [], "confidence": "certain | inferred", "possibleEvidence": [], "reason": "" },',
    '  "readinessGaps": [{ "triggerOperationOrder": 1, "expectedReadyState": "", "nextOperationOrder": 2, "reason": "" }],',
    '  "stateTransitions": [{ "triggerOperationOrder": 1, "triggerIntent": "", "expectedReadyState": "", "waitOwnerHint": "page | workflow | test", "reason": "" }],',
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
    'You are the Framework Mapper and Scenario Planner for a framework-compatible Playwright test generation workflow.',
    '',
    'Non-goals:',
    '- Do not write code.',
    '- Do not design files, method signatures, locator fields, imports, or workflow return shapes — Prompt 3 owns the exact artifact contract.',
    '',
    'Framework concept guide:',
    '- Model: typed business-data template with attributes only; execution metadata is not a model field.',
    '- Test data: concrete model values composed with execution metadata through the repo wrapper convention or an explicit Model & { metadata: { enabled: boolean } } type, with metadata.enabled true by default.',
    '- Page/component: owns locators, readiness, and low-level UI actions for a coherent screen or UI region.',
    '- Workflow: class that stitches page/component methods into reusable business steps and returns assertion-ready values.',
    '- Test/spec: thin objective validation that stitches workflows and test data together.',
    '',
    'Work through the following phases in order. Each phase commits a decision before the next phase begins — do not revisit a committed decision in a later phase except where explicitly allowed.',
    '',
    '---',
    'PHASE A — Classify the scenario (setup vs. behavior vs. discard)',
    '- Use Prompt 1 operation order as the traceability key.',
    '- This phase classifies non-assertion, meaningful operations only. Readiness and success assertions are not setup, behavior, or discarded — they are handled in Phase F1 (readiness) and Phase C/F4 (success), and should not be placed in any of this phase\'s three lists.',
    '- Classify each remaining meaningful operation as setup or behavior exactly once, or list it in discardedOperations with a reason.',
    '- Behavior is any action required by the scenario objective or pass condition, even when it also navigates.',
    '- Preserve meaningful behavior interactions, including navigation and selections before Apply/Submit/Next/Save/Continue. A direct URL may shorten setup but must never replace behavior.',
    '',
    'Setup-vs-behavior tie-break (applies to any app, not a special case):',
    '- Navigation and interstitial-dismissal clicks are common in every recording and do not always clearly announce which bucket they belong to. Use this rule whenever it\'s unclear:',
    '- An operation is behavior only if the stated objective or pass condition cannot be satisfied without it being explicitly modeled as a step (e.g. it directly performs, selects, or confirms something the objective names).',
    '- An operation is setup by default otherwise — including dialog/interstitial dismissals, and navigation that merely reaches a screen rather than performing part of the objective on that screen.',
    '- When genuinely unsure, default to setup rather than behavior, and record the choice in assumptions with an impact rating — under-classifying as setup is lower-risk than misclassifying objective-relevant behavior as setup, since setup operations are still carried forward (see setup handling below), not discarded.',
    '- Output: scenarioPlan.setupOperationOrders, scenarioPlan.behaviorOperationOrders, scenarioPlan.discardedOperations.',
    '- This is the only phase that performs this classification. Later phases consume behaviorOperationOrders as settled fact.',
    '',
    'Interleaved-setup check (applies to any app, not a special case — run this after the initial setup/behavior split above, before finalizing this phase\'s output):',
    '- Phase A2 (in Prompt 3) requires every setupOperationOrders entry to execute before the first workflow step. That is only physically possible when every setup-classified operation\'s order comes before every behavior-classified operation\'s order in the recorded sequence. Check this explicitly: take the minimum order in behaviorOperationOrders; any setup-classified operation whose order is GREATER than that minimum is interleaved, not leading setup, because it falls temporally after behavior has already started — meaning it occurs on a screen the behavior itself produced, and cannot run "before the workflow."',
    '- When you find an interleaved setup operation, do not leave it in setupOperationOrders as if it could still run first. Reclassify it as behavior instead, even if it doesn\'t itself satisfy the objective directly — its role is to advance the recorded sequence between two behavior-relevant points, which makes it part of the workflow\'s own step sequence, not separable leading setup. Record this reclassification in assumptions with an impact rating, naming the specific operation and which behavior operation it follows.',
    '- This check exists because the setup/behavior split is a relevance judgment (Phase A\'s main rule), but Phase A2 additionally requires a temporal property (all setup leads all behavior) that relevance alone does not guarantee. An operation can be correctly judged "not objective-relevant" and still be impossible to place before the workflow it\'s interleaved into — those are two different questions, and only the second one is checked here.',
    '- Only operations still classified setup after this check are output as scenarioPlan.setupOperationOrders. Everything reclassified here is folded into scenarioPlan.behaviorOperationOrders and proceeds through later phases (F1/F2) as ordinary workflow-owned actions, readiness evidence, or assertion evidence — whichever applies once given the same treatment as any other behavior operation.',
    '',
    'Setup handling (generic — every recording has setup operations that need a defined destination):',
    '- For each operation in setupOperationOrders (after the interleaved-setup check above — this only ever applies to true leading setup), record what it is for and whether it is expected to be handled by existing framework/test setup (e.g. base navigation, an existing fixture, a known global interstitial-dismissal helper) or whether it has no existing equivalent and must be newly represented somewhere.',
    '- Output shape: setupHandling: [{ "sourceOperationOrder": 1, "purpose": "", "coveredByExisting": true, "existingArtifact": "", "reason": "" }]',
    '- Do not silently drop a setup operation that has no existing equivalent — coveredByExisting: false operations must still be visible to Prompt 3 as something requiring a new minimal step, even though they are not part of the objective\'s behavior.',
    '',
    '---',
    'PHASE B — Resolve base URL handling',
    'Resolve in this order, stopping at the first that applies:',
    '1. Reuse the configured base URL when origins match the configured base URL after trailing-slash normalization.',
    '2. Use a direct setup URL only when it skips setup and preserves all behavior.',
    '3. Use a test-specific URL when the route is scenario-specific.',
    '4. Recommend a config update when the recorded origin is the intended app origin, and either no base URL is configured yet, or one is configured but mismatched. Distinguish these two cases in reason (state plainly whether this is a first-time configuration or a correction to an existing mismatch), but both resolve to the same decision value.',
    '- Output: scenarioPlan.baseUrlHandling with decision/recordedEntryUrl/configuredBaseUrl/startPath/directSetupUrl/reason.',
    '- This decision is final once made — Phase G\'s proceed/blocked gate may block on it, but later phases do not re-derive it.',
    '',
    '---',
    'PHASE C — Derive success criteria',
    'Build successCriteria in this precedence, using the first sufficient source:',
    '1. Recorded success assertions (use Prompt 1\'s assertions where assertionRole: success, and Prompt 1\'s successCoverage block if present).',
    '2. Explicit test-request evidence (the stated pass condition).',
    '3. Infer only when neither of the above is sufficient — and if Prompt 1 reported successCoverage.status: inferredRequired, treat this as expected and carry forward Prompt 1\'s possibleEvidence rather than re-deriving from scratch.',
    '- Keep each criterion traceable to its source and expected observable state.',
    '- Output: scenarioPlan.successCriteria.',
    '- Do not revisit assertion classification — Prompt 1 already decided assertionRole; you are only deciding which already-classified evidence satisfies the test request\'s pass condition.',
    '',
    '---',
    'PHASE D — Plan locators',
    'Using Prompt 1\'s locatorParts, riskFlags, and candidateFallback as evidence (do not re-derive locator facts — only classify acceptability):',
    '',
    'Framework helper check (run this for every locator, not just ones with parentScopeRisk: dynamic):',
    '- Check the provided frameworkCapabilities list for an entry with category "locatorResolution".',
    '- If one exists, build the candidate list in this exact priority order, using whichever sources actually apply (skip any tier with no source, don\'t pad with duplicates):',
    '  1. The locator exactly as recorded (parentScope + childTarget as decomposed by Prompt 1), if it has a recorded parentScope at all.',
    '  2. If the recorded parentScope is dynamic and matches a stablePrefix-volatileSuffix pattern (letters/hyphens followed by digits): the prefix-scoped variant combined with the same childTarget (existing rule, unchanged).',
    '  3. If Prompt 1\'s readinessScope is not null, build one candidate: the operation\'s own childTarget, scoped under readinessScope\'s locator (parentScope + childTarget combined as an ancestor-descendant locator). Before adding it to the candidate list, check whether it is exactly string-identical to any candidate already added from Tier 1 or Tier 2 — if so, skip it (already covered, no need to duplicate). This tier contributes at most one candidate, never more.',
    '  4. The bare childTarget alone, no scope at all — always included as the final, last-resort candidate.',
    '- Classify resolvableViaHelper whenever this check finds at least 2 distinct candidates (i.e. there\'s a real choice for the helper to make — a single-candidate list isn\'t meaningfully different from today\'s stable/provisional classification). Supply the full ordered candidateLocators array and helperRef, same output shape as today.',
    '- If frameworkCapabilities has no locatorResolution-category helper, or fewer than 2 distinct candidates exist, fall through to the existing stable/provisional/blocked classification unchanged.',
    '- This replaces the old gate (only fires on parentScopeRisk: dynamic) with a gate based on candidate count instead — the dynamic-parent case and the parentless-with-readiness-scope case are now the SAME mechanism, not two separate rules.',
    '- Do not invent a helper name not present in frameworkCapabilities. Absence of a matching entry means this check does not apply; do not assume a helper exists because earlier behavior or prior generations referenced one.',
    '',
    '- stable: the expression is executable, preserves fixed vs. parameterized data dependency, and identifies the intended element without ordinal fallback.',
    '- resolvableViaHelper: a locatorResolution-category framework helper exists per the check above; supply candidateLocators and helperRef instead of a single candidateLocator.',
    '- provisional: a concrete low/medium-risk fallback can proceed (no matching helper exists). Include the full scope and explicit .first()/.nth() used. Never carry an exact generated id into the candidate locator.',
    '- blocked: only when no meaningful concrete fallback exists, or ambiguous matching would make a high-risk data-changing action unsafe. Missing an ideal scope is provisional, not blocked — do not over-block.',
    '- Preserve active interaction context across related row/card/dialog/panel/listbox/menu/popover/tab operations. A generated parent id proves context existed but is not itself a reusable scope.',
    '- Every locatorPlan entry must contain either a concrete candidateLocator (stable/provisional/blocked) or a candidateLocators array plus helperRef (resolvableViaHelper), plus source operation orders.',
    '- List every provisional AND resolvableViaHelper locator in provisionalLocatorReview (this feeds Phase G) — resolvableViaHelper is lower-risk than provisional but still worth surfacing for review, since it changes how Prompt 3 must wire the locator.',
    '- Output: locatorPlan[].',
    '',
    '---',
    'PHASE E — Plan data ownership',
    '- Map related business inputs, selections, and expected values together.',
    '- Keep navigation configuration out of ordinary test data.',
    '- Do not parameterize a fixed locator merely because its displayed value is test data (this is a data-plan decision, not a re-opening of Phase D\'s locator classification).',
    '- Use prepared context to choose reuse, update, or create. Reused artifacts retain their exact repository identity; sample* artifacts are reference examples unless no real app artifact exists.',
    '- Output: dataPlan[].',
    '',
    '---',
    'PHASE F — Plan UI ownership and workflow ownership',
    'Two related sub-decisions; do both here since they share the same operation-order partitioning concern, but keep their outputs in separate fields.',
    '',
    'Reuse-match short-circuit (apply before F1/F2, generic to any app):',
    '- If the workflow reuse matches identify an exact match covering a contiguous range of behaviorOperationOrders, do not plan new UI or workflow ownership for that range. Instead, record it directly in workflowOperationOwnership with action: "reuse" and existingArtifact set to the matched workflow\'s identity, ownedActionOperationOrders set to exactly the matched range.',
    '- Do not re-derive locators, UI owners, or readiness for a reused range from Prompt 1 evidence — the matched workflow already encapsulates that. Skip F1 entirely for operations inside a reused range.',
    '- Only operations NOT covered by an exact reuse match proceed through F1/F2\'s normal planning below. This applies regardless of which app or which workflow is matched — the short-circuit is keyed on the reuse match input, not on any app-specific pattern.',
    '',
    'F1. UI ownership (for unmatched behaviorOperationOrders only):',
    '- Use Prompt 1 uiBoundaries as state evidence, not as mandatory artifacts.',
    '- Assign operations to the smallest coherent UI owner. Keep a region inside its containing page owner by default; use a separate component owner only when prepared context already defines one or the same region must be shared across multiple page owners.',
    '- Keep readiness operations in uiOwnershipPlan.readinessEvidence (not in workflow action ownership).',
    '- Define readiness from the strongest destination evidence. A readiness signal must distinguish the destination from the source state. Optional recorded interruptions are conditional at their recorded point; add other checkpoints only from the app-specific profile.',
    '- Output: uiOwnershipPlan[].',
    '',
    'F2. Workflow ownership (for unmatched behaviorOperationOrders only):',
    '- Partition meaningful actions into workflowOperationOwnership. ownedActionOperationOrders contains actions only.',
    '- Output: workflowOperationOwnership[] (in addition to any reuse entries already recorded above).',
    '',
    'F3. Coverage check (perform before moving to Phase G):',
    '- Every operation from Phase A\'s behaviorOperationOrders must appear exactly once across: uiOwnershipPlan.readinessEvidence, workflowOperationOwnership.ownedActionOperationOrders (whether action: reuse or create/update), or testPlan.assertionCriteria (Phase F4). No operation may appear in more than one of these three places.',
    '- Every operation from Phase A\'s setupOperationOrders must appear exactly once in setupHandling. This is a separate, parallel coverage requirement — setup operations are not expected to appear in uiOwnershipPlan/workflowOperationOwnership/testPlan.',
    '- Role-fidelity cross-check (separate from the coverage count above — this catches a misplacement even when every operation still appears exactly once overall): for every operation order listed in any uiOwnershipPlan.readinessEvidence array, confirm Prompt 1 actually classified that operation\'s assertionRole as readiness. If Prompt 1 classified it success or intermediate instead, remove it from readinessEvidence — a success-classified operation belongs only in testPlan.assertionCriteria, never in readinessEvidence, regardless of how directly it follows the owning page\'s other actions. This check exists because an operation can satisfy the exactly-once coverage count while still sitting in the wrong one of the three lists; counting coverage and verifying role correctness are two different checks, run both.',
    '- If you find an operation missing, duplicated, or role-mismatched in any of these checks, fix it now, before proceeding — do not carry a coverage or role gap into Phase G.',
    '',
    'F4. Test composition:',
    '- testPlan.workflowSequence follows source order.',
    '- Keep the test thin: compose workflows and assert meaningful observed text, value, route, count, or status. Do not plan redundant visibility booleans or echo input data as workflow results.',
    '- Business assertions go in testPlan.assertionCriteria (these are the "exactly once" slot referenced in F3, alongside readiness and owned actions).',
    '- Output: testPlan.action/existingArtifact/workflowSequence/assertionCriteria.',
    '',
    '---',
    'PHASE G — Proceed/blocked decision (final gate)',
    '- status: proceed (everything resolved cleanly) | proceedWithProvisionalLocators (Phase D produced provisional locators but nothing blocked) | blocked (a real blocker exists).',
    '- requiredClarifications must be empty unless status is blocked.',
    '- provisionalLocatorReview carries forward Phase D\'s list.',
    '- This is the last phase. Do not revise earlier phases\' decisions here — only gate on them.',
    '- Output: proceedDecision, assumptions[] (each assumption ties to sourceOperationOrders and an impact rating).',
    '',
    'Return JSON with this shape:',
    '```json',
    '{',
    '  "scenarioPlan": { "objective": "", "baseUrlHandling": { "decision": "reuse existing | recommend config update | direct setup url | test-specific URL", "recordedEntryUrl": "", "configuredBaseUrl": "", "startPath": "", "directSetupUrl": "", "reason": "" }, "setupOperationOrders": [], "setupHandling": [{ "sourceOperationOrder": 1, "purpose": "", "coveredByExisting": true, "existingArtifact": "", "reason": "" }], "behaviorOperationOrders": [], "discardedOperations": [{ "sourceOperationOrder": 1, "reason": "" }], "successCriteria": [{ "criterion": "", "source": "recordedAssertion | testRequest | inferred", "sourceOperationOrder": null, "expectedValue": "" }] },',
    '  "locatorPlan": [{ "locatorRef": "", "classification": "stable | resolvableViaHelper | provisional | blocked", "candidateLocator": "", "candidateLocators": [], "helperRef": "", "sourceOperationOrders": [], "dataDependency": "fixed | parameterized", "parameters": [], "evidence": "", "reviewNote": "" }],',
    '  "dataPlan": [{ "dataRef": "", "kind": "model | testData | expectedValue", "action": "reuse | create | update", "existingArtifact": "", "sourceOperationOrders": [], "fields": [], "reason": "" }],',
    '  "uiOwnershipPlan": [{ "ownerRef": "", "ownerType": "page | component", "action": "reuse | create | update", "existingArtifact": "", "sourceOperationOrders": [], "stateIdentity": "", "readinessEvidence": [], "responsibilities": [] }],',
    '  "workflowOperationOwnership": [{ "workflowRef": "", "action": "reuse | create | update", "existingArtifact": "", "ownedActionOperationOrders": [], "entryState": "", "exitState": "" }],',
    '  "testPlan": { "action": "create | update", "existingArtifact": "", "workflowSequence": [], "assertionCriteria": [{ "sourceOperationOrder": 1, "successCriterion": "", "requiredObservedValue": "" }] },',
    '  "proceedDecision": { "status": "proceed | proceedWithProvisionalLocators | blocked", "reason": "", "requiredClarifications": [], "provisionalLocatorReview": [] },',
    '  "assumptions": [{ "statement": "", "sourceOperationOrders": [], "impact": "low | medium | high" }]',
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
    'Work through the following phases in order.',
    '',
    '---',
    'PHASE A — Runtime inputs',
    '- Translate scenarioPlan.baseUrlHandling into a runtime input. Test-specific or direct URLs use the approved literal; configured base URL uses an explicit prepared-context source.',
    '- If baseUrlHandling.decision is "recommend config update" and no configuredBaseUrl currently exists in prepared context (first-time configuration, not a mismatch — check baseUrlHandling.reason for which case Prompt 2 identified): use recordedEntryUrl as a literal runtime input value, and carry the config-update recommendation forward as a non-blocking note (do not block on this — Prompt 2 already classified it as an expected outcome, not an error).',
    '- Block only when the selected source has no value AND no literal is available to fall back on (e.g. a configured-base-URL decision where prepared context has no value and Prompt 2 provided no recorded literal either).',
    '- Output: runtimeInputs[].',
    '',
    '---',
    'PHASE A2 — Expand setup handling (generic — every scenario has some setup that must execute)',
    '- For every entry in scenarioPlan.setupHandling:',
    '  - If coveredByExisting is true: reference the named existingArtifact directly as a step — do not re-expand it as new behavior.',
    '  - If coveredByExisting is false: expand a minimal step covering exactly what Prompt 2\'s setupHandling.purpose describes, no more.',
    '- Setup steps in tests[].steps call a UI owner\'s method directly, never a workflow (per the rule below that setup steps are not workflow steps unless Prompt 2 explicitly assigned them to one). Use tests[].steps[].call.ownerRef (not workflowRef) for these — ownerRef names the UI owner (page/component) whose method is being called directly. Set workflowRef only for steps that invoke a workflow\'s method; set ownerRef only for steps that invoke a UI owner\'s method directly. Exactly one of the two must be populated per step, never both, never neither.',
    '    - Placement: place it on the UI owner for the page it actually occurs on at that point in the trace — not the next page a later operation will create. Check the operation\'s order against uiOwnershipPlan/uiBoundaries: if the operation occurs before the first page transition in the trace (i.e. before any uiOwner\'s owned operations begin), it occurs on the entry page, which may have no owner being created elsewhere in this generation. In that case, create a minimal entry-level owner (e.g. an EntryPage / AppShell owner scoped to just this setup behavior) rather than attaching it to a later, unrelated page owner.',
    '    - If the operation occurs after a page transition but the corresponding page owner from Phase B doesn\'t yet exist at that point in sequence (i.e. it belongs to whichever page was current at that operation\'s order, not whichever page is current by the end of the trace), attach it to whichever owner is correctly current at that operation\'s order, by checking uiBoundaries evidence — do not default to the most prominent or most recently-defined owner.',
    '  - Setup steps are not workflow business steps — they execute before the first workflow in the test\'s step sequence, not inside a reusable workflow, unless Prompt 2 explicitly assigned them to a workflow (it does not, by Phase A\'s design in Prompt 2).',
    '- Every setupHandling entry must result in exactly one of: a referenced existing step, or a newly expanded minimal step. None may be silently dropped — operationTraceabilityComplete in Phase E checks this.',
    '- Output: include setup steps in tests[].steps, ordered before any workflow step, using the same structured-step shape as workflow/test steps elsewhere.',
    '',
    '---',
    'PHASE B — Expand artifacts (models, test data, UI owners, workflows, tests)',
    'For each Prompt 2 ref, expand exactly once. Apply these rules uniformly across all five artifact categories:',
    '- Preserve exact identities for reused artifacts. Name new artifacts from Prompt 2 refs using prepared repository conventions, without synonyms. Use filePath consistently.',
    '- Copy imports only from prepared context or resolvable existing artifacts. Do not invent or normalize package names. Conflicting or unresolved required imports block.',
    '- Keep owned actions, readiness evidence, and assertion evidence in separate operation-order fields — never enlarge action ownership with readiness or assertions. (Prompt 2 already partitioned these; you are only carrying the partition forward.)',
    '',
    'B1. Models — business fields only; execution metadata is never a model field.',
    'B2. Test data — compose its model with typed expected values and metadata.enabled true. Preserve recorded values and Unicode exactly.',
    'B3. UI owners (page/component):',
    '   - Preserve each Prompt 2 candidateLocator structurally. Only page to this.page owner context and declared parameter substitution are permitted. Preserve scopes, filters, .first(), .nth(); provisional locators are executable and non-blocking.',
    '   - A locator is a factory only when every parameter changes finalLocatorExpression; otherwise use a field with no parameters.',
    '   - UI methods consume parameters through behavior or locator factories. Use routine syntax only when one prepared framework helper directly matches the approved operation.',
    '   - For any locatorPlan entry with classification: resolvableViaHelper, do not emit a single locator field or factory. Instead, call the named helperRef (look up its exact method signature in frameworkCapabilities — do not guess parameter shape) with the candidateLocators array, in the same priority order Prompt 2 supplied, each expressed as a zero-arg locator-builder matching that helper\'s expected parameter shape. Await the helper\'s result and pass the resolved Locator into the existing interaction-catalog calls exactly as any other locator would be used. Never inline the candidate fallback logic by hand when a matching helper exists.',
    '   - After the last automatic candidate in the array, always include one trailing comment-only line (not a real array entry, just a code comment in the emitted method) noting that a QA can add a manually-supplied locator (e.g. a full XPath confirmed by inspecting the live page) as a new first entry in the candidates array if every automatic candidate ever fails — this is an expected, normal maintenance path, not an error state.',
    'B4. Workflows — express execution as structured steps (see Phase C for the valueRef rules governing these steps). Bind every return field through returnBindings to a step result. Return only observed values required by assertions; never echo input data.',
    '   - For action: reuse workflows, do not derive a returnShape from this generation\'s own evidence. Read the existing workflow\'s actual return type/method signatures from prepared context (the real artifact file, not workflowIndex.json\'s signature, which is intentionally UI-fact-shaped and excludes type information). If prepared context does not include enough of the existing artifact to resolve a required binding against it, this is a dependenciesResolvable failure in Phase E, not a value to guess.',
    'B5. Tests — express execution as structured steps (same valueRef rules). Bind every assertion\'s actualValueRef to a produced result and expectedValueRef to test data or a runtime input. Recorded content-text assertions set whitespaceNormalized true.',
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
    'Run these six checks. This is a check of what you produced in Phases A-D, not a new design pass:',
    '- schemaConformant: exact schema keys and enums are used.',
    '- operationTraceabilityComplete: every meaningful operation remains an owned action, readiness/assertion evidence, a Prompt 2 discard, or a Phase A2 setup step (referenced or newly expanded).',
    '- architecturePreserved: Prompt 2 ownership, locators, artifact decisions, and success criteria are unchanged.',
    '- valueFlowComplete: all valueRefs, assignments, arguments, return bindings, and assertion inputs resolve in a closed symbol table (per Phase C).',
    '- dependenciesResolvable: every artifact ref, filePath, import, and build dependency resolves.',
    '- frameworkCompatible: signatures and imports match prepared context.',
    '',
    '- Provisional locators, approved reasonable assumptions, and unambiguous routine framework syntax do NOT block.',
    '- Block only when one of the six checks above is false. If blocking: report the exact item in blockedItems with which check failed and why, and leave artifact arrays and build lists empty. contractStatus: blocked.',
    '- If all six pass and provisional locators exist: contractStatus: readyWithProvisionalLocators.',
    '- If all six pass with no provisional locators: contractStatus: ready.',
    '- Output: contractStatus, contractValidation (all six keys), blockedItems[], provisionalLocatorReview[], assumptions[].',
    '',
    'Return JSON matching this schema exactly. Unknown, missing, renamed, or aliased keys make the contract invalid:',
    '```json',
    '{',
    '  "contractStatus": "ready | readyWithProvisionalLocators | blocked",',
    '  "blockedItems": [{ "check": "", "itemRef": "", "reason": "" }],',
    '  "contractValidation": { "schemaConformant": true, "operationTraceabilityComplete": true, "architecturePreserved": true, "valueFlowComplete": true, "dependenciesResolvable": true, "frameworkCompatible": true },',
    '  "runtimeInputs": [{ "ref": "", "type": "", "source": "literal | configuredBaseUrl", "value": null, "sourceRef": "" }],',
    '  "models": [{ "ref": "", "action": "reuse | create | update", "existingArtifact": "", "filePath": "", "interfaceName": "", "fields": [{ "name": "", "type": "", "sourceOperationOrders": [] }], "imports": [], "dependsOn": [] }],',
    '  "testData": [{ "ref": "", "action": "reuse | create | update", "existingArtifact": "", "filePath": "", "exportName": "", "modelRef": "", "typeExpression": "", "values": [{ "name": "", "value": null, "sourceOperationOrders": [] }], "metadataEnabled": true, "imports": [], "dependsOn": [] }],',
    '  "uiOwners": [{ "ref": "", "ownerType": "page | component", "action": "reuse | create | update", "existingArtifact": "", "filePath": "", "className": "", "imports": [], "dependsOn": [], "ownedActionOperationOrders": [], "readinessOperationOrders": [], "assertionOperationOrders": [], "locators": [{ "locatorRef": "", "fieldName": "", "kind": "field | factory", "params": [{ "name": "", "type": "" }], "finalLocatorExpression": "", "status": "stable | provisional", "sourceOperationOrders": [] }], "methods": [{ "methodRef": "", "name": "", "params": [{ "name": "", "type": "" }], "returnType": "", "sourceOperationOrders": [], "behavior": "" }], "readinessMethods": [{ "methodRef": "", "name": "", "params": [{ "name": "", "type": "" }], "signal": "", "sourceOperationOrders": [] }] }],',
    '  "workflows": [{ "ref": "", "action": "reuse | create | update", "existingArtifact": "", "filePath": "", "className": "", "imports": [], "dependsOn": [], "ownedActionOperationOrders": [], "readinessOperationOrders": [], "assertionOperationOrders": [], "methods": [{ "methodRef": "", "name": "", "params": [{ "name": "", "type": "" }], "returnType": "", "steps": [{ "stepRef": "", "call": { "ownerRef": "", "methodRef": "", "args": [{ "param": "", "valueRef": "" }] }, "assignTo": null }], "returnBindings": [{ "fieldName": "", "valueRef": "" }] }], "returnShape": { "typeName": "", "fields": [{ "name": "", "type": "", "sourceAssertionOrders": [], "observedFrom": "" }] } }],',
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
    '- When emitting a resolveLocator(...) call, always include the manual-override comment exactly as contracted, immediately after the last candidate in the array, before the closing bracket.',
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
    '- If write access is available: report changed files, static validation results, provisional locator notes, and a note that runtime execution is deferred.',
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

// Prompt-3-embedding-only trim: Phase A2 needs operation order/type and uiBoundaries for setup-step
// placement; Phase B/C reference only Prompt 2's already-derived fields. rawOperation/locatorParts/
// riskFlags/candidateFallback per-operation, and dataCandidates/assertions/stateTransitions/
// recorderNoise/ambiguities entirely, are exactly what Prompt 2 already consumed to produce
// locatorPlan/successCriteria and are not referenced by name anywhere in Prompt 3's phases. This
// does not change Prompt 1's actual output, the schema returned to the dashboard, or what Prompt 2
// receives — only what gets re-embedded inside Prompt 3's own prompt text.
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
  const operationTrace = Array.isArray(parsed.operationTrace)
    ? parsed.operationTrace.map((op) => ({
        order: op.order,
        operationType: op.operationType,
        assertionRole: op.assertionRole,
        isMeaningful: op.isMeaningful
      }))
    : [];
  const compact = {
    entry: parsed.entry,
    operationTrace,
    // Restored: Phase B2 ("Preserve recorded values and Unicode exactly") has no other source for
    // testData[].values[].value once operationTrace.value is dropped — dataCandidates is the only
    // remaining carrier of the literal recorded input/selection strings (e.g. "india").
    dataCandidates: parsed.dataCandidates,
    uiBoundaries: parsed.uiBoundaries,
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
