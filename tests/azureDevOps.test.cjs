const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('fetches a user story, its child task, related item, and comments', async () => {
  const originalLoad = Module._load;
  Module._load = function (name, parent, isMain) {
    if (name === './credentials' && parent?.filename.endsWith('azureDevOps.js')) return { get: () => 'private-token' };
    if (name === './store' && parent?.filename.endsWith('azureDevOps.js')) return { getSettings: () => ({ azureDevOpsOrgUrl: 'https://dev.azure.com/example' }) };
    return originalLoad.call(this, name, parent, isMain);
  };
  const service = require('../electron/services/azureDevOps');
  Module._load = originalLoad;
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async (url, options) => {
    const parsed = new URL(url);
    urls.push(parsed.toString());
    assert.equal(options.headers.Authorization, `Basic ${Buffer.from(':private-token').toString('base64')}`);
    const match = parsed.pathname.match(/workItems\/(\d+)/i);
    const id = Number(match[1]);
    if (parsed.pathname.endsWith('/comments')) return { ok: true, text: async () => JSON.stringify(id === 101 && !parsed.searchParams.has('continuationToken')
      ? { comments: [{ text: '<p>Ready &amp; reviewed</p>', createdBy: { displayName: 'A' }, createdDate: '2026-01-01' }], continuationToken: 'next' }
      : { comments: id === 101 ? [{ text: 'Second comment', createdBy: { displayName: 'B' } }] : [] }) };
    return { ok: true, text: async () => JSON.stringify({ id, fields: {
      'System.Title': id === 101 ? 'Story' : id === 102 ? 'Child task' : 'Related item',
      'System.WorkItemType': id === 101 ? 'User Story' : 'Task',
      'System.TeamProject': 'Demo',
      'System.CreatedDate': '2026-11-01T10:00:00Z',
      'System.ChangedDate': '2026-11-02T10:00:00Z',
      'System.Description': '<p>Detailed <b>description</b></p>'
    }, relations: id === 101 ? [
      { rel: 'System.LinkTypes.Hierarchy-Forward', url: 'https://dev.azure.com/example/_apis/wit/workItems/102' },
      { rel: 'System.LinkTypes.Related', url: 'https://dev.azure.com/example/_apis/wit/workItems/103' }
    ] : id === 200 ? Array.from({ length: 160 }, (_, index) => ({ rel: 'System.LinkTypes.Hierarchy-Forward', url: `https://dev.azure.com/example/_apis/wit/workItems/${201 + index}` })) : [] }) };
  };
  try {
    const result = await service.fetchWorkItems('AB#101');
    assert.deepEqual(service.parseIds('AB#101 102 https://dev.azure.com/example/Demo/_workitems/edit/103'), [101, 102, 103]);
    assert.throws(() => service.parseIds('AB#101, typo, 103'), /Invalid Azure DevOps work item reference: typo/);
    assert.deepEqual(result.items.map((item) => item.id), [101, 102, 103]);
    assert.equal(result.items[0].comments[0].text, 'Ready & reviewed');
    assert.equal(result.items[0].comments[1].text, 'Second comment');
    assert.equal(result.items[0].createdAt, '2026-11-01T10:00:00Z');
    assert.equal(result.items[0].changedAt, '2026-11-02T10:00:00Z');
    assert.equal(result.items[1].parentId, 101);
    assert.equal(result.items[2].relation, 'related');
    assert(urls.every((url) => url.startsWith('https://dev.azure.com/example/')));
    let lastProgress;
    const large = await service.fetchWorkItems('200, 400', (progress) => { lastProgress = progress; });
    assert.deepEqual(large.rootIds, [200, 400]);
    assert.equal(large.items.length, 162);
    assert.equal(large.items.find((item) => item.id === 360).rootId, 200);
    assert.equal(lastProgress.loaded, 162);
    await assert.rejects(service.fetchWorkItems('https://dev.azure.com/another/Demo/_workitems/edit/101'), /configured Azure DevOps organization/);
  } finally { global.fetch = originalFetch; }
});
