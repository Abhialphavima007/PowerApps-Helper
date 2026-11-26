# Approval and portable setup improvements — 26 November 2026

## Result

- Approval text lists component names and friendly types first, with the reported dependency error below. Process category is read from the source to distinguish workflows, business rules, actions and cloud flows; unavailable category falls back to Process. Exact IDs, subcomponent settings and the hashed machine plan stay in the Deployment Event. Presentation changes do not authorize extra additions.
- The desktop uses its existing Dataverse API sign-in for approved repairs. Saved MCP repair settings migrate while destinations/profile remain intact. Separate Dataverse MCP initialization and the repair-transport selector are removed. Optional Codex updates and injectable compatibility contracts remain. Broader verification also corrected legacy auth fixtures to identify clients by client ID, and removes only newly introduced wrong-account entries after a rejected compatibility MCP sign-in.
- The profile form adds **Approval flow account**, validates an active Dataverse user and fills the canonical trusted GUID after explicit selection. Existing GUIDs hydrate the display without replacement. Pending/error/mismatched selection blocks form saving; stale asynchronous responses cannot override a later selection. The user still verifies the actual Dataverse connection account in Power Automate.
- One reference-counted Electron sleep blocker covers manual export/import and the entire agent operation, including approval waits and overlapping work. Protection is released on completion/failure. It prevents automatic idle sleep while the app runs; forced sleep, hibernation, lid policies, shutdown, power/network loss and restart-resume are excluded.
- A [generic setup guide](local-handover.md) separates central setup hosting from deployment source/target and explains new-user connections/profiles. No desktop environment, approver or trusted account was hardcoded for handover.

## Live development changes

Environment was verified as Abhinav Research, solution `PowerAppsHelper`, unmanaged. Solution version is now `1.1.3.0` (previous `1.0.0.0`); desktop package metadata remains `0.1.4`.

The active approval flow's two request titles/details and Teams reminder content were patched from the exact current envelope. Full definition comparison against the surgical patch passed. Trigger, bindings, decision validation and other actions were preserved. The new form script and form registration were uploaded and published; final script/FormXml readbacks match the local content. Existing profile enabled state, First response mode, 60-minute timeout and canonical trusted user were preserved. Maker annotations were removed from the new script, changed FormXml and setup icon through generic record updates. The icon drawing is unchanged.

After complete flow-consumer and deletion-dependency checks, only these five unused **solution memberships** were removed: `abhi_DeploymentDataverse`, `abhi_DeploymentOutlook`, `abhi_DeploymentApprovals`, `abhi_DeploymentTeams`, `abhi_sharedteams_eb0e0`. Their environment objects were retained. Used references, three flows, tables, app, roles and resources remain. Missing-dependency readback returned no rows. Pre-change solution backup, flow/form baselines and inventory are retained in ignored `.local-recovery/`; these can contain development configuration and are not handover files.

## Validation

Verified commands come from `package.json`, the release pipeline and existing Node tests:

- `node --test --experimental-test-coverage tests/approvalImprovements.test.cjs tests/deploymentAgent.test.cjs tests/deploymentFlows.test.cjs tests/teamsWorkflowIpc.test.cjs tests/auth.test.cjs tests/authDeviceCode.test.cjs`: **65 passed, 0 failed**. Seventeen improvement cases cover component presentation/fallback, settings migration, authenticated plan preservation, sleep lifecycle, IPC scope, flow patch invariants, account selection/error/race handling and form merging. The broader cases cover source repairs, rejected/invalidated approval, trigger contracts, workflow persistence/reveal and auth compatibility.
- `npm run build:renderer`: passed, 43 modules; existing Vite CommonJS API deprecation warning.
- `node --check` on changed JS/CJS entry points, services, form script and generators: passed. `git diff --check`: passed.
- Live flow readback: On, revision `1.1.3.0`, expected Flow owner trigger. Web resource/form publication succeeded. Generic record update required the verified `webresourceset` entity set after an initial `webresources` request returned 404; the unsuccessful request changed nothing.
- Initial expanded verification exposed outdated auth mock client indices and wrong-account cache cleanup, now fixed. Initial agent test fixtures omitted the source solution ID; corrected the fixtures while retaining the production identity guard. The earlier failure logs are historical evidence.
- Windows x64 NSIS draft installer build succeeded with Electron Builder 24.13.3 using the existing lockfile, built renderer and explicit local configuration. It is unsigned, uses the default Electron icon and retains desktop version 0.1.4. Nothing was published. Initial attempts failed on CLI option parsing/cache access and an incomplete NSIS resource-cache rename; the verified downloaded plugin directory was copied into its expected cache location, then the build succeeded. Logs and build configuration are private in `.local-recovery/`.
- Unmanaged and managed solution exports completed at version 1.1.3.0. The archive audit includes extensionless text web resources; its first complete scan found an old developer-account annotation in the setup icon, which was removed without changing the SVG drawing before re-export. Installer execution and managed import on another computer/environment remain unverified.
- Final artifact audit passed: each solution contains three flows, the account lookup/script and 12 text entries. All 27 packaged desktop application files were scanned. No signed webhook, token/private-key value, development host/account or saved configuration/cache path matched the audit rules. Dependencies/binaries were not certified by this content scan. Results are retained in `.local-recovery/handover-artifact-audit.json` and copied to the draft handover package.

New presentation/power/form-patch modules have 100% full-file line coverage in this run. Profile browser code is executed in a VM and excluded from Node's file coverage report; relevant paths have direct changed-rule assertions. Shared automation coverage is 69.34% for the whole file, not changed lines. No reliable changed-code coverage tool exists, so the approved 80% changed-business-logic target is not certified.

## Remaining checks and decisions (D01–D10)

These IDs track unknown implementation details; they do not reconstruct the unavailable standard.

| ID | Remaining detail |
|---|---|
| D01 | `docs/standards.md` and applicable `AGENTS.md` absent; only supplied working guidance was available. |
| D02 | User reports the previous overall runtime works; fresh live approval/Teams delivery, flow-expression rendering and source repair after these changes have not been exercised. |
| D03 | Picker validates user existence/activity, not connection ownership; verify the connection account for every installation/change. |
| D04 | Effective permissions, identity separation and server immutability require qualified review. No independent reviewers/owners assigned; do not treat this as accepted security debt. |
| D05 | Other deployment producers need an event adapter; this does not watch every platform import. |
| D06 | Local draft packaging is separate from signing, release publication and another-computer installation verification. |
| D07 | Reliable changed-code coverage and a repository solution-checker command are absent. No checker finding was waived. |
| D08 | Duplicate/ambiguous connector deliveries still need host evidence. |
| D09 | Managed downstream import and recovery restoration have not been rehearsed. |
| D10 | Physical idle-sleep behavior and platform policy need host checks; forced sleep/restart recovery is outside this change. |

Require one non-author approval and a second qualified reviewer for this security-sensitive integration before release (REL-01). No exception is self-approved (STD-02). Keep profiles, credentials, role assignments and connection binding configuration separate from exported solution code. Restore scoped flow/form baselines or re-add removed reference memberships after inspection; solution export alone does not restore profile data or credentials.
