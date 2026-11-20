'use strict';
// Simple JSON-file persistence in the OS app-data folder. No native modules,
// so it installs and runs cleanly on Windows and macOS without a build toolchain.

const fs = require('fs');
const path = require('path');

let baseDir;
let dbFile;
let settingsFile;

function init(userDataPath) {
  baseDir = path.join(userDataPath, 'powerapps-helper');
  dbFile = path.join(baseDir, 'deployments.json');
  settingsFile = path.join(baseDir, 'settings.json');
  fs.mkdirSync(baseDir, { recursive: true });
  fs.mkdirSync(path.join(baseDir, 'artifacts'), { recursive: true });
  fs.mkdirSync(path.join(baseDir, 'solutions'), { recursive: true });
  if (!fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, JSON.stringify({ deployments: [] }, null, 2));
  }
  if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(settingsFile, JSON.stringify(defaultSettings(), null, 2));
  }
}

function defaultSettings() {
  return {
    theme: 'dark', // 'dark' | 'light'
    storageMode: 'local', // 'local' | 'onedrive'
    localFolder: path.join(baseDir, 'solutions'),
    oneDriveRoot: 'PowerApps Helper',
    clientName: '',
    clientNamesByTenant: {},
    clientNameLegacyTenantId: '',
    azureDevOpsOrgUrl: '',
    azureFoundryEndpoint: '',
    aiModels: { openai: 'gpt-4.1-mini', claude: 'claude-sonnet-4-5-20250929', grok: 'grok-4', gemini: 'gemini-2.5-flash', foundry: '' }
  };
}

function getSettings() {
  try {
    const defaults = defaultSettings();
    const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    return { ...defaults, ...saved, theme: saved.theme === 'light' ? 'light' : 'dark',
      clientNamesByTenant: saved.clientNamesByTenant && typeof saved.clientNamesByTenant === 'object' && !Array.isArray(saved.clientNamesByTenant) ? saved.clientNamesByTenant : {},
      aiModels: { ...defaults.aiModels, ...saved.aiModels } };
  } catch {
    return defaultSettings();
  }
}

function saveSettings(patch) {
  if (Object.prototype.hasOwnProperty.call(patch, 'theme') && !['dark', 'light'].includes(patch.theme)) {
    throw new Error('Choose light or dark mode.');
  }
  const current = getSettings();
  const next = { ...current, ...patch, aiModels: { ...current.aiModels, ...patch.aiModels } };
  fs.writeFileSync(settingsFile, JSON.stringify(next, null, 2));
  return next;
}

function artifactsDir() {
  return path.join(baseDir, 'artifacts');
}

function getClientNamePreference(tenantKey) {
  let settings = getSettings();
  // Preserve a name entered before tenant-specific preferences were introduced.
  if (!settings.clientNameLegacyTenantId && typeof settings.clientName === 'string' && settings.clientName.trim()) {
    const names = settings.clientNamesByTenant;
    settings = saveSettings({
      clientNameLegacyTenantId: tenantKey,
      clientNamesByTenant: { ...names, [tenantKey]: Object.prototype.hasOwnProperty.call(names, tenantKey) ? names[tenantKey] : settings.clientName.trim() }
    });
  }
  const value = settings.clientNamesByTenant[tenantKey];
  return typeof value === 'string' ? value.trim() : '';
}

function saveClientNamePreference(tenantKey, value) {
  if (typeof value !== 'string' || value.trim().length > 80) throw new Error('Enter a client name of up to 80 characters.');
  getClientNamePreference(tenantKey);
  const settings = getSettings();
  saveSettings({ clientNamesByTenant: { ...settings.clientNamesByTenant, [tenantKey]: value.trim() } });
}

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  } catch {
    return { deployments: [] };
  }
}

function writeAll(data) {
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
}

function listDeployments() {
  const data = readAll();
  return data.deployments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getDeployment(id) {
  return readAll().deployments.find((d) => d.id === id) || null;
}

function addDeployment(record) {
  const data = readAll();
  const id = 'dep_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const full = { id, createdAt: new Date().toISOString(), status: 'pending', ...record };
  data.deployments.push(full);
  writeAll(data);
  return full;
}

function updateDeployment(id, patch) {
  const data = readAll();
  const idx = data.deployments.findIndex((d) => d.id === id);
  if (idx === -1) return null;
  data.deployments[idx] = { ...data.deployments[idx], ...patch, updatedAt: new Date().toISOString() };
  writeAll(data);
  return data.deployments[idx];
}

function deleteDeployments(ids) {
  const wanted = new Set(ids);
  const data = readAll();
  const before = data.deployments.length;
  data.deployments = data.deployments.filter((item) => !wanted.has(item.id));
  writeAll(data);
  return { deleted: before - data.deployments.length };
}

module.exports = {
  init,
  artifactsDir,
  getSettings,
  saveSettings,
  getClientNamePreference,
  saveClientNamePreference,
  listDeployments,
  getDeployment,
  addDeployment,
  updateDeployment,
  deleteDeployments
};
