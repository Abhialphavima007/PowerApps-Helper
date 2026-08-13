'use strict';
// Wrapper around the Power Platform CLI (`pac`).
// Shells out to the locally installed pac executable. No Entra app registration
// required for the default flow: device-code / interactive login is used.

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const isWin = process.platform === 'win32';

// Resolve the pac executable. pac is distributed as a dotnet tool or standalone.
function pacCommand() {
  return process.env.PAC_PATH || 'pac';
}

// Run a pac command and capture stdout/stderr.
function run(args, { onData } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(pacCommand(), args, {
        shell: isWin, // allow resolving pac.cmd on Windows PATH
        env: process.env
      });
    } catch (err) {
      return resolve({ ok: false, code: -1, stdout: '', stderr: String(err) });
    }
    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      if (onData) onData(s);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (onData) onData(s);
    });
    child.on('error', (err) => {
      resolve({ ok: false, code: -1, stdout, stderr: stderr + '\n' + String(err) });
    });
    child.on('close', (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

// Check pac is installed and return its version.
async function checkInstalled() {
  const r = await run(['--version']);
  if (!r.ok) {
    return {
      installed: false,
      message:
        'Power Platform CLI (pac) was not found on PATH. Install it via: dotnet tool install --global Microsoft.PowerApps.CLI.Tool  (or the standalone MSI/pkg), then restart the app.'
    };
  }
  return { installed: true, version: r.stdout.trim() };
}

// Some pac versions support JSON output via `--json`. We try JSON first and
// fall back to parsing the plain table if needed.
function tryParseJson(text) {
  try {
    // pac sometimes prints banners before the JSON; grab the first {...} or [...] block.
    const start = text.search(/[[{]/);
    if (start === -1) return null;
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

// ---- Auth ----

// Interactive / device-code login. Creates a named auth profile.
// pac opens a browser (interactive) automatically; no client secret needed.
async function authCreate({ name, deviceCode } = {}, onData) {
  const args = ['auth', 'create'];
  if (name) args.push('--name', name);
  if (deviceCode) args.push('--deviceCode');
  return run(args, { onData });
}

// Create an auth profile from a service principal (optional path).
async function authCreateSpn({ name, environment, applicationId, clientSecret, tenant }, onData) {
  const args = ['auth', 'create'];
  if (name) args.push('--name', name);
  if (environment) args.push('--environment', environment);
  args.push('--applicationId', applicationId, '--clientSecret', clientSecret, '--tenant', tenant);
  return run(args, { onData });
}

async function authList() {
  const r = await run(['auth', 'list']);
  return { ...r, profiles: parseAuthList(r.stdout) };
}

async function authSelect(index) {
  return run(['auth', 'select', '--index', String(index)]);
}

async function authDelete(index) {
  return run(['auth', 'delete', '--index', String(index)]);
}

function parseAuthList(text) {
  // Format: [index] * NAME  KIND  USER  CLOUD  ENVIRONMENT
  const lines = text.split(/\r?\n/).filter((l) => /^\s*\[\d+\]/.test(l));
  return lines.map((line) => {
    const active = line.includes('*');
    const idx = (line.match(/\[(\d+)\]/) || [])[1];
    const rest = line.replace(/^\s*\[\d+\]\s*\*?\s*/, '').trim();
    const cols = rest.split(/\s{2,}/);
    return {
      index: idx ? Number(idx) : null,
      active,
      name: cols[0] || '',
      kind: cols[1] || '',
      user: cols[2] || '',
      cloud: cols[3] || '',
      environment: cols.slice(4).join(' ') || ''
    };
  });
}

// ---- Environments ----

async function listEnvironments() {
  // Try JSON first.
  let r = await run(['admin', 'list', '--json']);
  let parsed = r.ok ? tryParseJson(r.stdout) : null;
  if (parsed && Array.isArray(parsed)) {
    return { ok: true, environments: normalizeEnvs(parsed) };
  }
  // Fallback: org list (works for any signed-in user, not just admins).
  r = await run(['org', 'list', '--json']);
  parsed = r.ok ? tryParseJson(r.stdout) : null;
  if (parsed && Array.isArray(parsed)) {
    return { ok: true, environments: normalizeEnvs(parsed) };
  }
  // Last resort: parse table output of `pac admin list`.
  const t = await run(['admin', 'list']);
  return { ok: t.ok, environments: parseEnvTable(t.stdout), raw: t.stdout + t.stderr };
}

function normalizeEnvs(arr) {
  return arr.map((e) => ({
    displayName: e.DisplayName || e.FriendlyName || e.displayName || e.EnvironmentName || '',
    environmentId: e.EnvironmentId || e.environmentId || e.EnvironmentName || '',
    environmentUrl: e.EnvironmentUrl || e.OrganizationUrl || e.environmentUrl || e.Url || '',
    type: e.Type || e.EnvironmentType || e.type || ''
  })).filter((e) => e.displayName || e.environmentUrl);
}

function parseEnvTable(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const m = line.match(/(https?:\/\/[^\s]+)/);
    if (m) {
      const url = m[1];
      const name = line.slice(0, line.indexOf(url)).trim();
      out.push({ displayName: name, environmentUrl: url, environmentId: url, type: '' });
    }
  }
  return out;
}

// Point pac at a specific environment (by url or id) for subsequent commands.
async function selectEnvironment(environment) {
  return run(['org', 'select', '--environment', environment]);
}

// ---- Solutions ----

async function listSolutions(environmentUrl) {
  const args = ['solution', 'list'];
  if (environmentUrl) args.push('--environment', environmentUrl);
  const r = await run([...args, '--json']);
  const parsed = r.ok ? tryParseJson(r.stdout) : null;
  if (parsed && Array.isArray(parsed)) {
    return { ok: true, solutions: parsed.map(normalizeSolution) };
  }
  const t = await run(args);
  return { ok: t.ok, solutions: parseSolutionTable(t.stdout), raw: t.stdout + t.stderr };
}

function normalizeSolution(s) {
  return {
    uniqueName: s.SolutionUniqueName || s.uniqueName || s.UniqueName || '',
    friendlyName: s.FriendlyName || s.friendlyName || s.DisplayName || '',
    version: s.VersionNumber || s.Version || s.version || '',
    isManaged: s.IsManaged ?? s.isManaged ?? false
  };
}

function parseSolutionTable(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !/^-+$/.test(l));
  const out = [];
  for (const line of lines) {
    if (/Unique Name|Friendly Name|Solution/i.test(line) && /Version/i.test(line)) continue;
    const cols = line.trim().split(/\s{2,}/);
    if (cols.length >= 2) {
      out.push({
        uniqueName: cols[0],
        friendlyName: cols[1] || cols[0],
        version: cols[2] || '',
        isManaged: /managed/i.test(line)
      });
    }
  }
  return out;
}

// Set the version of a solution in the source environment before export.
async function setSolutionVersion({ environmentUrl, solutionName, version }) {
  const args = ['solution', 'online-version', '--solution-name', solutionName, '--solution-version', version];
  if (environmentUrl) args.push('--environment', environmentUrl);
  return run(args);
}

// Export a solution to a local zip. managed=true exports managed.
async function exportSolution({ environmentUrl, solutionName, outFile, managed }, onData) {
  const args = ['solution', 'export', '--name', solutionName, '--path', outFile, '--overwrite'];
  if (managed) args.push('--managed');
  if (environmentUrl) args.push('--environment', environmentUrl);
  return run(args, { onData });
}

// Import a solution zip into the target environment.
// publishChanges publishes customizations after import (for unmanaged).
async function importSolution({ environmentUrl, file, publishChanges, forceOverwrite }, onData) {
  const args = ['solution', 'import', '--path', file];
  if (environmentUrl) args.push('--environment', environmentUrl);
  if (publishChanges) args.push('--publish-changes');
  if (forceOverwrite) args.push('--force-overwrite');
  return run(args, { onData });
}

// Check dependencies / missing dependencies for a solution zip against a target env.
async function checkSolution({ environmentUrl, file }, onData) {
  const args = ['solution', 'check', '--path', file];
  if (environmentUrl) args.push('--environment', environmentUrl);
  return run(args, { onData });
}

module.exports = {
  run,
  checkInstalled,
  authCreate,
  authCreateSpn,
  authList,
  authSelect,
  authDelete,
  listEnvironments,
  selectEnvironment,
  listSolutions,
  setSolutionVersion,
  exportSolution,
  importSolution,
  checkSolution
};
