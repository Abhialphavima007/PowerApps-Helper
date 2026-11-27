# Grouped deployment history

## Changelog — 27 November 2026

History projection version 1.0.1; deployment queue version 1.0.4. Desktop version remains 0.1.5. No dependencies or external Dataverse schema were changed; no installer or release was produced.

- Each queue is one History row. Counts, status filters and pagination count deployments, rather than individual solution imports. Single-solution records without a queue reference keep their existing behavior.
- Predefined package queues show their package name and saved-definition timestamp. The captured definition is retained in queue/child history; later library edits/removal do not change old deployment history. Package-name search selects the whole deployment. CSV adds package metadata and JSON retains it. See [local package definitions](predefined-packages.md).
- View opens an overview with the route, account, overall result, completion counts and solutions in their reviewed deployment order. View details opens an individual solution inside the same dialog. All solutions returns to the overview and restores keyboard focus.
- Individual details retain notes, work items, dependencies, warnings/errors, stored packages and agent activity/import logs already saved by the existing record writer. New queue details also expose start/finish times and available import completion/job references.
- A new queue saves its planned solution list after preflight and before starting imports. Waiting, running, success, failure and skipped outcomes are retained, including a fallback outcome when the full individual history write fails. Failure stops subsequent imports as before.
- The initial queue-history write must succeed before imports start. Later history-write failures become visible warnings and do not turn a successful import into a failed import. History deletion is blocked while a deployment is active so its queue metadata cannot be removed during recording.
- Existing records with a queueId are grouped without rewriting them. Unknown positions from old incomplete queues show Not recorded; their names/outcomes are not fabricated. Old records without a queueId cannot reliably be identified as a queue and remain separate.

## Filters, export and deletion

Source/target, period and status filters select complete deployments. The date is the queue's saved start time, or the earliest individual record timestamp for a legacy queue. Status is Failed if the parent or any child failed, Success when every planned solution has a successful record/outcome, otherwise Pending. Pending may represent an active, interrupted or incomplete queue; the view does not claim automatic resume. Refresh fetches the latest saved state.

Searching a solution name or work item selects the entire matching queue, including its other solutions. The filter UI states this. Page responses omit solution detail payloads; those load when View is selected.

CSV and JSON keep individual solution records, with queueId, zero-based queueIndex, queueCount, queue timestamps/status and available fallback outcomes. CSV columns are additive and retain the existing formula-prefix protection. The completion message counts selected deployments and also reports solution records when there are more. Selecting both a queue ID and one of its child IDs does not duplicate exported records.

Deleting a queue removes its parent metadata and all related individual history records. The confirmation explicitly describes this. Solution ZIPs and notes files remain on disk. Delete filtered includes matching queues across all pages. No existing history was deleted during implementation.

## Storage and consumer contracts

`deployments.json` retains its existing deployments array and adds an optional queues array on the first new queue. Each queue contains compact planned items and fallback outcomes; full child records remain in deployments. Old histories require no migration. Existing individual record IDs and add/update/get/list service contracts remain available.

| Component | Change / consumers |
| --- | --- |
| electron/services/historyGrouping.js | Pure grouping projection, used by store; queue IDs have a queue_ prefix. |
| electron/services/store.js | Grouped query/matching IDs, lazy grouped detail, queue metadata writer, export expansion and queue deletion. Raw listDeployments/getDeployment remain compatible. |
| electron/services/deploymentQueue.js | Optional awaited onStart and onResult hooks; main-process queue integration is the current consumer. Sequential import and stop behavior are preserved. |
| electron/main.js | Wires metadata/progress/results; history:get accepts grouped and existing child IDs; history:export expands selected queues; history:delete rejects active-deployment deletion. Existing history:list remains the legacy raw-record endpoint. |
| src/views/HistoryView.jsx, src/styles.css | Group rows, queue overview, reusable individual details, named controls and focus restoration. |
| src/views/DeployView.jsx | Displays queue-history update warnings returned by the backend. |

No auth, approval, notification recipient, deployment reporting or Microsoft installation-wait contracts were changed for this request. All status queries remain local history reads; no MCP/environment modification is required.

## Validation performed

Verified commands from the repository manifest and installed tooling, executed successfully:

```powershell
node --check electron/services/historyGrouping.js
node --check electron/services/store.js
node --check electron/services/deploymentQueue.js
node --check electron/main.js
npm run build:renderer
git -c core.safecrlf=false diff --check
```

The renderer compiled 43 modules. The existing Vite CommonJS API deprecation warning remains. Source review covered raw-record preservation, ordered grouping, legacy missing positions, per-deployment statistics/filtering/pagination, queue lifecycle writes, stopped/skipped results, fallback history, export expansion, deletion scope and dialog focus behavior. These checks are syntax/build/static evidence, not runtime regression evidence.

No tests were added or run, per the task's execution instructions. No live imports, MCP writes, history deletion/export against user data, UI host checks, installer packaging or releases were performed. There is no configured lint or solution-checker command in the manifest; no reliable changed-code coverage measurement was performed.

## Configuration, recovery and open details

Restart Electron and load the updated renderer. Installed copies require a future updated installer. No new settings or sign-in are needed. Closing the application still does not cancel or automatically resume an accepted deployment.

Before release/recovery, close Helper and back up its local powerapps-helper/deployments.json. Reverting the code leaves the original child records readable by older versions; older versions will not display the additional queue metadata. Restoring the backup restores history only, not target-environment state. No migration or recovery operation was executed.

- D01: docs/standards.md and applicable AGENTS.md were absent. Full rule mapping cannot be verified; supplied working guidance was used and no exception is approved.
- D02: Runtime regression evidence and the approved 80% coverage target are unmeasured. Full changed-code coverage tooling is not configured.
- D03: Packaged-host checks, independent non-author approval and recovery validation remain outstanding before release. Destructive history behavior also requires the qualified second reviewer specified by the supplied guidance; no review waiver is granted.
- D04: The existing synchronous JSON-file store still processes the full history and lacks transactional/atomic-write recovery. Queue history does not add automatic resume. Missing legacy records cannot be reconstructed from a queue reference alone.
