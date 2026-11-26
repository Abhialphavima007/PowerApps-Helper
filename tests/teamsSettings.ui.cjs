// Isolated Settings checks; synthetic addresses, temp storage, no network or live messages.
// Run: npx --no-install electron tests/teamsSettings.ui.cjs
'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const credentials = require('../electron/services/credentials');
const store = require('../electron/services/store');
const { createTeamsNotifications } = require('../electron/services/teamsNotifications');
const { setupFailure } = require('../electron/services/teamsWorkflow');

const tempRoot = path.resolve(os.tmpdir());
const folder = fs.mkdtempSync(path.join(tempRoot, 'powerapps-teams-ui-'));
app.disableHardwareAcceleration();
app.setPath('userData', folder);
let win;
let teams;
let exitCode = 0;
let rejectPersistence = false;
let holdStatus = false;
let releaseStatus;
let connectCalls = 0;
let checkCalls = 0;
let revealCalls = 0;
let allowReveal = false;
let missingWorkflowCheck = false;
const endpoint = 'https://example.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/synthetic/triggers/manual/paths/invoke?sig=test-fixture-not-a-credential';
const evaluate = source => win.webContents.executeJavaScript(source);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(source) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (await evaluate(source)) return; await pause(25); }
  throw new Error('Synthetic Teams UI condition timed out.');
}
async function input(selector, value) {
  await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}
async function save(check = false) {
  const label = check ? 'Save and check workflow setup' : 'Save Teams settings';
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === ${JSON.stringify(label)}).click()`);
  await waitFor(`!document.querySelector('button').disabled`);
}
async function click(label) {
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === ${JSON.stringify(label)}).click()`);
  await waitFor(`!document.querySelector('button').disabled`);
}

app.whenReady().then(async () => {
  try {
    credentials.init(folder);
    store.init(folder);
    store.saveSettings({ teamsNotifications: { enabled: true, transport: 'workflow', workflowRouting: 'fixed',
      recipients: 'person@example.invalid', intervalMinutes: 5 } });
    global.fetch = async () => { throw new Error('Network is forbidden in the synthetic Settings check.'); };
    teams = createTeamsNotifications({ credentials, auth: {}, getSettings: store.getSettings, notify() {} });
    ipcMain.handle('teams-ui:get', () => store.getSettings());
    const status = () => ({ ok: true, workflow: teams.workflowStatus(), runs: [], bridge: { enabled: false } });
    ipcMain.handle('teams-ui:status', () => holdStatus ? new Promise(resolve => { releaseStatus = () => resolve(status()); }) : status());
    ipcMain.handle('teams-ui:connect', () => { connectCalls++; throw new Error('Direct Graph sign-in is forbidden in this workflow check.'); });
    ipcMain.handle('teams-ui:check', () => {
      checkCalls++;
      if (missingWorkflowCheck) throw new Error("No handler registered for 'teams:checkWorkflow'");
      return teams.checkWorkflow();
    });
    ipcMain.handle('teams-ui:reveal', () => {
      revealCalls++;
      return allowReveal ? { ok: true, value: teams.revealWorkflow() } : { ok: false, error: 'Identity verification cancelled.' };
    });
    ipcMain.handle('teams-ui:remove', () => ({ ok: true, workflow: teams.removeWorkflow() }));
    ipcMain.handle('teams-ui:settingsSave', (_event, patch) => {
      teams.assertReady(patch.teamsNotifications);
      return store.saveSettings(patch);
    });
    ipcMain.handle('teams-ui:save', (_event, url, choices) => {
      try {
        let saved;
        const workflow = teams.saveWorkflow(url, choices, config => {
          if (rejectPersistence) throw new Error('Synthetic write failure.');
          saved = store.saveSettings({ teamsNotifications: config });
        });
        return { ok: true, settings: saved, workflow };
      } catch (error) { return setupFailure(error); }
    });
    const preload = path.join(folder, 'preload.cjs');
    fs.writeFileSync(preload, `const { contextBridge, ipcRenderer } = require('electron');
      contextBridge.exposeInMainWorld('api', {
        settings: { get: () => ipcRenderer.invoke('teams-ui:get'), save: patch => ipcRenderer.invoke('teams-ui:settingsSave', patch) },
        teams: { status: () => ipcRenderer.invoke('teams-ui:status'),
          connect: () => ipcRenderer.invoke('teams-ui:connect'),
          checkWorkflow: () => ipcRenderer.invoke('teams-ui:check'),
          revealWorkflow: () => ipcRenderer.invoke('teams-ui:reveal'),
          removeWorkflow: () => ipcRenderer.invoke('teams-ui:remove'),
          saveWorkflow: (url, choices) => ipcRenderer.invoke('teams-ui:save', url, choices), onProgress: () => () => {} }
      });`);
    await esbuild.build({ stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
      import TeamsSettings from '../src/components/TeamsSettings.jsx';
      const normalTimeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, gap, ...args) => gap === 30000
        ? (window.workflowAutoHide = callback, -1) : normalTimeout(callback, gap, ...args);
      window.api.settings.get().then(settings => createRoot(document.getElementById('root')).render(
        <TeamsSettings settings={settings} onSaved={() => {}} />));`,
      loader: 'jsx', resolveDir: __dirname }, bundle: true, outfile: path.join(folder, 'ui.js'),
      define: { 'process.env.NODE_ENV': '"production"' } });
    fs.writeFileSync(path.join(folder, 'index.html'), '<div id="root"></div><script src="ui.js"></script>');
    win = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true,
      nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
    await win.loadFile(path.join(folder, 'index.html'));
    await waitFor(`document.querySelector('#teams-routing')?.value === 'payload'`);
    assert.equal(await evaluate(`document.querySelector('#teams-workflow-url').type`), 'password');
    await input('#teams-workflow-url', endpoint.split('?')[0]);
    await save();
    await waitFor(`document.querySelector('[role="alert"]')?.textContent.includes('no webhook signature')`);
    assert.equal(teams.workflowStatus().configured, false);
    console.log('PASS new setup selects Helper people and unsigned addresses show the specific reason');

    await input('#teams-workflow-url', endpoint);
    rejectPersistence = true;
    await save();
    await waitFor(`document.querySelector('[role="alert"]')?.textContent.includes('settings could not be written')`);
    assert.equal(teams.workflowStatus().configured, false);
    assert.equal(await evaluate(`document.querySelector('#teams-workflow-url').value`), endpoint);
    console.log('PASS failed persistence preserves the entered address and reports safe recovery');

    rejectPersistence = false;
    await save(true);
    await waitFor(`document.querySelector('#teams-workflow-url').readOnly && document.body.textContent.includes('Workflow address saved.')`);
    assert.equal(await evaluate(`document.querySelector('#teams-workflow-url').value`), 'saved-workflow-address');
    assert.equal(revealCalls, 0);
    assert.equal(checkCalls, 1);
    assert.equal(connectCalls, 0);
    assert.equal(store.getSettings().teamsNotifications.workflowRouting, 'payload');
    assert.equal(fs.readFileSync(path.join(folder, 'powerapps-helper/credentials.bin')).includes(endpoint), false);
    assert.equal(fs.readFileSync(path.join(folder, 'powerapps-helper/settings.json'), 'utf8').includes(endpoint), false);
    await win.reload();
    await waitFor(`document.body.textContent.includes('Workflow address saved.')`);
    credentials.init(folder); store.init(folder);
    assert.equal(teams.workflowStatus().configured, true);
    assert.equal(await evaluate(`document.querySelector('#teams-workflow-url').readOnly && document.querySelector('#teams-workflow-url').type === 'password'`), true);
    console.log('PASS save encrypts the address, restores its protected saved value after reload and storage reinitialization, and only checks workflow');

    await click('Show');
    await waitFor(`document.querySelector('[role="alert"]')?.textContent.includes('verification cancelled')`);
    assert.equal(await evaluate(`document.querySelector('#teams-workflow-url').type`), 'password');
    allowReveal = true;
    await click('Show');
    await waitFor(`document.querySelector('#teams-workflow-url').type === 'text'`);
    assert.equal(await evaluate(`document.querySelector('#teams-workflow-url').value`), endpoint);
    await click('Hide');
    assert.equal(await evaluate(`document.querySelector('#teams-workflow-url').value`), 'saved-workflow-address');
    await click('Show');
    await evaluate(`window.workflowAutoHide()`);
    await waitFor(`document.querySelector('#teams-workflow-url').type === 'password'`);
    console.log('PASS reveal is explicit, cancellation keeps it protected, Hide and the 30-second timer clear it');

    await click('Replace');
    assert.equal(await evaluate(`document.querySelector('#teams-workflow-url').value`), '');
    await save();
    await waitFor(`document.querySelector('[role="alert"]')?.textContent.includes('replacement workflow address')`);
    await input('#teams-workflow-url', endpoint.replace('synthetic/', 'replacement/'));
    await click('Cancel');
    assert.equal(teams.revealWorkflow(), endpoint);
    assert.equal(await evaluate(`document.querySelector('#teams-workflow-url').readOnly`), true);
    await click('Replace');
    await input('#teams-workflow-url', endpoint.replace('synthetic/', 'replacement/'));
    await save(true);
    assert.equal(teams.revealWorkflow(), endpoint.replace('synthetic/', 'replacement/'));
    assert.equal(connectCalls, 0);
    console.log('PASS Replace starts empty, Cancel retains the saved address, and saving a replacement restores the lock');

    missingWorkflowCheck = true;
    await save(true);
    await waitFor(`document.querySelector('[role="alert"]')?.textContent.includes('Restart PowerApps Helper')`);
    assert.equal(connectCalls, 0);
    assert.equal(teams.workflowStatus().configured, true);
    missingWorkflowCheck = false;
    console.log('PASS older backend gives restart guidance with no direct Graph fallback');

    await click('Show');
    await evaluate(`(() => { const select = document.querySelector('#teams-connection');
      select.value = 'graph'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(`!document.querySelector('#teams-workflow-url')`);
    await evaluate(`(() => { const select = document.querySelector('#teams-connection');
      select.value = 'workflow'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(`document.querySelector('#teams-workflow-url')?.type === 'password'`);
    await click('Remove');
    await waitFor(`document.body.textContent.includes('No workflow address saved.')`);
    assert.equal(await evaluate(`document.querySelector('#teams-workflow-url').value`), '');
    console.log('PASS changing sender hides the address and Remove clears the saved workflow');

    const legacy = { ...store.getSettings().teamsNotifications, workflowRouting: 'fixed' };
    teams.saveWorkflow(endpoint, legacy, config => store.saveSettings({ teamsNotifications: config }));
    await win.reload();
    await waitFor(`document.querySelector('#teams-routing')?.value === 'fixed' && document.body.textContent.includes('Workflow address saved.')`);
    console.log('PASS saved fixed-recipient workflows retain their routing contract');

    teams.removeWorkflow();
    holdStatus = true;
    await win.reload();
    await waitFor(`document.querySelector('#teams-routing')?.value === 'fixed'`);
    await evaluate(`(() => { const select = document.querySelector('#teams-routing');
      select.value = 'fixed'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(typeof releaseStatus, 'function');
    releaseStatus();
    await waitFor(`document.body.textContent.includes('No workflow address saved.')`);
    await pause(100);
    assert.equal(await evaluate(`document.querySelector('#teams-routing').value`), 'fixed');
    console.log('PASS delayed initial status does not overwrite edited recipient routing');
  } catch (error) { console.error(error); exitCode = 1; }
  finally {
    teams?.dispose();
    win?.destroy();
    const resolved = path.resolve(folder);
    if (path.dirname(resolved) === tempRoot && path.basename(resolved).startsWith('powerapps-teams-ui-')) {
      try { await fs.promises.rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
      catch { console.error('Synthetic test folder cleanup could not finish.'); exitCode = 1; }
    }
    app.exit(exitCode);
  }
});
