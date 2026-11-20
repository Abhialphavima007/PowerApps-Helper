# PowerApps Helper

A cross-platform (Windows, macOS, and Linux) desktop app for deploying Microsoft Power Platform / Dataverse **solutions** from one environment to another — with dependency review, versioning, local deployment tracking, git integration, and **AI-generated deployment notes**.

[Download the latest GitHub release](https://github.com/Abhialphavima007/PowerApps-Helper/releases/latest) for Windows, macOS, or Linux.

**Sign in with your Microsoft work account — no Azure app registration required for standard deployment.** The app uses a Microsoft first-party **public client** (the same one Microsoft CLIs use) with browser or device-code sign-in, then talks to the **Dataverse Web API directly** for fast, low-lag cloud calls. Access tokens are cached locally using the existing OS-backed cache when encryption is available, and all deployment history stays on your machine. Tenant consent and access policies apply to either sign-in method. Agent source repair uses the same authenticated Dataverse Web API by default; connecting to MCP is optional.

---

## What it does

- **Sign in** with Microsoft credentials (MFA supported) — choose browser or device code. No app registration is needed when your tenant permits the default public client.
- **Multiple accounts** — connect several work accounts, switch the active one, and the environment list follows the active account.
- **Light and Dark mode** — switch instantly using the sun/moon button in the sidebar or **Settings → Appearance**. Your choice is remembered on this computer.
- **List your environments** automatically via the Global Discovery Service.
- Pick a **source** and **target** environment and an **unmanaged source solution**; export it as a managed or unmanaged package.
- **Bump the version** before export (auto-suggested).
- **Describe what's changing** + link **Azure DevOps work items** — load user stories, child tasks, descriptions, acceptance criteria, and comments; use AI to draft an editable change summary.
- **Export & analyze** the solution: **content summary**, **root components**, and package dependency declarations. You can review these before importing.
- **Store exported solutions and deployment notes** to **OneDrive** (for Business, same account) or a **local folder**, organized as `Base folder / Client / Source to Target / Solution / export files`. Choose the storage location and client name in **Settings**.
- **Deployment notes** — the earlier change summary carries into the Review step as editable notes. You can optionally generate a structured Power Platform Pipelines-style version with a local template or **Azure AI Foundry, OpenAI, Claude, Grok, or Gemini**.
- **Import to the target** with a **live progress bar** (real percentage from the import job), then publish for unmanaged solutions.
- **Deploy with agent (optional)** — choose **Continue with agent** in Configure to reach deployment before exporting, or export and review first. The agent exports if needed, imports into the target, and reacts only to dependencies reported by a failed target import. It captures the import error and import-job log at failure time, adds identifiable components to the selected unmanaged source solution, publishes source customizations once per repair cycle, re-exports, and retries up to five repair cycles. It retains the selected environments, Azure DevOps stories, description, and notes. Each repair method and import attempt is recorded in history.
- **Deployment notifications** — the app requests a native notification with the system sound when export or import stops, when agent deployment stops, and when deployment finishes or needs attention. A dismissible in-app alert also appears if native notifications are unsupported or disabled.
- **Track history** — filter by day, week, month, route, status, or solution; export filtered records as CSV/JSON or delete history records.
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

### Agent deployment and Microsoft Dataverse MCP

Agent dependency repair uses the active account's **Dataverse Web API** token by default. This avoids requesting a separate MCP permission or triggering its admin-approval prompt. Tenant policies may still require approval for Dataverse access.

To opt into the environment-hosted MCP endpoint at https://{environment}.crm.dynamics.com/api/mcp, set `DATAVERSE_MCP_ENABLED=true`. [Microsoft's direct endpoint setup](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/data-platform-mcp-other-clients#connect-using-the-remote-endpoint) requires a custom Entra app with the Dynamics CRM `mcp.tools` permission. Set `DATAVERSE_MCP_CLIENT_ID` to that tenant-approved public client's ID, enable public-client authentication for device code (and a loopback redirect for browser sign-in), and enable its entry in the source environment's MCP allowed clients. Tenant consent and access policies still apply. The compatibility default is Dataverse CLI client ID `0c412cc3-0dd6-449b-987f-05b053db9457`, documented for the `@microsoft/dataverse` local proxy; Microsoft explicitly requires tenant administrator consent for that client. See [Microsoft's MCP environment setup](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/data-platform-mcp).

When MCP is enabled, the endpoint's invoke_api tool is used for AddSolutionComponent only when its advertised schema supports the action. If MCP cannot connect before any source change, the agent falls back to the authenticated Dataverse Web API. It does not switch methods after an MCP source action begins, because the outcome might be ambiguous. Tenant policies, permissions, and live MCP tool availability vary; a local build cannot verify them.

---

## Why no app registration / low lag

- **No app registration for standard deployment:** sign-in uses a Microsoft first-party *public* client ID with no secret. MCP is optional and requires tenant consent and source environment setup.
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

For agent deployments, set `DATAVERSE_MCP_ENABLED=true` to use MCP. `DATAVERSE_MCP_CLIENT_ID` selects its public client, which must be approved by your tenant and allowed by the source environment. Leave MCP disabled to use the existing Dataverse Web API access for source repair.

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

The next app version is **0.1.4**. See [release notes and local build evidence](docs/releases/0.1.4.md).

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
