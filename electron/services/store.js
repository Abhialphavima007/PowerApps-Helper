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
    storageMode: 'local', // 'local' | 'onedrive'
    localFolder: path.join(baseDir, 'solutions'),
    oneDriveRoot: 'PowerApps Helper'
  };
}

function getSettings() {
  try {
    return { ...defaultSettings(), ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) };
  } catch {
    return defaultSettings();
  }
}

function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  fs.writeFileSync(settingsFile, JSON.stringify(next, null, 2));
  return next;
}

function artifactsDir() {
  return path.join(baseDir, 'artifacts');
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

module.exports = {
  init,
  artifactsDir,
  getSettings,
  saveSettings,
  listDeployments,
  getDeployment,
  addDeployment,
  updateDeployment
};
