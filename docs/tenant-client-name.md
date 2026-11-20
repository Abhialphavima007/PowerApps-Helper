# Tenant client name

Implemented 20 November 2026.

## Behavior and contracts

- Settings → Solution storage → Client name fills automatically from the active tenant and remains editable. Edits save on blur or Enter; clearing the field restores the automatic name. Save failures retain the draft and offer Retry.
- Automatic names use the Microsoft tenant display name when silent access is available. The fallback is the signed-in organization domain; guest accounts use their tenant ID rather than their home organization's domain. The Settings hint explains a fallback.
- Manual names are saved in the existing settings file under `clientNamesByTenant`. The tenant ID scopes each edit; an account key is used if tenant metadata is absent. The pre-existing `clientName` field is retained. An existing nonempty name is associated once with the first active tenant that resolves a client name, preserving the user's earlier edit without copying it to other tenants.
- Local and OneDrive exports, including agent repair exports, resolve the same tenant-specific name as Settings. Existing files and history are not moved. Account identity is checked again after optional metadata lookup; a changed account prevents using a result for another tenant.
- Settings remounts when the active account/tenant changes. Client-name requests ignore late results after unmount, and pending saves prevent duplicate submissions.

Affected components: `electron/services/clientName.js`, `electron/services/auth.js`, `electron/services/store.js`, `electron/main.js`, `electron/preload.js`, `src/App.jsx`, and `src/views/SettingsView.jsx`.

New preload methods are `settings.getClientName()` and `settings.saveClientName(value, { tenantId, homeAccountId })`. They return `{ ok, clientName, source, tenantId, homeAccountId }`, or `{ ok: false, error }`. Existing general settings methods remain available. `auth.getTenantTokenSilent(account)` is consumed only in the main-process client-name service; tokens are never returned through these preload methods.

## Tenant metadata

Verified against Microsoft's [Tenants — List API](https://learn.microsoft.com/en-us/rest/api/resources/tenants/list?view=rest-resources-2022-12-01) on 20 November 2026: `GET https://management.azure.com/tenants?api-version=2022-12-01` supplies `tenantId` and `displayName`.

The existing Dataverse MSAL public client attempts silent token acquisition for Azure Resource Manager with the matching cached account and tenant-specific authority. No interactive login fallback, Graph connection, new app registration, or dependency is added. Sovereign authorities and unsupported account metadata use the local fallback. The optional lookup waits at most four seconds, follows only validated tenant-list pagination URLs (at most ten pages), and caches the result per account/tenant for ten minutes. HTTP, consent, policy, timeout, and malformed-response failures use the fallback without interrupting sign-in or deployment.

## Validation and remaining checks

Executed successfully:

```bash
npm run build:renderer
node --check electron/services/clientName.js
node --check electron/services/auth.js
node --check electron/services/store.js
node --check electron/main.js
node --check electron/preload.js
git diff --check
```

The build reports the existing Vite CommonJS API deprecation warning. No automated behavior tests, live tenant calls, account-switching UI checks, cloud exports, or installer build were performed for this request. Changed-code coverage is unmeasured; the 80% target has not been established. Build and syntax checks do not prove runtime behavior. No repository lint or solution-checker command is configured.

Restart the development app to load the changed main/preload code. No additional configuration is required. Selecting an edited client name or clearing it affects future exports. No installer, release, or deployment was created.

## Open adoption inputs (D01–D10)

`docs/standards.md` is absent from this checkout, so full rule mappings cannot be verified. Silent Azure Resource Manager access depends on the configured public client and tenant policies; acceptance in the user's tenant remains unknown and the fallback is deliberate. Non-author review and any required qualified security review remain pending before release under REL-01. This record does not approve an exception.
