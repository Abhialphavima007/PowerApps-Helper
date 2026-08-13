'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
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

const isDev = process.env.NODE_ENV === 'development';
let win;

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
  store.init(app.getPath('userData'));
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

function registerIpc() {
  // --- Auth (multi-account) ---
  ipcMain.handle('auth:status', () => auth.status());
  ipcMain.handle('auth:add', async () => {
    try { return ok({ account: await auth.addAccount() }); } catch (e) { return fail(e); }
  });
  ipcMain.handle('auth:setActive', (_e, id) => auth.setActive(id));
  ipcMain.handle('auth:signOut', (_e, id) => auth.signOut(id));
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
  ipcMain.handle('settings:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    return { ok: true, folder: r.filePaths[0] };
  });
  ipcMain.handle('onedrive:connect', async () => {
    try { return await graph.connect(); } catch (e) { return fail(e); }
  });

  // --- AI ---
  ipcMain.handle('ai:providers', () => ai.availableProviders());
  ipcMain.handle('ai:generateNotes', async (_e, payload) => {
    try { return ok(await ai.generateNotes(payload)); } catch (e) { return fail(e); }
  });

  // --- History ---
  ipcMain.handle('history:list', () => store.listDeployments());
  ipcMain.handle('history:get', (_e, id) => store.getDeployment(id));

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
      return fail(e);
    }
  });

  // === Import into target (async, real progress) + optional publish ===
  ipcMain.handle('deploy:import', async (_e, params) => {
    const { targetEnvUrl, artifact, overwrite, publishChanges, exportManaged } = params;
    try {
      stage('import', 'running', 1, 'Starting import…');
      const r = await dataverse.importSolutionFromFile(
        targetEnvUrl, artifact, { overwrite, publishWorkflows: true },
        (pct, msg) => stage('import', 'running', pct, msg)
      );
      if (!r.ok) { stage('import', 'error', null, r.error); return r; }
      stage('import', 'done', 100, 'Imported.');

      if (publishChanges && !exportManaged) {
        stage('publish', 'running', null, 'Publishing customizations…');
        try {
          await dataverse.publishAll(targetEnvUrl);
          stage('publish', 'done', 100, 'Published.');
        } catch (e) {
          stage('publish', 'error', null, 'Publish warning: ' + e.message);
        }
      }
      return r;
    } catch (e) {
      stage('import', 'error', null, e.message);
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
