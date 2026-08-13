'use strict';
// Direct Dataverse Web API client. Talks to the cloud with an access token from
// auth.js — no pac subprocess, so calls are fast and low-lag.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const auth = require('./auth');

const API_VERSION = 'v9.2';

async function request(orgUrl, relPath, { method = 'GET', body, resource, raw } = {}) {
  const token = await auth.getToken(resource || orgUrl);
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
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text)?.error?.message || text;
    } catch {}
    const err = new Error(`${res.status} ${res.statusText}: ${msg}`);
    err.status = res.status;
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
    "/solutions?$select=uniquename,friendlyname,version,ismanaged,solutionid&$filter=isvisible eq true&$orderby=friendlyname asc";
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
async function importSolutionFromFile(orgUrl, file, { overwrite = true, publishWorkflows = true } = {}, onProgress) {
  const b64 = fs.readFileSync(file).toString('base64');
  const importJobId = crypto.randomUUID();
  const body = {
    OverwriteUnmanagedCustomizations: !!overwrite,
    PublishWorkflows: !!publishWorkflows,
    CustomizationFile: b64,
    ImportJobId: importJobId
  };
  const report = (pct, msg) => { if (onProgress) onProgress(pct, msg); };

  // Prefer the async message; fall back to synchronous ImportSolution.
  let asyncOperationId = null;
  try {
    report(2, 'Uploading package & queueing import…');
    const r = await request(orgUrl, `/api/data/${API_VERSION}/ImportSolutionAsync`, { method: 'POST', body });
    asyncOperationId = r.AsyncOperationId || r.asyncoperationid;
  } catch (e) {
    if (e.status === 404) {
      report(null, 'Async import unavailable; importing synchronously (this can take a while)…');
      await request(orgUrl, `/api/data/${API_VERSION}/ImportSolution`, { method: 'POST', body });
      report(100, 'Import completed.');
      return { ok: true, importJobId };
    }
    throw e;
  }

  if (!asyncOperationId) { report(100, 'Import submitted.'); return { ok: true, importJobId }; }

  // Adaptive polling: quick at first for snappy feedback, then back off.
  const started = Date.now();
  const timeoutMs = 20 * 60 * 1000;
  let delay = 1200;
  let lastPct = 2;
  while (Date.now() - started < timeoutMs) {
    await sleep(delay);
    delay = Math.min(delay + 800, 4000);

    // Real progress percentage from the import job (may 404 until it exists).
    try {
      const job = await request(orgUrl, `/api/data/${API_VERSION}/importjobs(${importJobId})?$select=progress`);
      if (typeof job.progress === 'number' && job.progress > lastPct) {
        lastPct = Math.min(99, Math.round(job.progress));
        report(lastPct, `Importing… ${lastPct}%`);
      }
    } catch { /* job not visible yet */ }

    // Completion state from the async operation.
    let op;
    try {
      op = await request(
        orgUrl,
        `/api/data/${API_VERSION}/asyncoperations(${asyncOperationId})?$select=statecode,statuscode,message,friendlymessage`
      );
    } catch {
      continue;
    }
    if (op.statecode === 3) {
      if (op.statuscode === 30) {
        report(100, 'Import completed.');
        return { ok: true, importJobId, asyncOperationId };
      }
      return { ok: false, error: op.friendlymessage || op.message || 'Import failed', importJobId, asyncOperationId };
    }
  }
  return { ok: false, error: 'Import timed out while waiting for completion.', importJobId, asyncOperationId };
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
  exportSolution,
  exportToFile,
  importSolutionFromFile,
  publishAll,
  whoami
};
