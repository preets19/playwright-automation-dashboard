# playwright-automation-dashboard

QA-facing local dashboard and Windows command tools for Playwright automation repos.

This repo owns the dashboard launchers, Dashboard Home, copied Test Dashboard, and setup/maintenance command wrappers. It is separate from app automation repos so dashboard/tooling changes can be versioned without forcing updates across every app repo.

## Repository Layout

- `Start Automation Dashboard.cmd`: double-click entry point for QA.
- `public/`: Dashboard Home web page.
- `tools/dashboard-home/`: local Home Dashboard server.
- `tools/test-dashboard/`: Test Dashboard copied from the app repo and run from this dashboard repo.
- `scripts/windows/`: Windows `.cmd` launchers and maintenance commands.

## Daily QA Flow

1. Double-click `Start Automation Dashboard.cmd`.
2. In Dashboard Home, discover repos under the local repo folder.
3. Load the app automation repo.
4. Run `Setup Automation` when the repo needs to be made ready.
5. Open `Test Dashboard` to run, debug, and review tests.
6. Use `Back to Home` from Test Dashboard to return to Dashboard Home with the selected repo retained.
7. Use `Stop Dashboard` or `Stop Automation` when finished.

Dashboard Home and Test Dashboard use the same local port by default:

```text
http://127.0.0.1:4310
```

Set `DASHBOARD_HOST` or `DASHBOARD_PORT` only if local workstation policy requires different values.

## Enterprise Notes

The main launcher path uses Windows `.cmd` files and Node.js. It does not require PowerShell execution policy changes.

Configure approved npm registry and Playwright browser mirror settings before setup if required by company network policy.
