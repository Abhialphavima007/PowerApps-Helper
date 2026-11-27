# Dependency approval presentation — 27 November 2026

Presentation revision **1.1.4.0** is applied to the existing unmanaged development approval flow in **Abhinav Research**. Desktop component formatter **1.1.0** and package **0.1.5** remain local. MCP verified the existing solution version **1.1.3.1**, which was retained. No new dependency, schema, installer or release.

## Result

Approval details use six numbered bold headings: Deployment, Components to add, Missing dependencies, After approval, Reported dependency error and Request reference. Component names use bullets and inline code; next steps use an ordered list. The selected approval mode supplies the approval rule.

Parsed dependency entries show which component requires which missing component, including a parent table where supplied. The formatter displays Table, Column and Table relationship while preserving the shared parser's legacy Entity, Attribute and Relationship contracts. The agent passes its parsed target dependencies; other callers fall back to the existing reviewed XML parser. If no structured entries exist, the message says so. The diagnostic summary shows at most 30 unique relationships with an explicit remainder notice; every proposed source addition is still listed. Original error text, component IDs, machine plan and SHA-256 are retained in the event and are not recalculated by presentation code.

Approval Markdown uses a fenced dependency block and a separate XML error excerpt (up to 4,000 characters). XML elements are separated into lines, embedded triple backticks cannot close the error fence, and truncated error excerpts are labelled. Technical component references keep their existing delimiter for old flows. The Teams reminder uses a supported Adaptive Card 1.2 Monospace TextBlock for dependency text and a 1,200-character error excerpt; it strips inline backticks from the surrounding list because Teams TextBlock supports a smaller Markdown subset. Old event details without a code block retain the full public details block.

## Example of the central sections

**2. Components to add to the source solution (3)**

- **Table:** `cr5f6_task`
- **Table:** `cr5f6_project`
- **Column:** `cr5f6_departmentname`

**3. Missing dependencies**

```text
cr5f6_employee (Table)
  requires cr5f6_project (Table)

cr5f6_employee (Table)
  requires cr5f6_task (Table)

cr5f6_department.cr5f6_employee_Department_cr5f6_department (Table relationship)
  requires cr5f6_department.cr5f6_departmentname (Column)
```

**4. After approval**

1. Add only the listed existing source components.
2. Publish source customizations.
3. Re-export the same solution version.
4. Retry the target import.

- **Tables:** added without their subcomponents.
- **Other listed components:** include their subcomponents.
- **Required components:** are not added automatically.

## Consumers and compatibility

| Changed component | Consumers / contract |
| --- | --- |
| `electron/services/approvalPresentation.js` | `deploymentAutomation.js` and existing approval presentation checks. Existing three arguments remain supported; optional error/parsed-dependency arguments affect display only. |
| `electron/services/deploymentAutomation.js`, `deploymentAgent.js` | Agent approval events. Parsed dependency context is additive; approval scope, identities, expiry and plan hash are unchanged. |
| `platform/approval-presentation.cjs` | Base generator, Teams extension generator and exact-envelope live patch workflow. Existing exports retained; revision constant is additive. |
| `platform/dependency-approval.json`, `dependency-approval-teams.json` | Local generated artifacts at 1.1.4.0. Outcome remains 1.1.3.0. No trigger/connection/decision or sender changes. |
| `electron/services/installationWait.js`, `dataverse.js` | Manual and agent imports, including queues. Background types 76/93/337 are checked separately from Helper's own import; see `solution-deployment-queue.md`. |

Existing test expectations were updated for the deliberate presentation/version changes. Tests were not added or run in this task.

## Rollout and recovery

Restart Electron to load local formatter/wait changes. A renderer refresh is insufficient. For the complete notification layout, apply `applyApprovalPresentation` to a freshly retrieved exact current approval-flow envelope in the configured setup environment. Do not replace a live flow with generated historical baselines. Preserve trigger, connection bindings, decision actions and active state; verify a scoped definition readback before a synthetic approval run. New flow definitions do not rewrite already-issued approvals.

After the user reconnected MCP, the active environment was verified as Abhinav Research. The existing **PowerApps Helper - Dependency Repair Approval** flow (`e2492334-06e8-f111-84ea-7c1e52067fec`) was retrieved afresh, and its exact envelope was saved as `platform/dependency-approval-live-before-format-1.1.4.json`. The presentation helper changed only the two native approval-details fields, the Teams reminder body and content version. A second pre-write read confirmed the definition, modification timestamp and state were still unchanged; the update patched only `clientdata`.

The update succeeded. Full definition readback matched the prepared envelope exactly at **1.1.4.0**, with the original connection references, trigger and Activated state/status (`1`/`2`) retained. The recorded server modification timestamp is `2026-11-27T10:57:00Z`. The exact saved envelope is `platform/dependency-approval-live-format-1.1.4.json`. No profile, recipients, trusted identity, approval decisions, other flow or solution version was changed. No approval notification was sent. Already-issued approvals are not rewritten; the desktop restart is still required for new dependency sections.

Recovery uses the exact pre-change envelope above and the prior local app revision. Before restoring, retrieve the live flow again and check for subsequent edits; apply the saved envelope through a scoped `clientdata` patch, then verify definition, bindings and active state. No recovery execution or automatic source rollback was introduced.

## Validation and remaining inputs

Passed syntax checks using `node --check` for `approvalPresentation.js`, `deploymentAutomation.js`, `deploymentAgent.js`, `installationWait.js`, `dataverse.js`, `approval-presentation.cjs`, `build-flows.cjs`, `build-dependency-teams.cjs` and the two updated test files. Both local flow generators (`node platform/build-flows.cjs` and `node platform/build-dependency-teams.cjs`) completed successfully. `npm run build:renderer` passed with 43 modules and the existing Vite CommonJS deprecation warning. `git -c core.safecrlf=false diff --check` passed. Source review covered display-only plan handling, preserved flow decisions/bindings, parser label compatibility, job-type filtering, explicit own-job exclusion and separate background/import deadlines.

A structural comparison of the generated definitions against the repository baseline found only the two approval-details fields and content version changed in the base approval flow; the Teams variant additionally changed the reminder card body. The generated outcome definition is structurally unchanged. The new approval expression is 3,059 characters. This static comparison does not establish live connector rendering.

The live approval-flow update and exact readback were performed through MCP after reconnection. No tests, host rendering, live solution import, approval notification, packaging or solution-checker was performed. No lint or solution-checker command is configured in the manifest/release pipeline. These syntax/build/source/readback checks do not certify behavior or the 80% changed-code coverage target.

- D01: `docs/standards.md` and applicable AGENTS files are absent; full approved rule mappings cannot be verified.
- D02: Live flow expression rendering, target background-job visibility/permissions and publisher identification are unverified. System-job category/name does not prove a solution publisher. Native Approvals/Teams host support must be checked with synthetic data.
- D03: Existing expectations changed; no tests were added/run, and changed-code coverage remains unmeasured.
- D04: Staged desktop/Teams/approval hosts, non-author review, a qualified second reviewer for the approval integration, managed export/import and scoped recovery checks remain pending before release. No release approval or exception is claimed.
