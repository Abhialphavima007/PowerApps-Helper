# PowerApps Helper setup guide

Desktop 0.1.6 and PowerAppsHelper solution 1.1.3.1

Prepared 27 November 2026

## 1 Overview and prerequisites

This guide helps an administrator install PowerApps Helper for an organization, connect the desktop to the Dataverse setup, and hand it over to deployment users. Each organization uses its own Microsoft accounts, environments, flow connections and notification recipients.

The desktop performs exports and imports directly through the Dataverse Web API. The optional PowerAppsHelper solution provides the setup app, notification profiles, deployment events, approval decisions and Power Automate flows. Basic desktop deployment works without this solution. Outcome emails and approved dependency repair require the solution and its configured flows.

### How the two parts connect

1. The user signs in to the desktop with a Microsoft work or school account.
2. The desktop exports from a source environment or reads selected solution ZIPs, then imports them into the chosen target.
3. When automation is enabled, it creates deployment or approval events in the configured setup environment.
4. Power Automate reads those events and sends outcome messages or requests approval. The desktop reads the resulting decision before making approved source changes.

The setup environment can be central for the team or can be each deployment target. It does not have to be the source environment. No access to the developer's environment is required.

### Before you begin

- Obtain the desktop installer and the matching PowerAppsHelper solution ZIP from the release bundle. Use unmanaged development and reviewed, tested managed artifacts downstream.
- Identify the source, target and optional setup environment URLs. Obtain permission to export, import and customize the source when dependency repair is needed.
- Have an administrator available to assign app/table access and configure Power Automate connections. Microsoft licensing, connector access and tenant consent policies apply.
- Prepare outcome recipients, dependency approvers, the approval policy and the actual Dataverse account used by the approval flow.

The installer includes the desktop runtime. End users do not need Node.js, the .NET SDK or Power Platform CLI. Git is needed only for optional local Git commits.

<!-- page -->

## 2 Install and sign in to the desktop

### Installation or update

1. Let any active deployment finish. Close PowerApps Helper before updating.
2. For an existing installation, make a private backup of its app data while it is closed and retain the previous installer. This backup contains personal configuration and credentials; do not distribute it.
3. Run **PowerApps Helper Setup 0.1.6.exe**. This local Windows x64 candidate is unsigned. Windows may display an unknown-publisher warning; use your organization's approved installation procedure.
4. Open PowerApps Helper and sign in with the account authorized for your source and target environments.
5. Confirm the displayed account and available environments. Choose your storage location in **Settings** before exporting solutions.

The application identity is retained in this release. Existing settings are intended to remain available, but installation and upgrade on another computer still require verification.

### Sign in once for a deployment queue

All Dataverse imports in a queue reuse the selected account and refresh tokens silently. Helper does not prompt separately for every solution. Microsoft can still require a new sign-in after revoked consent, session expiry or a tenant-policy change. Reconnect if Helper reports that the session is no longer valid, then inspect the target before retrying.

Account changes and another deployment are blocked while a queue is being prepared or run. Keep the desktop running, the computer connected to power and the network available. Helper prevents automatic idle sleep during active work. Forced sleep, shutdown, lid-close policies and network interruption are outside that protection.

### Storage choices

- **Local folder:** exported ZIPs and notes use the selected folder and client layout. This is the simplest setup when cloud storage is unnecessary.
- **OneDrive for Business:** uses a separate Microsoft Graph consent connection for the same account. Initial consent or tenant policy can require interaction.
- **Predefined package library:** is separate from export storage. Its screen shows the actual configured folder and provides **Choose folder** and **Show folder**.

Local history and package definitions are not automatically shared with another computer. Never transfer token caches or private workflow addresses as part of a handover.

<!-- page -->

## 3 Install the PowerAppsHelper solution

Install the solution when you need environment outcome emails or dependency approval. Keep its shipped schema and publisher prefix **abhi**. Do not rename tables or connection references.

1. Open Power Apps in the intended setup environment and select **Solutions**.
2. Import the supplied PowerAppsHelper ZIP. The current development solution is **1.1.3.1**; check the version in the ZIP/import screen. Desktop and Dataverse solution versions are separate.
3. Bind every connection reference below to this organization's connections. Both Dataverse connections must operate in the setup environment. Select the appropriate Outlook, Approvals and Teams accounts.
4. Complete the import. Open **PowerApps Helper Setup** and arrange app access for administrators and users.
5. In Power Automate, open the solution's outcome, dependency approval and Teams update flows. Resolve connection warnings. Configure the profile on the next page before enabling production delivery.

### Connection references

| Purpose and connector | Shipped reference |
| --- | --- |
| Outcome reporting using Dataverse | abhi_sharedcommondataserviceforapps_2abc7 |
| Outcome emails using Office 365 Outlook | abhi_sharedoffice365_0e041 |
| Approval evidence using Dataverse | abhi_sharedcommondataserviceforapps_5ab79 |
| Approval requests using Approvals | abhi_sharedapprovals_3625b |
| Reminders and updates using Teams | abhi_sharedteams_64386 |

The outcome and approval Dataverse event triggers must use **Added / Organization / Flow owner**. Deployment Events is an organization-owned table; the row-owner trigger setting is unsuitable.

### What an exported solution does not configure

The ZIP does not transfer notification profiles, recipients, user role assignments, signed webhook addresses or authenticated connector sessions. The receiving organization supplies these values. Flow connection accounts also need access to the recipients, Teams destinations and tables used by their actions.

Use the complete solution export for installation. The repository's flow and form generators alone do not recreate every table, app and role component. Importing the solution does not automatically monitor deployments performed by unrelated tools; the flows consume events published by PowerApps Helper.

<!-- page -->

## 4 Configure the notification profile and permissions

### Create one matching profile

1. Open **PowerApps Helper Setup → Notification Profiles**. Create or edit one profile with the key **default**, or choose a different key and use the same value in the desktop.
2. Enter a name, success email recipients, failure email recipients and dependency approvers. Separate multiple email addresses with semicolons. Progress recipients in Teams are configured separately.
3. Choose **First response** when one selected approver can decide; the first rejection stops repair. Choose **Every approver must approve** when all selected approvers must agree.
4. Set the approval timeout and message introductions. This approval timeout is independent of the solution import wait limit.
5. Configure the approval flow account below, enable the profile and save. Ensure there is exactly one profile matching the desktop's key.

### Verify the approval flow account

1. In Power Automate Connections, open the Microsoft Dataverse connection actually used by the dependency approval flow. Confirm its signed-in account.
2. Select that active Dataverse user in the profile's **Approval flow account** lookup.
3. Wait for the account validation. Helper fills the read-only **Trusted Approval Flow User ID**. Save the profile.
4. Recheck this selection whenever the connection account changes. The selected account can differ from the desktop user or the flow owner.

The account picker validates the selected user; it does not discover which connection account the flow uses. Do not select the current user merely because that user is administering setup.

### Review effective access

Use separate deployment and approval automation identities. Deployment users need to create/read deployment events and read profiles and decisions. They must not modify saved approval evidence or create/modify approval decisions. Setup administrators manage profiles. The trusted automation account writes decisions and delivery information.

Apply these restrictions through effective Dataverse permissions, considering all assigned roles. Read-only forms do not enforce server permissions. Existing role names alone do not prove the required restrictions; have the organization's administrator review access before enabling approved repairs. Deployment users also need appropriate source/target solution permissions and access to the relevant target System Jobs.

Enable the configured flows and inspect their run history during the handover checks. A successful desktop configuration check does not prove that an email or approval has been delivered.

<!-- page -->

## 5 Connect the desktop to the setup

Open **Settings → Emails & approval**, enable **Enable environment reports & dependency approval**, and enter the matching profile key, normally **default**.

### Choose where events are stored

| Arrangement | Desktop settings and environment requirements |
| --- | --- |
| Central approvals and outcome emails | Select **Fixed setup environment** and enter its URL. Install/configure the solution there. |
| Central approvals with outcome emails in each target | Select **Deployment target (automatic)** and enter the central approval setup URL. Configure approval centrally and outcome reporting in every target. |
| Each target handles approvals and outcomes | Select **Deployment target (automatic)** and leave the approval URL blank. Install/configure the setup in every target. |

Standard environment URLs and Dataverse API environment URLs are supported. Copy the actual environment address from your organization's Power Platform setup. Source and target information in messages comes from the deployment; the setup URL identifies the location of event/approval evidence.

### Save and check

1. Select **Save** before checking the connection. The check uses saved settings.
2. Select **Check saved setup**. Resolve missing table access, a missing/disabled profile, missing approvers or an unverified trusted flow account.
3. Use **Open PowerApps Helper Setup** when the check exposes its link. For automatic target setup, review the displayed requirements and confirm configuration in the target you will use.
4. If previous outcome reports are pending, use **Retry pending reports** after correcting the connection. Reports keep their original destination and account.

The check confirms configuration and table access. Flow activation, connector licensing and actual delivery require a real flow run. An email or Teams delivery failure is separate from the import result; inspect the target/history before repeating a successful import.

### Approved dependency repair

The agent proposes exact existing source components after a target import reports missing dependencies. Approval messages show numbered headings, solution/source/target details, component bullets, ordered next steps and dependency diagnostics in a code block. Full plan data and its hash remain in the Deployment Event.

Approvers respond through the matching Microsoft Approvals request. Teams chat replies do not authorize changes. Rejection, expiry or invalid/changed evidence stops repair. After valid approval, the agent adds only the approved components, publishes, re-exports and retries. Tables are added without their subcomponents; required components are not automatically added. Already-applied source changes are not automatically rolled back.

<!-- page -->

## 6 Deploy solutions and create predefined packages

### Single or multiple solutions

Choose **From source environment** to select unmanaged source solutions and an export type, or **Deploy existing package (.zip)** to select solution ZIP files. Choose **Single solution** or **Multiple solutions**. For multiple solutions, use **Up/Down** to put prerequisite solutions first. Review the displayed versions, types and target before starting.

The queue imports one solution at a time. The next solution starts only after the current import succeeds and the separate background installation check clears. A failure stops the queue and leaves later solutions unstarted. A multiple-solution deployment appears as one entry in **History**; open it to see the ordered solutions and each solution's individual details.

### Save a named package such as PREXA

1. Select source solutions or existing ZIPs and arrange their order.
2. Enter the package name and optional description. Select **Save package**. A target environment is not required for saving.
3. Open **Predefined packages** and choose the saved package. Review its loaded solutions and order.
4. Select a target and review/export the queue as offered by the selected route. Confirm the queue before importing.
5. Use **Edit package** to change entries or order, then **Save changes**. **Save as new package** creates a separate definition.

Helper remembers your chosen order; it does not calculate dependency order. No real PREXA package is preloaded. Select its actual solutions and order when creating it.

### Understand what is saved

| Package source | Saved definition and later behavior |
| --- | --- |
| Source environment | Stores source URL, solution names, order and export type. Loading resolves current source versions. It is a recipe for future exports. |
| Existing ZIP files | Stores absolute paths, original names/versions/types, order and SHA-256 fingerprints. Loading verifies those exact files. ZIPs are not copied into the definition. |

Existing ZIPs support three- or four-part numeric versions. Source export version selection retains its four-part requirement. Changed or missing ZIPs require reselection and saving; renaming a file or moving it breaks its saved path.

The default library is **<Electron userData>/powerapps-helper/packages**. The screen shows the actual path. To move packages to another computer, copy definitions and provide accessible ZIP paths or reselect the files. Source packages require source access for the receiving account. Local definitions and history are not an organization-wide cloud library. Keep exported ZIPs when you need a reproducible historical release.

<!-- page -->

## 7 Import wait limits and timeout recovery

Desktop 0.1.6 increases the time allowed to monitor each import. These limits apply to single imports and queue items; each item receives its own budget.

| Operation | Maximum wait |
| --- | --- |
| Unmanaged import or first managed installation | **1 hour per import** |
| Managed ZIP whose unique name already exists as a managed solution in the target | **3 hours per import** |
| Detected Microsoft background installation or bounded status recovery | **15 minutes per separate wait**, normally checking every 10 seconds |

The desktop inspects the exact ZIP submitted and checks target solution metadata to select the managed-update limit. An existing unmanaged target solution does not select the three-hour policy. Inaccessible or ambiguous target metadata stops verification rather than choosing a longer limit without evidence.

### Managed updates and upgrades

The three-hour window covers Helper's existing import route for managed solutions already installed in the target. Helper currently calls **ImportSolutionAsync**, with **ImportSolution** fallback. It does not offer a separate stage-and-apply-upgrade operation. Importing an updated managed package must not be interpreted as automatically applying a staged upgrade or deleting removed components. Follow your organization's upgrade procedure when those operations are needed.

### Microsoft background installation

The import budget is separate from pre-import and post-import readiness waits. A 40–50 minute normal import can complete within the one-hour limit. The 15-minute timer starts when blocking background work or recoverable unavailable status is detected; Helper's own import duration does not consume that timer.

Readiness observes system-job categories for Ribbon Client Metadata, Import Solution Metadata and installation after app updates. These categories do not prove an individual solution's publisher or expose every Microsoft operation. Explicit concurrent-operation rejection is also handled with a bounded wait before retrying that rejected submission. Helper requires two clear post-import checks separated by 10 seconds before advancing.

### If the limit is reached

1. Read the failure phase and import job details in History. A local timeout does not cancel a server import; Microsoft may still be processing it.
2. Inspect the target solution history and **System Jobs** using the recorded job identifiers. Confirm the actual outcome and version before retrying.
3. If the import succeeded but background readiness failed, avoid importing it again merely because the queue stopped.
4. After the target is ready, select only solutions that still need deployment. Completed solutions are not rolled back. Queue restart/resume is not automatic.

Actual import failures and invalid authentication still stop immediately; the longer window does not retry failed accepted jobs.

<!-- page -->

## 8 Optional integrations and troubleshooting

### Teams progress updates

In **Settings → Teams**, configure your own Teams workflow if you need progress messages. After importing the solution, bind its Teams connection and enable the update flow. Obtain the generated signed webhook URL for that installation; the flow editor address is not the webhook.

Where permitted, configure the trigger's signed-webhook mode and paste the address into Helper. Treat it as a credential: whoever holds it can invoke the workflow using its connection account. Do not put it in screenshots, release files or shared documents. Helper stores it encrypted locally.

Select the workflow bot option and the destinations chosen in Helper. Add authorized people, group chats or channels, choose events/interval, enable and save. The flow account needs destination access. Check actual delivery in Teams and flow run history. Direct **Send as me** uses a separate Microsoft connection and may require tenant consent.

### Other optional settings

- AI deployment notes require the chosen provider's API key in Settings. Azure AI Foundry also requires its endpoint and model/deployment name. A Codex/ChatGPT sign-in does not supply an API key. Review deployment information before sending it to a provider.
- Azure DevOps work item retrieval requires the organization URL and a token with the documented Work Items read scope. Keep it in the encrypted credential settings.
- OneDrive requires its separate Graph consent. Git commits require an installed Git client and an accessible local repository.

### Identify common problems

| Symptom | Where to check and action |
| --- | --- |
| Environment missing or access denied | Confirm signed-in account, tenant access and source/target permissions. Tenant consent policies may require administrator action. |
| Setup check fails | Confirm destination URL, solution installation, table access and exactly one enabled matching profile. |
| Approval rejected as untrusted | Verify the approval flow's actual Dataverse connection account and the profile's account selection. Check the matching approval/event evidence. |
| No email or Teams message | Inspect flow activation, run history, connector accounts, recipients/destinations and pending reports. Do not assume import failed. |
| Package cannot save or load | Read the affected row's error. Check name, selected entries, supported versions, file access and unchanged ZIP fingerprint; reselect changed files. |
| Import or installation timeout | Inspect target solution history/System Jobs and the recorded import phase before retrying. See section 7. |

<!-- page -->

## 9 Handover release and recovery

### Check before rollout

Use a non-production source/target and synthetic data. Have the receiving administrator and a deployment user confirm:

- Desktop installation/update, sign-in, source export and target import.
- Sequential order, grouped history and individual failure/skipped details.
- Saving/loading/editing a package, and handling changed or inaccessible ZIPs.
- Successful and failed outcome reporting through the configured environment.
- Approved, rejected and expired dependency requests; only the approved component plan is applied.
- Microsoft background installation waits and long-import monitoring with valid target permissions.
- Optional Teams delivery, unavailable connections and reconnect behavior.

These are handover checks to perform; they are not claims that this release has completed them.

### Release contents and publication

Desktop **0.1.6** includes the queue, package, history, notification changes and new import limits. The bundle contains the Windows x64 installer, setup guide, release notes, checksums and inspection records. Its manifest identifies the included solution exports. Older cloud exports may lack the latest approval formatting.

The local installer is unsigned. The release workflow builds other platforms and publishes automatically on a push to **main**. Include all intended source changes and both version files in the reviewed commit; ignored local release files are not pushed automatically.

Independent non-author review and a second qualified reviewer for the security-sensitive approval/Teams integration remain required before public rollout. Build success does not supply those approvals.

### Recover from an interrupted deployment or update

1. Inspect the target before retrying an interrupted import. Local app exit or timeout does not cancel a Microsoft job.
2. Use individual History details to determine completed and unstarted solutions. There is no automatic queue resume or rollback.
3. For a desktop update problem, close Helper and use the retained installer/private app-data backup under the organization's recovery procedure. Recovery on another computer needs verification.
4. To stop new automation requests, disable desktop automation and the relevant profile/flows. Already-started actions may finish.
5. A solution ZIP backup does not restore notification rows, credentials or connections. Back up environment configuration separately and use the organization's tested Dataverse recovery procedure. Removing a managed solution can remove components/data; do not use uninstall as a generic rollback.

### Evidence and limits of this candidate

Renderer build and JavaScript syntax checks passed. Inspection records report completed installer, source and document checks. Tests, live long imports, installation on another computer and managed downstream recovery have not been run for this change. Changed-code coverage is not certified; no verified lint or solution-checker command is available.

The referenced full coding standard is absent from this checkout (D01). Release review and host/recovery evidence remain open adoption inputs; no exception or failed check is waived by this guide.
