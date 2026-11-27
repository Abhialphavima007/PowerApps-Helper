# Set up PowerApps Helper on another computer

This setup uses the user's own Microsoft account, environments and connections. Abhinav Research is the development environment; another installation does not need access to it.

## 1. Install and sign in

Install the reviewed desktop build. Sign in with the Microsoft work account that can export from the source, import into the target and customize the unmanaged source solution. Choose local storage if OneDrive is unnecessary. Tenant sign-in policies still apply. A separate Helper Dataverse MCP connection is not required for approved repairs. Optional Codex deployment updates remain available.

## 2. Install the solution and connect its flows

Import **PowerAppsHelper 1.1.3.1** into the environment chosen for approval and reporting. Use the unmanaged copy in a development environment when customizing. Use a reviewed, tested managed copy downstream. Solution packages do not transfer profiles, credentials, connection accounts, role assignments or the signed webhook address.

Bind the solution's five connection references to the new installation's own connections:

| Purpose | Reference | Connection |
|---|---|---|
| Outcome reporting | `abhi_sharedcommondataserviceforapps_2abc7` | Dataverse in the setup environment |
| Outcome emails | `abhi_sharedoffice365_0e041` | Office 365 Outlook |
| Approval evidence | `abhi_sharedcommondataserviceforapps_5ab79` | Verified Dataverse automation account in the setup environment |
| Approval request | `abhi_sharedapprovals_3625b` | Approvals |
| Teams messages | `abhi_sharedteams_64386` | Microsoft Teams |

The flow accounts need access to their selected recipients and destinations. Keep both Dataverse event triggers on **Added / Organization / Flow owner**. Row owner is incompatible with the organization-owned event table. Open each flow in the designer, resolve connection warnings and turn it on after configuring the profile.

## 3. Configure one notification profile

Open **PowerApps Helper Setup → Notification Profiles**. Create one profile with key `default`, its name, success/failure recipients and dependency approvers. Separate email addresses with semicolons. Select **First response** if any one selected approver may decide, or **Every approver must approve** if all must agree. Set the approval timeout and wording.

For **Approval flow account**:

1. Open the dependency approval flow's Microsoft Dataverse connection in Power Automate Connections and confirm its signed-in account.
2. Select that user by name in the profile's **Approval flow account** lookup.
3. Wait for the account check. Helper fills the read-only **Trusted Approval Flow User ID**; save and enable the profile.

The selected account must be an active Dataverse user in this setup environment. It may differ from your sign-in or the flow owner. The picker removes manual GUID lookup; it does not automatically determine which account the connection uses. Recheck it when changing that connection. Existing trusted IDs display by name without being replaced.

Review effective roles and app access. The approval automation identity should be separate from deployment users. Deployers need to create/read events and read decisions, but must not modify saved events or create/modify decisions. Read-only forms alone do not enforce these restrictions.

## 4. Configure the desktop once

In **Settings → Emails & approval**, enable automation and use profile key `default`.

| Desired arrangement | Settings |
|---|---|
| One central setup for approval and outcome emails | Fixed setup environment; enter that environment URL |
| Central approval; outcomes follow each deployment target | Deployment target (automatic); enter the central approval URL; install/configure outcome reporting in every target |
| Each target owns both approval and outcome reporting | Deployment target (automatic); leave approval URL blank; install/configure the setup in every target |

Source and target names/URLs in requests always come from the deployment. The setup URL identifies where approval evidence is stored. Save, then **Check saved setup**. This checks configuration/table access; flow activation and delivery still require a real flow run.

For Teams progress messages, configure the new installation's workflow in **Settings → Teams**. Save its signed webhook address locally, choose people/group/chat/channel destinations and a progress interval. Keep the address private. It is stored encrypted on that computer; do not copy another user's settings or credential cache. Teams reminders use the flow account/connector identity; sending as a person is a separate supported connector option subject to tenant policy.

## 5. Verify before handing over

Use a non-production source/target and synthetic data. Check a successful deployment, a failed deployment, approved/rejected/expired dependency repair, and unavailable Teams/approval connections. Inspect flow run history and actual recipient delivery. Compare the requested component list to source additions and deployment history.

Keep the desktop running and connected until deployment finishes. Helper prevents automatic idle sleep during export, import and agent execution, including approval waits, then releases the protection. The screen may turn off. Forced sleep, lid-close policies, hibernation, shutdown or network interruption are not covered; this is not a cloud deployment worker or restart-resume feature.

Draft artifacts need independent review, downstream import checks and a recovery rehearsal before release. See [implementation and validation evidence](approval-usability-improvements.md).

For desktop 0.1.6 and the complete connection, package and timeout instructions, use the [setup guide](setup-guide.md) or [Word guide](PowerApps-Helper-Setup-Guide.docx).
