# PowerApps Helper

A cross-platform (Windows + macOS) desktop app for deploying Microsoft Power Platform / Dataverse **solutions** from one environment to another — with dependency review, versioning, local deployment tracking, git integration, and **AI-generated deployment notes**.

**Sign in with your Microsoft work account — no Azure app registration required.** The app uses a Microsoft first-party **public client** (the same one Microsoft CLIs use) with an interactive loopback sign-in, then talks to the **Dataverse Web API directly** for fast, low-lag cloud calls. Access tokens are cached **locally and encrypted**, and all deployment history stays on your machine.

---

## What it does

- **Sign in** with Microsoft credentials (MFA supported) — one click, no app registration.
- **Multiple accounts** — connect several work accounts, switch the active one, and the environment list follows the active account.
- **List your environments** automatically via the Global Discovery Service.
- Pick a **source** and **target** environment and a **solution**.
- **Bump the version** before export (auto-suggested).
- **Describe what's changing** + link **work items** — feeds the deployment notes.
- **Export & analyze** the solution: **content summary**, **root components**, and **dependencies** (the "missing dependencies" you'd see importing through the portal). Shown *before* it moves to the next environment.
- **Store the exported solution** to **OneDrive** (for Business, same account) or a **local folder**, organized as `Account / Source → Target / Solution / version.zip`. Chosen in **Settings**.
- **Deployment notes** in **Power Platform Pipelines style** — a structured template (Overview, Changes, Components, Dependencies, Work items, Steps, Verification, Rollback) that works with **no API key**, optionally polished by **Gemini** or **Grok**. Fully editable.
- **Import to the target** with a **live progress bar** (real percentage from the import job), then publish for unmanaged solutions.
- **Track history** — every deployment saved locally with notes, dependencies, stored-artifact link, account and status.
- **Git (optional)** — commit the exported `.zip` + notes to a local repo.

## Settings & storage

Open the **Settings** tab to choose where exported solutions land:

- **OneDrive for Business** — uploaded via Microsoft Graph for the *same* signed-in account. Because Microsoft doesn't let the Azure CLI client call Graph, OneDrive uses a separate Graph-capable public client (the **Microsoft Graph CLI** client, `14d82eec-…`). The first **Connect OneDrive** triggers a quick sign-in/consent for that client (still no app registration). Override with `AZURE_GRAPH_CLIENT_ID` if needed.
- **Local folder** — pick any folder; solutions are written in the same structured layout for easy tracking.

> Import proceeds with the standard import behavior — it does not block on missing dependencies. Dependencies are surfaced for **review** when moving between environments, as intended.

---

## Why no app registration / low lag

- **No app registration:** sign-in uses a Microsoft first-party *public* client ID (no secret, no tenant setup). Anyone with access to an environment can sign in.
- **Low lag:** browsing, export and import go straight to the **Dataverse Web API** over HTTPS with a cached bearer token — there is no `pac` subprocess in the hot path. After the first sign-in, tokens refresh silently.
- **Local where it matters:** the encrypted token cache, exported solution artifacts, deployment notes and history all live in your OS app-data folder.

If your tenant's conditional-access policy blocks the default public client, set your own `AZURE_CLIENT_ID` (a public client with delegated Dataverse permission) in `.env`.

---

## Prerequisites

1. **Node.js 18+** (for development / building).
2. A **Microsoft work/school account** with access to one or more Power Platform environments.
3. **git** on your PATH (only for the optional git-commit feature).
4. An **AI API key** (optional but recommended): Google **Gemini** and/or xAI **Grok**.

> `pac` CLI is **not required**. (A legacy `pac`-based service remains in the source but is no longer used by the app.)

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
| `AI_PROVIDER` | Default provider: `gemini` or `grok` |
| `AZURE_CLIENT_ID` | Optional public client ID override |
| `AZURE_AUTHORITY` | Optional authority override |

---

## Run (development)

```bash
npm run dev
```

Starts Vite and launches Electron. Click **Sign in with Microsoft**, complete the browser sign-in, and your environments load automatically.

## Build a distributable

```bash
npm run package        # current OS
npm run package:win    # Windows installer
npm run package:mac    # macOS .dmg
```

Output goes to `release/`.

## Automated releases (GitHub Actions)

`.github/workflows/release.yml` builds Windows + macOS installers and publishes a
GitHub Release automatically. To cut a release:

1. Bump `"version"` in `package.json` (e.g. `0.1.0` → `0.1.1`).
2. Commit and push to `main`.

The workflow detects the new version, builds on Windows and macOS runners, and
publishes a release **`v<version>`** with the installers attached. If a release
for that version already exists, it does nothing. You can also trigger it
manually from the repo's **Actions** tab. No secrets to configure — it uses the
built-in `GITHUB_TOKEN`. macOS builds are unsigned (no certificate required).

---

## How a deployment works (behind the scenes)

1. `PATCH solutions(id)` — sets the new version in the source (if you changed it).
2. `ExportSolution` action — downloads the solution as base64, written to the local artifacts folder as a `.zip`.
3. The `.zip` is inspected locally (`solution.xml` / `customizations.xml`) to build the **dependency** and **content** views.
4. Your description + the analysis are sent to **Gemini/Grok** to draft **deployment notes**.
5. `ImportSolutionAsync` — imports into the **target**, polling the async operation for progress; `PublishAllXml` runs afterward for unmanaged solutions.
6. The deployment (metadata + notes + dependencies + artifact path) is written to a local JSON store; notes are also saved as `.md`. Optionally committed to git.

Artifacts, notes, history and the encrypted token cache live under your OS app-data folder in `powerapps-helper/`.

---

## Project structure

```
electron/
  main.js              Electron main process + IPC orchestration
  preload.js           Secure bridge (contextIsolation)
  services/
    auth.js            Microsoft sign-in — multi-account, cancellable loopback, token cache
    dataverse.js       Dataverse Web API: discovery, export, async import (w/ progress), publish
    graph.js           OneDrive upload via Microsoft Graph (chunked upload session)
    solutionZip.js     Parses exported .zip for deps + content summary
    store.js           Local JSON history store + settings
    ai.js              Pipeline-style notes: deterministic template + Gemini/Grok polish
    git.js             Optional local git integration
    pac.js             (legacy, unused) Power Platform CLI wrapper
src/
  App.jsx              Layout, multi-account state, persistent Deploy tab
  views/
    DeployView.jsx     4-step deploy wizard with live progress bar
    HistoryView.jsx    Deployment history + detail
    AccountView.jsx    Connect/switch/remove accounts, environments
    SettingsView.jsx   Storage mode (OneDrive / local folder) + Connect OneDrive
index.html, vite.config.js, package.json
```

---

## Notes & limits

- First sign-in opens your browser; afterward tokens refresh silently.
- Very large solution imports run asynchronously with polling (15-min ceiling).
- Managed vs unmanaged export is your choice per deployment.
- MFA and conditional access are handled by the interactive browser sign-in.
