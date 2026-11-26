# History, target reporting and dependency approval

Implementation evidence: **26 November 2026**. Local source changes and an unmanaged approval-flow draft in **Abhinav Research**; no installer or release produced.

### Follow-up: API URL validation and approval destination

The user's next run stopped with `Choose an HTTPS Dataverse environment URL`. Read-only inspection confirmed automation was enabled, the optional approval URL was blank, and both deployed environments were discovered API aliases: `https://org88271e23.api.crm3.dynamics.com` and `https://glmarketplacefinal.api.crm3.dynamics.com`. The validator accepted only the standard web host. Revision 1.1.1 accepts the official optional `api` label, preserves the origin for tokens/requests/plan hashes, keeps the existing HTTPS/host/path/credential restrictions, and gives contextual setup errors. Settings readiness now also requires an enabled profile; deployment help reflects exact approval and five repair cycles.

Fresh MCP readback in Abhinav Research found approval flow `e2492334-06e8-f111-84ea-7c1e52067fec` **Activated/on** (state 1/status 2). Profile `bc8917ab-01e8-f111-84ea-7c1e52067fec` was still disabled, with a null trusted flow user, First response and one approver. Earlier off-state evidence below is historical. A blank approval URL follows the target and does not locate the central Abhinav Research profile. The approved existing central setup URL is used for approval; target reporting remains automatic. Flow/profile activation or identity changes were not made by this fix. D03/D04 remain prerequisites; this is not evidence of delivery.

Saved/read back only the optional approval destination as `https://prexa365abhiresearch.crm3.dynamics.com` in the existing desktop settings. Enablement, `default` profile, target reporting and MCP repair remained as inspected; other settings and encrypted credential files were retained. Settings write access was approved through the configured escalation reviewer. The running workspace Electron process has not been restarted, so restarting Helper is required to load the main-process validator fix. No deployment or retry was started.

Follow-up checks: `node --check electron/services/deploymentAutomation.js`, `npm run build:renderer` (43 modules; existing Vite CJS warning) and `git diff --check` passed. These are syntax/build/static checks; no tests, live approval, notification delivery or source repair was performed. Changed-code coverage remains unmeasured (D07).

## Resulting behavior

| Request | Implementation | Limit |
|---|---|---|
| History pagination | Main-process queries return 10/25/50/100 lightweight rows, default 25. Filters reset to page 1, results clamp after deletion, details load on demand, stale requests are ignored. Export/Delete filtered resolve all matching IDs. | The existing JSON history is still read and sorted in full per query. Rendering/IPC volume is bounded; storage is not database pagination. |
| Target environment default | New Emails & approval settings capture the selected target for terminal success/failure reporting. An optional separate approval setup URL is available. | Each target needs the setup schema, profile and active outcome flow. Existing explicitly saved URLs preserve fixed reporting/API behavior until changed. |
| One member approves repair | The disabled default profile now uses First response. The approval draft sends private Teams reminders to its selected approvers, with source, target, dependencies, run/cycle and expiry. Authenticated approval evidence gates exact source additions, publication, re-export and retry. | Reminders have no inline Approve/Reject buttons; respond through the matching Microsoft approval email or Power Automate Approvals. Chat replies do not grant permission. |
| Add approved dependencies via Helper MCP | New settings require the existing source MCP connection and an advertised AddSolutionComponent action. Missing connection/action stops repair. | This is Helper's existing environment-hosted MCP connection, not the separate Codex MCP sign-in. Tenant/source MCP setup still applies. API compatibility is an explicit alternative; publication/export/import use the existing API path. |

Approvers are configured in the Dataverse notification profile, separately from Teams progress recipients. No new approver addresses were inferred from progress recipients. First response means the first selected member's response decides: approval permits repair, rejection stops it. Every approver mode remains supported.

## Affected components and compatibility

- `electron/services/store.js`: paginated query/matching IDs and normalized automation defaults. Invalid automation configuration disables that feature while preserving other saved settings.
- `electron/main.js`, `electron/preload.js`: new history IPC and automation configuration captured at run start. Existing history list/get/export/delete contracts remain.
- `src/views/HistoryView.jsx`, `src/styles.css`: pagination, debounced filtering, lazy detail and loading/error controls.
- `src/components/DeploymentAutomationSettings.jsx`: settings-only target/fixed reporting and repair transport choices; deferred target setup guidance.
- `electron/services/deploymentAutomation.js`, `electron/services/deploymentAgent.js`: target resolution/outbox and exact authenticated approval checks, with MCP-only versus compatibility repair.
- `platform/build-flows.cjs`: corrected StartAndWaitForAnApproval action type.
- `platform/build-dependency-teams.cjs`, `dependency-approval-teams.json`: reproducible private Teams reminder extension with verified reference bindings.

Existing Teams deployment-update routing, signed webhook and encrypted credential setup were preserved. No dependencies, publisher prefix, table/choice schema or application release version changed. Other substantial local work was retained.

## Cloud evidence

MCP verified **Abhinav Research**, `https://prexa365abhiresearch.crm3.dynamics.com`.

- Approval flow `e2492334-06e8-f111-84ea-7c1e52067fec`: save first failed because StartAndWaitForAnApproval requires `OpenApiConnectionWebhook`. Corrected save succeeded. Full readback equaled the generated `dependency-approval-teams.json`; contentVersion is `1.1.0.0`. Final state is **Draft/off**.
- Profile `bc8917ab-01e8-f111-84ea-7c1e52067fec`: First response (`100000001`), timeout 60 minutes, **disabled**, trusted `abhi_flowuserid` **null**.
- Approval bindings: `abhi_sharedcommondataserviceforapps_5ab79`, `abhi_sharedapprovals_3625b`; private reminders reuse `abhi_sharedteams_64386`. A connection ID establishes binding, not identity or effective permissions.
- Outcome flow `11d4532b-06e8-f111-84ea-7c1e52067fec` and deployment Teams flow `a7da1eec-3de8-f111-84ea-7c1e52408682`: verified **on** with existing definitions/bindings. No live messages or callback addresses retrieved.

The Teams reminders and authenticated approval run independently. Reminder failure diagnostics do not overwrite an existing decision. Connector save acceptance is not proof of this behavior or of message delivery.

## Validation actually performed

Commands discovered in package.json, the release pipeline and existing generators:

- `node platform/build-dependency-teams.cjs` and `node platform/build-flows.cjs`: generation succeeded.
- `node --check` passed for main, preload, store, deploymentAgent, deploymentAutomation and both changed flow generators.
- `npm run build:renderer`: passed, **43 modules**, with the existing Vite CJS Node API deprecation warning.
- `git diff --check`: passed; existing LF/CRLF notices remain.
- MCP definition save/readback and selected profile/state verification passed as described above.

Static review covered page-size/filter validation, stale-result/error branches, page clamping, bulk-action scope, fresh/legacy/invalid settings, target capture, terminal outcomes, First response/Every approver evidence checks, account/profile/plan/expiry revalidation and missing/unsupported MCP behavior. These are code-review findings, not executed business tests.

No tests were added or run. No UI runtime, live approval/delivery, source mutation, packaging, solution checker, security review, downstream managed deployment or recovery drill was performed. No package lint/test or verified solution-checker command is configured. Reliable changed-line coverage measurement is absent; the supplied 80% changed-business-logic target is unmeasured, and changed-rule runtime evidence remains required before release.

## Setup and recovery

1. Verify the actual Dataverse account used by the approval flow's trigger/actions and its effective direct/team rights. Configure the trusted systemuserid only from that verification. A deployer must not be able to fabricate events/decisions through the same trusted identity or conflicting permissions.
2. Confirm profile approvers, First response/Every approver policy and timeout, then complete required review and host validation before enabling the profile/approval flow. Check saved setup validates configuration/table access only.
3. Install/configure outcome reporting in each target, or select an existing fixed reporting environment. A separate approval environment can retain one central approval profile.
4. Use an updated Helper process/build, choose the intended settings and save. Old explicit setup URLs require selecting target reporting/MCP to adopt the new defaults. An old installed executable is not updated by these source changes.

`platform/dependency-approval-live-before-teams.json` is the pre-change approval draft recovery baseline. Keep approval off while restoring that definition and verifying its state/bindings. Restore profile mode separately if reverting First response. Disabling local automation invalidates a pending repair at its next check; already started actions and partial approved source additions may remain. See [full setup and recovery guidance](../platform/README.md).

## Open details (D01–D10)

These IDs track unknowns for this task; they do not reconstruct the unavailable standard catalogue.

| ID | Remaining detail |
|---|---|
| D01 | docs/standards.md and applicable AGENTS.md were absent. Only supplied working guidance was available; full standard compliance cannot be certified. |
| D02 | Native inline Teams approval/output contract is unverified and not implemented. Actual approval evidence, card delivery and failure paths need host validation. |
| D03 | Actual Dataverse flow connection identity is unverified; trusted flow user remains blank. |
| D04 | Effective permissions, identity separation, event/decision immutability and independent security reviews need verification before activation. |
| D05 | Each reporting target requires configuration. Other deployment tools need an authenticated event publisher; this is not a universal deployment monitor. |
| D06 | Existing installed Helper and packaged hosts are not updated/verified; source changes have no release artifact. |
| D07 | Runtime changed-rule evidence, coverage tooling and checker integration remain outstanding; no 80% claim. |
| D08 | JSON history processing remains proportional to total data; connector duplicates/ambiguous sends remain possible. |
| D09 | Recovery procedure and managed downstream deployment/configuration have not been exercised. |
| D10 | Approver availability, timeout and retention of dependency/error data require operational confirmation. |

Required non-author approval and a second qualified reviewer for the approval security boundary remain outstanding. No exceptions, self-approval or release waiver are granted (STD-02 / REL-01 from the supplied guidance). Activation owner/reviewers and remediation dates have not been assigned.
