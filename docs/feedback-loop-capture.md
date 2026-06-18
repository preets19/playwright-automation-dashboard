# Feedback Loop Capture

The feedback loop is currently capture-only. It stores generation history for later review, but it does not change prompts, rules, framework code, tests, or dashboard behavior automatically.

## Current Scope

- Capture raw and formatted recorder input.
- Capture guided prompt text and AI responses.
- Capture generated and accepted artifact snapshots.
- Capture validation commands and results.
- Capture candidate lessons as review data only.

The existing dashboard feedback-loop checkbox is not wired to this storage layer. Capture runs passively for the Build Automated Test wizard and writes one-way snapshots to the local database.

## Local Database

The capture store uses Node's built-in `node:sqlite` module and writes to:

```text
.tmp/feedback-loop.db
```

Set `DASHBOARD_FEEDBACK_DB_PATH` to override the location.

Local database files are ignored by Git.

## Tables

- `generation_sessions`: one test-generation attempt.
- `recorder_inputs`: raw and formatted recorder code for a session.
- `generation_steps`: guided step prompts and responses.
- `artifact_snapshots`: generated, reviewed, rejected, or accepted file contents.
- `validation_runs`: local command results such as typecheck or targeted Playwright runs.
- `lessons_learned`: candidate lessons for later independent review.
- `capture_events`: raw one-way wizard snapshots captured at generation moments.

## Passive Capture Points

The dashboard writes capture events when:

- formatted recorder code is created
- the one-shot prompt is generated
- a guided prompt is copied
- guided output text areas are edited

The capture layer does not read records back into the dashboard and does not alter prompts.

Prepared dashboard context may include a live artifact index built from the currently selected repo. That index comes from current files on disk, not from captured feedback-loop records.

## Governance

Lessons are stored with `promoted = 0` by default. Promotion is a manual future workflow. No stored lesson should be automatically injected into prompts or framework rules until it has been independently reviewed and explicitly approved.

## Smoke Test

Run:

```powershell
node tools/test-dashboard/feedback-store-smoke.mjs
```

This creates a temporary database, inserts one complete capture session, verifies it, and deletes the temporary files.
