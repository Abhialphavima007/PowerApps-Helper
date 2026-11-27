'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, Notification, nativeTheme, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {}

const auth = require('./services/auth');
const dataverse = require('./services/dataverse');
const graph = require('./services/graph');
const zip = require('./services/solutionZip');
const store = require('./services/store');
const clientNames = require('./services/clientName');
const ai = require('./services/ai');
const git = require('./services/git');
const credentials = require('./services/credentials');
const azureDevOps = require('./services/azureDevOps');
const windowsHello = require('./services/windowsHello');
const { createDeploymentPower } = require('./services/deploymentPower');
const deploymentAgent = require('./services/deploymentAgent');
const deploymentQueue = require('./services/deploymentQueue');
const packageLibrary = require('./services/packageLibrary');
const { createDeploymentNotifier } = require('./services/deploymentNotifications');
const { createDeploymentAutomation, settings: automationSettings } = require('./services/deploymentAutomation');
const { createTeamsNotifications } = require('./services/teamsNotifications');
const teamsCodex = require('./services/teamsCodex');
const { setupFailure: workflowSetupFailure } = require('./services/teamsWorkflow');

const isDev = process.env.NODE_ENV === 'development';
const deploymentPower = createDeploymentPower(powerSaveBlocker);
function deploymentHandler(handler) {
  return (...args) => deploymentPower.run(() => handler(...args))
    .catch(error => fail(error));
}
let win;
let deploymentAutomation;
let teamsNotifications;
let teamsBridge;
const activeNotifications = new Set();
const notifyDeployment = createDeploymentNotifier({
  Notification,
  getWindow: () => win,
  activeNotifications
});

function createWindow() {
  const theme = store.getSettings().theme;
  nativeTheme.themeSource = theme;
  win = new BrowserWindow({
    width: 1200,
    height: 840,
    minWidth: 960,
    minHeight: 680,
    title: 'PowerApps Helper',
    backgroundColor: theme === 'light' ? '#f4f7fc' : '#0f1420',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.alphavima.powerappshelper');
  credentials.init(app.getPath('userData'));
  if (process.argv.includes('--teams-mcp')) {
    // The headless MCP adapter shares only the encrypted connector credential.
    await teamsCodex.runStdio({ app, userDataPath: app.getPath('userData'), credentials });
    return;
  }
  store.init(app.getPath('userData'));
  auth.init(app.getPath('userData'), (data) => {
    if (win && !win.isDestroyed()) win.webContents.send('auth:progress', data);
  });
  deploymentAutomation = createDeploymentAutomation({ auth, getSettings: store.getSettings,
    userDataPath: app.getPath('userData'), notify: notifyDeployment });
  teamsNotifications = createTeamsNotifications({ auth, credentials, getSettings: store.getSettings, notify: notifyDeployment,
    onStatus: data => { if (win && !win.isDestroyed()) win.webContents.send('teams:progress', data); } });
  teamsBridge = await teamsCodex.startBridge({ userDataPath: app.getPath('userData'), credentials,
    teams: teamsNotifications, auth, getSettings: store.getSettings });
  try { await teamsBridge.configure(); } catch { notifyDeployment('Teams connector needs attention', 'Optional Codex access could not start. Check Teams settings and secure credential storage.'); }
  const reportingTimer = setInterval(() => { void deploymentAutomation.flush().catch(() => {}); }, 60000);
  reportingTimer.unref();
  app.once('before-quit', () => clearInterval(reportingTimer));
  app.once('before-quit', () => { teamsNotifications.dispose(); teamsBridge.dispose(); });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => auth.cancelSignIn());

// ---- structured progress ----
function stage(stageName, statusVal, percent, message) {
  if (win && !win.isDestroyed())
    win.webContents.send('deploy:progress', {
      stage: stageName,
      status: statusVal, // 'running' | 'done' | 'error'
      percent: percent === undefined ? null : percent,
      message: message || '',
      time: Date.now()
    });
}

function ok(data) { return { ok: true, ...data }; }
function fail(err) { return { ok: false, error: String(err && err.message ? err.message : err) }; }

function sanitize(s) {
  let name = String(s || '').replace(/[\\/:*?"<>|#%~\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80).replace(/[. ]+$/g, '');
  if (!name || name === '.' || name === '..') name = 'unknown';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
}

// Store an exported artifact per Settings: local structured folder or OneDrive.
async function storeArtifact({ artifact, account, sourceEnv, targetEnv, solution, version, managed, report = stage }) {
  const client = await clientNames.get({ accountUsername: account });
  const settings = store.getSettings();
  const rel = path.join(
    sanitize(client.clientName),
    `${sanitize(sourceEnv)} to ${sanitize(targetEnv)}`,
    sanitize(solution),
    `${sanitize(version || 'export')}${managed ? '_managed' : ''}_${new Date().toISOString().replace(/[:.]/g, '-')}_${crypto.randomUUID()}.zip`
  );
  if (settings.storageMode === 'onedrive') {
    report('store', 'running', 0, 'Uploading to OneDrive…');
    const remote = (settings.oneDriveRoot || 'PowerApps Helper') + '/' + rel.split(path.sep).join('/');
    const buf = fs.readFileSync(artifact);
    const r = await graph.uploadBuffer(remote, buf, (pct) => report('store', 'running', pct, `Uploading to OneDrive… ${pct}%`));
    report('store', 'done', 100, 'Stored in OneDrive.');
    return { storage: 'onedrive', oneDriveUrl: r.webUrl, storedPath: remote, organized: true };
  }
  const dest = path.join(settings.localFolder, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(artifact, dest, fs.constants.COPYFILE_EXCL);
  report('store', 'done', 100, 'Saved to local folder.');
  return { storage: 'local', storedPath: dest, organized: true };
}

async function saveDeploymentRecord(record) {
  const saved = store.addDeployment(record);
  if (record.notes) {
    const notesFile = path.join(store.artifactsDir(), saved.id + '_notes.md');
    fs.writeFileSync(notesFile, record.notes, 'utf8');
    const patch = { notesFile };
    if (record.stored?.organized && record.stored.storedPath) {
      const organizedNotes = record.stored.storedPath.replace(/\.zip$/i, '.notes.md');
      try {
        if (record.stored.storage === 'onedrive') {
          const uploaded = await graph.uploadBuffer(organizedNotes, Buffer.from(record.notes, 'utf8'));
          patch.notesOneDriveUrl = uploaded.webUrl;
        } else if (record.stored.storage === 'local') {
          fs.copyFileSync(notesFile, organizedNotes, fs.constants.COPYFILE_EXCL);
          patch.notesFile = organizedNotes;
        }
      } catch (error) {
        patch.warning = [record.warning, 'Deployment notes could not be saved beside the export: ' + error.message].filter(Boolean).join(' ');
      }
    }
    Object.assign(saved, patch);
    store.updateDeployment(saved.id, patch);
  }
  return saved;
}

function registerIpc() {
  let revealPending = false;
  let agentBusy = false;
  const exclusiveDeployment = action => deploymentHandler(async (_event, params) => {
    if (agentBusy) return fail(new Error('A deployment is already running. Wait for it to finish.'));
    agentBusy = true;
    try { return await action(params); }
    finally { agentBusy = false; }
  });
  // --- Auth (multi-account) ---
  ipcMain.handle('auth:status', () => auth.status());
  ipcMain.handle('auth:add', async (_event, options) => {
    if (agentBusy) return fail(new Error('Wait for deployment to finish before adding an account.'));
    try { return ok({ account: await auth.addAccount(options) }); } catch (e) { return fail(e); }
  });
  ipcMain.handle('auth:setMethod', async (_event, method) => {
    if (agentBusy) return fail(new Error('Wait for deployment to finish before changing sign-in method.'));
    try { return await auth.setSignInMethod(method); } catch (e) { return fail(e); }
  });
  ipcMain.handle('auth:setActive', (_e, id) => agentBusy ? fail(new Error('Wait for deployment to finish before switching accounts.')) : auth.setActive(id));
  ipcMain.handle('auth:signOut', (_e, id) => agentBusy ? fail(new Error('Wait for deployment to finish before signing out.')) : auth.signOut(id));
  ipcMain.handle('auth:cancel', () => auth.cancelSignIn());

  // --- Environments / solutions ---
  ipcMain.handle('env:list', async () => {
    try { return await dataverse.discoverEnvironments(); } catch (e) { return fail(e); }
  });
  ipcMain.handle('solution:list', async (_e, orgUrl) => {
    try { return await dataverse.listSolutions(orgUrl); } catch (e) { return fail(e); }
  });

  // Local definitions are common to Microsoft accounts using this OS library.
  const libraryFolder = () => store.getSettings().packageLibraryFolder;
  const libraryAction = action => async (_event, payload) => {
    try {
      if (agentBusy) throw new Error('Wait for deployment to finish before changing or loading packages.');
      const { account } = await auth.status();
      if (!account) throw new Error('Sign in to use predefined packages.');
      if (agentBusy) throw new Error('Wait for deployment to finish before changing or loading packages.');
      return ok(await action(payload, account));
    } catch (error) { return fail(error); }
  };
  ipcMain.handle('packages:list', libraryAction(() => packageLibrary.list(libraryFolder())));
  ipcMain.handle('packages:save', libraryAction(draft => packageLibrary.save(libraryFolder(), draft)));
  ipcMain.handle('packages:remove', libraryAction(reference => packageLibrary.remove(libraryFolder(), reference)));
  ipcMain.handle('packages:load', libraryAction(async (reference, account) => {
    if (reference.accountId !== account.homeAccountId) throw new Error('Your account changed. Select the package again.');
    const recipe = await packageLibrary.get(libraryFolder(), reference);
    // Editing remains possible when a referenced ZIP has moved or changed.
    // Saving and deploying still verify the actual files.
    if (reference.edit === true && recipe.mode === 'file') return { package: recipe, items: recipe.items, solutions: [] };
    return dataverse.withAccount(account.homeAccountId, () => packageLibrary.resolve(recipe, dataverse));
  }));
  ipcMain.handle('packages:chooseFolder', libraryAction(async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Choose package library folder', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    if (agentBusy) throw new Error('Wait for deployment to finish before changing the package library folder.');
    const location = await packageLibrary.folder(result.filePaths[0]);
    if (agentBusy) throw new Error('Wait for deployment to finish before changing the package library folder.');
    store.saveSettings({ packageLibraryFolder: location });
    return { folder: location };
  }));

  // --- Settings & storage ---
  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('automation:status', async () => {
    try { return await deploymentAutomation.setupStatus(); } catch (error) { return fail(error); }
  });
  ipcMain.handle('automation:retry', async () => {
    try { await deploymentAutomation.flush(); return await deploymentAutomation.setupStatus(); } catch (error) { return fail(error); }
  });
  ipcMain.handle('settings:clientName:get', async () => {
    try { return ok(await clientNames.get()); } catch (error) { return fail(error); }
  });
  ipcMain.handle('settings:clientName:save', async (_event, value, account) => {
    try { return ok(await clientNames.save(value, account)); } catch (error) { return fail(error); }
  });
  ipcMain.handle('settings:save', async (_e, patch) => {
    if (Object.prototype.hasOwnProperty.call(patch, 'packageLibraryFolder')) {
      if (agentBusy) throw new Error('Wait for deployment to finish before changing the package library folder.');
      patch = { ...patch, packageLibraryFolder: await packageLibrary.folder(patch.packageLibraryFolder) };
      if (agentBusy) throw new Error('Wait for deployment to finish before changing the package library folder.');
    }
    if (patch.teamsNotifications) teamsNotifications.assertReady(patch.teamsNotifications);
    const settings = store.saveSettings(patch);
    if (Object.prototype.hasOwnProperty.call(patch, 'teamsNotifications')) {
      teamsNotifications.configure();
      try { await teamsBridge.configure(); }
      catch { notifyDeployment('Teams connector needs attention', 'Teams settings were saved, but optional Codex access could not start.'); }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'theme')) {
      nativeTheme.themeSource = settings.theme;
      if (win && !win.isDestroyed()) win.setBackgroundColor(settings.theme === 'light' ? '#f4f7fc' : '#0f1420');
    }
    return settings;
  });
  ipcMain.handle('teams:connect', async (_event, expectedTransport) => {
    if (agentBusy) return fail(new Error('Wait for deployment to finish before connecting Teams.'));
    try { return await teamsNotifications.connect(expectedTransport); } catch (error) { return fail(error); }
  });
  ipcMain.handle('teams:checkWorkflow', () => {
    try { return teamsNotifications.checkWorkflow(); } catch (error) { return fail(error); }
  });
  ipcMain.handle('teams:revealWorkflow', async () => {
    if (revealPending) return fail(new Error('A Windows Hello verification is already in progress.'));
    revealPending = true;
    try {
      if (!teamsNotifications.workflowStatus().configured) throw new Error('No saved workflow address is available to reveal.');
      const verification = await windowsHello.verify();
      if (!verification.ok) throw new Error(`Windows Hello did not verify your identity: ${verification.message}`);
      return ok({ value: teamsNotifications.revealWorkflow() });
    } catch (error) { return fail(error); }
    finally { revealPending = false; }
  });
  ipcMain.handle('teams:saveWorkflow', async (_event, url, choices) => {
    try {
      let settings;
      const workflow = teamsNotifications.saveWorkflow(url, choices, config => {
        settings = store.saveSettings({ teamsNotifications: config });
      });
      teamsNotifications.configure();
      let warning = '';
      try { await teamsBridge.configure(); }
      catch { warning = 'Workflow and settings saved, but optional Codex access could not start. Check secure OS credential storage and save Teams settings again.'; }
      return ok({ workflow, settings, warning });
    } catch (error) { return workflowSetupFailure(error); }
  });
  ipcMain.handle('teams:removeWorkflow', () => {
    try { return ok({ workflow: teamsNotifications.removeWorkflow() }); }
    catch { return fail(new Error('Workflow setup could not be removed. Check secure OS credential storage.')); }
  });
  ipcMain.handle('teams:status', () => ({ ok: true, runs: teamsNotifications.list(), workflow: teamsNotifications.workflowStatus(),
    bridge: teamsBridge.status(),
    mcpConfiguration: { command: process.execPath, args: app.isPackaged ? ['--teams-mcp'] : [app.getAppPath(), '--teams-mcp'] } }));
  ipcMain.handle('credentials:status', () => credentials.status());
  ipcMain.handle('credentials:save', (_e, name, value) => {
    try { if (!credentials.isPublicName(name)) throw new Error('Unknown credential type.'); return ok({ status: credentials.save(name, value) }); } catch (e) { return fail(e); }
  });
  ipcMain.handle('credentials:remove', (_e, name) => {
    try { if (!credentials.isPublicName(name)) throw new Error('Unknown credential type.'); return ok({ status: credentials.remove(name) }); } catch (e) { return fail(e); }
  });
  ipcMain.handle('credentials:reveal', async (_e, name) => {
    if (revealPending) return fail(new Error('A Windows Hello verification is already in progress.'));
    revealPending = true;
    try {
      if (!credentials.isPublicName(name)) throw new Error('Unknown credential type.');
      if (!credentials.status()[name]) throw new Error('No saved credential is available to reveal.');
      const verification = await windowsHello.verify();
      if (!verification.ok) throw new Error(`Windows Hello did not verify your identity: ${verification.message}`);
      return ok({ value: credentials.get(name) });
    } catch (e) { return fail(e); }
    finally { revealPending = false; }
  });
  ipcMain.handle('devops:fetch', async (event, references, requestId) => {
    try { return ok(await azureDevOps.fetchWorkItems(references, (progress) => event.sender.send('devops:progress', { requestId, ...progress }))); } catch (e) { return fail(e); }
  });
  ipcMain.handle('settings:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    return { ok: true, folder: r.filePaths[0] };
  });
  ipcMain.handle('onedrive:connect', async () => {
    try { return await graph.connect(); } catch (e) { return fail(e); }
  });

  // --- Pick a prebuilt solution package (.zip) and inspect it ---
  ipcMain.handle('dialog:pickZip', async (_event, options) => {
    const r = await dialog.showOpenDialog(win, {
      properties: options?.multiple === true ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: 'Solution package', extensions: ['zip'] }]
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    return { ok: true, path: r.filePaths[0], paths: r.filePaths };
  });
  ipcMain.handle('deploy:inspectFile', async (_e, { filePath }) => {
    try {
      const bytes = fs.readFileSync(filePath);
      const inspection = zip.inspect(bytes);
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      return ok({ artifact: filePath, inspection, sha256, stored: { storage: 'local', storedPath: filePath } });
    } catch (e) {
      return fail(e);
    }
  });

  // --- AI ---
  ipcMain.handle('ai:providers', () => ai.availableProviders());
  ipcMain.handle('ai:generateNotes', async (_e, payload) => {
    try { return ok(await ai.generateNotes(payload)); } catch (e) { return fail(e); }
  });
  ipcMain.handle('ai:summarizeWorkItems', async (event, payload, requestId) => {
    try { return ok(await ai.summarizeWorkItems(payload, (progress) => event.sender.send('ai:progress', { requestId, ...progress }))); } catch (e) { return fail(e); }
  });

  // --- History ---
  ipcMain.handle('history:list', () => store.listDeployments());
  ipcMain.handle('history:query', (_e, options) => store.queryDeployments(options));
  ipcMain.handle('history:matchingIds', (_e, filters) => store.matchingDeploymentIds(filters));
  ipcMain.handle('history:get', (_e, id) => store.getHistoryEntry(id));
  ipcMain.handle('history:delete', (_e, ids) => {
    if (agentBusy) throw new Error('Wait for the active deployment to finish before deleting history.');
    return store.deleteDeployments(Array.isArray(ids) ? ids : []);
  });
  ipcMain.handle('history:export', async (_e, ids, format) => {
    try {
      const { records, count } = store.exportHistoryRecords(Array.isArray(ids) ? ids : []);
      if (!records.length) throw new Error('There are no history records to export.');
      const type = format === 'csv' ? 'csv' : 'json';
      const result = await dialog.showSaveDialog(win, {
        title: 'Export deployment history',
        defaultPath: `powerapps-helper-history.${type}`,
        filters: [{ name: type.toUpperCase(), extensions: [type] }]
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      let output;
      if (type === 'json') output = JSON.stringify(records, null, 2);
      else {
        const columns = ['createdAt', 'solution', 'solutionUniqueName', 'version', 'sourceEnv', 'sourceUrl', 'targetEnv', 'targetUrl', 'status', 'deploymentMethod', 'agent', 'account', 'exportManaged', 'workItems', 'workItemSummary', 'workItemDetails', 'description', 'notes', 'dependencies', 'artifact', 'stored', 'warning', 'error', 'queueId', 'queueIndex', 'queueCount', 'queueCreatedAt', 'queueFinishedAt', 'queueStatus', 'queueWarning', 'startedAt', 'finishedAt', 'historyRecorded', 'importCompleted', 'importJobId', 'phase', 'package'];
        const cell = (value) => {
          let text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
          if (/^\s*[=+@-]/.test(text)) text = "'" + text;
          return `"${text.replace(/"/g, '""')}"`;
        };
        output = '\uFEFF' + [columns.join(','), ...records.map((record) => columns.map((name) => cell(record[name])).join(','))].join('\r\n');
      }
      fs.writeFileSync(result.filePath, output, 'utf8');
      return ok({ path: result.filePath, count, solutionCount: records.length });
    } catch (e) { return fail(e); }
  });

  // --- Git ---
  ipcMain.handle('git:commit', async (_e, { cwd, message }) => {
    const dir = cwd || store.artifactsDir();
    await git.ensureRepo(dir);
    return git.commitAll(dir, message);
  });

  // --- Utility ---
  ipcMain.handle('open:path', (_e, p) => shell.showItemInFolder(p));
  ipcMain.handle('open:external', (_e, url) => shell.openExternal(url));
  ipcMain.handle('artifacts:dir', () => store.artifactsDir());

  // === Export from source (optional version bump) + inspect + store ===
  const exportDeployment = async params => {
    const { sourceEnvUrl, sourceEnvName, targetEnvName, account, solutionId, solutionName, newVersion, exportManaged } = params;
    const current = await auth.status().catch(() => ({}));
    const snapshot = { runId: crypto.randomUUID(), accountId: current.account?.homeAccountId,
      account: current.account?.username, sourceEnv: sourceEnvName, targetEnv: targetEnvName,
      solutionUniqueName: solutionName, version: newVersion, exportManaged, phase: 'export',
      queueIndex: params.queueIndex, queueCount: params.queueCount };
    teamsNotifications.start(snapshot);
    const report = (...args) => { stage(...args); teamsNotifications.update(snapshot.runId, ...args); };
    try {
      if (newVersion && solutionId) {
        report('version', 'running', null, `Setting version ${newVersion}…`);
        try {
          await dataverse.setSolutionVersion(sourceEnvUrl, solutionId, newVersion);
          report('version', 'done', 100, `Version set to ${newVersion}.`);
        } catch (e) {
          report('version', 'error', null, 'Version update warning: ' + e.message);
        }
      }
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const outFile = path.join(store.artifactsDir(), `${sanitize(solutionName)}_${sanitize(newVersion || 'export')}_${ts}${exportManaged ? '_managed' : ''}.zip`);

      report('export', 'running', null, `Exporting ${solutionName} from ${sourceEnvName}…`);
      await dataverse.exportToFile(sourceEnvUrl, solutionName, exportManaged, outFile);
      report('export', 'done', 100, 'Exported.');

      report('analyze', 'running', null, 'Inspecting package…');
      const inspection = zip.inspect(outFile);
      report('analyze', 'done', 100, `Found ${inspection.dependencies?.length || 0} dependencies.`);

      let stored = {};
      try {
        stored = await storeArtifact({
          artifact: outFile, account, sourceEnv: sourceEnvName, targetEnv: targetEnvName,
          solution: solutionName, version: newVersion, managed: exportManaged, report
        });
      } catch (e) {
        stored = { warning: 'Export could not be saved to the configured storage: ' + e.message };
        report('store', 'error', null, stored.warning);
      }
      const teams = teamsNotifications.finish(snapshot.runId, { ok: true });
      return ok({ artifact: outFile, inspection, stored, teams });
    } catch (e) {
      report('export', 'error', null, e.message);
      notifyDeployment('Export stopped', e.message);
      return { ...fail(e), teams: teamsNotifications.finish(snapshot.runId, { ok: false, error: e.message }) };
    }
  };
  ipcMain.handle('deploy:export', exclusiveDeployment(exportDeployment));

  // === Bounded agent deployment from a source solution ===
  const agentDeployment = async params => {
    let snapshot;
    const report = (...args) => { stage(...args); if (snapshot) teamsNotifications.update(snapshot.runId, ...args); };
    try {
      snapshot = structuredClone(params);
      snapshot.runId = crypto.randomUUID();
      const current = await auth.status();
      if (!current.signedIn || current.account.homeAccountId !== snapshot.accountId) {
        throw new Error('The active Microsoft account changed. Review the deployment details and try again.');
      }
      snapshot.account = current.account.username;
      snapshot.deploymentMethod = 'agent';
      snapshot.deploymentAutomation = automationSettings(store.getSettings().deploymentAutomation);
      snapshot.repairTransport = snapshot.deploymentAutomation.repairTransport;
      snapshot.teamsNotifications = store.getSettings().teamsNotifications;
      teamsNotifications.start(snapshot, snapshot.teamsNotifications);
      const checkAccount = async () => {
        const latest = await auth.status();
        if (latest.account?.homeAccountId !== snapshot.accountId) throw new Error('The active Microsoft account changed during deployment.');
      };
      report('agent', 'running', null, 'Agent deployment started.');
      const result = await deploymentAgent.runAgentDeployment(snapshot, {
        dataverse, mcp: null, zip,
        artifactsDir: store.artifactsDir, storeArtifact: args => storeArtifact({ ...args, report }), report, checkAccount,
        requestApproval: deploymentAutomation.requestApproval
      });
      const teams = teamsNotifications.finish(snapshot.runId, result);
      let warning = result.warning || '';
      let saved = null;
      try {
        saved = await saveDeploymentRecord(deploymentAgent.makeHistoryRecord(snapshot, result, current.account.username));
        warning = saved.warning || warning;
      } catch (error) {
        warning = [warning, 'Deployment history could not be saved: ' + error.message].filter(Boolean).join(' ');
      }
      if (snapshot.gitCommit && result.analysis?.artifact) {
        try {
          const dir = store.artifactsDir();
          await git.ensureRepo(dir);
          await git.commitAll(dir, 'Deploy ' + snapshot.solutionUniqueName + ' v' + snapshot.version + ' -> ' + snapshot.targetEnv);
        } catch (error) { warning = [warning, 'Git commit failed: ' + error.message].filter(Boolean).join(' '); }
      }
      if (warning && saved) {
        try { saved = store.updateDeployment(saved.id, { warning }); }
        catch { /* The import outcome is still authoritative if history updating fails. */ }
      }
      report('agent', result.ok ? 'done' : 'error', result.ok ? 100 : null, result.ok ? (saved ? 'Deployment recorded in history.' : 'Import finished; history could not be saved.') : result.error);
      notifyDeployment(result.ok ? (warning ? 'Deployment needs attention' : 'Deployment complete') : 'Deployment stopped',
        result.ok
          ? (warning || `Imported ${snapshot.solutionUniqueName} v${snapshot.version} to ${snapshot.targetEnv}.`)
          : (result.error || 'Agent deployment stopped before import could finish.'));
      const reporting = await deploymentAutomation.recordOutcome(snapshot, { ...result, warning })
        .catch(() => ({ ok: false, error: 'Deployment reporting could not be queued. Check reporting settings.' }));
      if (saved) { try { saved = store.updateDeployment(saved.id, { teamsNotifications: snapshot.teamsNotifications, teams }); } catch {} }
      return { ...result, warning, record: saved, runId: snapshot.runId, reporting, teams };
    } catch (error) {
      report('agent', 'error', null, error.message);
      notifyDeployment('Deployment stopped', error.message);
      const teams = snapshot ? teamsNotifications.finish(snapshot.runId, { ok: false, error: error.message }) : null;
      if (snapshot) await deploymentAutomation.recordOutcome(snapshot, { ok: false, error: error.message }).catch(() => {});
      return { ...fail(error), teams };
    }
  };
  ipcMain.handle('deploy:agent', exclusiveDeployment(agentDeployment));

  // === Import into target (async, real progress) + optional publish ===
  const importDeployment = async params => {
    const { targetEnvUrl, targetEnvName, solutionName, artifact, overwrite, publishChanges, exportManaged } = params;
    const current = await auth.status().catch(() => ({}));
    const snapshot = { runId: crypto.randomUUID(), accountId: current.account?.homeAccountId,
      account: current.account?.username, sourceUrl: params.sourceEnvUrl || '', sourceEnv: params.sourceEnvName || 'Package file',
      targetUrl: targetEnvUrl, targetEnv: targetEnvName, solutionUniqueName: params.solutionUniqueName || solutionName,
      solution: solutionName, version: params.version, exportManaged, overwrite, publishChanges,
      deploymentMethod: 'import', description: params.description, notes: params.notes,
      queueIndex: params.queueIndex, queueCount: params.queueCount };
    snapshot.deploymentAutomation = automationSettings(store.getSettings().deploymentAutomation);
    const teamsChoice = store.getSettings().teamsNotifications;
    teamsNotifications.start(snapshot, teamsChoice);
    const report = (...args) => { stage(...args); teamsNotifications.update(snapshot.runId, ...args); };
    try {
      report('import', 'running', 1, 'Starting import…');
      const r = await dataverse.importSolutionFromFile(
        targetEnvUrl, artifact, { overwrite, publishWorkflows: true, expectedSha256: params.expectedSha256 },
        (pct, msg) => report('import', 'running', pct, msg)
      );
      if (!r.ok) {
        report('import', 'error', null, r.error);
        notifyDeployment('Import stopped', [solutionName, 'could not be imported to', targetEnvName, r.error].filter(Boolean).join(' '));
        r.runId = snapshot.runId;
        r.teams = teamsNotifications.finish(snapshot.runId, r);
        r.teamsNotifications = teamsChoice;
        r.reporting = await deploymentAutomation.recordOutcome(snapshot, r)
          .catch(() => ({ ok: false, error: 'Deployment reporting could not be queued. Check reporting settings.' }));
        return r;
      }
      report('import', 'done', 100, 'Imported.');

      let publishWarning = '';
      if (publishChanges && !exportManaged) {
        report('publish', 'running', null, 'Publishing customizations…');
        try {
          await dataverse.publishAll(targetEnvUrl);
          report('publish', 'done', 100, 'Published.');
        } catch (e) {
          report('publish', 'error', null, 'Publish warning: ' + e.message);
          publishWarning = 'Import succeeded, but publishing failed: ' + e.message;
        }
      }
      notifyDeployment(publishWarning ? 'Deployment needs attention' : 'Deployment complete',
        publishWarning || `Imported ${solutionName || 'solution'} to ${targetEnvName || targetEnvUrl}.`);
      const teams = teamsNotifications.finish(snapshot.runId, { ...r, warning: publishWarning });
      const reporting = await deploymentAutomation.recordOutcome(snapshot, { ...r, warning: publishWarning })
        .catch(() => ({ ok: false, error: 'Deployment reporting could not be queued. Check reporting settings.' }));
      return { ...r, ...(publishWarning ? { warning: publishWarning } : {}), runId: snapshot.runId, reporting,
        teams, teamsNotifications: teamsChoice };
    } catch (e) {
      report('import', 'error', null, e.message);
      notifyDeployment('Import stopped', e.message);
      const teams = teamsNotifications.finish(snapshot.runId, { ok: false, error: e.message });
      await deploymentAutomation.recordOutcome(snapshot, { ok: false, error: e.message }).catch(() => {});
      return { ...fail(e), teams, teamsNotifications: teamsChoice };
    }
  };
  ipcMain.handle('deploy:import', exclusiveDeployment(importDeployment));

  // One captured account, route and ordered list for the entire queue.
  const queueAction = async (params, prepare) => {
    const { account } = await auth.status();
    if (!account || account.homeAccountId !== params.accountId) throw new Error('The active Microsoft account changed. Review the queue again.');
    const snapshot = structuredClone(params);
    await packageLibrary.verifyQueue(libraryFolder(), snapshot);
    const historyWarnings = new Set();
    const updateQueueHistory = (queueId, index, patch) => {
      try { store.updateDeploymentQueue(queueId, index, patch); }
      catch (error) { historyWarnings.add('Queue history could not be updated: ' + error.message); }
    };
    const checkAccount = async () => {
      const { account: currentAccount } = await auth.status();
      if (currentAccount?.homeAccountId !== snapshot.accountId) throw new Error('The deployment account changed. Queue stopped.');
    };
    const onItem = (index, status, message, queueId) => {
      if (queueId) {
        const now = new Date().toISOString();
        updateQueueHistory(queueId, index, {
          status: status === 'done' ? 'success' : status === 'error' ? 'failed' : status,
          ...(status === 'running' ? { startedAt: now } : { finishedAt: now }),
          ...(status === 'error' || status === 'skipped' ? { error: message } : {})
        });
      }
      if (win && !win.isDestroyed()) win.webContents.send('deploy:queueProgress', { requestId: snapshot.requestId, queueId, index, status, message });
    };
    const services = { dataverse, zip, checkAccount, onItem,
      // If the initial history write fails, stop before any import is submitted.
      onStart: queue => store.startDeploymentQueue(queue, account.username),
      onResult: (queue, index, result) => updateQueueHistory(queue.queueId, index, {
        status: result.ok ? 'success' : 'failed', error: result.error || null,
        warning: result.warning || null, recordId: result.record?.id,
        importCompleted: result.importCompleted, importJobId: result.importJobId,
        phase: result.phase, runId: result.runId
      }),
      exportItem: (queue, item, index) => exportDeployment({ sourceEnvUrl: queue.sourceUrl, sourceEnvName: queue.sourceEnv,
        targetEnvName: queue.targetEnv, account: account.username, solutionId: item.solutionId,
        solutionName: item.solutionUniqueName, newVersion: item.version, exportManaged: queue.exportManaged,
        queueIndex: index, queueCount: queue.items.length }),
      runItem: async (queue, item, index) => {
        const detail = { ...queue, ...item, items: undefined, account: account.username,
          queueId: queue.queueId, queueIndex: index, queueCount: queue.items.length,
          deferExport: !item.analysis, analysis: item.analysis };
        if (queue.mode === 'source' && queue.useAgent) return agentDeployment(detail);
        const result = await importDeployment({ targetEnvUrl: queue.targetUrl, targetEnvName: queue.targetEnv,
          sourceEnvUrl: queue.sourceUrl || '', sourceEnvName: queue.sourceEnv || 'Package file',
          solutionName: item.solution || item.solutionUniqueName, solutionUniqueName: item.solutionUniqueName,
          artifact: item.analysis.artifact, version: item.version, overwrite: queue.overwrite,
          expectedSha256: queue.package?.mode === 'file' ? item.sha256 : undefined,
          publishChanges: queue.publishChanges, exportManaged: item.exportManaged ?? queue.exportManaged,
          description: queue.description, notes: queue.notes,
          queueIndex: index, queueCount: queue.items.length });
        let warning = result.warning || '';
        let record;
        try {
          record = await saveDeploymentRecord({ solution: item.solution || item.solutionUniqueName,
            solutionUniqueName: item.solutionUniqueName, version: item.version,
            sourceEnv: queue.sourceEnv || 'Package file', sourceUrl: queue.sourceUrl || '',
            targetEnv: queue.targetEnv, targetUrl: queue.targetUrl, account: account.username,
            description: queue.description, workItems: queue.workItems, workItemDetails: queue.workItemDetails,
            workItemSummary: queue.workItemSummary, notes: queue.notes, mode: queue.mode,
            exportManaged: item.exportManaged ?? queue.exportManaged, deploymentMethod: 'queue',
            queueId: queue.queueId, queueIndex: index, queueCount: queue.items.length,
            package: queue.package,
            artifact: item.analysis.artifact, stored: item.analysis.stored,
            dependencies: item.analysis.inspection.dependencies, summary: item.analysis.inspection.summary,
            status: result.ok ? 'success' : 'failed', error: result.ok ? null : result.error,
            importCompleted: result.importCompleted, importJobId: result.importJobId, phase: result.phase,
            warning: [warning, item.analysis.stored?.warning].filter(Boolean).join(' '),
            runId: result.runId, reporting: result.reporting, teams: result.teams, teamsNotifications: result.teamsNotifications });
        } catch (error) { warning = [warning, 'Deployment history could not be saved: ' + error.message].filter(Boolean).join(' '); }
        if (queue.gitCommit) {
          try { await git.ensureRepo(store.artifactsDir()); await git.commitAll(store.artifactsDir(), 'Deploy ' + item.solutionUniqueName + ' v' + item.version + ' -> ' + queue.targetEnv); }
          catch (error) { warning = [warning, 'Git commit failed: ' + error.message].filter(Boolean).join(' '); }
        }
        return { ...result, warning, record };
      }
    };
    return dataverse.withAccount(snapshot.accountId, async () => {
      if (prepare) return deploymentQueue.prepareQueue(snapshot, services);
      const result = await deploymentQueue.runQueue(snapshot, services);
      updateQueueHistory(result.queueId, null, { status: result.ok ? 'success' : 'failed',
        finishedAt: new Date().toISOString(), error: result.error || null,
        warning: [...historyWarnings].join(' ') });
      return { ...result, ...(historyWarnings.size ? { warning: [...historyWarnings].join(' ') } : {}) };
    });
  };
  ipcMain.handle('deploy:prepareQueue', exclusiveDeployment(params => queueAction(params, true)));
  ipcMain.handle('deploy:queue', exclusiveDeployment(params => queueAction(params, false)));

  // === Persist a deployment record + write notes file ===
  ipcMain.handle('deploy:record', async (_e, record) => {
    return saveDeploymentRecord(record);
  });
}
