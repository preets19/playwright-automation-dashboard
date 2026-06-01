# Test Dashboard

Local web dashboard for running and maintaining app automation projects.

In this repo, Test Dashboard is launched from Dashboard Home as a handoff. Dashboard Home releases the local port, starts Test Dashboard, and the browser navigates to the Test Dashboard page. Use `Back to Home` to return to Dashboard Home with the selected repo retained.

The dashboard discovers app automation repos under `C:\Users\{current-user}\Source\Repo`.
Set `AUTOMATION_WORKSPACE_ROOT` to override that location.
Select a repo in the dashboard before running tests or editing settings.

## Run Directly

```powershell
npm.cmd run dashboard
```

Then open:

```text
http://localhost:4310
```

By default the server binds to `127.0.0.1`. `DASHBOARD_HOST` and `DASHBOARD_PORT` can override the host and port.

## Features

- Select an app automation repo from the local source workspace.
- Load the selected repo explicitly from the App Repository dropdown.
- Return to Dashboard Home with the selected repo retained.
- View local Node, npm, Playwright, and app configuration status for the selected repo.
- Open Playwright Test Runner UI for interactive running and debugging.
- Open Playwright Recorder UI for generating new test flows.
- Run all tests from the dashboard in parallel using the selected browser projects.
- Open the Playwright HTML report after it has been generated.
- Run maintenance checks such as app typecheck, framework build, validation, dependency update check, and security audit.
- Edit common `appsettings.json` values.
- Select one or more browsers for Playwright projects.
- Set demo slow motion in milliseconds for Playwright runs.
- Clean generated artifacts.

The server exposes only approved commands. It does not run arbitrary command text from the browser.
