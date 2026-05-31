# Windows Launchers

These `.cmd` files avoid PowerShell execution policy issues.

## First-Time Setup

Double-click:

```text
setup-once.cmd
```

This installs npm dependencies and Playwright browsers.
In managed networks, configure your approved npm registry and any Playwright browser mirror environment variables before running setup.

## Daily Use

Double-click:

```text
Start Automation Dashboard.cmd
```

This starts the dashboard and opens it in the browser.
One command window remains open on purpose so users can see what is running. Close it with the dashboard `Stop Automation` button or `Stop Automation.cmd`.

## Optional Launchers

- `start-dashboard.cmd`: starts only the dashboard and opens the browser.
- Dashboard `Open Interactive UI`: opens Playwright Test Runner UI.
- Dashboard `Open Recorder UI`: opens Playwright Recorder.
- `run-validation.cmd`: runs the full validation check.
- `stop-automation.cmd`: stops dashboard and Playwright processes started from this repo.
- `update-framework.cmd`: rebuilds the sibling framework package and reinstalls it into this template or app-specific automation repo.

## Desktop Shortcut

Create a shortcut to:

```text
Start Automation Dashboard.cmd
```

Name it:

```text
Automation Dashboard
```

Create another shortcut to `Stop Automation.cmd` as a failsafe if the dashboard is unavailable.
