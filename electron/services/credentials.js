'use strict';

const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

const NAMES = ['openai', 'claude', 'grok', 'gemini', 'foundry', 'azureDevOps'];
const PRIVATE_NAMES = ['teamsCodex', 'teamsWorkflow'];
let file;

function init(userDataPath) {
  const dir = path.join(userDataPath, 'powerapps-helper');
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'credentials.bin');
}

function assertReady() {
  if (!file) throw new Error('Credential storage is not initialized.');
  if (!safeStorage?.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable. Credentials were not saved.');
  if (safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('Secure OS credential storage is unavailable. Credentials were not saved.');
}

function read() {
  assertReady();
  if (!fs.existsSync(file)) return {};
  return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
}

function write(data) {
  assertReady();
  fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(data)), { mode: 0o600 });
}

function assertName(name) {
  if (!NAMES.includes(name) && !PRIVATE_NAMES.includes(name)) throw new Error('Unknown credential type.');
}

function save(name, value) {
  assertName(name);
  if (!value || !String(value).trim()) throw new Error('Enter a credential before saving.');
  const data = read();
  data[name] = String(value).trim();
  write(data);
  return status();
}

function remove(name) {
  assertName(name);
  const data = read();
  delete data[name];
  write(data);
  return status();
}

function get(name) {
  assertName(name);
  try { return read()[name] || ''; } catch (e) {
    if (e.message.includes('unavailable')) return '';
    throw e;
  }
}

function status() {
  let data = {};
  try { data = read(); } catch (e) {
    if (!e.message.includes('unavailable')) throw e;
  }
  return Object.fromEntries(NAMES.map((name) => [name, !!data[name]]));
}

module.exports = { init, save, remove, get, status, isPublicName: name => NAMES.includes(name) };
