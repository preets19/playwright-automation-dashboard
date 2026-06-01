# Windows Launchers

These `.cmd` files avoid PowerShell execution policy issues.

## Dashboard Home Setup

From Dashboard Home, load an app automation repo and click:

```text
1. Setup Automation
```

This runs setup against the loaded repo, installs npm dependencies, and installs Playwright browsers.
In managed networks, configure your approved npm registry and any Playwright browser mirror environment variables before running setup.

## Daily Use

Double-click:

```text
Start Automation Dashboard.cmd
```

This starts Dashboard Home and opens it in the browser on `127.0.0.1:4310`.
Use Dashboard Home to discover repos, load a repo, run setup, check Git status, or hand off to Test Dashboard.

## Optional Launchers

- `start-dashboard.cmd`: starts Dashboard Home.
- Dashboard Home `Open Test Dashboard`: hands off to the copied Test Dashboard in this repo.
- Test Dashboard `Back to Home`: returns to Dashboard Home with the selected repo retained.
- Test Dashboard `Open Interactive UI`: opens Playwright Test Runner UI.
- Test Dashboard `Open Recorder UI`: opens Playwright Recorder.
- `run-validation.cmd`: runs the full validation check.
- `stop-automation.cmd`: stops dashboard and Playwright processes started from this repo.
- `update-framework.cmd`: rebuilds the sibling framework package and reinstalls it into the loaded app automation repo.

## Desktop Shortcut

Create a shortcut to:

```text
Start Automation Dashboard.cmd
```

Name it:

```text
Automation Dashboard
```

Create another shortcut to `stop-automation.cmd` as a failsafe if the dashboard is unavailable.
