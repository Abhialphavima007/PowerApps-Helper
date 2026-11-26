# Teams deployment connector

Connector revision **1.4.0**, payload contracts **1 and 2**, MCP contract **1.1.0** (compatible additive groupLink). Local implementation for PowerApps Helper **0.1.4**; no new dependencies, installer, release or live message.

**Teams notifications use Settings only.** Choose private people, one existing group chat, one channel, or any combination. The recommended connection uses a Teams workflow, with optional direct Microsoft Graph messaging. The live workflow in **Abhinav Research** is **on**, with its native signed Teams webhook and existing bound connection preserved. On 26 November 2026, its destination routing was extended and exact saved-definition readback verified. Actual group/channel delivery remains unverified.

## Configure notifications

First follow [the Teams workflow setup](../platform/teams-workflow.md). The flow belongs to the existing unmanaged **PowerAppsHelper** solution, publisher Abhinav, prefix abhi. Its current designer-created connection reference is abhi_sharedteams_64386; the historical unbound abhi_DeploymentTeams reference is unused by this flow.

1. Fully close and reopen Helper to load the local main/preload update, then open **Settings → Teams notifications**. A renderer refresh alone does not load the new connection handlers. Checking a workflow does not require Microsoft Teams sign-in; deployment and Codex reporting still use Helper's existing account.
2. Under **Send deployment updates as**, select **Workflows bot (recommended)** and **Use destinations selected in Helper (Helper workflow)**.
3. A saved address appears masked, with **Show / Replace / Remove**, and is retained after reopening. If no address is saved, reopen the flow's Teams webhook trigger, confirm **Anyone** and copy its current signed address into the password field. It is a credential; paste directly into Settings, never chat or source. Do not use an old tenant-authenticated endpoint or the editor link.
4. Enter up to 20 Microsoft work sign-in addresses, separated by semicolons. Under **Group chat and channel**, optionally paste **Copy link to chat** for one existing group and **Copy link to channel** for one channel. Leave people blank for group/channel-only delivery. The workflow bot sends a separate card to each selected destination. The workflow connection owner must have access. Standard channels are supported; the Teams connector does not support workflow cards in private channels. Shared-channel delivery is unverified and requires the host team's ID/access.
5. Choose a gap of **1–1440 minutes** (default **5**) and Started, Periodic progress, Completed and/or Failure.
6. Enable notifications, then **Save and check workflow setup**. Its dedicated local handler cannot open Graph sign-in or request admin consent. This verifies local configuration only; check Power Automate run history and Teams for actual delivery. An older running backend shows restart guidance without falling back to Graph.
7. Later recipient/event/timing changes use **Save Teams settings**. Deploy uses the saved choices automatically.

Fresh settings choose workflow/payload routing with notifications off. Existing settings keep their saved transport; a saved Teams object without workflowRouting is interpreted as fixed routing for compatibility. If no callback is configured, initial Settings loading selects payload routing unless the user has already edited the form. A saved legacy fixed callback keeps its routing. Opening Settings does not replace the stored connection. Settings preserves groupLink and channelLink; the existing encrypted callback needs no migration or replacement for payload destination edits.

### Send updates from your own Teams account

In **Settings → Teams notifications**, choose **Send as me — my Teams account** under **Send deployment updates as**. Enter private recipients, choose events and timing, enable notifications, then **Save and sign in to send as me**. Complete sign-in using the Microsoft account active in Helper. This reuses the existing delegated Graph connection (`transport: graph`); no new setting, IPC/MCP contract or cloud workflow change is introduced. Existing saved workflow connections stay selected until the user changes and saves this choice.

New deployment updates appear in each recipient's one-to-one Teams chat with the signed-in sender. Optional Codex reports use the same selected connection and account. The message includes the solution, source → destination, current stage and result. This option needs Teams messaging consent; it cannot bypass an administrator-approval requirement. Use work sign-in addresses in the sender's Teams organisation; self-chat is unsupported and guest/external recipients are unverified. Helper must stay open, and background sending never opens sign-in. Switching transport stops active reporting; use the new sender for future deployments.

The sender selection, description, recipient help, connection button and confirmation now name the actual sender. The existing `teams-connection` control ID and stored `workflow`/`graph` values are preserved. No live Graph consent or message delivery has been verified for this presentation change. The user-provided screenshot shows Workflows bot Started/Progress delivery for that displayed run only.

Validation for this sender presentation update: `npm run build:renderer` and `git diff --check` passed. Both sender choices and their conditional descriptions were visually inspected in the running dark-mode development app. The draft was returned to the saved workflow choice; no settings, credentials or cloud flow were changed and no messages were sent. Tests were not added or run. Live consent/delivery, light/narrow/packaged hosts and independent review remain outstanding under the existing D01/D03/D06/D07 gaps.

### Settings layout — 25 November 2026

Settings now opens to Teams notifications with six category buttons. Sections stay mounted when hidden to retain unsaved drafts. Teams connection, private recipients, timing and optional Codex preferences are grouped; native checkboxes have scoped sizing and aligned labels. Workflow instructions and connection tools expand on demand. Existing settings, IPC/service contracts and callback encryption are preserved. TeamsNotificationFields has one renderer consumer, TeamsSettings; no common library or cloud definition changed.

The layout uses the existing light/dark palettes and switches to a category grid in smaller windows. Renderer build and patch whitespace checks passed. The running development app was visually inspected in dark mode for Teams controls and category navigation; no settings were saved or notifications sent. Tests were not added or run for this presentation change. Narrow/light/packaged-host visual checks remain unperformed; no installer or release was created. D01 and the existing review/coverage gaps remain applicable. Restart a production app after installing an updated build; the development renderer updates automatically.

Save errors distinguish invalid/unsigned addresses, recipient/gap choices, secure credential storage, settings writes and failed recovery. Only fixed safe messages cross IPC. If settings persistence fails after a callback write, Helper attempts to restore the previous callback, or removes only the newly added callback on first setup. Recovery is best effort; underlying writes are not a transaction, and a partial disk write can require re-entering matching settings. Reporting is cancelled when callback recovery fails. Successful saves persist normalized choices, clear the entered secret and display a read-only mask. **Replace** starts an empty draft; **Cancel** retains the saved address. No network request is made by saving or checking workflow setup.

**Use destinations selected in Helper** adds a versioned helper object to the Adaptive Card envelope. It carries normalized recipients, run ID, event and observed timestamp. Private-only requests retain version 1. Group/channel requests use version 2 with groupChats (0–1 decoded chat IDs) and channels (0–1 teamId/channelId objects). Version 2 allows 0 private recipients but requires at least one destination. Changes apply to future runs without replacing the callback. The updated flow validates types, bounds, email normalization, thread IDs and team GUIDs before sending. One incoming request routes the same bounded card to all destinations; independent private/group/channel branches prevent a failed recipient from skipping other destination types. Private recipients remain sequential, with no side-effect retries.

**Destinations fixed in an existing workflow** preserves the older standard envelope and encrypted destination-hash binding. Keep the workflow actions and Helper destinations in sync; changing them requires updating those actions and saving the callback again. Existing fixed hashes remain unchanged when no group is configured. A fixed workflow cannot consume dynamic destinations simply by switching the local selection.

Choices are copied when a run starts. Interval/event/recipient edits apply to future runs. Disabling Teams or changing transport cancels reporting. Replacing/removing a callback cancels workflow reporting, including queued final requests. Re-enabling does not resume cancelled sessions.

## Timing and outcomes

| Event | Behaviour |
| --- | --- |
| Started | Queued when export, import or agent deployment starts, if selected. |
| Progress | Queued at the saved interval using the latest observed stage and its observation time. |
| Completed / Failure | Queued immediately after the observed outcome, if selected. |
| Export completed | Says **Export ready for review**; import has not started. |
| Import with publish warning | Reports completion with the publishing warning. |
| Codex stops reporting | At an interval tick after at least 30 minutes or twice the configured interval without an update, reporting ends with **outcome unknown**. If Failure is selected, a Reporting stopped message is queued; this does not declare deployment failure. |

Helper owns the timer while the app is open. The workflow responds to incoming updates; it does not poll Dataverse or discover deployments from other tools. Codex supplies observed stages and outcomes through MCP. Enabling Codex alone does not monitor an external deployment.

Local requests are queued in order; pending progress is coalesced and skipped when a run finishes. Actual delivery can be delayed by offline/sleep, sign-in, cloud processing or throttling. Cloud workflow runs can overlap and reorder messages. Export and subsequent import have separate run IDs. Cards include solution/version, source → destination, initiator, current stage/update, run ID and timestamps. Multi-line details remain within a bounded text-only Helper card.

Notification failure does not change the deployment outcome. Settings shows retained reporting summaries. workflow_accepted means HTTP acceptance only; recipients remain delivery_unconfirmed until checked in flow history. Graph accepted means API acceptance, not that a person read a message. History stores an initial summary; Settings shows later summaries during the app session.

No uncertain/failed message is retried automatically. Workflow failure suppresses periodic requests; a distinct completion/failure event is still attempted once. Recipient actions have retryPolicy none. Graph failures stop later messages to that destination while other destinations continue. Check Teams/run history before restarting after an ambiguous timeout. Multiple recipients/runs, partial sends, duplicate triggers and replay remain risks. Durable cloud delivery/deduplication and production throughput are not implemented or measured.

## Connection, consent and credentials

The recommended workflow path uses an authorized Teams connection, normally **Flow bot → Chat with Flow bot**. Helper does not acquire a Graph Teams token for that path. Microsoft can still require Teams connection authorization, restrict workflows or enforce licensing and tenant policy. This work does not bypass Microsoft administration.

The live flow uses bound abhi_sharedteams_64386. Its native trigger is manual, type Request, kind TeamsWebhook. The previous Tenant authentication required a Microsoft token; Helper deliberately supplies no Authorization header when calling the approved signed address. Authentication was previously changed to All with approval. Revision 1.4.0 preserves that trigger and binding and extends validation/routing actions; exact readback and activated state were verified. Dataverse sign-in is separate from Teams connection authorization. Actual version-2 delivery remains unverified. The earlier empty-trigger generator and rejected unbound-reference updates are historical; do not apply that generator over the live flow. See [the workflow guide](../platform/teams-workflow.md) for reproducible sources, snapshots and exact IDs.

The Anyone callback is a bearer credential: its holder can invoke the dynamic-recipient flow through its connection owner's authority. Payload validation is not caller authentication or a recipient allowlist. Protect and rotate the callback; restrict access to trusted installations and review the intended connection account/recipients.

Signed callbacks are stored encrypted, never returned in renderer configuration, status or MCP output. The additive **Show** IPC returns the address only after successful Windows Hello verification, using the existing shared verification concurrency guard. No automatic reveal occurs. **Hide**, transport changes, unmount and a 30-second timer clear the revealed value; successful save also clears it. Only signed HTTPS Microsoft workflow endpoints are accepted; redirects are forbidden, timeout is 15 seconds, and errors omit callback/response bodies. Removing/replacing the callback stops active workflow reporting. Secure OS credential storage must be available.

**Direct Microsoft connection** is optional. It requests delegated Graph User.Read, User.ReadBasic.All, Chat.Create and ChatMessage.Send for private messages. Group-only delivery requests ChatMessage.Send without user lookup/chat creation; channels request ChannelMessage.Send. Group chat IDs route directly to existing chats; Helper never creates a group or adds members. Tenant policy may require admin approval. Background sending never opens interactive sign-in. Direct self-chat is not supported. Work sign-in addresses can differ from email aliases; guest/cross-tenant/government-cloud behaviour is unverified.

Direct mode reuses AZURE_GRAPH_CLIENT_ID and AZURE_AUTHORITY. A tenant-approved public client may be needed if the default Graph CLI client cannot obtain the scopes; no client secret is required. Restart/reconnect after environment configuration changes. Teams tokens use a separate encrypted-only teams-cache.bin; insecure Linux basic_text storage is rejected. Sign-out clears Teams tokens; already submitted requests can still complete.

## Optional Codex connection

1. Enable **Allow optional Codex deployment notifications on this computer** and save Teams settings.
2. Select **Codex connection details** and confirm **Ready on this computer**.
3. Configure a local Codex MCP server using the exact command and args shown there. Development includes the checkout path; installed builds use --teams-mcp.
4. Keep Helper open and signed in with a ready connection. Read teams_deployment_status before beginning reporting; it does not verify live credentials or delivery.

Use the [official Codex MCP configuration guide](https://developers.openai.com/codex/mcp/). For file-based configuration, place the displayed command and args under [mcp_servers.powerapps_helper_teams] in the applicable config.toml. No OpenAI API key is needed. The actual Codex host has not been configured or verified during this work.

| Tool | Required inputs | Purpose |
| --- | --- | --- |
| teams_deployment_status | None | Read retained summaries and masked workflow status. |
| teams_deployment_begin | externalKey, solution, targetEnv | Begin reporting; returns a run ID. Optional version, sourceEnv and session notification choices. |
| teams_deployment_update | runId, stage | Record observed progress; optional percent (0–100) and message. Sending follows the interval. |
| teams_deployment_finish | runId, outcome (success/failure) | Queue final update and stop periodic reporting; optional message. |

Example using saved recipients:

~~~json
{
  "externalKey": "synthetic-release-2026-11-25-001",
  "solution": "ExampleSolution",
  "version": "1.0.0.1",
  "sourceEnv": "Development",
  "targetEnv": "Staging",
  "notifications": { "intervalMinutes": 5 }
}
~~~

The example is synthetic. Allowed notification overrides are enabled, recipients, groupLink, channelLink, intervalMinutes, started, progress, success, failure; unsupported fields are rejected. groupLink is additive in MCP 1.1.0; existing tool names and required inputs remain unchanged. Codex cannot change transport/routing mode or read the callback. Payload mode permits explicitly authorized destination overrides. Fixed mode requires its saved destination binding. Human authorization is required for people/groups/channels; enabling Codex does not authorize choosing new destinations.

Use a unique external key for each actual attempt. Identical begins are deduplicated for the initiating account while retained in the same app session; conflicting details are rejected. Cancelled/expired attempts need a new key. Up to 20 active Codex sessions and 100 retained summaries are supported. Restart/pruning ends deduplication. The bridge uses authenticated loopback access and stdio; its port descriptor contains no bearer secret. Local OS credential access and actual packaged-host behaviour require security review.

## Deployment and affected components

The app source is ready for review; no package or release was produced. Restart a development build to load these changes. Downstream deployments need a reviewed managed solution artifact, environment-specific Teams connection/callback, explicit dependencies/ownership and recovery checks. Disable Teams reporting/flow to stop future requests, inspect history and rotate any exposed callback; messages already sent cannot be recalled. The prior unmanaged backup predates Teams components. Recovery has not been rehearsed.

| Component / consumer | Change |
| --- | --- |
| teamsNotifications.js / teamsWorkflow.js | Workflow/Graph transport, payload/fixed routing, encrypted callback, recipient/card validation, timing and cancellation; safe save errors and optional normalized persistence/recovery callback. Additive local check/reveal methods; optional expected-transport guard preserves no-argument connect. |
| teamsCodex.js | Optional authenticated loopback/stdio MCP, compatible additive groupLink in public contract 1.1.0. |
| auth.js | New getTeamsGraphToken and encrypted Teams cache; existing Graph helper contract retained. Sign-out clears Teams cache. |
| credentials.js | Private teamsWorkflow/teamsCodex records; public credential names/contracts retained. |
| store.js | Disabled defaults and validation; fresh payload routing, compatibility migration. |
| main.js / preload.js | Teams IPC, subscriptions, export/import/agent updates, optional bridge lifecycle; workflow-save IPC persists normalized choices and returns safe categorized failures. Additive checkWorkflow/revealWorkflow IPC; reveal shares Windows Hello verification guard with existing credential reveal. |
| TeamsSettings.jsx / TeamsNotificationFields.jsx | Settings-only people, optional existing group/channel links, events/gap, saved callback mask with Show/Replace/Remove, connection modes and masked delivery status. Group/channel-only setup can be saved/checked. |
| DeployView.jsx / SettingsView.jsx | Deploy consumes saved choices; all notification configuration is in Settings. |
| platform/build-teams-flow.cjs and generated files | Historical intended draft/schema and actual draft snapshot; separate live before/after auth snapshots without callbacks. |
| platform/build-teams-destinations.cjs | Reproducible additive version-1/2 routing from a verified credential-free live baseline; generated definition/schema. Historical draft generator retained. |
| PowerAppsHelper cloud solution | Existing activated Teams flow extended to group/channel routing, native signed trigger and bound abhi_sharedteams_64386 preserved. Historical unused unbound reference and other components preserved. |

Shared consumer inventory: auth serves main, Dataverse, OneDrive, Azure DevOps, tenant naming, deployment automation and Dataverse MCP; Teams uses the new method. Credentials serves main, AI and Azure DevOps, plus private workflow/bridge processes. Store/preload serve the renderer. Existing deployment-email/approval changes were preserved. Shared regression and staged-host checks are outstanding.

Require one non-author approval and a second qualified security reviewer before release. No exception or release is self-approved (STD-02 / REL-01); adoption does not resolve SEC-01 / SEC-02. CI publishes on push to main; no commit/push/package/publishing was performed.

## Changelog

### 1.4.0 — 26 November 2026

- Added Settings-only groupLink and channelLink fields, independently optional alongside up to 20 people. Saved destinations are retained, copied per run, and mapped from supported Teams links; malformed/off-host links and invalid IDs fail locally. Workflow payload mode no longer rejects channels. Existing callback encryption and legacy fixed hashes remain compatible; no secret migration.
- Added version-2 group/channel payloads; private-only payloads stay version 1. Extended the existing Abhinav Research flow from its verified live clientdata, preserving trigger, authentication, actual binding, template and private action. Bounded independent destination branches each use PostCardToConversation and retryPolicy none. No new flow, trigger, connection or Graph permission is needed in workflow mode.
- Microsoft initially rejected regex patterns in ParseJson schema (ActionSchemaNotSupported). Moved thread/GUID checks into bounded Query filters; revised save succeeded. Exact full-clientdata readback, activated state and unchanged trigger/binding verified. Original live definition retained in teams-live-before-destination-routing.json for recovery. Group uses location Group chat/body/recipient; channel uses location Channel/body/recipient/groupId and channelId, accepted by the cloud definition validator.
- Optional MCP 1.1.0 adds groupLink without changing existing tool names/required inputs. Direct Graph routes group IDs directly, avoids private user/chat lookups for group/channel-only delivery, and requests only destination-relevant messaging scopes.
- Validation performed: node platform/build-teams-destinations.cjs, node --check for the notification/workflow/Codex services and generator, npm run build:renderer (43 modules), git diff --check, and Dataverse exact readback. Existing Vite CJS warning remains. Tests, changed-line coverage, cloud runs/live sends, actual Codex host, visual/packaged hosts, solution checker and recovery rehearsal were not performed; D01/D02/D04/D06/D07/D09/D10 remain open. Restart Helper before use. No package/release created.

### 1.3.3 — 25 November 2026

- Enriched both workflow and Graph notifications with managed/unmanaged package type, display/unique name where they differ, operation, selected overwrite/publish options, readable stages, elapsed time and labelled UTC timestamps. Import attempts, dependency components added and import job ID are included in final messages when returned by the deployment service. Failures retain the last observed stage; successful imports with warnings label the warning explicitly.
- Export/import handlers now pass their existing selected type/options to notifications; agent deployments use their existing snapshot. Export-only messages explicitly say import has not started. Codex's existing contract has no package-type/options inputs: these are shown as Not provided or omitted, without assuming unmanaged/disabled options.
- Message text stays within the live flow's 2,000-character details limit, reserving space for identifiers/timing and sanitizing the update text. No descriptions, notes, credentials, local artifact paths or recipient lists were added to cards. Existing routing, timing, settings, IPC/MCP and webhook payload contracts are preserved; no cloud edit is required.
- Validation: JavaScript syntax checks for main.js and teamsNotifications.js and git diff --check passed. Tests were not added or run for this request; changed-logic coverage and host/cloud delivery checks remain unperformed (D01/D06/D07). Restart Helper to load the main-process changes. No live notification, package or release was sent/created.

### 1.3.2 — 25 November 2026

- Display encrypted saved workflow addresses as a read-only mask after save/reopen, with Windows Hello protected Show, Hide after 30 seconds, and Replace/Cancel/Remove controls. No private credential name was added to the public credential API.
- Route Save and check exclusively through a local workflow handler, with no Graph authentication or network request. Missing older handlers show restart guidance. Direct connection supplies an expected-transport guard; the existing no-argument contract remains supported.
- Passed 24 focused Node tests, 9 isolated Settings scenarios, renderer build, JavaScript syntax and whitespace checks. Synthetic data only; no live message, actual credential reveal or cloud change. Initial restricted Electron startup failed; the approved retry passed.
- Running development UI was observed with saved Send as me selection and an idle Configure deployment page. Subsequent window inspection was interrupted by minimized/user-input state; the main/preload process was not restarted and the saved sender was not changed. Full restart and actual workflow selection/check remain required in that host.
- App stays 0.1.4, payload 1 and MCP 1.0.0. No dependencies, installer or release changed. Required independent/security reviews and changed-code coverage measurement remain outstanding.

### Settings sender option — 25 November 2026

- Made the existing delegated Graph path explicit as **Send as me — my Teams account**, alongside **Workflows bot (recommended)**.
- Added sender descriptions, private-recipient guidance and consent/setup instructions. Preserved transport values, saved configuration, account matching and IPC/MCP contracts. Connector/service versions are unchanged.
- Renderer build, whitespace checks and dark-mode visual inspection passed; no tests, live sends, cloud changes or release.

### 1.3.1 — 25 November 2026

- Corrected the verified live Tenant-authenticated trigger to All (Anyone), with explicit user approval and exact readback. Flow remains on; actual Teams reference is bound.
- Added safe, specific save errors and best-effort callback recovery on settings-write failure. Main persists normalized choices; the two-argument service contract remains compatible.
- Default unconfigured callbacks to Helper-selected private people without overwriting delayed user edits or saved legacy fixed routing.
- Passed 18 focused Node tests, 5 isolated Settings scenarios and renderer/syntax/whitespace checks. No cloud runtime/send, callback retrieval or release. Initial restricted UI attempts failed; isolated UI scenarios passed with normal desktop access.
- App stays 0.1.4, MCP 1.0.0; no dependency changes. Restart Helper and recopy the newly generated signed address directly into Settings.

### 1.3.0 — 25 November 2026

- Restored recommended workflow setup in Settings with encrypted password input; optional Graph remains.
- Added versioned Helper-selected private recipients; retained fixed workflow/service/IPC/MCP contracts.
- Created draft and connection reference in Abhinav Research; native trigger/Teams authorization remain pending.
- Bounded multi-line cards and tightened local recipient limits. Generated text-only schema restrictions; cloud synchronization rejected until the connection is bound.
- Fresh payload defaults preserve existing fixed settings. MCP stays 1.0.0; app stays 0.1.4; no dependencies changed.
- Generator/build/syntax/whitespace and MCP readback performed; no tests or live sends for this revision.

### 1.2.0 — 25 November 2026

- Earlier Settings revision selected direct private Graph messages, removing workflow/channel controls.
- Saved recipients before interactive sign-in; tenant consent remained required.
- Build/store syntax/whitespace checks passed; no tests or live delivery for that revision.

### 1.1.0 — 25 November 2026

- Added workflow transport, encrypted signed callback and fixed destination binding.
- Moved configuration to Settings, included deployment route/stage and separated HTTP acceptance from delivery.
- Cancelled reporting on callback replacement/removal or transport changes; final events remained distinct from uncertain requests.

### 1.0.0

- Introduced chat/channel service contracts, interval/events, separate notification outcomes and optional Codex MCP.
- Existing lockfile MCP SDK 1.32.2; no dependency/application-version change.

## Validation and unresolved details

Verified repository commands: npm run build:renderer (manifest), node --check <file>, git diff --check, node platform/build-teams-flow.cjs (historical generator). Focused checks: node --test tests/teamsWorkflow.test.cjs tests/credentials.test.cjs tests/teamsWorkflowIpc.test.cjs and npx --no-install electron tests/teamsSettings.ui.cjs. Release pipeline supplies npm ci --no-audit --no-fund and packaging commands; these were not run. No lint/test/solution-checker script is configured in package.json.

Revision 1.4.0 adds node platform/build-teams-destinations.cjs, run successfully. Local syntax/renderer/whitespace checks and exact active cloud definition readback succeeded. No tests were added or run for this request. Existing synthetic tests have not been extended for group/channel routing or the new schema; changed-rule behaviour evidence and the 80% changed-line coverage target remain unmeasured. Cloud save validation confirms schema/expression/connector definition acceptance, not runtime forwarding, destination membership or message delivery. Cloud SDK validation initially rejected patterns; bounded Query validators were accepted. Tests/host/cloud/recovery and required independent/security reviews remain outstanding; this is an unmanaged development update, not a reviewed downstream release.

For **1.3.2**, 24 focused Node tests and 9 isolated Settings scenarios passed. Tests exercise the actual registerIpc/preload functions with synthetic dependencies, workflow checks with zero authentication/network calls, transport mismatch before authentication, Windows Hello gating/cancellation/concurrency/recovery, encrypted address persistence across store reinitialization, no automatic reveal, Hide/30-second expiry, replacement/cancellation/removal, legacy fixed routing, delayed status preserving edits and old-backend restart guidance without generic-connect fallback. Renderer build passed (43 modules), main/preload/service/UI-test syntax and git diff --check passed. The restricted Electron attempt exited with GPU error -1073741515; an approved retry passed with synthetic data and network blocked. No actual Teams delivery, user credential reveal, full restart of the active Helper, cloud change, actual Codex host configuration, packaged host or solution checker was verified. Changed-rule evidence is attached; reliable changed-code line coverage is unavailable and the 80% target is unmeasured.

For **1.3.1**, 18 focused Node tests and 5 isolated Settings scenarios passed using synthetic data without Microsoft requests. UI scenarios cover new payload defaults, unsigned-address feedback, failed persistence preserving the entered address, successful Save and check with encrypted storage and reload, legacy fixed routing and delayed initial status preserving user edits. Node evidence covers invalid input, modern signed address formats, sanitized/spoofed errors, credential read/write failures, prior-callback recovery, first-save cleanup, failed recovery cancellation, normalized persistence, payload recipient changes and ordered interval/final messaging without Graph sign-in. The renderer build (43 modules), syntax and tracked patch whitespace checks passed. Initial restricted Electron attempts failed at startup; the isolated UI check then passed with normal desktop access and network blocked. No genuine callback, saved user credential or live Teams recipient was used.

MCP reverified Abhinav Research, activated flow, native trigger, actual bound reference and exact auth-only revision. It did not establish runtime delivery. Reliable changed-code coverage measurement is absent: attach the changed-rule evidence above; do not claim the 80% changed-business-logic target is measured. Cloud trigger forwarding/schema rejection/Teams actions, actual Codex host, packaged installation, full shared-consumer regression, solution checker, managed deployment and recovery rehearsal remain unverified. Required independent approvals are outstanding.

For **1.3.0**, the generator, renderer build (43 modules), syntax checks for generator/store/workflow/notification/Codex/main JavaScript, and tracked patch whitespace checks passed. Existing Vite CJS deprecation and Git line-ending warnings remain. MCP verified environment, solution membership, reference/flow IDs and draft/off state. Initial draft readback matched its original generator; revised source synchronization was rejected, and the actual retained definition is captured separately.

Earlier connection verification passed 9 synthetic workflow tests and 1 existing credential test. Revision 1.3.1 extends/reruns those checks as described above. No live notification, actual consent, flow activation/runtime, Codex host, packaging, solution checker, managed deployment, recovery drill or independent approval was performed.

| Decision / unknown | Remaining detail |
| --- | --- |
| D01 | docs/standards.md and AGENTS.md were not found. Full approved rule text could not be read; apply supplied working guidance without claiming full compliance. |
| D02 | Abhinav Research live flow is on with native TeamsWebhook and bound abhi_sharedteams_64386. Version-1/2 destination extension read back exactly with native trigger/binding preserved. Runtime forwarding, membership, group/channel delivery and private-recipient regression remain unverified; reference membership requires downstream packaging verification. Historical empty-trigger/unbound drafts must not replace the live flow. |
| D03 | Actual recipients/UPNs, Teams owner connection, licensing, tenant consent and guest/cross-tenant compatibility unverified. Signed callback grants dynamic-recipient authority; no cloud recipient allowlist. |
| D04 | Installed Electron stdio/actual Codex host and other operating systems unverified. Codex host not configured here. |
| D05 | Credential storage, local bridge access, account switching, sign-out and cache races need security review. |
| D06 | Revision 1.3.2 passed persistence/check/reveal tests. Revision 1.4.0 has generator/syntax/renderer/whitespace and exact active cloud definition evidence only; tests/changed-rule runtime evidence and reliable changed-line measurement remain absent and the 80% target unmeasured. Active Helper restart, visual/cloud runtime, full shared consumers and packaged hosts need evidence before release. |
| D07 | Non-author/second qualified security reviews, owner assignments, regression/checker and staged-host checks outstanding. No waiver or self-approval. |
| D08 | In-memory reporting/deduplication ends after restart/pruning. No durable cloud delivery or replay protection; concurrent runs and partial sends remain risks. |
| D09 | Flow/Graph latency and throttling can delay/reorder delivery. No automatic side-effect retry after uncertainty; production throughput unmeasured. |
| D10 | Codex outcomes require evidence from its deployment tool. Helper timer runs only while open; no autonomous deployment polling. Reviewed solution export/recovery staging outstanding. |

References: [Teams connector](https://learn.microsoft.com/en-us/connectors/teams/), [create a private chat](https://learn.microsoft.com/en-us/graph/api/chat-post?view=graph-rest-1.0), [send a chat message](https://learn.microsoft.com/en-us/graph/api/chat-post-messages?view=graph-rest-1.0), [read a user](https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0), [Codex MCP](https://developers.openai.com/codex/mcp/).
