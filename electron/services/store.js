'use strict';
// Simple JSON-file persistence in the OS app-data folder. No native modules,
// so it installs and runs cleanly on Windows and macOS without a build toolchain.

const fs = require('fs');
const path = require('path');
const { settings: automationSettings, DEFAULTS: AUTOMATION_DEFAULTS } = require('./deploymentAutomation');
const { settings: teamsSettings, DEFAULTS: TEAMS_DEFAULTS } = require('./teamsNotifications');
const { groupHistory, queueHistoryId } = require('./historyGrouping');

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
  fs.mkdirSync(path.join(baseDir, 'packages'), { recursive: true });
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
    deploymentAutomation: { ...AUTOMATION_DEFAULTS },
    teamsNotifications: { ...TEAMS_DEFAULTS, workflowRouting: 'payload' },
    storageMode: 'local', // 'local' | 'onedrive'
    localFolder: path.join(baseDir, 'solutions'),
    packageLibraryFolder: path.join(baseDir, 'packages'),
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
    let deploymentAutomation;
    try { deploymentAutomation = automationSettings(saved.deploymentAutomation); }
    catch { deploymentAutomation = { ...AUTOMATION_DEFAULTS }; }
    return { ...defaults, ...saved, theme: saved.theme === 'light' ? 'light' : 'dark',
      deploymentAutomation,
      // Older callbacks have destinations fixed in the cloud flow.
      teamsNotifications: { ...defaults.teamsNotifications, ...saved.teamsNotifications,
        workflowRouting: saved.teamsNotifications?.workflowRouting || (saved.teamsNotifications ? 'fixed' : 'payload'),
        transport: saved.teamsNotifications?.transport || (saved.teamsNotifications ? 'workflow' : defaults.teamsNotifications.transport) },
      clientNamesByTenant: saved.clientNamesByTenant && typeof saved.clientNamesByTenant === 'object' && !Array.isArray(saved.clientNamesByTenant) ? saved.clientNamesByTenant : {},
      aiModels: { ...defaults.aiModels, ...saved.aiModels } };
  } catch {
    return defaultSettings();
  }
}

function saveSettings(patch) {
  if (Object.prototype.hasOwnProperty.call(patch, 'teamsNotifications')) {
    patch = { ...patch, teamsNotifications: teamsSettings(patch.teamsNotifications) };
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'deploymentAutomation')) {
    patch = { ...patch, deploymentAutomation: automationSettings(patch.deploymentAutomation) };
  }
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

function listHistoryEntries() {
  const data = readAll();
  return groupHistory(data.deployments, data.queues || []);
}

function getHistoryEntry(id) {
  return listHistoryEntries().find(item => item.id === id) || getDeployment(id);
}

// Store only queue metadata and fallback outcomes here. Full logs/notes remain
// in the existing individual deployment records, linked by queueId/index.
function startDeploymentQueue(queue, account) {
  const data = readAll();
  const record = {
    id: queueHistoryId(queue.queueId), queueId: queue.queueId,
    createdAt: new Date().toISOString(), status: 'pending',
    sourceEnv: queue.sourceEnv || 'Package file', sourceUrl: queue.sourceUrl || '',
    targetEnv: queue.targetEnv, targetUrl: queue.targetUrl, account,
    deploymentMethod: queue.useAgent ? 'agent' : 'queue', exportManaged: queue.exportManaged,
    package: queue.package,
    description: queue.description, workItems: queue.workItems, notes: queue.notes,
    items: queue.items.map(item => ({ solution: item.solution || item.solutionUniqueName,
      solutionUniqueName: item.solutionUniqueName, version: item.version,
      exportManaged: item.exportManaged ?? queue.exportManaged,
      deploymentMethod: queue.useAgent ? 'agent' : 'queue', status: 'waiting' }))
  };
  data.queues = [...(data.queues || []), record];
  writeAll(data);
  return record;
}

function updateDeploymentQueue(queueId, index, patch) {
  const data = readAll();
  const record = data.queues?.find(item => item.queueId === queueId);
  if (!record) throw new Error('The queue history record is unavailable.');
  if (index == null) Object.assign(record, patch);
  else {
    if (!record.items[index]) throw new Error('The solution history position is unavailable.');
    Object.assign(record.items[index], patch);
  }
  writeAll(data);
}

function historyFilters(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid history filters.');
  const result = {};
  for (const key of ['source', 'target', 'status', 'query', 'since']) {
    if (value[key] != null && (typeof value[key] !== 'string' || value[key].length > 2000)) throw new Error('Invalid history filter.');
    result[key] = value[key] || '';
  }
  if (result.status && !['success', 'failed', 'pending'].includes(result.status)) throw new Error('Invalid history status.');
  if (result.since && !Number.isFinite(Date.parse(result.since))) throw new Error('Invalid history period.');
  return result;
}

function matchingDeployments(items, value) {
  const { source, target, status, query, since } = historyFilters(value);
  const needle = query.trim().toLocaleLowerCase();
  return items.filter(item => (!since || Date.parse(item.createdAt) >= Date.parse(since))
    && (!source || (item.sourceUrl || item.sourceEnv) === source)
    && (!target || (item.targetUrl || item.targetEnv) === target)
    && (!status || item.status === status)
    && (!needle || [item, ...(item.solutions || [])].some(record =>
      `${record.solution} ${record.package?.name || ''} ${record.solutionUniqueName || ''} ${record.workItems || ''}`.toLocaleLowerCase().includes(needle))));
}

// Keep large notes, import logs and work-item details out of page responses.
function queryDeployments({ filters = {}, page = 1, pageSize = 25 } = {}) {
  if (!Number.isSafeInteger(page) || page < 1 || ![10, 25, 50, 100].includes(pageSize)) throw new Error('Invalid history page.');
  const all = listHistoryEntries();
  const matches = matchingDeployments(all, filters);
  const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const fields = ['id', 'kind', 'createdAt', 'solution', 'package', 'deploymentMethod', 'exportManaged', 'mixedTypes', 'version', 'sourceEnv', 'targetEnv', 'status', 'queueCount', 'completed'];
  const options = (name, url) => [...new Map(all.filter(item => item[name]).map(item =>
    [item[url] || item[name], { id: item[url] || item[name], label: item[name] }])).values()]
    .sort((a, b) => a.label.localeCompare(b.label));
  return {
    items: matches.slice((currentPage - 1) * pageSize, currentPage * pageSize)
      .map(item => Object.fromEntries(fields.map(key => [key, item[key]]))),
    page: currentPage, pageSize, totalPages, total: matches.length,
    summary: { total: all.length, success: all.filter(item => item.status === 'success').length,
      failed: all.filter(item => item.status === 'failed').length },
    sourceOptions: options('sourceEnv', 'sourceUrl'), targetOptions: options('targetEnv', 'targetUrl')
  };
}

function matchingDeploymentIds(filters) {
  return matchingDeployments(listHistoryEntries(), filters).map(item => item.id);
}

function exportHistoryRecords(ids) {
  const wanted = new Set(ids);
  const entries = listHistoryEntries();
  const selected = entries.filter(item => wanted.has(item.id));
  // CSV keeps one row per solution; JSON also retains individual detail.
  const records = selected.flatMap(item => item.kind === 'queue' ? item.solutions.map(solution => ({
    ...solution, queueCreatedAt: item.createdAt, queueFinishedAt: item.finishedAt,
    queueStatus: item.status, queueWarning: item.warning
  })) : [item]);
  // Preserve export by an existing individual ID for older IPC consumers.
  const included = new Set(records.map(item => item.id));
  let individualCount = 0;
  for (const record of listDeployments()) {
    if (wanted.has(record.id) && !included.has(record.id)) {
      records.push(record);
      individualCount += 1;
    }
  }
  return { records, count: selected.length + individualCount };
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
  const groups = groupHistory(data.deployments, data.queues || []);
  const queueIds = new Set(groups.filter(item => item.kind === 'queue' && wanted.has(item.id)).map(item => item.queueId));
  const deleted = groups.filter(item => wanted.has(item.id)).length;
  const individualDeleted = data.deployments.filter(item => wanted.has(item.id) && item.queueId && !queueIds.has(item.queueId)).length;
  data.deployments = data.deployments.filter(item => !wanted.has(item.id) && !queueIds.has(item.queueId));
  if (data.queues) data.queues = data.queues.filter(item => !queueIds.has(item.queueId));
  writeAll(data);
  return { deleted: deleted + individualDeleted };
}

module.exports = {
  init,
  artifactsDir,
  getSettings,
  saveSettings,
  getClientNamePreference,
  saveClientNamePreference,
  listDeployments,
  listHistoryEntries,
  getHistoryEntry,
  startDeploymentQueue,
  updateDeploymentQueue,
  exportHistoryRecords,
  queryDeployments,
  matchingDeploymentIds,
  getDeployment,
  addDeployment,
  updateDeployment,
  deleteDeployments
};
