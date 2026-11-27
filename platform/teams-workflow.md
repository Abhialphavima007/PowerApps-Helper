# Teams deployment updates

Created through Dataverse MCP on **25 November 2026**, extended on **26 November 2026**, in **Abhinav Research**. Local connector revision **1.4.1**, payload contracts **1 and 2**, MCP contract **1.1.0**. The 27 November message-format update changes local cards only; the cloud flow was not modified.

## Current status

**The cloud flow is on, with private, existing group chat and channel routing.** The 26 November update preserved the native signed Teams webhook, Anyone authentication and existing Teams binding. Full saved clientdata matches the generated source exactly, and activated state was read back. Version-2 cloud runs and actual group/channel delivery have not been verified. The historical flow name still says Private Teams Deployment Updates; its ID and existing callback are preserved.

| Component | Verified value |
| --- | --- |
| Environment | https://prexa365abhiresearch.crm3.dynamics.com |
| Solution | PowerAppsHelper, unmanaged 1.0.0.0 |
| Publisher | Abhinav, existing prefix abhi |
| Solution ID | 4a99833d-fbe7-f111-84ea-7c1e52067fec |
| Flow | PowerApps Helper - Private Teams Deployment Updates |
| Flow ID | a7da1eec-3de8-f111-84ea-7c1e52408682 |
| Flow state | Activated, statecode 1 / statuscode 2 |
| Native trigger | manual: Request / TeamsWebhook |
| Trigger authentication | All (Anyone), approved signed-webhook mode |
| Actual connection reference | abhi_sharedteams_64386 |
| Reference ID | 4487f488-40e8-f111-84ea-7c1e520671bf |
| Connector | /providers/Microsoft.PowerApps/apis/shared_teams |
| Bound Teams connection | shared-teams-94cbcdd8-949a-4653-82d2-27a6e1518e79 |

[Open the flow record](https://prexa365abhiresearch.crm3.dynamics.com/main.aspx?pagetype=entityrecord&etn=workflow&id=a7da1eec-3de8-f111-84ea-7c1e52408682). For the designer, open Power Automate, select **Abhinav Research → Solutions → PowerApps Helper → Cloud flows**. The Power Automate environment ID was not verified; the Dataverse organization ID is not used as a substitute.

Flow and original reference solution membership were previously verified (component types 29 and 10169). The designer-created live flow now uses the bound reference above. The earlier abhi_DeploymentTeams reference (5af8fad5-3de8-f111-84ea-7c1e52408682) remains unbound and unused by this flow; it was preserved along with existing email, approval, shared references and SYSTEM flows. Membership of the new reference must be checked before downstream packaging.

## Save the connection in Helper

1. Fully close and reopen Helper to load the local main/preload update; refreshing the page alone is insufficient. No installer was built or released.
2. Open the flow in Abhinav Research. In **When a Teams webhook request is received**, confirm **Who can trigger the flow → Anyone** and copy the newly generated webhook address. Its signed address must contain a signature; the flow editor link or an old tenant-authenticated endpoint will not work. Keep the address out of Codex chat, source and logs.
3. In **Helper → Settings → Teams notifications**, select **Workflows bot (recommended) → Use destinations selected in Helper (Helper workflow)**. If an address is already saved, keep it. Otherwise paste directly into the password field. Enter intended Microsoft work sign-in addresses and/or paste a group chat link and channel link copied from Teams. Up to 20 people, one existing group and one channel are supported in any combination. Choose events and gap, enable notifications, then select **Save and check workflow setup**. This dedicated local check does not open Microsoft sign-in. Older running handlers display restart guidance without falling back to Graph.
4. After saving, the entered secret clears and a read-only mask confirms persistent encrypted storage, with **Show / Replace / Remove**. Show requires Windows Hello and hides after 30 seconds; Cancel retains the previous address during replacement. Group/channel destination edits need no callback replacement in Helper routing mode. Changes apply to new runs. Completion/failure requests skip the progress gap when selected. Helper must stay open.
5. The Teams connection owner must belong to the group and have team/channel access. Standard channels are supported; Microsoft's Teams connector does not support posting these cards to private channels. Shared-channel delivery is unverified and needs the host team ID. A pasted link does not grant access. Check Power Automate run history and Teams for delivery. The local check does not send a message or prove the cloud actions succeeded. Runtime validation with synthetic data and expressly selected non-production destinations remains outstanding.

Do not overwrite the live flow with teams-private-notification.json: that historical generator intentionally leaves its trigger collection empty and references the old unbound connection. The live before/after snapshots below capture the actual native trigger and bound reference without a callback.

The setup check verifies local configuration only. Check Power Automate run history and Teams to confirm delivery. The installed desktop must contain these local source changes; no installer was built or released.

## Payload and behaviour

The adapter posts the documented Adaptive Card envelope plus:

    helper: version, recipients, runId, event, observedAt [, groupChats, channels]

Private-only Helper requests retain version 1 (1–20 normalized work sign-in addresses). Version 2 adds groupChats (0–1 decoded chat IDs) and channels (0–1 objects with teamId/channelId) and allows 0–20 people, requiring at least one destination overall. Existing version-1 callers remain compatible; version 1 rejects non-empty group/channel routing. Events are started, progress, success and failure. Each work sign-in address is at most 254 characters. Supported links are HTTPS teams.microsoft.com/l/chat/<encoded thread.v2 ID>/conversations and /l/channel/<encoded thread.skype or thread.tacv2 ID>/<name>?groupId=<team GUID>. Helper decodes IDs once and validates the host, path and IDs; no host DOM access, new member creation or membership lookup is used.

The flow validates types/card bounds first, then normalized people, thread IDs and team GUIDs using bounded Query actions. Power Automate rejected regex pattern properties in ParseJson for OpenApiConnection flows; ID checks were moved into supported expressions. The revised definition was accepted. Independent private/group/channel branches all receive the same card. Each private recipient loop is sequential, each new destination array is capped at one, and all connector actions have retryPolicy none. Group routing uses PostCardToConversation, Flow bot / Group chat / body/recipient; channel routing uses Flow bot / Channel / body/recipient/groupId and channelId. No extra Teams connection or delegated Graph token is used.

The generated schema permits one AdaptiveCard 1.2 with at most 20 bounded TextBlocks and no card actions. Revision 1.4.1 deployment cards use five blocks: a title and bold, numbered Solution / Deployment / Status / Timing sections. Fields are listed below their section headings; queue messages show Solution N of Total. Legacy unstructured envelopes remain supported. Cards contain solution/version, managed/unmanaged package type when provided, source and destination, initiator, operation, selected import options, readable stage/progress, elapsed time and labelled UTC timestamps. Final messages include actual import attempts, dependency components added and import job ID when available. Each block respects the existing 2,000-character text limit; group/channel IDs and recipient lists are not added to the displayed card. No flow update or callback replacement is required for the new format. Actual Teams rendering/delivery remains unverified for this local revision.

Helper owns the progress timer while it is running: default **5 minutes**, configurable **1–1440**. Selected completion/failure events are queued immediately. The webhook handles incoming updates; it does not query Dataverse or autonomously discover every deployment. Optional Codex MCP supplies observed stages/outcomes to Helper; enabling it does not monitor an external deployment automatically.

Settings recipients are copied when a run starts. Later changes apply to future runs. Disabling notifications, changing transport or replacing/removing the callback cancels reporting. Delivery failures are separate from the deployment result. HTTP acceptance means only that the workflow accepted the request, not that its Teams actions succeeded.

## Security, delivery and recovery

- The Anyone callback is a bearer credential. Its holder can invoke this dynamic-recipient flow using the connection owner's authority. Keep it restricted to trusted Helper installations; rotate it if disclosed. Payload validation is not caller authentication or a recipient allowlist.
- No automatic retry follows an uncertain send. Each recipient action has retryPolicy none. A distinct final event can still follow a failed progress request.
- Private recipients are processed sequentially within a request. Group/channel branches run independently so one type's failure does not skip another. Separate requests can execute concurrently. Ordering across cloud runs, partial sends, duplicate/replayed requests and connector throttling remain risks. No durable cloud deduplication, transaction across destinations or guaranteed delivery is implemented.
- Identify the connection owner/coowner and review effective rights and retention before release. Actual recipient addresses and tenant permissions are not verified.
- Recover by disabling Helper notifications and the Teams flow, inspecting run history and restoring teams-live-before-destination-routing.json while off. Restore the previous desktop source too, or clear group/channel settings before resuming version-1-only routing. Verify the native trigger/binding and rotate the callback if disclosed before re-enabling. Already sent Teams messages cannot be recalled by disabling reporting. Recovery has not been rehearsed.
- The existing unmanaged recovery snapshot dated 24 November predates these Teams components. Export a new reviewed solution artifact after runtime validation. Use managed artifacts downstream, explicit references/dependencies and environment-specific connections/callbacks.

## Reproducible source and evidence

Run **node platform/build-teams-destinations.cjs** to reproduce the current extension from its verified credential-free baseline:

- teams-live-before-destination-routing.json: exact full live clientdata captured before the 26 November update, including native All trigger, templateName and bound reference.
- teams-destination-notification.json: generated complete clientdata for the extended flow. Exact cloud readback verified; state remained Activated.
- teams-destination-request-schema.json: corresponding ParseJson schema; IDs are validated by the flow's Query filters, not unsupported schema patterns.
- teams-live-destination-snapshot.json: exact saved live readback after the extension, without a webhook credential.

The Teams connector reference confirms PostCardToConversation and its dynamic body. Cloud save validated the group/channel parameter definitions and expressions. This is not runtime evidence. Syntax checks, renderer build (43 modules), generator and whitespace checks passed for 1.4.0. Tests, live messages/cloud runs, actual Codex host, visual/packaged hosts, solution checker, changed-line coverage and recovery rehearsal were not performed. Full Helper restart is required; no installer/release was produced.

Historical **node platform/build-teams-flow.cjs** generates the incomplete private draft:

- teams-private-notification.json: revised intended draft, with an intentionally empty trigger collection.
- teams-request-schema.json: the same validation schema used by the generated ParseJson action.
- teams-cloud-draft-snapshot.json: readback of the actual off cloud draft after the rejected updates; it is not regenerated and differs from the revised intended definition.
- teams-live-before-auth-fix.json: historical live definition immediately before the approved auth change; native trigger, bound reference and Tenant authentication.
- teams-live-signed-snapshot.json: exact live readback after the auth change, with All authentication and the bound reference. Neither live snapshot contains a callback credential.

The old generator is for historical draft/schema reproduction only. Use build-teams-destinations.cjs and its verified live baseline for this extension, preserving native trigger and actual reference; verify dependencies and exact readback without exporting credentials. The signed callback remains a credential and is never embedded in these files.

For 1.3.1, 18 focused Node tests and 5 isolated Settings scenarios passed. MCP verified the environment, activated flow, native trigger, bound reference and exact auth-only definition change. The flow was already on; no activation was performed. Revision 1.3.2 passed 24 focused Node tests, 9 isolated Settings scenarios, syntax, renderer build and whitespace checks for saved-address persistence, protected reveal and dedicated local checking. No callback retrieval, live Teams message, actual user-credential reveal, cloud runtime, packaging, checker, managed deployment or recovery check was performed. The active Helper main/preload was not restarted; the host still needs a full restart and workflow selection/check. See [connector validation and D01–D10](../docs/teams-deployment-connector.md#validation-and-unresolved-details).

The required non-author and second qualified security reviews are outstanding. No exception or release is self-approved (STD-02 / REL-01); SEC-01 / SEC-02 remain unresolved by standard adoption.

References: [Microsoft Teams connector, webhook and posting operations](https://learn.microsoft.com/en-us/connectors/teams/), [HTTP trigger authentication](https://learn.microsoft.com/en-us/power-automate/oauth-authentication).
