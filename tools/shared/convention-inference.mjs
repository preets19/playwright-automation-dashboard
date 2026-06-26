// Single shared place that infers framework-usage conventions from sampled app-repo file
// content. Previously test-dashboard/server.mjs and automation-context-mcp/server.mjs each had
// their own copy of these regex checks — identical logic, but the two copies had already
// drifted on output field names (frameworkImports/pageObjects/workflows/specs vs.
// frameworkImport/pageObjectPattern/workflowPattern/testImportPattern). The field names here
// match automation-context-mcp's existing public tool contract (summarize_repo_conventions),
// since that one is consumed by external MCP clients and its shape is the one that must not
// silently change; test-dashboard's caller maps this canonical shape to its own existing keys.
export function inferFrameworkConventions(samples) {
  const allContent = samples.map((sample) => sample.content).join('\n');
  return {
    frameworkImport: allContent.includes("@your-org/playwright-base-framework")
      ? "Uses imports from '@your-org/playwright-base-framework'."
      : 'No framework package import observed in sampled files.',
    jsExtensionImports: /\.js['"]/.test(allContent)
      ? 'Uses .js extensions in TypeScript relative imports.'
      : 'No .js relative import convention observed in sampled files.',
    pageObjectPattern: /extends BasePage/.test(allContent)
      ? 'Page objects extend BasePage.'
      : 'No BasePage extension observed in sampled files.',
    workflowPattern: /constructor\(private readonly page: Page\)/.test(allContent)
      ? 'Workflows commonly accept Playwright Page in the constructor.'
      : 'No common workflow constructor pattern detected in sampled files.',
    testImportPattern: /import \{ expect, test \} from '@your-org\/playwright-base-framework'/.test(allContent)
      ? 'Specs import expect and test from the framework package.'
      : 'Spec import pattern not detected in sampled files.'
  };
}
