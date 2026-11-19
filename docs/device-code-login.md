# Device-code sign-in

Added 19 November 2026.

## Behavior and contracts

- The sign-in gate and Accounts page offer device code alongside browser sign-in.
- The active account's method can be changed in Accounts without signing in again. It is saved per account in the existing `active-account.json` file, with backward compatibility for files containing only `homeAccountId`.
- Dataverse discovery and resource tokens, environment-hosted Dataverse MCP tokens, and OneDrive tokens use the selected method after silent acquisition fails.
- The existing MSAL Node dependency provides device-code polling; no dependencies, app registrations, resource scopes, or Dataverse schema were added or changed.
- Existing `auth.add()` and `auth.addAccount()` calls still use browser sign-in. The optional argument is `{ method: 'browser' | 'deviceCode' }`. Existing `auth.init(path)` callers remain supported.
- New `auth.setMethod(method)` and `auth.onProgress(callback)` preload APIs update the active account preference and subscribe to temporary sign-in progress. Subscriptions return an unsubscribe function.
- Only the user-facing code, Microsoft verification address, expiry, account hint, method, and request ID reach the renderer. Device credentials and access/refresh tokens stay in the main process. Codes are not written to logs or files by this feature.
- Verification addresses must be HTTPS addresses on the supported Microsoft sign-in hosts. Device-code sign-in is bounded to five minutes; Cancel sets MSAL's supported request cancellation flag and immediately releases the app's pending sign-in. Expired, rejected, null, wrong-account, and consent-required results are handled.
- Sign-in dialogs apply to both account connection and later resource prompts. The dialog and progress subscription clean up when unmounted; app exit cancels pending sign-in.

## Consumers inspected

`electron/main.js`, `electron/preload.js`, `src/App.jsx`, `src/views/AccountView.jsx`, and the Dataverse, MCP, and Graph token consumers. The pre-existing browser cancellation regression in `tests/auth.test.cjs` was read. The reviewed dependency is the installed, lockfile-resolved `@azure/msal-node` 2.16.3; its source confirms `deviceCodeCallback`, mutable `cancel`, timeout in seconds, and a nullable authentication result.

## Build and validation

Repository commands were discovered in `package.json`, README, and `.github/workflows/release.yml`:

- `npm run build:renderer` builds the renderer.
- `npm run dev` starts the development app.
- `npm run package:win` builds the Windows installer. Release CI also packages macOS and Linux.
- No lint, test, coverage, or solution-checker command is registered in the package scripts or release pipeline. Existing tests use Node's built-in test APIs.

Validation performed on 19 November 2026:

- `npm run build:renderer` completed successfully. Vite compiled the sign-in UI into the production renderer; it reported its existing CommonJS Node API deprecation warning.
- `node --check electron/services/auth.js`, `node --check electron/main.js`, and `node --check electron/preload.js` completed successfully.
- `git -c core.safecrlf=false diff --check` completed successfully.

At the initial implementation stage, automated tests and interactive sign-in checks were not requested and were not run. The subsequent user-requested review and its tests are recorded below. Changed-code coverage is unmeasured; the approved 80% target has not been established. Runtime behavior and Microsoft tenant acceptance require follow-up validation.

## Configuration and recovery

No new configuration is required. Use the existing public-client overrides only with tenant-approved registrations. Device code uses the same client IDs and resource permissions as browser sign-in. Admin consent, environment MCP enablement/allowed clients, Dataverse permissions, and conditional-access policy still apply.

Restart the development app to load the new main/preload code. A packaged installation requires a newly built installer. To stop using device code, select Browser in Accounts. Existing token cache formats are unchanged; earlier code ignores the added account preference field.

## Open adoption inputs (D01–D10)

The referenced `docs/standards.md` is absent from this checkout and was not found under `C:\Research`. Detailed rule mappings and any required exception approval cannot be verified from the adoption guide alone. This note records unknowns without asserting compliance or approving an exception:

- The installed `DataverseMCP-Server.exe` was located through the laptop's configured MCP command. Its bundle does not expose application authentication source or documentation, so its client ID, authority, and requested scopes were not verified. Its token stores and credentials were not opened.
- The affected tenant's consent status and device-code policy are unknown. The supplied screenshot shows an admin access request for Dataverse CLI, which changing authentication flow does not resolve by itself.
- Supported-host sign-in, account switching, cancellation/retry, expiry, consent denial, OneDrive/MCP prompts, and persistence after restart still need runtime checks when requested. MSAL cancellation stops subsequent polling; an HTTP request already in progress is not aborted by its cancellation flag.
- The existing token-cache helper permits a plaintext fallback when OS encryption is unavailable. This predates the change; adding a login method does not certify its storage security.
- Non-author review and any required qualified security review remain pending before release. No release, tenant consent change, or deployment was performed by this change.

## Administrator approval review — 19 November 2026

The user requested verification after Microsoft displayed **Approval required** for **Dataverse CLI**, requesting access to Dataverse MCP tools and sign-in/profile. The visible authorization URL's client ID matches this code's compatibility default, `0c412cc3-0dd6-449b-987f-05b053db9457`.

Verified against [Microsoft's non-Microsoft MCP client documentation](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/data-platform-mcp-other-clients), retrieved on 19 November 2026:

- Microsoft documents that exact ID for the `@microsoft/dataverse` local proxy and explicitly requires tenant administrator consent before users authenticate. The app name and permission prompt therefore have a documented explanation; the screenshot does not prove a device-code implementation failure.
- The app connects directly to the remote `/api/mcp` endpoint. Microsoft's instructions for that route require a custom Entra application with Dynamics CRM `mcp.tools` permission and its ID enabled in the environment's allowed MCP clients. The previous README conflated that setup with the local proxy's default client. The README and code comment now describe the distinction. No runtime client ID, scopes, or authority were changed; a tenant-approved custom ID can already be configured using `DATAVERSE_MCP_CLIENT_ID`.
- Both authentication methods request the same resource `/.default` scope with the same selected client registration. That requests the registration's configured resource permissions; changing the transport to device code does not grant consent. The MCP tool permission is required by the documented endpoint setup; no replacement scope was inferred to bypass approval.
- The screenshot's `/authorize` URL represents browser authorization. Existing accounts retain Browser unless their Accounts preference is changed. The running installation/build and its selected preference were not inspected.
- At the time of this review, MCP sign-in was attempted before the Web API fallback during dependency repair. The later "Avoiding MCP-specific admin approval" section records the changed default; tenant behavior remains unknown.

Validation performed for this requested review:

- Added `tests/authDeviceCode.test.cjs` using synthetic accounts, temporary files, and mocked MSAL/Electron APIs. It checks public-only progress, device-code routing for Dataverse/Graph/MCP, persisted preference after reinitialization, cached MCP acquisition, cancellation/retry, new and cached wrong-account handling, consent denial, expiry/rejection, null results, and verification-host validation.
- Verified command: `node --test tests/authDeviceCode.test.cjs tests/deploymentAgent.test.cjs` — **28 passed, 0 failed**. Existing deployment tests cover fallback before source action and stopping after an action has begun. An initial test-fixture failure was corrected: recreated mocked Dataverse clients now retain the synthetic account, matching the cache state assumed by the restart scenario.
- `node --check electron/services/auth.js` and `git -c core.safecrlf=false diff --check` passed.
- No live authentication, MFA, admin approval request, tenant change, deployment, or installer rebuild was performed. These mock checks establish local routing and failure behavior, not Microsoft tenant acceptance. No reliable changed-code coverage measurement or solution-checker command is available in the repository.

The custom app's approved ID, permissions/consent, allowed-client entry, and the installed laptop MCP's identity settings remain open adoption inputs under D01–D10. The missing standard prevents verifying more detailed rule mappings; this review does not self-approve an exception.

## Avoiding MCP-specific admin approval

The deployment agent now uses the active user's authenticated Dataverse Web API for dependency repair by default. This avoids the distinct Dataverse MCP `mcp.tools` consent request. Remote MCP is available only when `DATAVERSE_MCP_ENABLED=true` is explicitly configured with an approved `DATAVERSE_MCP_CLIENT_ID` and a source-environment MCP allow-list entry. This does not override tenant consent or conditional-access policy for Dataverse API access.

Validation for this change should cover an import repair with MCP disabled (Web API action only), the existing opt-in MCP repair route, and the pre-action MCP failure fallback. Tenant sign-in and consent behavior remain environment-specific.
