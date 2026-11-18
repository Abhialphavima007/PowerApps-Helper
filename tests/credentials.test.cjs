const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

test('stores credentials encrypted and returns only presence to the UI', () => {
  const originalLoad = Module._load;
  Module._load = function (name, parent, isMain) {
    if (name === 'electron') return { safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value).reverse(),
      decryptString: (value) => Buffer.from(value).reverse().toString()
    } };
    return originalLoad.call(this, name, parent, isMain);
  };
  const credentials = require('../electron/services/credentials');
  Module._load = originalLoad;
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'powerapps-credentials-'));
  try {
    credentials.init(folder);
    assert.deepEqual(credentials.save('azureDevOps', 'secret-pat').azureDevOps, true);
    assert.equal(credentials.save('foundry', 'foundry-secret').foundry, true);
    const file = path.join(folder, 'powerapps-helper', 'credentials.bin');
    assert.equal(fs.readFileSync(file).includes('secret-pat'), false);
    assert.equal(fs.readFileSync(file).includes('foundry-secret'), false);
    credentials.init(folder);
    assert.equal(credentials.status().azureDevOps, true);
    assert.equal(credentials.status().foundry, true);
    assert.equal(credentials.get('azureDevOps'), 'secret-pat');
    assert.equal(credentials.remove('azureDevOps').azureDevOps, false);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
