'use strict';

// v1.1.3 — accept original three- or four-part versions in existing ZIPs.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const solutionZip = require('./solutionZip');
const GUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const UNIQUE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;
const SOURCE_VERSION = /^\d+\.\d+\.\d+\.\d+$/;
const ZIP_VERSION = /^\d+\.\d+\.\d+(?:\.\d+)?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_BYTES = 128 * 1024;

function text(value, label, max, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw new Error(`Enter a valid ${label} (up to ${max} characters).`);
  }
  return value.trim();
}

function sourceUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.dynamics.com') || url.username ||
      url.password || url.port || url.search || url.hash || !/^\/?$/.test(url.pathname)) {
    throw new Error('Choose a valid HTTPS Dataverse source environment.');
  }
  return url.origin;
}

function definition(input, allowMissingFingerprint = false) {
  const fileMode = input?.schemaVersion === 2 && input.mode === 'file';
  if (!input || !(input.schemaVersion === 1 || fileMode) || !GUID.test(input.id || '') ||
      !Array.isArray(input.items) || !input.items.length || input.items.length > 100 ||
      typeof input.exportManaged !== 'boolean' ||
      !Number.isFinite(Date.parse(input.createdAt)) || !Number.isFinite(Date.parse(input.updatedAt))) {
    throw new Error('This package definition is invalid or uses an unsupported format.');
  }
  const seen = new Set();
  const items = input.items.map(item => {
    if (!UNIQUE_NAME.test(item?.solutionUniqueName || '') || seen.has(item.solutionUniqueName.toLowerCase())) {
      throw new Error('A package must contain valid, distinct solution unique names.');
    }
    seen.add(item.solutionUniqueName.toLowerCase());
    const result = { solutionUniqueName: item.solutionUniqueName,
      solution: text(item.solution || item.solutionUniqueName, 'solution display name', 200, true) };
    if (fileMode) {
      if (typeof item.version !== 'string' || !ZIP_VERSION.test(item.version)) {
        throw new Error(`Cannot save ${item.solutionUniqueName}: found solution version "${item.version || '(missing)'}". Existing ZIP versions must have three or four numeric parts, such as 1.0.67 or 1.0.67.0. Choose a ZIP containing a valid solution version.`);
      }
      if (typeof item.exportManaged !== 'boolean') throw new Error(`Cannot save ${item.solutionUniqueName}: its managed or unmanaged type is missing. Choose its ZIP again.`);
      if (!SHA256.test(item.sha256 || '') && !(allowMissingFingerprint && item.sha256 === undefined)) throw new Error(`Cannot save ${item.solutionUniqueName}: its file fingerprint is missing or invalid. Choose its ZIP again.`);
      Object.assign(result, { artifact: artifactPath(item.artifact), version: item.version,
        exportManaged: item.exportManaged, sha256: item.sha256 });
    }
    return result;
  });
  if (fileMode) return { schemaVersion: 2, mode: 'file', id: input.id,
    name: text(input.name, 'package name', 100, true),
    description: text(input.description || '', 'package description', 2000),
    sourceUrl: '', sourceEnv: 'Package files', exportManaged: items.every(item => item.exportManaged),
    createdAt: input.createdAt, updatedAt: input.updatedAt, items };
  return { schemaVersion: 1, id: input.id, name: text(input.name, 'package name', 100, true),
    description: text(input.description || '', 'package description', 2000),
    sourceUrl: sourceUrl(input.sourceUrl), sourceEnv: text(input.sourceEnv || '', 'source name', 200),
    exportManaged: input.exportManaged, createdAt: input.createdAt, updatedAt: input.updatedAt, items };
}

function artifactPath(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f]/.test(value) ||
      !path.isAbsolute(value) || path.extname(value).toLowerCase() !== '.zip') {
    throw new Error('Choose an absolute path to a solution ZIP file.');
  }
  return path.normalize(value);
}

async function inspectArtifact(item, captureFingerprint = false) {
  const artifact = artifactPath(item.artifact);
  let bytes;
  try { bytes = await fs.readFile(artifact); }
  catch { throw new Error(`Cannot read ${item.solutionUniqueName}: ${artifact}. Reselect its ZIP and save the package again.`); }
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (!(captureFingerprint && item.sha256 === undefined) &&
      (!SHA256.test(item.sha256 || '') || item.sha256 !== sha256)) {
    throw new Error(`The ZIP for ${item.solutionUniqueName} changed. Reselect it, review it and save the package again.`);
  }
  const inspection = solutionZip.inspect(bytes);
  if (inspection.uniqueName !== item.solutionUniqueName || inspection.version !== item.version ||
      inspection.managed !== item.exportManaged) {
    throw new Error(`The ZIP for ${item.solutionUniqueName} does not match its saved solution, version or type. Reselect it and save again.`);
  }
  return { ...item, artifact, sha256,
    analysis: { artifact, inspection, sha256, stored: { storage: 'local', storedPath: artifact } } };
}

function withHash(value) {
  return { ...value, hash: crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') };
}

async function folder(location) {
  if (typeof location !== 'string' || !path.isAbsolute(location)) throw new Error('Choose an absolute package library folder.');
  const resolved = await fs.realpath(location);
  if (!(await fs.stat(resolved)).isDirectory()) throw new Error('The package library location is not a folder.');
  return resolved;
}

function filename(root, id) {
  if (!GUID.test(id || '')) throw new Error('Invalid package reference.');
  return path.join(root, id + '.package.json');
}

async function read(root, id) {
  const file = filename(root, id);
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) throw new Error('Package definition is not a supported small JSON file.');
  const handle = await fs.open(file, 'r');
  let content;
  try {
    // Bound the read even if another process grows the file after lstat.
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!chunk.bytesRead) break;
      bytesRead += chunk.bytesRead;
    }
    if (bytesRead > MAX_BYTES) throw new Error('Package definition is too large.');
    content = buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
  const result = definition(JSON.parse(content));
  if (result.id !== id) throw new Error('Package ID does not match its filename.');
  return withHash(result);
}

async function list(location) {
  const root = await folder(location);
  const entries = (await fs.readdir(root)).filter(name => /^[0-9a-f-]+\.package\.json$/.test(name));
  if (entries.length > 500) throw new Error('This library has more than 500 definitions. Choose a smaller library folder.');
  const packages = [], warnings = [];
  for (const name of entries) {
    try { packages.push(await read(root, name.replace('.package.json', ''))); }
    catch { warnings.push(`Could not read ${name}. Check its format and folder permissions.`); }
  }
  packages.sort((a, b) => a.name.localeCompare(b.name) || b.updatedAt.localeCompare(a.updatedAt));
  return { folder: root, packages, warnings };
}

async function locked(root, id, action) {
  const lockPath = filename(root, id) + '.lock';
  let lock;
  try { lock = await fs.open(lockPath, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('This package is being changed. Try again after the other save finishes.');
    throw error;
  }
  try { return await action(); }
  finally { await lock.close(); await fs.unlink(lockPath); }
}

async function save(location, draft) {
  const root = await folder(location);
  if (!draft.id && (await fs.readdir(root)).filter(name => /^[0-9a-f-]+\.package\.json$/.test(name)).length >= 500) {
    throw new Error('This library already has 500 definitions. Choose another folder before adding a package.');
  }
  const id = draft.id || crypto.randomUUID();
  return locked(root, id, async () => {
    const previous = draft.id ? await read(root, id) : null;
    if (previous && draft.expectedHash !== previous.hash) throw new Error('This package changed. Reload it before saving changes.');
    const now = new Date().toISOString();
    let result = definition({ ...draft, schemaVersion: draft.mode === 'file' ? 2 : 1,
      exportManaged: draft.mode === 'file' ? true : draft.exportManaged,
      id, createdAt: previous?.createdAt || now, updatedAt: now }, draft.mode === 'file');
    if (result.mode === 'file') {
      for (const item of result.items) {
        // Older picker responses can omit the fingerprint. Preserve any saved
        // expectation for an unchanged reference; only a new reference captures it.
        const saved = previous?.mode === 'file' && previous.items.find(existing =>
          existing.solutionUniqueName.toLowerCase() === item.solutionUniqueName.toLowerCase() &&
          existing.artifact === item.artifact);
        if (item.sha256 === undefined && saved) item.sha256 = saved.sha256;
        const verified = await inspectArtifact(item, true);
        item.sha256 = verified.sha256;
      }
      // All persisted definitions still require complete, verified fingerprints.
      result = definition(result);
    }
    const content = JSON.stringify(result, null, 2) + '\n';
    if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) throw new Error('Package definition is too large.');
    const temp = filename(root, id) + '.' + crypto.randomUUID() + '.tmp';
    try {
      await fs.writeFile(temp, content, { flag: 'wx', mode: 0o600 });
      await fs.rename(temp, filename(root, id));
    } finally { await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    return withHash(result);
  });
}

async function remove(location, reference) {
  const root = await folder(location);
  return locked(root, reference.id, async () => {
    const current = await read(root, reference.id);
    if (current.hash !== reference.hash) throw new Error('This package changed. Reload it before removing it.');
    await fs.unlink(filename(root, reference.id));
  });
}

async function get(location, reference) {
  const current = await read(await folder(location), reference.id);
  if (current.hash !== reference.hash) throw new Error('The saved package changed. Select it again and review the new definition.');
  return current;
}

async function resolve(recipe, dataverse) {
  if (recipe.mode === 'file') {
    const items = [];
    for (const item of recipe.items) items.push(await inspectArtifact(item));
    return { package: recipe, items, solutions: [] };
  }
  const available = await dataverse.listSolutions(recipe.sourceUrl);
  if (!available.ok) throw new Error(available.error || 'Could not read the saved source environment.');
  const items = recipe.items.map(item => {
    const current = available.solutions?.find(solution => solution.uniqueName === item.solutionUniqueName && !solution.isManaged);
    if (!current || !SOURCE_VERSION.test(current.version || '') || !current.solutionId) {
      throw new Error('A saved unmanaged solution is missing or inaccessible in the source: ' + item.solutionUniqueName);
    }
    return { solutionUniqueName: current.uniqueName, solution: current.friendlyName || current.uniqueName,
      solutionId: current.solutionId, version: current.version };
  });
  return { package: recipe, items, solutions: (available.solutions || []).filter(item => !item.isManaged) };
}

async function verifyQueue(location, snapshot) {
  if (!snapshot.packageRef) {
    delete snapshot.package;
    return;
  }
  const recipe = await get(location, snapshot.packageRef);
  if (recipe.mode === 'file') {
    if (snapshot.mode !== 'file' || snapshot.useAgent || !Array.isArray(snapshot.items) ||
        snapshot.items.length !== recipe.items.length || snapshot.items.some((item, index) => {
          const saved = recipe.items[index];
          return item.solutionUniqueName !== saved.solutionUniqueName || item.artifact !== saved.artifact ||
            item.version !== saved.version || item.exportManaged !== saved.exportManaged || item.sha256 !== saved.sha256;
        })) {
      throw new Error('The queue no longer matches the saved ZIP package. Select the package again.');
    }
    const resolved = await resolve(recipe);
    snapshot.items = resolved.items;
    snapshot.sourceUrl = '';
    snapshot.sourceEnv = 'Package files';
    snapshot.exportManaged = recipe.exportManaged;
    snapshot.package = recipe;
    return;
  }
  if (snapshot.mode !== 'source' || sourceUrl(snapshot.sourceUrl) !== recipe.sourceUrl ||
      snapshot.exportManaged !== recipe.exportManaged || !Array.isArray(snapshot.items) ||
      snapshot.items.length !== recipe.items.length || snapshot.items.some((item, index) =>
        item.solutionUniqueName !== recipe.items[index].solutionUniqueName)) {
    throw new Error('The queue no longer matches the saved package. Select the package again.');
  }
  snapshot.sourceUrl = recipe.sourceUrl;
  snapshot.sourceEnv = recipe.sourceEnv || recipe.sourceUrl;
  snapshot.package = recipe;
}

module.exports = { list, save, remove, get, resolve, verifyQueue, folder };
