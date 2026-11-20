# Light and Dark mode

Implemented and verified on Windows on 20 November 2026.

## Behavior

- The sidebar sun/moon button switches modes before or after sign-in. Settings → Appearance offers native Light/Dark radio controls with keyboard support.
- Both controls share the same app state. Theme changes apply without remounting the deployment view.
- The existing local settings file stores `theme: 'light' | 'dark'`. Missing or invalid saved values default to Dark; invalid save values are rejected. Other settings are preserved.
- Startup restores the preference before React renders. Electron uses the saved preference for the window background and supported `nativeTheme.themeSource` API.
- A pending save disables both controls and blocks repeated saves. A failed save or invalid response restores the previous theme and displays an alert. A subsequent switch can retry.
- Shared CSS variables cover surfaces, text, inputs, logs, badges, alerts, dialogs, account cards, and notifications. `color-scheme` follows the selected mode.

Affected components: `electron/services/store.js`, `electron/main.js`, `src/theme.mjs`, `src/main.jsx`, `src/App.jsx`, `src/views/SettingsView.jsx`, and `src/styles.css`. Existing settings IPC and preload contracts are retained; no dependencies were added.

## Validation performed

Commands discovered from package scripts and the existing Node test convention, then executed successfully:

```bash
npm run build:renderer
node --test --experimental-test-coverage tests/theme.test.cjs
npx --no-install electron tests/theme.ui.cjs
node --check electron/main.js
node --check electron/services/store.js
node --check tests/theme.ui.cjs
node --check tests/fixtures/theme-preload.cjs
git diff --check
```

- Four Node tests passed: theme normalization/application, saved startup preference, settings-read fallback, and persistence across store reinitialization with settings preservation and invalid-save rejection.
- The isolated Electron harness loads the actual built renderer with synthetic APIs, accounts, and temporary settings. It passed both switching directions before sign-in, reload persistence, write-failure/invalid-response rollback and retry, repeated-click protection, Settings synchronization, keyboard arrow switching, and deployment-draft retention.
- Both palettes passed 16 sampled text contrast checks at 4.5:1 or higher. Accounts, History detail, and sign-in dialogs inherited the selected palette. No unexpected renderer errors were detected.
- Light and Dark Settings screenshots were visually inspected. The harness verifies the captured background pixel matches the selected theme. Screenshots are generated under ignored `release/theme-checks-20261120/`.
- Synthetic settings failures intentionally produce Electron error logs. The renderer build reports the existing Vite CommonJS API deprecation warning; Git reports existing LF/CRLF conversion warnings.

`src/theme.mjs` reached 100% line, branch, and function coverage. React event handlers and production main-process integration are not instrumented for changed-code coverage. Whole-file store coverage includes unrelated history functions and is not a reliable changed-code metric. The approved 80% changed-business-logic target cannot be established globally; the changed-behavior evidence above records the tooling gap.

## Configuration and remaining checks

### Light glass refinement — 20 November 2026

The light palette now uses a stationary blue/mint gradient, translucent cards and sidebar with supported CSS backdrop filtering, softer borders and shadows, rounder controls, white selected segments, and constrained content width on larger screens. Enabled inputs retain distinct boundaries and focus outlines. Menus and dialogs keep opaque content surfaces. Dark styles and theme persistence/event handling are unchanged.

Opaque CSS defaults support hosts without backdrop filtering; reduced transparency and increased contrast media preferences suppress the glass effects. Reduced motion disables the new button transitions. Narrow layouts wrap segmented controls and form columns. No dependencies, host integration, or settings migration were added.

Validation for this refinement: the renderer build and whitespace check passed. Offline Electron screenshots with synthetic data were visually reviewed for Deploy (desktop, 780px, and 500px windows), Settings, History, and the existing Dark appearance. Screenshots are stored under ignored `release/glass-preview-20261120/`. The preview did not use real authentication, user settings, or cloud services. The existing UI check's obsolete flat-background expectation was updated for the tinted canvas; automated tests were not added or rerun. The earlier automated evidence above applies to the initial theme implementation. Live deployment, packaged installer, host accessibility preferences, and cross-platform rendering remain unverified for this refinement. CSS-only changes add no testable business logic; full rendered contrast measurement remains open.

### Dark glass and shared layout — 20 November 2026

Both themes now use the same layout rules for centered content (maximum 1320px), headings, card padding, form controls, segmented controls, table spacing, sidebar items, and responsive wrapping. In particular, the work-item reference field shares a row with its Refresh details button on desktop in both themes. Switching palettes no longer changes these dimensions or positions.

Dark mode uses a stationary deep blue/teal canvas, translucent blue panels and sidebar, subtle highlight borders, softer shadows, and brighter muted text and accent colors. Theme-specific CSS variables supply colors while the glass and layout rules are shared. Menus and dialogs retain opaque content surfaces. Unsupported backdrop filtering, reduced transparency, increased contrast, and reduced motion preferences have shared fallbacks. Theme settings and deployment event/state logic are unchanged; no dependencies or migrations were added.

Affected components: `src/styles.css`, this note, and README. The existing UI screenshot expectation for a flat Dark background was updated to accommodate the gradient; no tests were added or run for this refinement. Earlier automated evidence above applies to the initial theme implementation, not the new glass styling.

Validation: `npm run build:renderer` passed, and offline Electron screenshots using synthetic data were reviewed for Dark Deploy (desktop and 500px window), Settings, History, and Accounts. Layout observations of 10 deployment elements at 1440px and 500px window widths had identical rectangles in Light and Dark. Screenshots and observations are stored under ignored `release/glass-preview-20261120/`; this preview uses isolated in-memory settings and blocks network requests. Whitespace validation passed. The build retains the existing Vite CommonJS API deprecation warning.

Live deployments, automated regression tests, full rendered contrast measurements, host accessibility preferences, cross-platform rendering, and packaged installer behavior were not checked for this refinement. The CSS change adds no testable business logic; rendered accessibility coverage remains an open tooling gap. The absent standards file and D01–D10 adoption inputs below remain unresolved.

No configuration or migration is required. Reload the running development renderer to load the styling. A packaged installation needs an updated installer when publication is requested; none was created for this change. Older code ignores the added preference field.

Native OS dialog/title-bar appearance, macOS/Linux host behavior, real authentication, Dataverse, OneDrive, and packaged installer behavior were not integration tested. The Electron UI harness uses synthetic settings handlers; production main-process code received syntax validation. No lint or solution-checker command is configured in the repository manifests or pipeline.

## Open adoption inputs (D01–D10)

The referenced `docs/standards.md` is absent from this checkout. Detailed rule mappings and exception requirements could not be verified; this record does not claim full standard compliance or approve an exception. Reliable React/main changed-code coverage and downstream host checks remain open. Non-author review remains pending before release under REL-01. No release or deployment was performed.
