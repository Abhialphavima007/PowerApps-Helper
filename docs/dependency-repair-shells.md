# Table dependency repair

The reported import first identified three missing primary-name columns. After those were added, the next import reported missing tables `abhi_event1` and `cr5f6_jobapplicant`. The exported solution contained both as type 1 roots with behavior 2 (shell only), and the agent stopped at its previous two-cycle limit.

The agent now permits up to five repair cycles, identifies table roots using a component ID or a source-verified logical name, and allows a missing shell-only table to be added. After a table repair, it requires the re-exported table root to have behavior 0 or 1 before another import. Existing duplicate-attempt and per-cycle component limits remain in place.

## Open implementation detail

- **D01:** Whether `AddSolutionComponent` upgrades an already present shell to behavior 0 or 1 in the selected source environment is unverified. Check with synthetic data in a non-production environment. If it remains a shell or the result is ambiguous, the agent stops; a source solution owner must investigate the table's inclusion before retrying.

## Validation and deployment

- `npm run build:renderer` builds the renderer; `npm run package:win` packages Windows, as declared in `package.json`. The release workflow also runs the renderer build. No lint, test, coverage, or solution-checker command is declared in the package scripts or release workflow. Existing tests use Node's built-in test APIs.
- `node --check` passed for both changed service files and the adjusted existing test file. `git diff --check` passed. `npm run build:renderer` passed with the existing Vite CommonJS API deprecation warning.
- A Windows x64 installer was built using `npx --no-install electron-builder --win nsis --x64 --publish never` with a workspace-local builder cache, a dedicated output directory, and `-c.win.signAndEditExecutable=false`. It is unsigned. The default sandbox could not access the existing Electron cache; the successful build used elevated access.
- Automated tests were not run for this change. Changed-code coverage is unmeasured; the 80% target has not been established. No live source mutation, export, import, or tenant validation was performed.
- The current desktop uses the existing authenticated Dataverse Web API for exact approved source additions. It no longer initializes the separate Helper Dataverse MCP connection. Saved MCP settings migrate to API repair while preserving approval and reporting destinations. Exact-plan authorization and source customization permissions remain required; see [current improvement evidence](approval-usability-improvements.md).
- `docs/standards.md` was unavailable in this checkout, so detailed standard rule mapping could not be verified.
