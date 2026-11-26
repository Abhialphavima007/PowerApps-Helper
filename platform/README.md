# PowerApps Helper deployment automation

Solution revision **1.1.3.0**, 26 November 2026. Desktop release candidate **0.1.5** packages these changes; the earlier handover build used 0.1.4. See the [desktop release notes](../docs/releases/0.1.5.md), [new-user setup guide](../docs/local-handover.md) and [validation/recovery evidence](../docs/approval-usability-improvements.md).

## Current development state

The development solution is **PowerAppsHelper**, unmanaged, in **Abhinav Research**. Approval, outcome and Teams deployment-update flows are on. The default profile is enabled, First response, with a 60-minute timeout and the previously verified trusted account intact. Approval and outcome Dataverse triggers use **Flow owner**, because Deployment Events is OrganizationOwned. Another installation chooses its own environment, connections, recipients and profile.

The approval presentation and account-picker form/script are published. This revision preserves decision guards, trigger contracts and used connection bindings. Runtime delivery after this revision has not been checked; the user's preceding deployment flow was reported working. The desktop changes require an updated build/restart.

## Behaviour

- Outcome reporting defaults to the deployment target captured at run start, for success/failure only. Every reporting target requires the setup and configured outcome flow. A fixed setup environment is supported.
- An optional central approval environment stores the profile/events/decisions while request source and target details come from the deployment. Leaving that URL blank uses the target for approval too.
- The local outbox retries accepted-pending reports while Helper runs with the original deployment account. Dataverse event acceptance is distinct from email delivery; inspect flow history for connector failures.
- Failed imports propose only exact existing source components. Approval requests list names and friendly types, planned action, excluded unresolved dependencies and then the import error. Exact IDs, subcomponent settings, plan JSON and SHA-256 remain in the Deployment Event.
- First response lets one selected approver decide; a first rejection stops repair. Every approver remains configurable. Approval responses must come through the matching Microsoft approval request; Teams chat replies do not authorize changes. Private Teams reminders point to Approvals; inline approval buttons are not implemented.
- The desktop checks decision creator/modifier, event/run/plan, response/expiry, approval ID and selected responders. It revalidates configuration/evidence before source additions, publication, export and retry. Rejection, expiry, changed configuration or invalid evidence stops repair.
- Approved repairs use the existing Dataverse API sign-in. The separate desktop Dataverse MCP connection and transport selector are removed. Saved MCP settings migrate without changing destinations; optional Codex updates and legacy injectable contracts remain.
- The new Approval flow account lookup validates an active Dataverse user and fills the read-only canonical trusted GUID after explicit selection. Existing GUIDs display by name without replacement. Confirm the actual connection account in Power Automate first; the current user/flow owner is not automatically trusted.
- Automatic idle-sleep protection spans manual export/import and the whole agent run including approval waits. Helper must remain running. Forced sleep, hibernation, lid policies, shutdown and network loss are outside this protection.

Approval can leave already-added components in the source if a later operation fails; there is no automatic rollback. These flows consume created Helper events; they are not universal observers of maker/pipeline imports. Connector delivery is not guaranteed exactly once.

## Current connection references

| Consumer | Reference | Connector |
|---|---|---|
| Outcome | abhi_sharedcommondataserviceforapps_2abc7 | Microsoft Dataverse |
| Outcome email | abhi_sharedoffice365_0e041 | Office 365 Outlook |
| Approval | abhi_sharedcommondataserviceforapps_5ab79 | Microsoft Dataverse |
| Approval requests | abhi_sharedapprovals_3625b | Approvals |
| Approval reminders and Teams updates | abhi_sharedteams_64386 | Microsoft Teams |

Five unused memberships were removed after consumer and dependency checks: abhi_DeploymentDataverse, abhi_DeploymentOutlook, abhi_DeploymentApprovals, abhi_DeploymentTeams and abhi_sharedteams_eb0e0. Environment objects were retained. Working flows, schema, app, roles and resources remain. Missing-dependency readback returned no rows.

## Customize and distribute

Use unmanaged development and reviewed, tested managed artifacts downstream. Import the solution, bind the five references to the recipient's connections, create/configure a profile and verify effective permissions. Profiles, role assignments, credentials and signed webhook addresses are not portable solution configuration. Use [local-handover.md](../docs/local-handover.md) for central versus target setup options and the account picker.

Preserve schema names, prefix abhi and existing public contracts. schema.json describes the shipped schema. build-flows.cjs generates the base envelopes; build-dependency-teams.cjs preserves the verified Teams extension and applies the current presentation. build-setup.cjs generates the typed forms/views and profile form registration. These generators alone do not recreate every app, role or table component; use the exported solution for handover.

## Validation and recovery

65 focused improvement/deployment/auth/IPC tests passed. Renderer build, changed JS/CJS syntax and whitespace checks passed. Live approval definition comparison confirmed the surgical patch; final script and form readbacks match local content. Coverage evidence and exclusions are recorded in the linked improvement report; the 80% changed-code target is not certified. No repository lint or solution-checker command was found.

Before release, require the non-author and second qualified security review (REL-01), fresh runtime delivery/error checks, another-environment managed import and recovery rehearsal. No exception is self-approved (STD-02). Full standards.md was unavailable (D01); remaining D01–D10 details are in the improvement report.

Pre-change solution backup, exact flow/form baselines and consumer inventory are in ignored .local-recovery and must remain private. Restore scoped baselines or re-add removed memberships after inspection. Solution backup does not restore configuration rows or credentials. Disable profile/flows and desktop automation to stop new requests; already-started actions may finish. Pending local reports retain their captured destination/account.

Historical revisions and earlier setup states are retained in CHANGELOG.md and the preceding task reports. Current state above supersedes historical disabled-profile/off-flow notes.
