# Ordered solution deployments

## Changelog — 27 November 2026

Queue service: version 1.0.6; installation-wait service: version 1.1.0; history grouping: version 1.0.1. Desktop 0.1.6 now packages these features as a local release candidate; public publication remains pending review. Dataverse import service 1.2.0 adds independent 60/180-minute import limits. No dependencies were added or changed.

- Added Single solution / Multiple solutions below the existing source/package selector.
- Added **Predefined packages** as a third option. Local definitions load current source solutions or saved solution ZIP references in order and use this queue, including one-solution packages. Queue preparation/execution verifies the saved definition; unreviewed exports reject changed source versions. File queues check reviewed fingerprints, and saved-file imports check the exact bytes submitted after installation waits/retries. See [local package workflow and validation](predefined-packages.md).
- Multiple source solutions can be added, removed, assigned four-part versions, and reordered using Up/Down controls. Multiple ZIPs can be selected together and reordered. Existing ZIPs accept three- or four-part numeric versions, retaining the exact manifest version and file bytes (queue service 1.0.6). ZIP review identifies the exact solution, path and actual version if it is missing/malformed. Source export versions still require four parts.
- Source queues support export/review followed by manual import, or the existing optional deployment agent. Source exports retain the existing version update and artifact storage behavior. File queues use the packages selected from disk.
- The backend captures one account, source, target and ordered list. It runs one item at a time and stops subsequent imports after an import or installation failure. Per-item history records include queue identity, index and count. History shows the queue once, with an ordered solution detail view; new queues also retain planned items and skipped outcomes. See [grouped history](grouped-deployment-history.md) for storage, filters, export/delete semantics and validation.
- Changing source, account or selection mode clears the queue draft. Changing export type or a source item's version invalidates its reviewed package. The backend re-inspects selected ZIPs and rejects mismatched names, versions or package types.
- Fixed queue startup and per-item account checks to use the existing public `auth.status()` contract. Calling the private, unexported `getActiveAccount()` caused `auth.getActiveAccount is not a function` before imports could start. Restart Electron to load this fix.
- Fixed the subsequent pre-import `Restricted API is not called by Microsoft publisher plugin` failure by replacing the solution-history query with the documented `asyncoperations` system-job query. The saved failed NovSolution record confirmed phase `installation`, `importCompleted = false` and no import job ID.
- Teams notifications now show bold, numbered Solution / Deployment / Status / Timing sections and the solution's queue position for export, manual import and agent deployment. Pre-import installation/session failures are excluded from the displayed import-attempt count. The queue result separates its heading, completion count and failure reason.
- Narrowed readiness checks to Microsoft background Ribbon Client Metadata (76), Import Solution Metadata (93) and solution installation after app updates (337). Helper's own import is tracked separately, and its known system-job ID is explicitly excluded from the post-import background check. The 15-minute budget starts on detected blocking work (or unavailable status), not at the beginning of Helper's import.

## Sign-in and execution

Dataverse queue operations use the existing MSAL account and silent token refresh. They never launch a second Dataverse sign-in. An expired session, revoked permission or required interactive consent stops the queue with a reconnect message. Adding, switching or signing out accounts and starting another deployment is blocked throughout export preparation and queue execution.

The optional OneDrive storage feature retains its separate existing Graph consent/cache. Its first use or tenant policy may require interaction; this change does not replace that feature's authentication contract. Configure local storage to avoid OneDrive interaction. Optional reporting, Teams delivery and dependency approvals retain their existing settings and consent requirements.

The queue runs in the Electron main process and keeps the existing sleep protection active for its complete lifetime. Switching app tabs preserves the deployment screen. Keep Helper open: there is no persisted automatic queue resume after app exit. Completed solutions are not rolled back or automatically retried.

## Import and Microsoft installation waits

1. Check target installation readiness before submitting an import.
2. Submit through the existing Dataverse Web API and wait for actual import completion. An absent async-operation ID is not success: the fallback requires the import job's completion timestamp, 100% progress and explicit success result.
3. After import success, require two idle installation checks separated by 10 seconds before allowing the item to finish.
4. If the server explicitly rejects the submission because a previous solution/RibbonData operation is running, wait and retry that rejected submission. An accepted job that later fails is not retried by this installation handler.
5. Stop on a real import failure, authorization/schema error, or installation timeout. The optional agent retains its existing approved dependency repair flow; it does not repair or retry installation/authentication failures.

Background installation status is polled every 10 seconds after each response. Each readiness request has a maximum 30-second network timeout, capped by the remaining installation budget. The 15-minute budget begins when background work is detected; temporary 429/502/503/504, timeout and network failures also start a bounded status-recovery budget. Pre-import and post-import background waits have separate budgets. Repeated concurrent-submission rejections share a deadline beginning at the first rejection. Helper's upload/import duration does not consume its pre/post background wait. Desktop 0.1.6 allows 60 minutes for each normal import and 180 minutes when the submitted managed ZIP matches an existing managed solution in the target. The exact ZIP and target metadata select the limit. This uses the existing import action, not a separate stage/apply-upgrade operation. Status requests and delays are capped by the remaining import budget; a monitoring timeout stops the queue without cancelling the server operation or triggering dependency repair. The import limit is separate from the installation limit. See [0.1.6 release notes](releases/0.1.6.md). A clear pre-check returns immediately, while the post-import check still requires two clear responses to allow late background work to appear.

The status query uses Microsoft's documented `asyncoperations` entity set, filtering non-terminal jobs (`statecode ne 3`) for Ribbon Client Metadata Operation (76), Import Solution Metadata (93) and solution installation after app updates (337). Ordinary solution imports (203), updates (45), publishes (204), upgrades (207/211) and uninstalls (208) no longer enter the background readiness query. Names, IDs, start times and operation types are selected; no job payloads are requested. [Microsoft system-job reference](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/asyncoperation?view=dataverse-latest). A job name/type does not establish an individual solution's publisher; this observes platform background job categories, not a verified Microsoft-publisher inventory. The prior `solutionhistories` query was restricted and is no longer called. Live visibility of all RibbonData/Microsoft solution activity remains unconfirmed. Narrow concurrent-operation submission rejection handling covers an operation that starts between checks, is not visible, or falls outside these categories. Such a rejection does not prove the other operation's publisher. Authorization or malformed status responses still stop the queue; they are not treated as idle. The account must be able to read relevant target System Jobs.

A timeout stops Helper's queue; it does not cancel a Microsoft operation already running. If import succeeded but installation readiness failed, the result/history preserves `importCompleted` and the import job ID. The UI asks the user to check the target before importing that solution again. Later solutions remain unstarted.

Optional publish, artifact storage, history, Git and notification warnings retain the existing warning behavior. They do not turn a confirmed import into an import failure.

## Affected components and consumers

| Component | Contract / consumers |
| --- | --- |
| `src/views/DeployView.jsx`, `src/styles.css` | Single and multiple selection, queue ordering, review, results and accessible named controls. |
| `electron/preload.js` | Existing `pickZip()` still returns `path`; optional `{ multiple: true }` adds `paths`. New `prepareQueue`, `runQueue` and removable `onQueueProgress` listener. |
| `electron/main.js` | Existing export/import/agent IPC handlers reuse internal functions; all deployment handlers share account and execution locking. Queue progress includes request ID to filter older events. |
| `electron/services/deploymentQueue.js` | New preparation/preflight and sequential execution service; main-process queue IPC is its only current consumer. |
| `electron/services/installationWait.js` | New bounded readiness/conflict helper; Dataverse is its current consumer. |
| `electron/services/dataverse.js` | Existing `importSolutionFromFile` arguments remain supported. Manual and agent imports, including queues, now wait for Microsoft installation readiness. `withAccount` is used by queue execution. Existing auth helpers are unchanged. |
| `electron/services/deploymentAgent.js` | Preserves import completion/phase information and adds queue metadata to history. Installation failures stop before dependency repairs. |
| `electron/services/teamsNotifications.js`, `teamsWorkflow.js` | Existing start/update/finish and workflow payload versions remain supported. Queue position is additive; notifications use numbered sections, escaped field values and HTML for direct Graph delivery. |
| Local history / reporting | Queue imports reuse history, notes, Git and existing notification/reporting consumers; metadata fields are additive. |

No plugin, web resource, shared AV client library, PCF control or Dataverse schema/registration was changed.

## Validation performed

Commands verified from `package.json`, the release pipeline and local tooling, and executed successfully:

```powershell
node --check electron/main.js
node --check electron/preload.js
node --check electron/services/dataverse.js
node --check electron/services/deploymentAgent.js
node --check electron/services/deploymentQueue.js
node --check electron/services/installationWait.js
npm run build:renderer
git -c core.safecrlf=false diff --check
```

The renderer build compiled 43 modules. It retains the existing Vite CommonJS API deprecation warning. Source review covered sequential awaits, queue failure/skipped handling, selection invalidation, actual ZIP verification, lock cleanup, silent-account scope, narrow submission retries, installation deadlines and import-completion propagation.

For the queue account-call fix, `node --check electron/main.js` and `git -c core.safecrlf=false diff --check` were rerun successfully. Source inspection confirmed both queue lookups use the exported `auth.status()` and no external `auth.getActiveAccount()` calls remain. No renderer build or live deployment was rerun for this backend-only fix.

For the restricted-status-query and message-format fixes, syntax checks passed for `main.js`, `dataverse.js`, `deploymentQueue.js`, `teamsNotifications.js` and `teamsWorkflow.js`; `npm run build:renderer` passed with 43 modules and the existing Vite warning. Public Microsoft references verified the system-job entity set, operation-type values and terminal state. Local history inspection confirmed the pre-import failure phase. MCP returned stored environment context, but metadata/query calls reported not signed in; no additional sign-in was initiated. No tests, live target queries/imports, Teams sends, cloud-flow changes, packaging or host rendering checks were performed for this fix.

No tests were added or run, per the task's execution instructions. These syntax/build/source checks do not establish behavior or changed-code coverage. No lint or solution-checker command is configured in the manifest or release pipeline. No live import, RibbonData operation, consent flow, packaged-host check or cross-platform UI check was run.

## Open adoption inputs (D01–D10 tracking)

- D01: Referenced `docs/standards.md` is absent. Full rule mappings and exceptions cannot be verified; this note does not approve an exception or claim full compliance.
- D02: Dataverse MCP metadata requests were unavailable because MCP was not signed in. Public Microsoft metadata was used for the replacement system-job query; target System Job permissions and live RibbonData visibility require a non-production check.
- D03: Changed-rule regression evidence and the 80% changed-business-logic coverage target remain unverified. Tests were not authorized; reliable changed-code coverage measurement is not configured for the complete renderer/main flow.
- D04: Staged Windows/macOS/Linux packaged-host checks, independent non-author review and the recovery check remain pending before release. No release or live deployment was performed.

No configuration or database migration is required for the queue. A running development app must load the updated renderer and restart Electron for the new IPC/backend handlers. Installed desktop copies require a future updated installer. Recovery uses per-item history and target inspection to select only solutions that still need deployment; there is no automatic rollback.


