'use strict';
// Direct Dataverse Web API client. Talks to the cloud with an access token from
// auth.js — no pac subprocess, so calls are fast and low-lag.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const auth = require('./auth');
const solutionZip = require('./solutionZip');
const installation = require('./installationWait');
const deploymentAccount = new AsyncLocalStorage();

const API_VERSION = 'v9.2';
// v1.2.0 — independent per-import budgets; background readiness stays at 15 minutes.
const IMPORT_WAIT_MS = 60 * 60 * 1000;
const MANAGED_UPDATE_WAIT_MS = 3 * 60 * 60 * 1000;

async function request(orgUrl, relPath, { method = 'GET', body, resource, raw, timeoutMs } = {}) {
  const accountId = deploymentAccount.getStore();
  let token;
  try {
    token = accountId ? await auth.getTokenSilent(resource || orgUrl, accountId) : await auth.getToken(resource || orgUrl);
  } catch (error) {
    if (!accountId) throw error;
    const sessionError = new Error('The deployment account no longer has a valid Microsoft session for this environment. Reconnect the account, then review the queue.');
    sessionError.phase = 'authentication';
    throw sessionError;
  }
  const url = orgUrl.replace(/\/+$/, '') + relPath;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0'
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...(timeoutMs ? { signal: AbortSignal.timeout(Math.max(1, timeoutMs)) } : {})
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    let responseError;
    try {
      responseError = JSON.parse(text)?.error;
      msg = responseError?.message || text;
    } catch {}
    const err = new Error(`${res.status} ${res.statusText}: ${msg}`);
    err.status = res.status;
    err.responseError = responseError;
    throw err;
  }
  if (raw) return { headers: res.headers, text };
  return text ? JSON.parse(text) : {};
}

// ---- Environments (Global Discovery Service) ----
async function discoverEnvironments() {
  const disco = auth.GLOBAL_DISCO;
  const data = await request(disco, '/api/discovery/v2.0/Instances', { resource: disco });
  const list = (data.value || []).map((i) => ({
    displayName: i.FriendlyName || i.UrlName || i.UniqueName,
    environmentId: i.EnvironmentId || i.Id,
    environmentUrl: (i.ApiUrl || i.Url || '').replace(/\/+$/, ''),
    type: i.OrganizationType || i.Purpose || i.State || '',
    version: i.Version || ''
  })).filter((e) => e.environmentUrl);
  // Stable, readable order.
  list.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { ok: true, environments: list };
}

// ---- Solutions ----
async function listSolutions(orgUrl) {
  const q =
    '/api/data/' +
    API_VERSION +
    "/solutions?$select=uniquename,friendlyname,version,ismanaged,solutionid&$filter=isvisible eq true and ismanaged eq false&$orderby=friendlyname asc";
  const data = await request(orgUrl, q);
  const solutions = (data.value || []).map((s) => ({
    solutionId: s.solutionid,
    uniqueName: s.uniquename,
    friendlyName: s.friendlyname || s.uniquename,
    version: s.version,
    isManaged: !!s.ismanaged
  }));
  return { ok: true, solutions };
}

async function setSolutionVersion(orgUrl, solutionId, version) {
  await request(orgUrl, `/api/data/${API_VERSION}/solutions(${solutionId})`, {
    method: 'PATCH',
    body: { version }
  });
  return { ok: true };
}

async function addSolutionComponent(orgUrl, solutionUniqueName, componentId, componentType) {
  await request(orgUrl, '/api/data/' + API_VERSION + '/AddSolutionComponent', {
    method: 'POST',
    body: {
      ComponentId: componentId,
      ComponentType: componentType,
      SolutionUniqueName: solutionUniqueName,
      AddRequiredComponents: false,
      DoNotIncludeSubcomponents: Number(componentType) === 1
    }
  });
  return { ok: true };
}

// Resolve an ID omitted from a target import error by one exact match in the source.
// Only unambiguous component types are queried; ambiguous names are never added.
async function findComponentBySchema(orgUrl, componentType, schemaName, { parentSchemaName = '' } = {}) {
  const schema = String(schemaName || '').trim();
  if (!schema) return null;
  const escaped = schema.replace(/'/g, "''");
  if (Number(componentType) === 1) {
    // EntityDefinitions is a metadata endpoint and does not accept $top.
    // A logical-name key also avoids an ambiguous filtered collection query.
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(schema)) return null;
    try {
      const entity = await request(orgUrl, `/api/data/${API_VERSION}/EntityDefinitions(LogicalName='${schema.toLowerCase()}')`);
      return entity.MetadataId || null;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }
  if (Number(componentType) === 2) {
    const parent = String(parentSchemaName || '').trim();
    // Attribute logical names are only unique within a table. Never guess the
    // parent from a display name or search every table for a matching column.
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(parent) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(schema)) return null;
    const filter = encodeURIComponent(`LogicalName eq '${escaped}'`);
    try {
      const data = await request(orgUrl,
        `/api/data/${API_VERSION}/EntityDefinitions(LogicalName='${parent}')/Attributes?$select=MetadataId,LogicalName&$filter=${filter}`);
      if (data['@odata.nextLink']) return null;
      const matches = (data.value || []).filter((item) => String(item.LogicalName || '').toLowerCase() === schema.toLowerCase());
      const ids = [...new Set(matches.map((item) => item.MetadataId).filter(Boolean))];
      return ids.length === 1 ? ids[0] : null;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }
  if (Number(componentType) === 9) {
    // Type 9 is a global option set. Local choices are part of their attribute
    // and must not be guessed from the choice label.
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(schema)) return null;
    try {
      const optionSet = await request(orgUrl,
        `/api/data/${API_VERSION}/GlobalOptionSetDefinitions(Name='${escaped}')`);
      return optionSet.MetadataId || null;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }
  const lookups = {
    20: [{ set: 'roles', id: 'roleid', field: 'name' }],
    26: [{ set: 'savedqueries', id: 'savedqueryid', field: 'name' }],
    29: [{ set: 'workflows', id: 'workflowid', field: 'uniquename' }, { set: 'workflows', id: 'workflowid', field: 'name' }],
    60: [{ set: 'systemforms', id: 'formid', field: 'name' }],
    61: [{ set: 'webresourceset', id: 'webresourceid', field: 'name' }],
    62: [{ set: 'sitemaps', id: 'sitemapid', field: 'sitemapname' }],
    80: [{ set: 'appmodules', id: 'appmoduleid', field: 'uniquename' }],
    300: [{ set: 'canvasapps', id: 'canvasappid', field: 'name' }],
    371: [{ set: 'connectionreferences', id: 'connectionreferenceid', field: 'connectionreferencelogicalname' }],
    380: [{ set: 'environmentvariabledefinitions', id: 'environmentvariabledefinitionid', field: 'schemaname' }]
  };
  for (const lookup of lookups[Number(componentType)] || []) {
    const filter = encodeURIComponent(`${lookup.field} eq '${escaped}'`);
    const data = await request(orgUrl, `/api/data/${API_VERSION}/${lookup.set}?$select=${lookup.id}&$filter=${filter}`);
    if (data['@odata.nextLink']) return null;
    const ids = [...new Set((data.value || []).map((item) => item[lookup.id]).filter(Boolean))];
    if (ids.length > 1) return null;
    if (ids.length === 1) return ids[0];
  }
  return null;
}

async function getEntityPrimaryNameAttribute(orgUrl, entitySchemaName) {
  const schema = String(entitySchemaName || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(schema)) return null;
  const logicalName = schema.toLowerCase();
  const entity = await request(orgUrl,
    `/api/data/${API_VERSION}/EntityDefinitions(LogicalName='${logicalName}')?$select=MetadataId,LogicalName,PrimaryNameAttribute`);
  const returnedLogicalName = String(entity.LogicalName || '');
  const attributeSchemaName = String(entity.PrimaryNameAttribute || '');
  if (!entity.MetadataId || returnedLogicalName.toLowerCase() !== logicalName ||
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(attributeSchemaName)) return null;
  return { entityId: entity.MetadataId, entitySchemaName: returnedLogicalName, attributeSchemaName };
}

// ---- Export ----
// Returns the exported solution as a base64 string, which we write to disk.
async function exportSolution(orgUrl, solutionUniqueName, managed) {
  const data = await request(orgUrl, `/api/data/${API_VERSION}/ExportSolution`, {
    method: 'POST',
    body: { SolutionName: solutionUniqueName, Managed: !!managed }
  });
  return data.ExportSolutionFile; // base64
}

async function exportToFile(orgUrl, solutionUniqueName, managed, outFile) {
  const b64 = await exportSolution(orgUrl, solutionUniqueName, managed);
  fs.writeFileSync(outFile, Buffer.from(b64, 'base64'));
  return outFile;
}

// ---- Import (async with progress polling) ----
// onProgress(percent|null, message) — percent comes from the import job (0-100).
function diagnosticStrings(value, depth = 0) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object' || depth > 5) return [];
  return Object.values(value).flatMap((item) => diagnosticStrings(item, depth + 1));
}

async function importFailure(orgUrl, importJobId, error, asyncOperationId = null) {
  const errorText = String(error?.message || error || 'Import failed');
  const diagnostics = [errorText, ...diagnosticStrings(error?.responseError)];
  const diagnosticMatches = diagnostics.map((message) => ({ message, dependencies: solutionZip.parseMissingDependencies(message) }));
  const errorMatch = diagnosticMatches.find((item) => item.dependencies.length);
  const errorDependencies = errorMatch?.dependencies || [];
  let importLog = '';
  let logDependencies = [];
  for (let attempt = 0; attempt < (errorDependencies.length ? 1 : 3); attempt++) {
    try {
      const job = await request(orgUrl, `/api/data/${API_VERSION}/importjobs(${importJobId})?$select=data`);
      importLog = typeof job.data === 'string' ? job.data : '';
      logDependencies = solutionZip.parseMissingDependencies(importLog);
    } catch { /* The import job may not be visible immediately. */ }
    if (logDependencies.length || errorDependencies.length) break;
    if (attempt < 2) await sleep(350 * (attempt + 1));
  }
  // Dataverse often embeds MissingDependencies in the API error before its import job is available.
  const dependencies = logDependencies.length ? logDependencies : errorDependencies;
  return {
    ok: false, error: errorText, importJobId, asyncOperationId, dependencies,
    importLog: (importLog || errorMatch?.message || errorText).slice(0, 12000)
  };
}

async function importWaitPolicy(orgUrl, bytes) {
  // Inspect the same bytes that will be submitted, never a display name or filename.
  const inspection = solutionZip.inspect(bytes);
  if (!/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(inspection.uniqueName || '')) {
    throw new Error('The selected ZIP does not contain a valid solution unique name. Review the package before importing.');
  }
  if (!inspection.managed) return { importKind: 'standard', timeoutMs: IMPORT_WAIT_MS };

  const filter = encodeURIComponent(`uniquename eq '${inspection.uniqueName}'`);
  const data = await request(orgUrl,
    `/api/data/${API_VERSION}/solutions?$select=uniquename,ismanaged&$filter=${filter}&$top=2`,
    { timeoutMs: 30000 });
  if (!Array.isArray(data.value) || data.value.length > 1 || data['@odata.nextLink'] ||
      data.value.some(solution => typeof solution.ismanaged !== 'boolean' ||
        typeof solution.uniquename !== 'string' ||
        solution.uniquename.toLowerCase() !== inspection.uniqueName.toLowerCase())) {
    throw new Error('Could not verify whether this managed solution is already installed. Check target solution access before retrying.');
  }
  // An existing managed solution gets the conservative update/upgrade wait.
  // This does not change ImportSolutionAsync into a stage/apply-upgrade action.
  return data.value[0]?.ismanaged
    ? { importKind: 'managedUpdate', timeoutMs: MANAGED_UPDATE_WAIT_MS }
    : { importKind: 'standard', timeoutMs: IMPORT_WAIT_MS };
}

async function importOnce(orgUrl, file, { overwrite = true, publishWorkflows = true, expectedSha256 } = {}, onProgress) {
  let bytes;
  try { bytes = fs.readFileSync(file); }
  catch (error) {
    if (expectedSha256 === undefined) throw error;
    const artifactError = new Error('The saved package ZIP is no longer readable. Reselect it and save the package again.');
    artifactError.phase = 'artifact';
    throw artifactError;
  }
  // Verify the exact bytes submitted, including after background-installation waits/retries.
  if (expectedSha256 !== undefined && (!/^[0-9a-f]{64}$/.test(expectedSha256) ||
      crypto.createHash('sha256').update(bytes).digest('hex') !== expectedSha256)) {
    const error = new Error('The saved package ZIP changed before import. Reselect it, review it and save the package again.');
    error.phase = 'artifact';
    throw error;
  }
  const policy = await importWaitPolicy(orgUrl, bytes);
  const waitDetails = { importKind: policy.importKind, importTimeoutMinutes: policy.timeoutMs / 60000 };
  const b64 = bytes.toString('base64');
  const importJobId = crypto.randomUUID();
  const body = {
    OverwriteUnmanagedCustomizations: !!overwrite,
    PublishWorkflows: !!publishWorkflows,
    CustomizationFile: b64,
    ImportJobId: importJobId
  };
  const report = (pct, msg) => { if (onProgress) onProgress(pct, msg); };
  const timedOut = asyncOperationId => ({ ok: false, phase: 'importTimeout',
    error: `Import monitoring reached its ${waitDetails.importTimeoutMinutes}-minute limit. Microsoft may still be importing this solution. Check the target solution history and System Jobs before retrying; remaining queue items were not started.`,
    importJobId, asyncOperationId, ...waitDetails });
  const rejected = error => {
    if (error.phase === 'authentication') throw error;
    // Only an HTTP rejection of the submission can be retried for concurrent
    // installation. A failed accepted job may already have applied changes.
    if (error.status && installation.isInstallationBusy(error.message)) {
      return { ok: false, error: error.message, importJobId, importRejected: true, phase: 'installation' };
    }
    return importFailure(orgUrl, importJobId, error);
  };

  // Prefer the async message; fall back to synchronous ImportSolution.
  let asyncOperationId = null;
  try {
    report(null, policy.importKind === 'managedUpdate'
      ? 'Managed solution already exists in the target. Waiting up to 3 hours for this update import; Microsoft installation is checked separately.'
      : 'Waiting up to 1 hour for this solution import; Microsoft installation is checked separately.');
    report(2, 'Uploading package & queueing import…');
    const r = await request(orgUrl, `/api/data/${API_VERSION}/ImportSolutionAsync`, { method: 'POST', body });
    asyncOperationId = r.AsyncOperationId || r.asyncoperationid;
  } catch (e) {
    if (e.status === 404) {
      report(null, 'Async import unavailable; importing synchronously (this can take a while)…');
      try { await request(orgUrl, `/api/data/${API_VERSION}/ImportSolution`, { method: 'POST', body, timeoutMs: policy.timeoutMs }); }
      catch (error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') return timedOut(null);
        return rejected(error);
      }
      report(100, 'Import completed.');
      return { ok: true, importJobId, ...waitDetails };
    }
    return rejected(e);
  }

  // Adaptive polling: quick at first for snappy feedback, then back off.
  const started = Date.now();
  const timeoutMs = policy.timeoutMs;
  const remainingMs = () => Math.max(0, timeoutMs - (Date.now() - started));
  let delay = 1200;
  let lastPct = 2;
  while (Date.now() - started < timeoutMs) {
    await sleep(Math.min(delay, remainingMs()));
    if (!remainingMs()) break;
    delay = Math.min(delay + 800, 4000);

    // Real progress percentage from the import job (may 404 until it exists).
    try {
      const fields = asyncOperationId ? 'progress' : 'progress,completedon,data';
      const job = await request(orgUrl, `/api/data/${API_VERSION}/importjobs(${importJobId})?$select=${fields}`, { timeoutMs: Math.min(30000, remainingMs()) });
      if (!remainingMs()) break;
      if (typeof job.progress === 'number' && job.progress > lastPct) {
        lastPct = Math.min(99, Math.round(job.progress));
        report(lastPct, `Importing… ${lastPct}%`);
      }
      // Missing async-operation IDs are not proof of completion. Use the import
      // job's terminal timestamp and explicit result instead of advancing early.
      if (!asyncOperationId && job.completedon && typeof job.data === 'string') {
        if (/\bresult\s*=\s*["'](?:failure|error)["']/i.test(job.data)) {
          return importFailure(orgUrl, importJobId, job.data);
        }
        if (job.progress === 100 && /\bresult\s*=\s*["']success["']/i.test(job.data)) {
          return { ok: true, importJobId, ...waitDetails };
        }
      }
    } catch (error) {
      if ([401, 403].includes(error.status) || /Microsoft session/.test(error.message)) throw error;
    }

    if (!asyncOperationId) continue;
    if (!remainingMs()) break;

    // Completion state from the async operation.
    let op;
    try {
      op = await request(
        orgUrl,
        `/api/data/${API_VERSION}/asyncoperations(${asyncOperationId})?$select=statecode,statuscode,message,friendlymessage`,
        { timeoutMs: Math.min(30000, remainingMs()) }
      );
      if (!remainingMs()) break;
    } catch (error) {
      if ([401, 403].includes(error.status) || /Microsoft session/.test(error.message)) throw error;
      continue;
    }
    if (op.statecode === 3) {
      if (op.statuscode === 30) {
        report(100, 'Import completed.');
        return { ok: true, importJobId, asyncOperationId, ...waitDetails };
      }
      return importFailure(orgUrl, importJobId, op.friendlymessage || op.message || 'Import failed', asyncOperationId);
    }
  }
  return timedOut(asyncOperationId);
}

async function waitForInstallation(orgUrl, onProgress, options = {}) {
  const ownOperationId = options.excludeAsyncOperationId;
  if (ownOperationId && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ownOperationId)) {
    throw new Error('The import returned an invalid system-job reference. Check the target before retrying.');
  }
  return installation.waitForInstallation({
    ...options,
    report: message => onProgress?.(null, message),
    readActive: async timeoutMs => {
      // solutionhistories can reject external callers with Microsoft's restricted-
      // publisher API error. Read documented background system jobs instead:
      // Ribbon Client Metadata (76), Import Solution Metadata (93), and solution
      // installation after app updates (337). Ordinary custom-solution imports,
      // publishes, upgrades and uninstalls do not enter this background wait.
      // Job names/types do not prove the publisher of an individual solution.
      // statecode=3 is terminal (success, failure or cancellation).
      // https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/asyncoperation
      const types = [76, 93, 337];
      const filter = types.map(type => `operationtype eq ${type}`).join(' or ');
      const excludeOwn = ownOperationId ? ` and asyncoperationid ne ${ownOperationId}` : '';
      const data = await request(orgUrl,
        `/api/data/${API_VERSION}/asyncoperations?$select=asyncoperationid,name,operationtype,startedon&$filter=statecode ne 3 and (${filter})${excludeOwn}&$top=50`,
        { timeoutMs });
      if (!Array.isArray(data.value)) throw new Error('Dataverse did not return a valid installation-status response.');
      return data.value.map(job => ({ ...job, solutionname: job.name || 'Microsoft solution/ribbon installation' }));
    }
  });
}

async function importSolutionFromFile(orgUrl, file, options = {}, onProgress) {
  // Start a conflict budget only when Microsoft rejects a concurrent submission.
  // Upload/import duration does not consume the background-installation budget.
  let conflictDeadline;
  let lastResult;
  let phase = 'installation';
  try {
    await waitForInstallation(orgUrl, onProgress);
    while (true) {
      if (conflictDeadline !== undefined && Date.now() >= conflictDeadline) {
        await waitForInstallation(orgUrl, onProgress, { deadline: conflictDeadline });
      }
      phase = 'import';
      lastResult = await importOnce(orgUrl, file, options, onProgress);
      phase = 'installation';
      if (!lastResult.ok && lastResult.importRejected && installation.isInstallationBusy(lastResult.error)) {
        // The server rejected this operation before it could import. The next
        // attempt uses a new job ID; repeated rejections share a 15-minute budget.
        conflictDeadline ??= Date.now() + installation.MAX_WAIT_MS;
        onProgress?.(null, 'Dataverse reports another solution/RibbonData operation is running. Waiting before retrying this solution…');
        await sleep(Math.min(installation.CHECK_INTERVAL_MS, Math.max(0, conflictDeadline - Date.now())));
        await waitForInstallation(orgUrl, onProgress, { settle: true, deadline: conflictDeadline });
        continue;
      }
      if (!lastResult.ok) return lastResult;
      await waitForInstallation(orgUrl, onProgress, { settle: true, excludeAsyncOperationId: lastResult.asyncOperationId });
      onProgress?.(100, 'Import and Microsoft installation completed.');
      return { ...lastResult, importCompleted: true };
    }
  } catch (error) {
    return { ...lastResult, ok: false, error: error.message, phase: error.phase || phase,
      importCompleted: !!lastResult?.ok };
  }
}

function withAccount(accountId, action) {
  if (!accountId) throw new Error('Sign in before starting the deployment queue.');
  return deploymentAccount.run(accountId, action);
}

// ---- Publish ----
async function publishAll(orgUrl, onProgress) {
  if (onProgress) onProgress('Publishing customizations...\n');
  await request(orgUrl, `/api/data/${API_VERSION}/PublishAllXml`, { method: 'POST', body: {} });
  return { ok: true };
}

// ---- Whoami (connectivity check for an org) ----
async function whoami(orgUrl) {
  const data = await request(orgUrl, `/api/data/${API_VERSION}/WhoAmI`);
  return { ok: true, ...data };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  discoverEnvironments,
  listSolutions,
  setSolutionVersion,
  addSolutionComponent,
  findComponentBySchema,
  getEntityPrimaryNameAttribute,
  exportSolution,
  exportToFile,
  importSolutionFromFile,
  waitForInstallation,
  withAccount,
  publishAll,
  whoami
};
