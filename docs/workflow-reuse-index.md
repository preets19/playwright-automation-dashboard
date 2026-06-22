# Workflow Reuse Index

The dashboard keeps a local workflow-signature index so later recorder flows can reuse available automation capabilities without asking AI to rediscover every overlapping step.

## Lifecycle

1. Prompt 1 produces ordered normalized recorder operations.
2. Prompt 3 assigns operation orders to workflow contracts.
3. When Prompt 4 is prepared, the dashboard stages one signature per contracted workflow.
4. A staged signature becomes available only while its workflow file exists under `_automation/workflows` in the selected app repo.
5. Before Prompt 2 is prepared for a later recording, the dashboard compares its normalized operation sequence with available signatures.
6. Confirmed ordered matches and unmatched operation orders are injected into Prompt 2. Existing prompt rules continue to handle unmatched work.

For example, after `LoginWorkflow` exists, a `Login + Sort Product` recording can match the login operation range and leave only sorting operations for new artifact mapping.

## Storage And Safety

- The canonical index lives in the selected app repo at `_automation/context/workflowIndex.json`.
- The index is versioned and travels with the app automation code. The dashboard feedback SQLite database remains separate and continues to own generation/learning history.
- Recorder `fill()` and `type()` literals are redacted before raw code is retained for traceability.
- Generated source files are referenced by path and are not copied into the index.
- Deleting a workflow artifact immediately makes its signature unavailable for matching.
- Matching does not modify prompts, rules, or source files. It only supplies deterministic reuse evidence to Prompt 2.

## Matching

Signatures compare ordered meaningful operations using operation type, semantic locator shape, page/step hint, intent, and assertion role. Literal input values and generated numeric identifiers do not drive matching.

Matches must clear a strict similarity threshold and cannot claim overlapping operation ranges. Entry and exit state labels are included so Prompt 2 can reject a structurally similar match when it is semantically inappropriate.
