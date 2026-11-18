'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {}

const auth = require('./services/auth');
const dataverse = require('./services/dataverse');
const graph = require('./services/graph');
const zip = require('./services/solutionZip');
const store = require('./services/store');
const ai = require('./services/ai');
const git = require('./services/git');
const credentials = require('./services/credentials');
const azureDevOps = require('./services/azureDevOps');
const windowsHello = require('./services/windowsHello');
const dataverseMcp = require('./services/dataverseMcp');
const deploymentAgent = require('./services/deploymentAgent');

const isDev = process.env.NODE_ENV === 'development';
let win;
const activeNotifications = new Set();

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 840,
    minWidth: 960,
    minHeight: 680,
    title: 'PowerApps Helper',
    backgroundColor: '#0f1420',
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

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.alphavima.powerappshelper');
  store.init(app.getPath('userData'));
  credentials.init(app.getPath('userData'));
  auth.init(app.getPath('userData'));
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

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

function notifyDeployment(title, message) {
  try {
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: 'PowerApps Helper — ' + title,
      body: String(message || '').slice(0, 220),
      silent: false
    });
    activeNotifications.add(notification);
    notification.on('close', () => activeNotifications.delete(notification));
    notification.on('click', () => {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    });
    notification.show();
  } catch { /* The in-app result remains available when OS notifications are disabled. */ }
}

function sanitize(s) {
  return String(s || 'unknown').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
}

// Store an exported artifact per Settings: local structured folder or OneDrive.
async function storeArtifact({ artifact, account, sourceEnv, targetEnv, solution, version, managed }) {
  const settings = store.getSettings();
  const rel = path.join(
    sanitize(account),
    `${sanitize(sourceEnv)} to ${sanitize(targetEnv)}`,
    sanitize(solution),
    `${sanitize(version || 'export')}${managed ? '_managed' : ''}.zip`
  );
  if (settings.storageMode === 'onedrive') {
    stage('store', 'running', 0, 'Uploading to OneDrive…');
    const remote = (settings.oneDriveRoot || 'PowerApps Helper') + '/' + rel.split(path.sep).join('/');
    const buf = fs.readFileSync(artifact);
    const r = await graph.uploadBuffer(remote, buf, (pct) => stage('store', 'running', pct, `Uploading to OneDrive… ${pct}%`));
    stage('store', 'done', 100, 'Stored in OneDrive.');
    return { storage: 'onedrive', oneDriveUrl: r.webUrl, storedPath: remote };
  }
  const dest = path.join(settings.localFolder, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(artifact, dest);
  stage('store', 'done', 100, 'Saved to local folder.');
  return { storage: 'local', storedPath: dest };
}

function saveDeploymentRecord(record) {
  const saved = store.addDeployment(record);
  if (record.notes) {
    const notesFile = path.join(store.artifactsDir(), saved.id + '_notes.md');
    fs.writeFileSync(notesFile, record.notes, 'utf8');
    store.updateDeployment(saved.id, { notesFile });
    saved.notesFile = notesFile;
  }
  return saved;
}

function registerIpc() {
  let revealPending = false;
  let agentBusy = false;
  // --- Auth (multi-account) ---
  ipcMain.handle('auth:status', () => auth.status());
  ipcMain.handle('auth:add', async () => {
    if (agentBusy) return fail(new Error('Wait for the deployment agent to finish before adding an account.'));
    try { return ok({ account: await auth.addAccount() }); } catch (e) { return fail(e); }
  });
  ipcMain.handle('auth:setActive', (_e, id) => agentBusy ? fail(new Error('Wait for the deployment agent to finish before switching accounts.')) : auth.setActive(id));
  ipcMain.handle('auth:signOut', (_e, id) => agentBusy ? fail(new Error('Wait for the deployment agent to finish before signing out.')) : auth.signOut(id));
  ipcMain.handle('auth:cancel', () => auth.cancelSignIn());

  // --- Environments / solutions ---
  ipcMain.handle('env:list', async () => {
    try { return await dataverse.discoverEnvironments(); } catch (e) { return fail(e); }
  });
  ipcMain.handle('solution:list', async (_e, orgUrl) => {
    try { return await dataverse.listSolutions(orgUrl); } catch (e) { return fail(e); }
  });

  // --- Settings & storage ---
  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:save', (_e, patch) => store.saveSettings(patch));
  ipcMain.handle('credentials:status', () => credentials.status());
  ipcMain.handle('credentials:save', (_e, name, value) => {
    try { return ok({ status: credentials.save(name, value) }); } catch (e) { return fail(e); }
  });
  ipcMain.handle('credentials:remove', (_e, name) => {
    try { return ok({ status: credentials.remove(name) }); } catch (e) { return fail(e); }
  });
  ipcMain.handle('credentials:reveal', async (_e, name) => {
    if (revealPending) return fail(new Error('A Windows Hello verification is already in progress.'));
    revealPending = true;
    try {
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
  ipcMain.handle('dialog:pickZip', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Solution package', extensions: ['zip'] }]
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    return { ok: true, path: r.filePaths[0] };
  });
  ipcMain.handle('deploy:inspectFile', async (_e, { filePath }) => {
    try {
      const inspection = zip.inspect(filePath);
      return ok({ artifact: filePath, inspection, stored: { storage: 'local', storedPath: filePath } });
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
  ipcMain.handle('history:get', (_e, id) => store.getDeployment(id));
  ipcMain.handle('history:delete', (_e, ids) => store.deleteDeployments(Array.isArray(ids) ? ids : []));
  ipcMain.handle('history:export', async (_e, ids, format) => {
    try {
      const records = store.listDeployments().filter((item) => Array.isArray(ids) && ids.includes(item.id));
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
        const columns = ['createdAt', 'solution', 'solutionUniqueName', 'version', 'sourceEnv', 'sourceUrl', 'targetEnv', 'targetUrl', 'status', 'deploymentMethod', 'agent', 'account', 'exportManaged', 'workItems', 'workItemSummary', 'workItemDetails', 'description', 'notes', 'dependencies', 'artifact', 'stored', 'warning', 'error'];
        const cell = (value) => {
          let text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
          if (/^\s*[=+@-]/.test(text)) text = "'" + text;
          return `"${text.replace(/"/g, '""')}"`;
        };
        output = '\uFEFF' + [columns.join(','), ...records.map((record) => columns.map((name) => cell(record[name])).join(','))].join('\r\n');
      }
      fs.writeFileSync(result.filePath, output, 'utf8');
      return ok({ path: result.filePath, count: records.length });
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
  ipcMain.handle('deploy:export', async (_e, params) => {
    if (agentBusy) return fail(new Error('A deployment agent is already running.'));
    const { sourceEnvUrl, sourceEnvName, targetEnvName, account, solutionId, solutionName, newVersion, exportManaged } = params;
    try {
      if (newVersion && solutionId) {
        stage('version', 'running', null, `Setting version ${newVersion}…`);
        try {
          await dataverse.setSolutionVersion(sourceEnvUrl, solutionId, newVersion);
          stage('version', 'done', 100, `Version set to ${newVersion}.`);
        } catch (e) {
          stage('version', 'error', null, 'Version update warning: ' + e.message);
        }
      }
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const outFile = path.join(store.artifactsDir(), `${sanitize(solutionName)}_${sanitize(newVersion || 'export')}_${ts}${exportManaged ? '_managed' : ''}.zip`);

      stage('export', 'running', null, `Exporting ${solutionName} from ${sourceEnvName}…`);
      await dataverse.exportToFile(sourceEnvUrl, solutionName, exportManaged, outFile);
      stage('export', 'done', 100, 'Exported.');

      stage('analyze', 'running', null, 'Inspecting package…');
      const inspection = zip.inspect(outFile);
      stage('analyze', 'done', 100, `Found ${inspection.dependencies?.length || 0} dependencies.`);

      let stored = {};
      try {
        stored = await storeArtifact({
          artifact: outFile, account, sourceEnv: sourceEnvName, targetEnv: targetEnvName,
          solution: solutionName, version: newVersion, managed: exportManaged
        });
      } catch (e) {
        stage('store', 'error', null, 'Storage warning: ' + e.message);
      }
      return ok({ artifact: outFile, inspection, stored });
    } catch (e) {
      stage('export', 'error', null, e.message);
      notifyDeployment('Export stopped', 'Open the app to review the export error.');
      return fail(e);
    }
  });

  // === Bounded agent deployment from a source solution ===
  ipcMain.handle('deploy:agent', async (_e, params) => {
    if (agentBusy) return fail(new Error('A deployment agent is already running.'));
    agentBusy = true;
    try {
      const snapshot = structuredClone(params);
      const current = await auth.status();
      if (!current.signedIn || current.account.homeAccountId !== snapshot.accountId) {
        throw new Error('The active Microsoft account changed. Review the deployment details and try again.');
      }
      snapshot.account = current.account.username;
      const checkAccount = async () => {
        const latest = await auth.status();
        if (latest.account?.homeAccountId !== snapshot.accountId) throw new Error('The active Microsoft account changed during deployment.');
      };
      stage('agent', 'running', null, 'Agent deployment started.');
      const result = await deploymentAgent.runAgentDeployment(snapshot, {
        dataverse, mcp: dataverseMcp, zip,
        artifactsDir: store.artifactsDir, storeArtifact, report: stage, checkAccount
      });
      let warning = result.warning || '';
      let saved = null;
      try {
        saved = saveDeploymentRecord(deploymentAgent.makeHistoryRecord(snapshot, result, current.account.username));
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
      stage('agent', result.ok ? 'done' : 'error', result.ok ? 100 : null, result.ok ? (saved ? 'Deployment recorded in history.' : 'Import finished; history could not be saved.') : result.error);
      notifyDeployment(result.ok ? (warning ? 'Deployment needs attention' : 'Deployment complete') : 'Deployment stopped',
        result.ok ? (warning ? 'Open the app to review the warning.' : 'The solution was imported successfully.') : 'Open the app to review the error and retry.');
      return { ...result, warning, record: saved };
    } catch (error) {
      stage('agent', 'error', null, error.message);
      notifyDeployment('Deployment stopped', 'Open the app to review the error and retry.');
      return fail(error);
    } finally { agentBusy = false; }
  });

  // === Import into target (async, real progress) + optional publish ===
  ipcMain.handle('deploy:import', async (_e, params) => {
    if (agentBusy) return fail(new Error('A deployment agent is already running.'));
    const { targetEnvUrl, artifact, overwrite, publishChanges, exportManaged } = params;
    try {
      stage('import', 'running', 1, 'Starting import…');
      const r = await dataverse.importSolutionFromFile(
        targetEnvUrl, artifact, { overwrite, publishWorkflows: true },
        (pct, msg) => stage('import', 'running', pct, msg)
      );
      if (!r.ok) {
        stage('import', 'error', null, r.error);
        notifyDeployment('Import stopped', 'Open the app to review the import error.');
        return r;
      }
      stage('import', 'done', 100, 'Imported.');

      let publishWarning = '';
      if (publishChanges && !exportManaged) {
        stage('publish', 'running', null, 'Publishing customizations…');
        try {
          await dataverse.publishAll(targetEnvUrl);
          stage('publish', 'done', 100, 'Published.');
        } catch (e) {
          stage('publish', 'error', null, 'Publish warning: ' + e.message);
          publishWarning = 'Import succeeded, but publishing failed: ' + e.message;
        }
      }
      notifyDeployment(publishWarning ? 'Deployment needs attention' : 'Deployment complete',
        publishWarning ? 'Open the app to review the publishing warning.' : 'The solution was imported successfully.');
      return { ...r, ...(publishWarning ? { warning: publishWarning } : {}) };
    } catch (e) {
      stage('import', 'error', null, e.message);
      notifyDeployment('Import stopped', 'Open the app to review the import error.');
      return fail(e);
    }
  });

  // === Persist a deployment record + write notes file ===
  ipcMain.handle('deploy:record', async (_e, record) => {
    const saved = store.addDeployment(record);
    if (record.notes) {
      const notesFile = path.join(store.artifactsDir(), `${saved.id}_notes.md`);
      fs.writeFileSync(notesFile, record.notes, 'utf8');
      store.updateDeployment(saved.id, { notesFile });
      saved.notesFile = notesFile;
    }
    return saved;
  });
}
