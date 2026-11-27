# Local predefined packages

## Changelog — 27 November 2026

Package library service 1.1.3; deployment queue 1.0.6; history grouping 1.0.1. Desktop 0.1.6 packages these features in a local Windows release candidate. No dependencies, Dataverse tables or registrations were added. See [release notes](releases/0.1.6.md) and the [setup guide](setup-guide.md).

- **Existing ZIPs now support three- or four-part numeric versions**, including `1.0.67` and `1.0.67.0`, in single/multiple selection validation, saving, reading/loading/editing and queue preparation/execution. The original version is kept exactly as read from `solution.xml`; Helper does not append `.0`, rewrite, re-export or rename the ZIP. Source environment version selection/export retains its four-part requirement. Missing/malformed versions still identify the affected solution; file fingerprints and exact metadata/order checks remain enforced.

- Replaced the generic incomplete-entry hint with the solution's current queue position, name, missing details or actual unsupported version. Affected rows and the save section show the issue. Backend save and queue review also name the failing solution/version. Service 1.1.2 / queue 1.0.5 required four parts; service 1.1.3 / queue 1.0.6 extends existing ZIPs to three or four parts. Single-file saves show the same detailed validation before submission.

- Fixed **Save package** staying disabled for inspected ZIP entries without a picker fingerprint. A name and selected solution metadata enable saving without a target. Save calculates missing fingerprints from the same bytes it inspects and returns them to the draft; persisted definitions still require complete fingerprints. For an unchanged saved file reference, an omitted draft fingerprint falls back to its previously saved fingerprint, so editing cannot silently recapture a changed ZIP.
- Missing input guidance, save progress, success and errors appear beside the save controls. Active operations prevent duplicate saves. If an older picker omitted the fingerprint for a new entry, integrity tracking for that entry begins at save; name/version/type must still match the selection. Provided fingerprints remain mandatory to match.

- **Deploy existing package (.zip)** now offers **Save as a predefined package** for a single ZIP or multiple ordered ZIPs. Previously the save controls only appeared for source-environment selections.
- ZIP definitions use schema version 2 and store absolute file paths, solution names, versions, per-file managed/unmanaged types and SHA-256 fingerprints. ZIPs are neither copied nor exported when saving or loading.
- Loading, saving and queue preparation/execution check referenced files. The importer also verifies the exact submitted bytes after installation waits and on every submission retry. A moved, unreadable or changed ZIP stops the operation and requires reselection.
- ZIP definitions can be opened for editing even if files are missing. Remove/reselect affected entries before saving. Reordering accessible unchanged files does not require reselection.
- Existing schema version 1 source definitions and their canonical hashes retain their previous format and behavior.

- Save a named deployment definition from an unmanaged source solution selection, including its explicit import order and managed/unmanaged export type.
- The third deployment option, **Predefined packages**, lists definitions in the configured folder after sign-in. Selecting one loads all its current source solutions in the saved order.
- **Edit package** loads the definition into the appropriate source or ZIP editor. **Save changes** updates it; **Save as new package** creates a separate definition. Removing a definition leaves deployment history and solution ZIPs intact.
- A package deployment uses the existing sequential queue, account reuse, background installation waits and grouped history. History shows the package name and retains the definition used, even after the library definition is edited or removed.

## Create and use a package

1. Choose **From source environment** and select the source. Choose Single solution or Multiple solutions.
2. Select the unmanaged solutions. For multiple solutions, use Up/Down to put prerequisite solutions first. Order is chosen by the creator; Helper does not infer dependency order.
3. Choose Managed or Unmanaged. Enter a package name, such as PREXA, and optionally a description. Select **Save package**. A target environment is not required to save.
4. Choose **Predefined packages** and select the saved package. Helper reads the saved source environment with the active Microsoft account and loads its solutions in order. Review the displayed current versions.
5. Select the target, then **Export & review queue** or **Continue with agent**. Review before starting deployment.

Source definitions hold the source environment URL/name, solution unique/display names, order, export type, ID and timestamps. They hold no ZIPs, account credentials, target environment, runtime solution IDs, deployment notes or version edits. Saving a definition does not export or deploy anything. No real PREXA package was seeded: its actual source and solution order must be selected by the creator.

Loading resolves current source versions and IDs; it does not automatically increment versions. Before an unreviewed export, preflight rejects changed source versions and asks the user to reload. After review, the existing queue re-inspects the exported ZIPs for the expected solution, version and type. A definition is a recipe for future exports, not an immutable historical release. Source customizations can change after loading; retain exported ZIPs when a reproducible release is required.

### Create from existing solution ZIPs

1. Choose **Deploy existing package (.zip)**, then **Single solution** or **Multiple solutions**.
2. Choose the ZIP(s). For multiple solutions, use Up/Down to set the import order.
3. Enter a package name and optional description, then **Save package**. Saving does not require a target.
4. Choose **Predefined packages** and select the package. Helper checks every referenced ZIP and shows its saved path, version, type and order. It does not connect to a source environment or re-export solutions.
5. Select the target, **Review queue**, then continue and **Import queue to target**. The active account and existing sequential import, background installation waits and grouped history are reused. ZIP packages do not offer source dependency repair through the agent.

These definitions remember where files are; they do not contain or copy the ZIPs. Keep the selected ZIPs accessible at their saved absolute paths. To replace a file or promote a new version, use **Edit package**, remove the affected entry, choose its replacement ZIP, arrange the order and **Save changes**. A fingerprint detects any byte change, even if the solution name/version/type did not change. This is integrity checking, not publisher authentication.

## Folder and sharing

Default location:

```text
<Electron app.getPath('userData')>/powerapps-helper/packages
```

This is the current OS user's application-data directory. The actual absolute path is displayed under **Predefined packages → Library folder**. **Show folder** reveals it. **Choose folder…** selects an existing directory and saves that location in Helper's local settings. Changing folders does not move existing definitions. This library setting is separate from the exported-ZIP storage setting in Settings.

Definitions are named `<uuid>.package.json`; the filename ID must match the JSON ID. To use them on another computer, copy these files with their original filenames into that computer's selected library folder. Do not copy temporary `.tmp` or `.lock` files. Selecting the same accessible folder also makes the definitions visible to other Helper clients using it, but UNC/network-folder locking and atomic rename behavior have not been verified. Cloud synchronization is not implemented.

For ZIP definitions, the absolute ZIP paths must also be accessible on each computer. Copying definitions alone does not transfer ZIPs or rewrite paths. If locations differ, edit and reselect files on that computer. ZIP paths are visible in definitions and captured history; use synthetic/non-sensitive paths when sharing examples.

The default library is common to Microsoft accounts using Helper under the same OS user. It is not automatically common to every Windows user or every computer. Each consumer needs target import access through their own Microsoft account, and source export access for source definitions. Package discovery does not grant environment permissions.

Anyone with write access to the folder can change its definitions. Use OS folder permissions to control authors and readers. Local storage has no package publishing roles or signatures. A SHA-256 hash detects changes between selection, edits and queue preparation/execution; it does not authenticate the author. Consumers cannot reorder or change source/type in the predefined deployment screen; they must explicitly edit and save the definition.

## Validation and failures

- Definitions require a UUID, timestamps and 1–100 distinct solution unique names. Schema version 1 source definitions require a valid HTTPS `.dynamics.com` source URL and Boolean export type. Schema version 2 ZIP definitions require `mode: file`, absolute `.zip` paths, original three- or four-part numeric version strings, Boolean per-file types and SHA-256 fingerprints. Supported source URL rules match the existing queue.
- Each definition is at most 128 KiB. Listing refuses more than 500 definition files; saving a new definition checks that capacity. Concurrent creators in separate clients can still exceed this listing limit; split the library into smaller folders if that occurs.
- Reads are bounded, skip invalid files with visible warnings and reject symbolic-link files and mismatched filename/content IDs. Folder trust and permissions remain necessary; this is not a hardened filesystem boundary against a hostile local writer.
- Every saved source solution must still exist as an accessible unmanaged solution with a current ID/version. Missing source access or a missing solution stops loading the whole package; no partial queue is returned.
- Every saved ZIP must match its fingerprint and solution metadata. No partial ZIP deployment queue is returned if loading fails. Editing can load stored references without file inspection; saving and review/import still check the files.
- Updates/removal require the current definition hash. Queue preparation and execution re-read the definition and enforce exact source, export type, solution count and order. A changed or removed definition requires reloading/reviewing before continuing.
- Save/update uses an exclusive per-definition lock, a temporary file and rename. A conflicting writer is asked to retry. A failed read is not treated as an empty valid package.
- Account changes clear the deployment draft and invalidate pending load/save UI responses. Package loading uses the captured active account with silent token refresh. Expired credentials or required consent return an error requiring reconnection.
- The existing import/install wait behavior is unchanged. Actual import completion is tracked separately from Microsoft background readiness. The queue stops after a failure; completed imports are not rolled back. App exit does not resume a queue automatically.

## Components and contracts

| Component | Change / current consumers |
| --- | --- |
| `electron/services/packageLibrary.js` | Local source/ZIP definition service: list/save/remove/get/resolve/verifyQueue/folder. Main-process package and queue IPC are its consumers. Schema 1 source format is preserved; schema 2 adds ZIP references. |
| `electron/main.js`, `electron/preload.js` | Additive `packages` IPC/API. Main requires sign-in, prevents package operations when deployment is busy, verifies package references, and captures the account for source queries. Native directory selection persists the configured folder. |
| `electron/services/store.js` | Initializes the default folder/setting and stores additive package metadata in queue history. Existing history records need no migration. |
| `electron/services/deploymentQueue.js`, `deploymentAgent.js` | Reuse queue execution; validate current versions before unreviewed package export and retain package metadata in child history. |
| `electron/main.js` file inspection IPC, `electron/preload.js`, `src/views/DeployView.jsx` | `deploy:inspectFile` retains its artifact/inspection/stored contract and adds `sha256`. The single/multiple file pickers consume it. Package loading accepts additive `edit: true` for editable ZIP references. |
| `electron/services/dataverse.js` | `importSolutionFromFile` adds optional `expectedSha256`; main's saved-file queue importer supplies it. Existing main single-import and `deploymentAgent.js` callers omit it and retain their contract. Existing references in `tests/dataverseImport.test.cjs` and `tests/deploymentAgent.test.cjs` were inventoried but not executed. |
| `electron/services/solutionZip.js` | Unchanged `inspect` implementation accepts paths or Buffers through AdmZip. File inspection IPC, queue preflight and the package library inspect the same bytes they hash. Other main export and deployment-agent callers still use paths. |
| `electron/services/historyGrouping.js`, `src/views/HistoryView.jsx` | Package name in grouped history/search/details; full captured definition remains in parent/child JSON records. CSV gains an additive package column. |
| `src/views/DeployView.jsx`, `src/styles.css` | Create/edit/save UI, configurable library, automatic ordered loading, fixed recipe review and visible loading/errors. |

No AV common library, PCF, plugin or client web resource was changed. No Dataverse schema metadata was needed or inferred for local storage. Existing deployed queue and approval contracts are retained.

## Validation performed

Verified renderer command from `package.json` and `.github/workflows/release.yml`; syntax/whitespace commands from installed Node/Git tooling:

```powershell
npm run build:renderer
node --check electron/services/packageLibrary.js
node --check electron/main.js
node --check electron/services/deploymentQueue.js
node --check electron/services/dataverse.js
git -c core.safecrlf=false diff --check
```

The listed commands passed for the ZIP-package extension. The renderer compiled 43 modules; the existing Vite CommonJS API deprecation warning remains. Source review covered definition whitelisting, bounded reads, conflict detection, fixed queue order, source version checks, file fingerprints/metadata, exact-byte import checks, stale load/account responses, error handling and package history propagation. Static checks do not establish runtime behavior or line coverage.

For the disabled-save correction (service 1.1.1), `npm run build:renderer`, `node --check electron/services/packageLibrary.js` and `git -c core.safecrlf=false diff --check` passed. Source inspection covered absent fingerprints on new entries, matching/mismatched provided fingerprints, saved-reference fallback, strict persisted definition validation and errors next to the save controls. No runtime save, UI check or test execution was performed; D02/D03 remain open. Restart the Electron main process as well as loading the renderer; a renderer refresh alone cannot update the save handler.

For detailed ZIP diagnostics (service 1.1.2 / queue 1.0.5), read-only inspection of all 19 local GiveLife solution ZIPs found 18 four-part versions and one three-part version: `AC_PCF_BingAddressAutoComplete` declares `1.0.67` inside `SolutionManifest` in `solution.xml`. Its file is readable and its managed flag is Boolean; the version-format check explains the reported save blocker. This inspection does not establish target importability or missing dependencies. No ZIP was changed. `npm run build:renderer`, `node --check electron/services/packageLibrary.js`, `node --check electron/services/deploymentQueue.js` and `git -c core.safecrlf=false diff --check` passed. Runtime save/import checks and tests remain unperformed.

For three-part existing-ZIP support (service 1.1.3 / queue 1.0.6), those same four commands passed after the implementation. Source review covered consistent three/four-part file validation across renderer/save/read/preflight, retained four-part source validation, unchanged exact-version comparisons and byte fingerprints, malformed version reporting and downgrade compatibility. No tests, actual app saves, live imports, UI host checks or installer builds were performed. Changed-rule runtime/coverage evidence remains open under D02; independent release review remains open under D03.

No tests were added or run, per the task's execution instructions. No live source queries/imports, UI host checks, actual package saves through the app, installer builds, network-folder checks or publishing were performed. The manifest/pipeline have no configured lint or solution-checker command.

## Deployment and recovery

Restart Electron and load the rebuilt renderer to use the new backend/API. Installed clients need a future updated installer. No environment configuration or database migration is required. Source and target privileges remain the existing deployment requirements.

Back up the selected library, referenced ZIPs and Helper's settings/history before distributing an installer. Reverting the code leaves recipe files on disk and existing individual history records readable. Versions that support only schema 1 will skip schema 2 ZIP definitions with a visible library warning; existing source definitions continue to work. Copying/restoring definitions changes only recipes, never target-environment state.

Clients predating service 1.1.3 will skip schema 2 definitions containing three-part ZIP versions with a library warning. Existing four-part definitions and their canonical hashes are unchanged. Upgrade consumers of those definitions together; do not edit ZIP contents to make a definition readable in an older client.

If a crash leaves a definition `.lock`, close all Helper clients writing to that folder, back up the definition and temporary files, and verify that no writer remains before manually removing the matching stale lock. Preserve orphan `.tmp` files for inspection before recovery. Automatic stale-lock recovery is not implemented. Library recovery and shared-folder behavior still need staged host validation.

### Open adoption inputs (D01–D10 tracking)

- D01: Referenced `docs/standards.md` and applicable AGENTS.md were absent. Full rule IDs/mappings could not be read; supplied working guidance was used. This is not approval of an exception.
- D02: Changed-rule runtime evidence and the approved 80% changed-business-logic coverage target remain unverified. Tests were not authorized and reliable changed-code coverage is not configured for this renderer/main flow.
- D03: Independent non-author review, relevant packaged Windows/macOS/Linux checks and recovery validation are pending before release. Security/folder data boundaries require a qualified second reviewer under the supplied guidance. No release approval is claimed.
- D04: Shared-folder atomic write/locking and simultaneous library-capacity behavior are unverified. Folder permissions define trust; hashes are not signatures. A recipe cannot reproduce source customizations from an earlier point in time.
- D05: Target acceptance of an original three-part manifest version has not been checked through live import. Helper's local validation accepts that format and sends the original ZIP bytes; target import errors remain authoritative and use existing failure reporting. No Dataverse behavior or metadata was inferred from this local validation change.

