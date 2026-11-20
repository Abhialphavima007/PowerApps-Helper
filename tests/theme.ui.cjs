// Run after npm run build:renderer with: npx --no-install electron tests/theme.ui.cjs
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../electron/services/store');

const tempRoot = path.resolve(os.tmpdir());
const folder = fs.mkdtempSync(path.join(tempRoot, 'powerapps-theme-ui-'));
app.setPath('userData', folder);
store.init(folder);
let win;
let signedIn = false;
let failure = '';
let readFailure = false;
let saveCount = 0;
const rendererErrors = [];
const outputDir = path.resolve(__dirname, '../release/theme-checks-20261120');
const evaluate = (source) => win.webContents.executeJavaScript(source);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(source) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await evaluate(source)) return;
    await pause(25);
  }
  throw new Error(`UI condition did not become true: ${source}`);
}

async function switchTheme(theme) {
  await evaluate(`document.querySelector('.sidebar-appearance button').click()`);
  await waitFor(`document.documentElement.dataset.theme === '${theme}' && !document.querySelector('.sidebar-appearance button').disabled`);
  assert.equal(store.getSettings().theme, theme);
}

function rgb(color) {
  const values = color.match(/[\d.]+/g).map(Number);
  return [values[0], values[1], values[2], values[3] ?? 1];
}
function composite(color, background) {
  return color.slice(0, 3).map((value, index) => value * color[3] + background[index] * (1 - color[3]));
}
function luminance(color) {
  return color.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

async function checkPalette(theme) {
  const samples = await evaluate(`(() => {
    const host = document.createElement('div');
    host.className = 'card'; host.style.cssText = 'position:fixed;left:-10000px';
    const classes = ['muted', 'log', 'alert err', 'alert info', 'alert warn', 'pill ok', 'pill bad', 'pill warn', 'pill managed', 'pill unmanaged', 'btn', 'btn danger', 'btn agent-button', 'sign-in-dialog', 'history-dialog', 'summary-dialog'];
    for (const className of classes) { const item = document.createElement('div'); item.className = className; item.textContent = 'Synthetic sample'; host.append(item); }
    document.body.append(host);
    const panel = getComputedStyle(host).backgroundColor;
    const results = Array.from(host.children, (item) => ({ name: item.className, text: getComputedStyle(item).color, background: getComputedStyle(item).backgroundColor, panel }));
    host.remove();
    return { results, scheme: getComputedStyle(document.documentElement).colorScheme, body: getComputedStyle(document.body).backgroundColor };
  })()`);
  assert.equal(samples.scheme, theme);
  assert.equal(samples.body, theme === 'light' ? 'rgb(244, 247, 252)' : 'rgb(15, 20, 32)');
  for (const sample of samples.results) {
    const background = composite(rgb(sample.background), rgb(sample.panel));
    const text = composite(rgb(sample.text), background);
    const levels = [luminance(text), luminance(background)].sort((a, b) => b - a);
    const ratio = (levels[0] + 0.05) / (levels[1] + 0.05);
    assert.ok(ratio >= 4.5, `${theme} ${sample.name} contrast ${ratio.toFixed(2)} must be at least 4.5`);
  }
  console.log(`PASS ${theme}: native color scheme and ${samples.results.length} text contrast samples`);
}

app.whenReady().then(async () => {
  ipcMain.handle('theme-test:settings-get', () => {
    if (readFailure) throw new Error('Synthetic settings read failure');
    return store.getSettings();
  });
  ipcMain.handle('theme-test:settings-save', async (_event, patch) => {
    saveCount++;
    await pause(100);
    const nextFailure = failure;
    failure = '';
    if (nextFailure === 'reject') throw new Error('Synthetic settings write failure');
    if (nextFailure === 'response') return { theme: 'unknown' };
    return store.saveSettings(patch);
  });
  ipcMain.handle('theme-test:auth-status', () => ({
    signedIn,
    account: signedIn ? { name: 'Synthetic User', username: 'synthetic@example.invalid', homeAccountId: 'synthetic', signInMethod: 'deviceCode' } : null,
    accounts: []
  }));
  ipcMain.handle('theme-test:cancel', () => {
    win.webContents.send('auth:progress', { stage: 'finished', requestId: 'synthetic-sign-in' });
  });
  win = new BrowserWindow({ show: false, width: 1200, height: 840, webPreferences: {
    preload: path.join(__dirname, 'fixtures/theme-preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true
  } });
  win.webContents.on('console-message', (_event, level, message) => {
    if (level === 3 && !message.includes('Synthetic settings')) rendererErrors.push(message);
  });
  const index = path.resolve(__dirname, '../dist/index.html');
  await win.loadFile(index);
  await waitFor(`!!document.querySelector('.sidebar-appearance button')`);
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark');
  await checkPalette('dark');
  await switchTheme('light');
  await checkPalette('light');
  await win.loadFile(index);
  await waitFor(`!!document.querySelector('.sidebar-appearance button')`);
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'light');
  console.log('PASS switching before sign-in and restoring light mode on reload');

  for (const kind of ['reject', 'response']) {
    failure = kind;
    await evaluate(`document.querySelector('.sidebar-appearance button').click()`);
    await waitFor(`document.documentElement.dataset.theme === 'light' && !!document.querySelector('[role="alert"]')`);
    assert.equal(store.getSettings().theme, 'light');
  }
  await switchTheme('dark');
  assert.equal(await evaluate(`!!document.querySelector('[role="alert"]')`), false);
  console.log('PASS write failure, invalid response, rollback and successful retry');

  const before = saveCount;
  await evaluate(`(() => { const button = document.querySelector('.sidebar-appearance button'); button.click(); button.click(); button.click(); })()`);
  await waitFor(`document.documentElement.dataset.theme === 'light' && !document.querySelector('.sidebar-appearance button').disabled`);
  assert.equal(saveCount - before, 1);
  console.log('PASS repeated clicks produce one pending theme save');

  signedIn = true;
  await win.loadFile(index);
  await waitFor(`!!document.querySelector('.main textarea')`);
  await evaluate(`(() => {
    window.themeDraft = document.querySelector('.main textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(window.themeDraft, 'Synthetic deployment draft');
    window.themeDraft.dispatchEvent(new Event('input', { bubbles:true }));
    document.querySelector('.nav button[aria-label="Settings"]').click();
  })()`);
  await waitFor(`!!document.querySelector('input[name="appearance"]')`);
  assert.equal(await evaluate(`document.querySelector('input[name="appearance"][value="light"]').checked`), true);
  await evaluate(`document.querySelector('input[name="appearance"][value="dark"]').click()`);
  await waitFor(`document.documentElement.dataset.theme === 'dark' && !document.querySelector('.sidebar-appearance button').disabled`);
  assert.equal(await evaluate(`window.themeDraft.isConnected && window.themeDraft.value === 'Synthetic deployment draft'`), true);
  await evaluate(`document.querySelector('input[name="appearance"][value="dark"]').focus()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left' });
  await waitFor(`document.documentElement.dataset.theme === 'light' && !document.querySelector('.sidebar-appearance button').disabled`);
  console.log('PASS Settings synchronization, keyboard radio switching and retained deployment draft');

  fs.mkdirSync(outputDir, { recursive: true });
  for (const theme of ['light', 'dark']) {
    if (store.getSettings().theme !== theme) await switchTheme(theme);
    await evaluate(`document.querySelector('.nav button[aria-label="Settings"]').click()`);
    await waitFor(`!!document.querySelector('input[name="appearance"]')`);
    await pause(300);
    const snapshot = await win.webContents.capturePage();
    const { width, height } = snapshot.getSize();
    const pixel = (Math.floor(height * 0.01) * width + Math.floor(width * 0.35)) * 4;
    const bitmap = snapshot.toBitmap();
    const actualBackground = [bitmap[pixel + 2], bitmap[pixel + 1], bitmap[pixel]];
    // Both canvases use gradients rather than a single flat color.
    if (theme === 'dark') assert.ok(actualBackground.every(channel => channel < 110), 'Captured frame must match the dark canvas');
    else assert.ok(actualBackground.every(channel => channel >= 180), 'Captured frame must match the light canvas');
    fs.writeFileSync(path.join(outputDir, `settings-${theme}.png`), snapshot.toPNG());
    await evaluate(`document.querySelector('.nav button[aria-label="Accounts"]').click()`);
    await waitFor(`!!document.querySelector('.account-overview')`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.account-overview')).backgroundImage.includes('${theme === 'light' ? '224, 235, 252' : '35, 54, 88'}')`), true);
    await evaluate(`document.querySelector('.nav button[aria-label="History"]').click()`);
    await waitFor(`!!document.querySelector('.history-row-actions button')`);
    await evaluate(`Array.from(document.querySelectorAll('.history-row-actions button')).find(button => button.textContent === 'View').click()`);
    await waitFor(`!!document.querySelector('.history-dialog[open]')`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.history-dialog')).backgroundColor`), theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(27, 36, 54)');
    await evaluate(`document.querySelector('.history-dialog button').click()`);
    win.webContents.send('auth:progress', { requestId: 'synthetic-sign-in', method: 'browser', stage: 'waiting' });
    await waitFor(`!!document.querySelector('.sign-in-dialog[open]')`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.sign-in-dialog')).backgroundColor`), theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(27, 36, 54)');
    await evaluate(`document.querySelector('.sign-in-dialog .sign-in-actions button').click()`);
    await waitFor(`!document.querySelector('.sign-in-dialog')`);
    console.log(`PASS ${theme}: Accounts, History detail and sign-in dialog inherit the selected palette`);
  }
  readFailure = true;
  await win.loadFile(index);
  await waitFor(`!!document.querySelector('.sidebar-appearance button')`);
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark');
  console.log('PASS failed startup settings read retains a usable app');
  assert.deepEqual(rendererErrors, []);
  console.log(`PASS no unexpected renderer errors; screenshots: ${outputDir}`);
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

app.on('quit', () => {
  if (!path.resolve(folder).startsWith(tempRoot + path.sep)) throw new Error('Unexpected UI test cleanup path');
  fs.rmSync(folder, { recursive: true, force: true });
});
