const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../electron/services/store');

test('deletes selected history records without deleting exported artifacts', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'powerapps-history-'));
  try {
    store.init(folder);
    const artifact = path.join(store.artifactsDir(), 'solution.zip');
    fs.writeFileSync(artifact, 'package');
    const first = store.addDeployment({ solution: 'First', artifact });
    const second = store.addDeployment({ solution: 'Second' });
    assert.equal(store.deleteDeployments([first.id]).deleted, 1);
    assert.deepEqual(store.listDeployments().map((item) => item.id), [second.id]);
    assert.equal(fs.readFileSync(artifact, 'utf8'), 'package');
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
