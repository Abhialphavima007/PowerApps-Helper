'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Evaluate the actual registration function without starting Electron, auth or a deployment.
function handlers(teamsNotifications, windowsHello) {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  const start = source.indexOf('function registerIpc() {');
  assert.ok(start > 0);
  const registered = new Map();
  const context = { ipcMain: { handle: (name, handler) => registered.set(name, handler) },
    teamsNotifications, windowsHello, deploymentHandler: handler => handler, ok: value => ({ ok: true, ...value }),
    fail: error => ({ ok: false, error: error.message }) };
  vm.runInNewContext(source.slice(start), context, { filename: 'main-register-ipc.js' });
  context.registerIpc();
  return registered;
}

test('workflow IPC checks only the workflow service and forwards explicit direct sender expectations', async () => {
  let checked = 0;
  let connected = 0;
  const registered = handlers({
    checkWorkflow() { checked++; return { ok: true, transport: 'workflow' }; },
    connect(expected) { connected++; assert.equal(expected, 'graph'); return { ok: true, transport: 'graph' }; }
  }, { verify() { throw new Error('Setup check must not request identity verification.'); } });
  assert.equal(registered.get('teams:checkWorkflow')().transport, 'workflow');
  assert.equal(checked, 1);
  assert.equal(connected, 0);
  assert.equal((await registered.get('teams:connect')({}, 'graph')).transport, 'graph');
  assert.equal(connected, 1);
});

test('workflow reveal waits for successful Windows Hello and shares the credential concurrency guard', async () => {
  let release;
  let reveals = 0;
  const registered = handlers({ workflowStatus: () => ({ configured: true }),
    revealWorkflow: () => { reveals++; return 'synthetic-secret-address'; } },
  { verify: () => new Promise(resolve => { release = resolve; }) });
  const pending = registered.get('teams:revealWorkflow')();
  assert.equal(reveals, 0);
  assert.match((await registered.get('credentials:reveal')({}, 'openai')).error, /already in progress/);
  assert.match((await registered.get('teams:revealWorkflow')()).error, /already in progress/);
  release({ ok: false, message: 'Cancelled.' });
  assert.equal((await pending).ok, false);
  assert.equal(reveals, 0);
  const approved = registered.get('teams:revealWorkflow')();
  release({ ok: true });
  assert.deepEqual(await approved, { ok: true, value: 'synthetic-secret-address' });
  assert.equal(reveals, 1);
});

test('missing address and failed identity verification never expose a workflow secret; guard recovers', async () => {
  let configured = false;
  let verifies = 0;
  const registered = handlers({ workflowStatus: () => ({ configured }),
    revealWorkflow() { throw new Error('Must not reveal before identity verification.'); } },
  { async verify() { verifies++; throw new Error('Verification unavailable.'); } });
  assert.match((await registered.get('teams:revealWorkflow')()).error, /No saved workflow address/);
  assert.equal(verifies, 0);
  configured = true;
  assert.match((await registered.get('teams:revealWorkflow')()).error, /Verification unavailable/);
  assert.match((await registered.get('teams:revealWorkflow')()).error, /Verification unavailable/);
  assert.equal(verifies, 2);
});

test('preload exposes additive workflow routes without calling the generic connection', async () => {
  let api;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/preload.js'), 'utf8'), {
    require: name => {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
        ipcRenderer: { invoke: async (...args) => { calls.push(args); return { ok: true }; } } };
    }
  });
  await api.teams.checkWorkflow();
  await api.teams.revealWorkflow();
  await api.teams.connect('graph');
  assert.deepEqual(calls.map(args => Array.from(args)), [
    ['teams:checkWorkflow'], ['teams:revealWorkflow'], ['teams:connect', 'graph']
  ]);
});
