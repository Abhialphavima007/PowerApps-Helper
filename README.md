# PowerApps Helper

A cross-platform (Windows, macOS, and Linux) desktop app for deploying Microsoft Power Platform / Dataverse **solutions** from one environment to another — with dependency review, versioning, local deployment tracking, git integration, and **AI-generated deployment notes**.

[Download the latest GitHub release](https://github.com/Abhialphavima007/PowerApps-Helper/releases/latest) for Windows, macOS, or Linux.

**Sign in with your Microsoft work account — no Azure app registration required for standard deployment.** The app uses a Microsoft first-party **public client** (the same one Microsoft CLIs use) with browser or device-code sign-in, then talks to the **Dataverse Web API directly**. Access tokens are cached locally using the existing OS-backed cache when encryption is available, and deployment history stays on your machine. Tenant consent and access policies apply. Approved dependency repairs use the same Dataverse sign-in; a separate Helper Dataverse MCP connection is no longer required.

---

## What it does

- **Sign in** with Microsoft credentials (MFA supported) — choose browser or device code. No app registration is needed when your tenant permits the default public client.
- **Multiple accounts** — connect several work accounts, switch the active one, and the environment list follows the active account.
- **Light and Dark mode** — switch instantly using the sun/moon button in the sidebar or **Settings → Appearance**. Your choice is remembered on this computer.
- **List your environments** automatically via the Global Discovery Service.
- Pick a **source** and **target** environment and an **unmanaged source solution**; export it as a managed or unmanaged package.
- Choose **Single solution** or **Multiple solutions**, select source solutions or ZIPs, and arrange the multiple-solution queue with Up/Down controls. Imports run one at a time using the signed-in Microsoft account. Each selected solution's import is tracked separately. Detected Microsoft background solution/ribbon installation is checked every 10 seconds for up to 15 minutes per wait; an import or installation failure stops the queue. See [queue behavior and validation](docs/solution-deployment-queue.md).
- **Bump the version** before export (auto-suggested).
- **Predefined packages** — save a named source selection or existing solution ZIPs and their import order (for example, PREXA) in a local library. Selecting it later loads current source solutions or the saved ZIP locations in order for review and sequential deployment. Save ZIP selections from **Deploy existing package (.zip)**. ZIPs remain in place; missing or changed files require reselection. Choose the library folder from the third deployment option; other computers need the definitions and access to any referenced ZIPs. See [local package workflow and storage](docs/predefined-packages.md).
- **Describe what's changing** + link **Azure DevOps work items** — load user stories, child tasks, descriptions, acceptance criteria, and comments; use AI to draft an editable change summary.
- **Export & analyze** the solution: **content summary**, **root components**, and package dependency declarations. You can review these before importing.
- **Store exported solutions and deployment notes** to **OneDrive** (for Business, same account) or a **local folder**, organized as `Base folder / Client / Source to Target / Solution / export files`. Choose the storage location and client name in **Settings**.
- **Deployment notes** — the earlier change summary carries into the Review step as editable notes. You can optionally generate a structured Power Platform Pipelines-style version with a local template or **Azure AI Foundry, OpenAI, Claude, Grok, or Gemini**.
- **Import to the target** with a **live progress bar** (real percentage from the import job), then publish for unmanaged solutions.
- **Deploy with agent (optional)** — choose **Continue with agent** in Configure to reach deployment before exporting, or export and review first. The agent exports if needed, imports into the target, and reacts only to dependencies reported by a failed target import. It captures the import error and import-job log at failure time, adds identifiable components to the selected unmanaged source solution, publishes source customizations once per repair cycle, re-exports, and retries up to five repair cycles. It retains the selected environments, Azure DevOps stories, description, and notes. Each repair method and import attempt is recorded in history.
- **Deployment notifications** — the app requests a native notification with the system sound when export or import stops, when agent deployment stops, and when deployment finishes or needs attention. A dismissible in-app alert also appears if native notifications are unsupported or disabled.
- **Teams deployment connector** — configure up to 20 people, an existing group chat link, a channel link, progress gap (default 5 minutes) and events in **Settings**. Use any combination, including group/channel-only delivery. The recommended workflow sends cards with solution type/version, source → target and current stage; selected completion/failure skip the progress gap. Optional Codex MCP supplies observed progress to Helper's background sender while the app is open. The flow in **Abhinav Research** is on with destination routing, its existing signed trigger and bound Teams connection. Restart Helper, select Helper destinations, keep the saved webhook and paste links copied from Teams. The workflow account needs destination access; private-channel cards are unsupported. Cloud delivery still needs confirmation in run history and Teams. Optional Send as me remains subject to tenant consent. See [workflow setup](platform/teams-workflow.md) and [limits and validation](docs/teams-deployment-connector.md).
- **Deployment emails and dependency approval** — optional Dataverse reporting defaults to each deployment's target. Source repairs require authenticated approval of the exact component plan. Requests list component names and friendly types before the dependency error. Recipients, wording, mode and timeout are editable in **PowerApps Helper Setup**. Select the verified approval flow Dataverse account by name to fill its trusted ID. The Abhinav Research approval flow and default profile are enabled. See [setup and current state](platform/README.md).
- **Automatic sleep protection** — Helper keeps the computer awake during export, import and the complete agent run, including approval waits. The display can turn off. Keep Helper running; forced sleep, hibernation, shutdown and network loss cannot be prevented by this feature.
- **Track history** — each multiple-solution queue appears as one deployment. Open it to see the ordered solutions and each solution's full details, including failures and skipped imports. Filter by day, week, month, route, status, or solution; browse 10, 25 (default), 50 or 100 rows per page. A solution match selects its whole queue; CSV/JSON export includes individual records and Delete filtered includes every matching page. See [queue history behavior](docs/grouped-deployment-history.md).
- **Git (optional)** — commit the exported `.zip` + notes to a local repo.

## Settings & storage

Choose **Light mode** or **Dark mode** under **Settings → Appearance**, or use the sidebar sun/moon button even before signing in. Dark is the default for existing and new installations. Switching applies immediately without restarting or clearing your deployment draft. A failed preference save restores the previous mode and shows an alert.

Both modes use an Apple-inspired glass appearance with frosted panels, rounded controls, and soft shadows. Light uses a blue/mint canvas; Dark uses a deep blue/teal canvas. Content width, spacing, and responsive arrangement are shared, so switching themes preserves the layout. Surfaces become opaque when backdrop filtering is unavailable or reduced transparency is requested.

Open the **Settings** tab to choose where exported solutions land:

- **Client name** — fills automatically from the signed-in tenant and is used as the first folder below the selected base. You can edit it; edits are saved separately for each tenant. Clear the field to restore the automatic name. If Microsoft tenant details cannot be read silently, the organization domain is used (or the tenant ID for guest accounts). The setting applies to future exports; existing files and history are not moved. See [tenant client-name notes](docs/tenant-client-name.md).
- **OneDrive for Business** — uploaded via Microsoft Graph for the *same* signed-in account. Because Microsoft doesn't let the Azure CLI client call Graph, OneDrive uses a separate Graph-capable public client (the **Microsoft Graph CLI** client, `14d82eec-…`). The first **Connect OneDrive** triggers a quick sign-in/consent for that client (still no app registration). Override with `AZURE_GRAPH_CLIENT_ID` if needed.
- **Local folder** — pick any folder; solutions are written in the same structured layout for easy tracking.
- **AI credentials** — save API keys for OpenAI, Claude, Grok, Gemini, and Azure AI Foundry in the encrypted local credential store. Saved keys remain masked; revealing one requires Windows Hello and it hides again after 30 seconds. Azure AI Foundry also needs a model inference endpoint and model or deployment name. A Codex or ChatGPT sign-in does not supply an OpenAI API key.
- **Azure DevOps** — enter the organization URL and a Personal Access Token with **Work Items: Read** scope. Preview one or more comma-separated stories in Settings. In a deployment, enter comma-separated IDs, `AB#` references, or work item URLs; the app fetches each item, its full child tree, related items, descriptions, acceptance criteria, status dates, and comments with progress shown for large trees. The AI summary button processes large sets in parts and writes a plain-English problem, task journey, and outcome for each story. Review it in the full-screen view or edit the change description before deployment. Work item details are sent to the chosen AI provider only when requesting AI output.

The manual import path remains available. Package dependency declarations are advisory and never trigger agent source repairs. The agent only makes a repair after a failed target import identifies a missing component. If the target error omits its GUID, the agent uses one exact type-and-schema match from the package or source environment. A missing table already exported as a shell can be added; before another import, the agent checks that the re-export contains the table beyond a shell. It stops on missing or ambiguous diagnostics, repeated failures, inaccessible source solutions, or unsupported component types. If export itself fails, there is no package to import, so the agent stops and reports that export error.

Each source export, including agent repair re-exports, gets a distinct ZIP file even when the version is unchanged. Deployment notes are also saved beside the final stored ZIP after the deployment is recorded. Staging copies remain in app data for imports and optional Git commits. Storage failures are reported; the staging copy remains available. Packages selected from disk are not moved. History CSV/JSON exports still use the location selected in the save dialog.

Predefined package definitions use a separate library, defaulting to `app.getPath('userData')/powerapps-helper/packages`. The **Predefined packages** screen displays the actual folder and offers **Choose folder** and **Show folder**. Definitions remember the source, solution names, order and type; ZIPs are exported when reviewing or deploying. They use current source versions when loaded and do not automatically increment them. Package deployments appear once in History under the package name, with individual solution details inside.

### Deployment emails and approval setup

In **Settings → Emails & approval**, new settings use **Deployment target (automatic)** for success/failure reports. The target is captured at deployment start; changing the next deployment's target does not move queued reports. PowerApps Helper Setup, a configured profile and the active outcome flow must exist in each reporting target. Progress updates use the separate Teams connector.

You can select a fixed reporting environment or supply a separate approval setup environment while reports follow the target. Leave the approval URL blank to use the target for both. Older saved destinations are preserved; saved MCP repair settings migrate to the existing API sign-in. Save before checking setup or retrying pending reports. With no saved approval URL, Check saved setup explains the target prerequisites. The local outbox retries while Helper runs using the original Microsoft account. Email delivery failures are separate from import results.

In **PowerApps Helper Setup**, edit recipients, dependency approvers, wording, mode and timeout. Approvers are separate from Teams progress recipients. **First response** lets one selected member approve; a first rejection stops repair. Select **Approval flow account** using the actual Dataverse connection account verified in Power Automate Connections. Helper validates that user and fills the read-only trusted ID; existing IDs are preserved. Teams reminders identify the matching Microsoft approval request. Respond through Microsoft Approvals; chat replies cannot approve changes. New installations require their own connections and enabled profile. See the [complete setup guide](docs/setup-guide.md) and [Word guide](docs/PowerApps-Helper-Setup-Guide.docx).

When an import reports missing dependencies, the agent sends the exact proposed source additions for approval and waits. Rejection, expiry, missing evidence or changed setup blocks repair. Manual imports remain available. Approved additions are recorded in history; partially completed additions are not automatically rolled back. These flows receive events from the updated PowerApps Helper desktop; other deployment tools need their own event publisher. See [deployment automation details](platform/README.md).

### Agent deployment and optional Codex MCP

Approved source additions, publication, export and import use Helper's existing authenticated Dataverse API. The desktop no longer opens a separate Dataverse MCP connection or exposes a repair-transport selector. Exact-plan approval checks remain required before source changes. Tenant sign-in policies and source customization permissions still apply.

The optional Codex connector for observed deployment updates is independent and remains available. Compatibility modules retain their public MCP contracts for existing callers; they are not initialized by the desktop repair path.

---

## Why no app registration / low lag

- **No app registration for standard deployment:** sign-in uses a Microsoft first-party *public* client ID with no secret, subject to tenant policy. Separate Dataverse MCP consent is not required for desktop repairs.
- **Low lag:** browsing, export and import go straight to the **Dataverse Web API** over HTTPS with a cached bearer token — there is no `pac` subprocess in the hot path. After the first sign-in, tokens refresh silently.
- **Local where it matters:** the encrypted token cache, exported solution artifacts, deployment notes and history all live in your OS app-data folder.

If your tenant's conditional-access policy blocks the default public client, set your own `AZURE_CLIENT_ID` (a public client with delegated Dataverse permission) in `.env`.

---

## Prerequisites

1. **Node.js 18+** (for development / building).
2. A **Microsoft work/school account** with access to one or more Power Platform environments.
3. **git** on your PATH (only for the optional git-commit feature).
4. An **AI API key** (optional): OpenAI, Anthropic Claude, xAI Grok, Google Gemini, or Azure AI Foundry. Configure it in Settings or `.env`.

The desktop installer bundles the runtime and libraries required by the app. `pac`, the .NET SDK, and Node.js are not required on users' computers. Optional git commits require git to be installed separately.

---

## Setup

```bash
npm install
cp .env.example .env      # add your AI key(s); Microsoft sign-in needs no config
```

`.env` keys:

| Key | Purpose |
|-----|---------|
| `GEMINI_API_KEY` | Google Gemini API key |
| `GROK_API_KEY` | xAI Grok API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Claude API key |
| `AZURE_FOUNDRY_API_KEY` | Azure AI Foundry model API key |
| `AZURE_FOUNDRY_ENDPOINT` | Azure AI Foundry model inference endpoint |
| `AZURE_FOUNDRY_MODEL` | Azure AI Foundry model or deployment name |
| `AI_PROVIDER` | Default provider: `openai`, `claude`, `gemini`, `grok`, `foundry`, or `template` |
| `AZURE_CLIENT_ID` | Optional public client ID override |
| `AZURE_AUTHORITY` | Optional authority override |

---

Desktop agent deployments use the existing Dataverse API connection. Legacy Dataverse MCP environment variables do not enable a desktop repair connection.

## Run (development)

```bash
npm run dev
```

Starts Vite and launches Electron. Click **Sign in with Microsoft** for browser sign-in, or **Sign in with device code**. For device code, copy the code shown in the app, click **Open Microsoft sign-in**, enter the code, and complete authentication. Your environments load automatically after sign-in.

In **Accounts**, **Use device code** connects an account with that method. For an already connected account, set **Sign-in method → Device code** in the active account card. The app remembers the method per account and uses it when Dataverse, OneDrive, or an enabled deployment MCP connection next requires sign-in. Cached tokens continue to refresh silently. Sign-in prompts can be cancelled and time out after five minutes.

If Microsoft shows **Request sent** or **Need admin approval**, an administrator must approve the client application. Changing to device code cannot bypass that requirement. The installed laptop Dataverse MCP server and this app's environment-hosted MCP connection may use different app registrations; a successful sign-in to one does not establish consent for the other. See [device-code implementation notes](docs/device-code-login.md) for build evidence and remaining checks.

## Build a distributable

```bash
npm run package        # current OS
npm run package:win    # Windows installer
npm run package:mac    # macOS .dmg
npm run package:linux  # Linux AppImage
```

Output goes to `release/`.

For a renderer build without packaging, run `npm run build:renderer`. For changed Electron JavaScript, `node --check <file>` checks syntax; `git diff --check` checks patch whitespace. These checks do not verify deployment, OneDrive, or the desktop UI.

### Theme checks

Verified on Windows with the installed dependencies:

```bash
npm run build:renderer
node --test --experimental-test-coverage tests/theme.test.cjs
npx --no-install electron tests/theme.ui.cjs
```

The Electron check uses the built renderer, synthetic accounts, and temporary settings without cloud calls. It checks switching, persistence, failure recovery, keyboard controls, retained deployment drafts, and sampled text contrast in both palettes. See [theme validation notes](docs/light-dark-theme.md) for evidence and remaining checks.

## Automated releases (GitHub Actions)

The current release candidate is **0.1.5**. See [release notes and local build evidence](docs/releases/0.1.5.md). Public publication remains subject to the required independent/security review and release checks.

Every push to `main` starts `.github/workflows/release.yml`. It builds Windows
installers (`.exe`), macOS disk images (`.dmg`), and Linux AppImages for x64 and
ARM64, then publishes a GitHub Release with all successful builds together.
Commit and push to the main branch to publish the next release; a local commit
alone does not start GitHub Actions.
The release tag is `v<package version>+build.<workflow run number>`, so code-only
pushes also get a new downloadable release. Bump the version in `package.json`
and `package-lock.json` when the app version changes. You can also start a build
manually from the repo's **Actions** tab. No extra secret is needed; the workflow
uses `GITHUB_TOKEN`. macOS builds are unsigned (no certificate configured).

---

## How a deployment works (behind the scenes)

1. `PATCH solutions(id)` — sets the new version in the source (if you changed it).
2. `ExportSolution` action — downloads the solution as base64, written to the local artifacts folder as a `.zip`.
3. The `.zip` is inspected locally (`solution.xml` / `customizations.xml`) to build the **dependency** and **content** views.
4. The change description carries into editable **deployment notes** on the Review screen, or directly onto the deployment screen when using the pre-export agent path. You can optionally generate formatted notes from the package analysis and fetched Azure DevOps details on Review; the local template needs no AI key.
5. `ImportSolutionAsync` — imports into the **target**, polling the async operation for progress; `PublishAllXml` runs afterward for unmanaged solutions.
6. The deployment (metadata + notes + dependencies + work item snapshot + artifact path) is written to a local JSON store; notes are also saved as `.md`. Optionally committed to git.

Artifacts, notes, history and the encrypted token cache live under your OS app-data folder in `powerapps-helper/`.

---

## Project structure

```
electron/
  main.js              Electron main process + IPC orchestration
  preload.js           Secure bridge (contextIsolation)
  services/
    auth.js            Microsoft sign-in — multi-account, browser/device code, token cache
    dataverse.js       Dataverse Web API: discovery, export, async import (w/ progress), publish
    dataverseMcp.js    Direct connection to Microsoft's environment MCP endpoint
    deploymentAgent.js Bounded import, dependency repair, re-export, and retry workflow
    graph.js           OneDrive upload via Microsoft Graph (chunked upload session)
    solutionZip.js     Parses exported .zip for deps + content summary
    store.js           Local JSON history store + settings
    credentials.js     Encrypted API keys and Azure DevOps token
    azureDevOps.js     Work item tree and comments
    ai.js              AI summaries and pipeline-style deployment notes
    git.js             Optional local git integration
src/
  App.jsx              Layout, multi-account state, persistent Deploy tab
  views/
    DeployView.jsx     3-step deploy wizard with live progress bar
    HistoryView.jsx    Filter, export, and delete deployment history
    AccountView.jsx    Connect/switch/remove accounts, environments
    SettingsView.jsx   Storage, AI credentials, and Azure DevOps setup
index.html, vite.config.js, package.json
```

---

## Notes & limits

- First sign-in uses your chosen browser or device-code method; afterward tokens refresh silently.
- Very large solution imports run asynchronously with polling (15-min ceiling).
- Managed vs unmanaged export is your choice per deployment.
- Microsoft handles MFA and conditional access for either method. Some tenants block device-code authentication.

## Desktop release 0.1.6

Normal imports can wait up to one hour. A managed ZIP updating an existing managed target solution receives up to three hours through the existing import route. Microsoft background installation checks retain their separate 15-minute limit. See [release notes](docs/releases/0.1.6.md) and the [setup guide](docs/setup-guide.md).
