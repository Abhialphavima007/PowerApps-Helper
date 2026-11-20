const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const store = require('../electron/services/store');
const themeModule = import(pathToFileURL(path.join(__dirname, '../src/theme.mjs')).href);

test('normalizes supported themes and safely defaults unknown values to dark', async () => {
  const { normalizeTheme, applyTheme } = await themeModule;
  assert.equal(normalizeTheme('light'), 'light');
  for (const value of ['dark', undefined, null, '', 'system', 'LIGHT', {}]) {
    assert.equal(normalizeTheme(value), 'dark');
  }
  const root = { dataset: {} };
  applyTheme('light', root);
  assert.equal(root.dataset.theme, 'light');
  applyTheme('dark', root);
  assert.equal(root.dataset.theme, 'dark');
});

test('loads and applies the saved preference before returning', async () => {
  const { loadTheme } = await themeModule;
  const root = { dataset: {} };
  assert.equal(await loadTheme({ get: async () => ({ theme: 'light' }) }, root), 'light');
  assert.equal(root.dataset.theme, 'light');
  assert.equal(await loadTheme({ get: async () => ({}) }, root), 'dark');
});

test('settings read failures and a missing desktop API leave a usable dark theme', async () => {
  const { loadTheme } = await themeModule;
  for (const settingsApi of [null, { get: async () => { throw new Error('Synthetic read failure'); } }, { get: async () => null }]) {
    const root = { dataset: { theme: 'light' } };
    assert.equal(await loadTheme(settingsApi, root), 'dark');
    assert.equal(root.dataset.theme, 'dark');
  }
});

test('saves themes across restart without replacing existing storage preferences', () => {
  const tempRoot = path.resolve(os.tmpdir());
  const folder = fs.mkdtempSync(path.join(tempRoot, 'powerapps-theme-'));
  try {
    store.init(folder);
    assert.equal(store.getSettings().theme, 'dark');
    store.saveSettings({ clientName: 'Synthetic Client', oneDriveRoot: 'Synthetic Exports' });
    store.saveSettings({ theme: 'light' });
    store.init(folder);
    assert.equal(store.getSettings().theme, 'light');
    assert.equal(store.getSettings().clientName, 'Synthetic Client');
    store.saveSettings({ storageMode: 'onedrive', aiModels: { foundry: 'synthetic-model' } });
    assert.equal(store.getSettings().theme, 'light');
    assert.equal(store.getSettings().oneDriveRoot, 'Synthetic Exports');
    assert.equal(store.getSettings().aiModels.foundry, 'synthetic-model');
    store.saveSettings({ theme: 'dark' });
    store.init(folder);
    assert.equal(store.getSettings().theme, 'dark');
    for (const value of [null, '', 'system', 1]) {
      assert.throws(() => store.saveSettings({ theme: value }), /Choose light or dark mode/);
      assert.equal(store.getSettings().theme, 'dark');
    }
    const settingsPath = path.join(folder, 'powerapps-helper', 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'unknown', clientName: 'Legacy Client' }));
    assert.equal(store.getSettings().theme, 'dark');
    assert.equal(store.getSettings().clientName, 'Legacy Client');
    fs.writeFileSync(settingsPath, JSON.stringify({ clientName: 'Legacy Client' }));
    assert.equal(store.getSettings().theme, 'dark');
  } finally {
    if (!path.resolve(folder).startsWith(tempRoot + path.sep)) throw new Error('Unexpected test cleanup path');
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
