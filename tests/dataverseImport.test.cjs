const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('returns missing components from the failed import job', async () => {
  const originalLoad = Module._load;
  Module._load = function (name, parent, isMain) {
    if (name === './auth' && parent?.filename.endsWith('dataverse.js')) return { getToken: async () => 'test-token' };
    return originalLoad.call(this, name, parent, isMain);
  };
  const dataverse = require('../electron/services/dataverse');
  Module._load = originalLoad;
  const file = path.join(os.tmpdir(), 'powerapps-import-' + Date.now() + '.zip');
  fs.writeFileSync(file, 'test');
  const originalFetch = global.fetch;
  const requested = [];
  const missingId = '11111111-2222-4333-8444-555555555555';
  global.fetch = async (url, options) => {
    requested.push({ url, method: options.method });
    if (url.includes('/ImportSolutionAsync')) {
      return { ok: false, status: 400, statusText: 'Bad Request', text: async () => JSON.stringify({ error: { message: 'Import failed' } }) };
    }
    if (url.includes('/importjobs(')) {
      return { ok: true, text: async () => JSON.stringify({ data: '<ImportLog><MissingDependencies><MissingDependency><Required type="61" id="{' + missingId + '}" schemaName="new_script.js"/><Dependent type="29"/></MissingDependency></MissingDependencies></ImportLog>' }) };
    }
    assert.fail('Unexpected URL: ' + url);
  };
  try {
    const result = await dataverse.importSolutionFromFile('https://target.crm.dynamics.com', file);
    assert.equal(result.ok, false);
    assert.match(result.error, /Import failed/);
    assert.equal(result.dependencies.length, 1);
    assert.equal(result.dependencies[0].requiredId, missingId);
    assert.equal(result.dependencies[0].requiredTypeCode, '61');
    assert(result.importJobId);
    assert(requested.some((item) => item.url.includes('/importjobs(' + result.importJobId + ')')));
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(file, { force: true });
  }
});
