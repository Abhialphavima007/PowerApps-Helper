'use strict';

// v1.0.6 — existing ZIPs retain original three- or four-part versions.
const crypto = require('crypto');
const fs = require('fs');
const GUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const UNIQUE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;
const SOURCE_VERSION = /^\d+\.\d+\.\d+\.\d+$/;
const ZIP_VERSION = /^\d+\.\d+\.\d+(?:\.\d+)?$/;

function environmentUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.dynamics.com') ||
      url.username || url.password || url.port || url.search || url.hash || !/^\/?$/.test(url.pathname)) {
    throw new Error('Choose a valid HTTPS Dataverse environment for the queue.');
  }
  return url.origin;
}

async function preflight(params, { dataverse, zip, checkAccount }) {
  const snapshot = structuredClone(params);
  if (!['source', 'file'].includes(snapshot.mode) || !Array.isArray(snapshot.items) ||
      !snapshot.items.length || snapshot.items.length > 100) throw new Error('Choose between 1 and 100 solutions for the queue.');
  snapshot.targetUrl = environmentUrl(snapshot.targetUrl);
  if (snapshot.mode === 'source') {
    snapshot.sourceUrl = environmentUrl(snapshot.sourceUrl);
    if (snapshot.sourceUrl === snapshot.targetUrl) throw new Error('Source and target must differ.');
  }
  await checkAccount();
  await dataverse.whoami(snapshot.targetUrl);
  const available = snapshot.mode === 'source' ? await dataverse.listSolutions(snapshot.sourceUrl) : null;
  if (available && !available.ok) throw new Error('Could not verify the source solutions.');
  const seen = new Set();
  for (const item of snapshot.items) {
    if (snapshot.mode === 'file' || item.analysis) {
      const artifact = snapshot.mode === 'file' ? item.artifact : item.analysis.artifact;
      const bytes = fs.readFileSync(artifact);
      if (snapshot.mode === 'file' && item.sha256 &&
          crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) {
        throw new Error('A selected ZIP changed after review. Choose the solution packages again: ' + item.solutionUniqueName);
      }
      const inspection = zip.inspect(bytes);
      if (!UNIQUE_NAME.test(inspection.uniqueName || '')) throw new Error(`Cannot review ${artifact}: a valid solution unique name is missing from solution.xml.`);
      const versionPattern = snapshot.mode === 'file' ? ZIP_VERSION : SOURCE_VERSION;
      if (!versionPattern.test(inspection.version || '')) {
        const format = snapshot.mode === 'file' ? 'three or four numeric parts, such as 1.0.67 or 1.0.67.0' : 'four numeric parts, such as 1.0.0.0';
        throw new Error(`Cannot review ${inspection.uniqueName}: found solution version "${inspection.version || '(missing)'}" in ${artifact}. Helper requires ${format}. Choose a ZIP containing a valid solution version.`);
      }
      if (snapshot.mode === 'file' && (inspection.uniqueName !== item.solutionUniqueName ||
          inspection.version !== item.version || inspection.managed !== item.exportManaged)) {
        throw new Error('A selected ZIP changed after review. Choose the solution packages again.');
      }
      if (snapshot.mode === 'source' && (inspection.uniqueName !== item.solutionUniqueName ||
          inspection.version !== item.version || inspection.managed !== !!snapshot.exportManaged)) {
        throw new Error('An exported package no longer matches the selected solution, version or type. Export the queue again.');
      }
      item.analysis = { artifact, inspection, stored: item.analysis?.stored || { storage: 'local', storedPath: artifact } };
      if (snapshot.mode === 'file') {
        item.solutionUniqueName = inspection.uniqueName;
        item.solution = inspection.uniqueName;
        item.version = inspection.version;
        item.exportManaged = inspection.managed;
      }
    }
    if (!UNIQUE_NAME.test(item.solutionUniqueName || '') || seen.has(item.solutionUniqueName.toLowerCase())) {
      throw new Error('Choose each solution only once in the queue.');
    }
    seen.add(item.solutionUniqueName.toLowerCase());
    if (snapshot.mode === 'source') {
      if (!GUID.test(item.solutionId || '') || !SOURCE_VERSION.test(item.version || '')) throw new Error('Every source solution needs a valid ID and four-part version.');
      const current = available.solutions?.find(solution => solution.uniqueName === item.solutionUniqueName && !solution.isManaged);
      if (!current || current.solutionId?.toLowerCase() !== item.solutionId.toLowerCase()) {
        throw new Error('A selected unmanaged source solution changed or is no longer accessible: ' + item.solutionUniqueName);
      }
      if (snapshot.package && !item.analysis && current.version !== item.version) {
        throw new Error('A saved package source version changed. Reload the package before exporting: ' + item.solutionUniqueName);
      }
    }
  }
  return snapshot;
}

async function prepareQueue(params, services) {
  // A fresh export replaces old analyses, including missing or stale ZIPs.
  const draft = structuredClone(params);
  if (draft.mode === 'source' && Array.isArray(draft.items)) {
    draft.items.forEach(item => { delete item.analysis; });
  }
  const snapshot = await preflight(draft, services);
  if (snapshot.mode !== 'source') return { ok: true, items: snapshot.items };
  const items = [];
  for (let index = 0; index < snapshot.items.length; index++) {
    await services.checkAccount();
    const item = snapshot.items[index];
    services.onItem?.(index, 'running', 'Exporting and reviewing…');
    const analysis = await services.exportItem(snapshot, item, index);
    if (!analysis.ok || analysis.inspection?.uniqueName !== item.solutionUniqueName ||
        analysis.inspection?.version !== item.version || analysis.inspection?.managed !== !!snapshot.exportManaged) {
      const message = analysis.error || 'Exported package does not match the selected solution, version or type.';
      services.onItem?.(index, 'error', message);
      for (let next = index + 1; next < snapshot.items.length; next++) {
        services.onItem?.(next, 'skipped', 'Not exported because an earlier export failed.');
      }
      throw new Error(item.solutionUniqueName + ': ' + message);
    }
    items.push({ ...item, analysis });
    services.onItem?.(index, 'ready', 'Exported and ready to review.');
  }
  return { ok: true, items };
}

async function runQueue(params, services) {
  const snapshot = await preflight(params, services);
  if (snapshot.mode === 'source' && !snapshot.useAgent && snapshot.items.some(item => !item.analysis)) {
    throw new Error('Export and review every source solution before importing the queue.');
  }
  snapshot.queueId = crypto.randomUUID();
  await services.onStart?.(snapshot);
  const results = [];
  for (let index = 0; index < snapshot.items.length; index++) {
    const item = snapshot.items[index];
    services.onItem?.(index, 'running', 'Starting deployment…', snapshot.queueId);
    let result;
    try {
      await services.checkAccount();
      // No parallel imports. runItem resolves only after import, Microsoft
      // installation readiness, optional publish, and result recording.
      result = await services.runItem(snapshot, item, index);
    } catch (error) { result = { ok: false, error: error.message }; }
    results.push({ solutionUniqueName: item.solutionUniqueName, ...result });
    await services.onResult?.(snapshot, index, result);
    services.onItem?.(index, result.ok ? 'done' : 'error', result.ok ? (result.warning || 'Deployment completed.') : result.error, snapshot.queueId);
    if (!result.ok) {
      for (let next = index + 1; next < snapshot.items.length; next++) {
        services.onItem?.(next, 'skipped', 'Not started because an earlier solution failed.', snapshot.queueId);
      }
      return { ok: false, queueId: snapshot.queueId, results,
        completed: results.filter(entry => entry.ok).length, total: snapshot.items.length,
        error: item.solutionUniqueName + ': ' + (result.error || 'Deployment failed.') };
    }
  }
  return { ok: true, queueId: snapshot.queueId, results, completed: results.length, total: snapshot.items.length };
}

module.exports = { prepareQueue, runQueue };
