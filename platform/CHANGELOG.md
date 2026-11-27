# Deployment automation changelog

## Approval presentation 1.1.4 — 27 November 2026

- Added six numbered sections with bold headings, component bullets, ordered repair steps, a dependency relationship code block and an XML error excerpt. Approval rule is derived from the event's selected mode. The original error and exact hashed repair plan remain in the Deployment Event.
- Teams reminders separate dependency text into a supported Adaptive Card 1.2 Monospace block; native approval details use fenced Markdown. Old event details remain readable when a dependency block is absent.
- Regenerated both approval definitions. After MCP reconnection, patched only the presentation fields in the freshly retrieved existing development approval flow. Exact full-definition readback matched revision 1.1.4.0; Activated state, connection bindings, trigger and decision guards were retained. Saved exact before/after recovery envelopes.
- Recipients, profile, outcome definition and the existing solution version 1.1.3.1 remain unchanged. No approval notification, solution export, installer or release was produced. Restart Electron for the desktop dependency sections; already-issued approvals are not rewritten. Validation and remaining host checks are recorded in ../docs/dependency-approval-format.md.

## Deployment automation 1.1.3 — 26 November 2026

- Cleaned approval requests/reminders: component names and friendly types first; dependency error below; exact plan and technical evidence retained in the event.
- Added the active-user account picker to the published profile form. Explicit selection fills the canonical trusted ID; existing IDs and approval guards are preserved.
- Removed the separate desktop Dataverse MCP repair requirement and migrated saved settings to existing API sign-in. Optional Codex updates and compatibility contracts remain.
- Added automatic idle-sleep protection over export/import and full agent approval waits, with overlap/error cleanup.
- Removed five verified unused connection-reference memberships from the development solution without deleting environment objects; bumped solution version to 1.1.3.0.
- Added generic handover guidance. 65 focused/compatibility tests, renderer build, syntax and whitespace checks passed. Runtime delivery, physical sleep, managed downstream import, checker and independent review remain pending. See ../docs/approval-usability-improvements.md.

## Deployment automation 1.1.2 — 26 November 2026

- Fixed both Dataverse event triggers to use Flow owner (`3`). The server rejected Row owner (`2`) for the shipped OrganizationOwned Deployment Events table, preventing approval and outcome flows from starting despite their On status.
- Verified option values through active-environment metadata. Corrected and reactivated both live flows in Abhinav Research; exact definition readback and both registered Added/Organization callbacks were verified. Connections, recipients, profile and authenticated decision guards were retained.
- Updated both generators and regenerated definitions. Saved exact live before/after files, retaining designer metadata for the live patch. Historical baselines remain recovery evidence.
- Three focused regression tests passed, including both generated event triggers, historical baseline correction, unchanged input and rejection of unsupported trigger contracts. Syntax and generation checks passed. No live approval, message, source repair or deployment retry was performed. A fresh Helper run is required because Added triggers do not replay the earlier queued event.


## Deployment automation 1.1.1 — 26 November 2026

- Fixed approval and repair-plan URL validation to accept Global Discovery's verified `org.api.crm3.dynamics.com` format as well as standard environment URLs. Authentication, API requests and approval plan hashes retain the discovered origin; unrelated hosts, insecure URLs and URL credentials remain rejected.
- Added destination-specific setup errors, explicit missing profile prerequisites and an accurate approval-readiness flag that includes profile enablement. Setup app links use the web host rather than the API alias. Corrected deployment guidance to require approval and describe five repair cycles and the configured transport.
- Fresh MCP readback found the Abhinav Research approval flow activated, but the profile still disabled with a blank trusted user. The desktop's enabled automation used a blank approval destination, pointing at GL Marketplace instead of the existing central setup. No flow or profile was changed, no trusted identity inferred, and no source repair or live message sent.
- Saved/read back the existing Abhinav Research central approval destination while retaining automatic target outcomes and MCP repair. Syntax, renderer build and whitespace checks passed; restart is required for the running Helper process. Approval setup/delivery, coverage and required reviews remain outstanding.

## Deployment automation 1.1.0 — 26 November 2026

- Added History pagination (10/25/50/100 rows), lightweight page results, lazy details and actions across all matching pages. JSON storage still reads/sorts the whole history.
- New Emails & approval settings default to captured deployment-target reporting, terminal success/failure only, optional separate approval setup, and MCP-only approved source additions. Preserved older explicit fixed destinations/API compatibility. Invalid automation configuration disables that feature without resetting other saved settings.
- Saved the Abhinav Research approval draft with private Teams reminders using the verified Teams card contract and bound references. Authenticated approval remains through Microsoft approval email/Power Automate; chat responses cannot authorize repair and inline Teams approval is not implemented.
- Changed the disabled default profile to First response. Flow remains off; trusted connection identity/effective rights and recipient configuration require verification before activation. No trusted identity was inferred or live notification sent.
- Corrected StartAndWaitForAnApproval to OpenApiConnectionWebhook after host save validation rejected the old type. Corrected save succeeded; full definition equality and off state verified.
- Retained a pre-change approval draft and verified nonsecret connection bindings. No source additions, installer, release, tests, runtime approval/delivery, checker, managed deployment or recovery drill. Syntax/build/whitespace evidence and remaining setup gaps are in docs/history-reporting-approval.md.

## Teams connector 1.3.1 — 25 November 2026

- Verified the live Abhinav Research flow is on with its native TeamsWebhook trigger and bound abhi_sharedteams_64386 connection reference. The earlier unbound reference is unused and preserved.
- With explicit user approval, changed only trigger authentication from Tenant to All (Anyone). Exact definition readback and activated state verified. Nonsecret before/after definition snapshots retained; no callback or live message retrieved/sent.
- Added specific, safe workflow-save errors and normalized settings persistence with best-effort recovery of the earlier encrypted callback on a settings-write failure. Original two-argument service contract retained.
- New callback setup defaults to Helper-selected private people; saved legacy fixed routing and edits during delayed status loading are preserved.
- Passed 18 focused Node tests, 5 isolated Electron Settings scenarios, renderer build, syntax and whitespace checks. Initial restricted UI attempts failed to start Electron; the successful check used normal desktop access with synthetic data and network blocked.
- App remains 0.1.4 and MCP contract 1.0.0; no dependency, installer or release change. User must restart Helper and recopy the current signed address directly into Settings. Cloud runtime/delivery, changed-code coverage, reviews/checker and recovery rehearsal remain unverified.

## Teams connector 1.3.0 — 25 November 2026

- Created private Teams notification draft a7da1eec-3de8-f111-84ea-7c1e52408682 and unbound abhi_DeploymentTeams reference in the existing PowerAppsHelper solution in Abhinav Research.
- Draft remains off with no native webhook trigger. Teams sign-in/connection binding and designer trigger setup are required before delivery.
- Added Helper-selected recipients to the versioned webhook payload and restored encrypted workflow setup in Settings; no channel configuration in the UI. Fixed-recipient/service/IPC/MCP compatibility retained.
- Added reproducible draft/schema generator, text-only card validation and separate actual cloud readback snapshot. Revised cloud synchronization was rejected with XrmConnectionReferenceMissingConnection; finish setup and sync before activation.
- Kept the Helper progress timer (default five minutes), immediate selected completion/failure and optional Codex observed updates. No autonomous cloud monitoring, live sends, activation, package or release.
- Corrected status documentation: existing outcome flow is activated; approval is draft, verified by readback without changing either flow.
- Generator, renderer build, syntax and tracked whitespace checks passed. No new/rerun tests; current routing/UI, flow runtime and host reviews remain outstanding.

## 1.0.1 — 24 November 2026

- Created corrected solution-aware outcome and approval draft flows with disabled external-action retries, expiry handling and correlated final decisions.
- Published the setup app, sitemap, typed forms and default views; created unassigned scoped security roles.
- Added local desktop outcome reporting/outbox and approval gating before source additions, publication, re-export and retry. Disabling or changing local setup invalidates pending repair authorization.
- Verified persisted flow envelopes against generated definitions and retained existing unrelated connection references.
- Saved an unmanaged snapshot and documented activation, review, recovery and validation gaps. Flows and default profile remain off; desktop changes are not released.

## 1.0.0 — 24 November 2026

- Added deployment profile, event and decision schema with editable recipients, email text, approval mode and timeout.
- Created initial draft automation components. Superseded task-created drafts were removed after corrected drafts were created.
