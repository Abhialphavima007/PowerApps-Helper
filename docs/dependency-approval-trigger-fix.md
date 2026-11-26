# Dependency approval trigger correction

Evidence: **26 November 2026**, unmanaged development in **Abhinav Research** (`https://prexa365abhiresearch.crm3.dynamics.com`). No release artifact was produced.

## Cause

The user shared the trigger error:

> Cannot set trigger runas type to RecordOwner for entity: abhi_deploymentevent because it is of ownershiptype OrgOwned

Dataverse metadata verifies `abhi_deploymentevent.OwnershipType = OrganizationOwned`. The callbackregistration RunAs option metadata verifies **1 = Modifying user**, **2 = Row owner**, **3 = Flow owner**. Both live event-triggered flows and the original generator selected `2`. The table has no row owner, so subscription registration failed before any flow action could run. No approval or private Teams reminder was sent by this failed trigger. A flow's Activated status alone did not establish trigger health.

The current approval event was created at **5:43:22 PM IST**, event `8990073a-2316-5038-a9df-119282a4aa94`, run `e4df8021-c891-4054-a8d6-4a1e4fb5695b`: NovSolution 1.0.0.20, Abhinav Dev → GL Marketplace. It matched the trigger filter and enabled default profile, including First response, recipients and nonempty plan with a 64-character hash. At final readback it remained Queued with no decision. Its expiry is **6:43:23 PM IST**. Helper polls for decisions every 15 seconds until that deadline; this is a bounded wait, not an infinite loop. Trigger-registration failures cannot reach the flow's action-level failure handler, so this event has no flow-written delivery error.

## Correction and live evidence

Changed only `subscriptionRequest/runas` to `3` and `contentVersion` to `1.1.2.0` in each exact live envelope. Saved before/after envelopes; disabled each affected flow, guarded against intervening definition changes, saved and read back its correction, then restored its Activated state. No schema, profile, recipient, connection reference, action, approval verification or deployment setting was changed.

| Flow | Flow ID | Verified registration |
|---|---|---|
| Dependency Repair Approval | `e2492334-06e8-f111-84ea-7c1e52067fec` | `03c5a265-95e9-f111-84ea-7c1e520671bf`, created 6:02:10 PM IST |
| Deployment Outcome Notification | `11d4532b-06e8-f111-84ea-7c1e52067fec` | `13dde692-95e9-f111-84ea-7c1e52067401`, created 6:03:35 PM IST |

Both registrations show **Flow owner**, **Added**, **Organization**, `abhi_deploymentevent`, and their unchanged event-specific queued filters. The default profile is enabled, configured for `singha@alphavima.com`, First response and 60 minutes. The configured trusted user is `5f835603-ebd5-f111-84e8-7ced8d064ef7`, matching the previously verified Dataverse connection account. The user configured that ID; this correction did not change it.

The approval flow sends a **Flow bot private Teams reminder** to each event approver and starts the authenticated Microsoft approval request independently. The reminder has an OpenUrl link; it has no inline Approve/Reject implementation. Respond through the matching approval email or Power Automate → the environment hosting this flow → Approvals → Received. Progress notification group/channel destinations do not configure approval recipients; the default approval profile does.

## Resume the deployment

Added triggers do not replay events created before their subscription existed. The old request remains unchanged and has not been duplicated, deleted, approved or resubmitted. While Helper is waiting and no approved source actions have begun, close and reopen Helper to stop that local wait, then initiate the intended deployment again. The new agent run creates a new run ID and approval event. If dependencies are still missing, inspect that new flow run and confirm private Teams reminder delivery and the authenticated approval request. Approve only the exact proposed source additions and retry plan.

No live message, approval response, source addition or deployment retry was performed during this correction. Reopening Helper is for ending the old wait; the cloud correction is already active and does not require an updated desktop installer.

## Source and validation

- `platform/build-flows.cjs`: both base flow envelopes select Flow owner.
- `platform/build-dependency-teams.cjs`: validates the expected Dataverse event trigger and corrects the preserved historical Row-owner baseline before extending it.
- Regenerated `deployment-outcome.json`, `dependency-approval.json`, `dependency-approval-teams.json` at contentVersion 1.1.2.0. The live designer includes metadata/empty else branches/templateName absent from generated source. Live patches preserve them.
- `node --test --experimental-test-coverage tests/deploymentFlows.test.cjs`: **3 passed, 0 failed**. Covers both base triggers, extension correction, baseline immutability, retained trigger filter/scope/message, bound connector selection and missing/wrong trigger rejection.
- `node --check platform/build-flows.cjs` and `node --check platform/build-dependency-teams.cjs`: passed.
- `node platform/build-flows.cjs` and `node platform/build-dependency-teams.cjs`: generation succeeded.
- Exact live-envelope comparison and MCP readback: each correction changes only Run as and contentVersion; both registrations verified.
- Full-file extension line coverage: **92.93%**, branch coverage **75%**. The VM-evaluated base generator is excluded from Node's file coverage report; its captured output is asserted by the first test. No reliable changed-line coverage is configured, so no changed-code 80% claim is made. Changed-rule evidence is the three focused tests.

Renderer/package/checker runs, end-to-end approval/delivery, trusted decision attribution, source repair, managed downstream deployment and recovery drills were not performed. No renderer or Electron business code changed in this correction.

## Recovery and remaining details

`platform/dependency-approval-before-runas-fix.json` and `platform/deployment-outcome-before-runas-fix.json` preserve exact live envelopes before correction. `*-runas-fixed.json` preserve the exact corrections. To recover, disable the affected flow and restore its reviewed envelope through supported tooling, then verify bindings and trigger health before enabling it. The pre-fix Row-owner envelopes reproduce the known invalid trigger and must remain disabled; retain them as evidence, not an operational fallback. Recovery was not exercised. Event/decision records and profile configuration are not reset by definition recovery.

| ID | Remaining detail |
|---|---|
| D01 | `docs/standards.md` and applicable AGENTS.md are absent; only supplied working guidance was available. |
| D02 | Subscription health is verified; private reminder delivery, authenticated approval and action-level runtime behavior await a fresh event. Inline Teams response remains unimplemented. |
| D03 | Connection account is verified; actual creator/modifier attribution of a flow-written decision still needs runtime evidence. |
| D04 | The same configured user has System Administrator and is used by MCP. Identity separation/effective rights and independent security review remain unresolved; no decision guard was loosened. |
| D07 | Changed-line measurement/checker integration remains absent; focused tests provide changed-rule evidence with the VM coverage exclusion above. |
| D09 | Recovery and downstream managed deployment remain untested. |
| D10 | Old queued requests are not replayed by Added triggers. Helper waits until the deadline unless its process is closed; it does not currently detect an unregistered trigger during polling. |

Required non-author review and second qualified review of the approval security boundary remain outstanding. This correction grants no exception, self-approval or release waiver (STD-02/REL-01 from the supplied guidance).
