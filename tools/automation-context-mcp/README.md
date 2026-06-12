# Automation Context MCP

Read-only Model Context Protocol server for build-time automation test generation.

The server lives in the dashboard repo because the dashboard orchestrates app automation repos and the shared base framework repo.

## Purpose

Expose scoped automation context to AI clients:

- selected app repo `_automation` artifacts
- shared base framework `src` APIs
- shared `.ai` generation rules, templates, and lessons
- representative examples and repo conventions

## Scope

Version 1 is read-only.

Allowed read roots:

- `{appRepoPath}/_automation`
- `{frameworkRepoPath}/src`
- `{frameworkRepoPath}/.ai`

The MCP server should use only the selected active app repo for app-specific context. It should not borrow pages, workflows, models, test data, or tests from other app repos unless explicitly requested.

## Tools

- `get_repo_context`
- `list_automation_artifacts`
- `get_test_generation_rules`
- `get_output_template`
- `get_lessons_learned`
- `read_artifact`
- `get_relevant_examples`
- `summarize_repo_conventions`

## Run

```powershell
node tools/automation-context-mcp/server.mjs
```

The server communicates over stdio and is intended to be launched by an AI client that supports MCP.

## Example Client Configuration

Exact configuration depends on the AI client.

```json
{
  "mcpServers": {
    "automation-context": {
      "command": "node",
      "args": [
        "C:\\Users\\omegazadmin\\Source\\Repo\\playwright-automation-dashboard\\tools\\automation-context-mcp\\server.mjs"
      ],
      "env": {
        "AUTOMATION_WORKSPACE_ROOT": "C:\\Users\\omegazadmin\\Source\\Repo"
      }
    }
  }
}
```

## Recommended Use

Pass the selected app repo path explicitly to MCP tools:

```json
{
  "appRepoPath": "C:\\Users\\omegazadmin\\Source\\Repo\\playwright-app-template"
}
```

The server can later support dashboard active-repo state as a fallback through `.tmp/active-repo.json`, but explicit `appRepoPath` is preferred for deterministic generation.
