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

test('reads escaped missing dependencies from the target import error when no import job exists', async () => {
  const dataverse = require('../electron/services/dataverse');
  const file = path.join(os.tmpdir(), 'powerapps-import-error-' + Date.now() + '.zip');
  fs.writeFileSync(file, 'test');
  const originalFetch = global.fetch;
  const missingId = '11111111-2222-4333-8444-555555555555';
  const missingXml = '<MissingDependencies canResolveAllMissingDependencies="false"><MissingDependency canResolveMissingDependency="true"><Required type="61" id="{' + missingId + '}" schemaName="new_script.js"/><Dependent type="29"/></MissingDependency></MissingDependencies>';
  const escapedXml = missingXml.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  global.fetch = async (url) => {
    if (url.includes('/ImportSolutionAsync')) {
      return { ok: false, status: 400, statusText: 'Bad Request', text: async () => JSON.stringify({ error: { message: 'Solution manifest import: FAILURE. Some dependencies are missing. ' + escapedXml } }) };
    }
    if (url.includes('/importjobs(')) {
      return { ok: false, status: 404, statusText: 'Not Found', text: async () => '{}' };
    }
    assert.fail('Unexpected URL: ' + url);
  };
  try {
    const result = await dataverse.importSolutionFromFile('https://target.crm.dynamics.com', file);
    assert.equal(result.ok, false);
    assert.equal(result.dependencies.length, 1);
    assert.equal(result.dependencies[0].requiredId, missingId);
    assert.equal(result.dependencies[0].requiredTypeCode, '61');
    assert.match(result.importLog, /MissingDependencies/);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(file, { force: true });
  }
});

test('resolves only a unique source component with the exact schema name', async () => {
  const dataverse = require('../electron/services/dataverse');
  const originalFetch = global.fetch;
  const missingId = '11111111-2222-4333-8444-555555555555';
  let values = [{ webresourceid: missingId }];
  global.fetch = async (url) => {
    assert.match(url, /^https:\/\/source\.crm\.dynamics\.com\/api\/data\/v9\.2\/webresourceset\?/);
    assert.match(decodeURIComponent(url), /name eq 'new_script\.js'/);
    return { ok: true, text: async () => JSON.stringify({ value: values }) };
  };
  try {
    assert.equal(await dataverse.findComponentBySchema('https://source.crm.dynamics.com', 61, 'new_script.js'), missingId);
    values = [{ webresourceid: missingId }, { webresourceid: '22222222-3333-4444-8555-666666666666' }];
    assert.equal(await dataverse.findComponentBySchema('https://source.crm.dynamics.com', 61, 'new_script.js'), null);
    assert.equal(await dataverse.findComponentBySchema('https://source.crm.dynamics.com', 999, 'new_script.js'), null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('looks up an entity by logical-name key without unsupported metadata query options', async () => {
  const dataverse = require('../electron/services/dataverse');
  const originalFetch = global.fetch;
  const entityId = '11111111-2222-4333-8444-555555555555';
  global.fetch = async (url) => {
    assert.equal(url, "https://source.crm.dynamics.com/api/data/v9.2/EntityDefinitions(LogicalName='abhi_timeslot')");
    return { ok: true, text: async () => JSON.stringify({ MetadataId: entityId, LogicalName: 'abhi_timeslot' }) };
  };
  try {
    // Dataverse import logs may capitalize parts of a logical name even though
    // metadata lookup by LogicalName needs the source's canonical lowercase key.
    assert.equal(await dataverse.findComponentBySchema('https://source.crm.dynamics.com', 1, 'abhi_TimeSlot'), entityId);
  } finally {
    global.fetch = originalFetch;
  }
});

test('resolves an attribute by exact logical name under its required parent table', async () => {
  const dataverse = require('../electron/services/dataverse');
  const originalFetch = global.fetch;
  const attributeId = '11111111-2222-4333-8444-555555555555';
  let values = [{ MetadataId: attributeId, LogicalName: 'abhi_eventname' }];
  global.fetch = async (url) => {
    assert.match(decodeURIComponent(url), /EntityDefinitions\(LogicalName='abhi_event'\)\/Attributes\?\$select=MetadataId,LogicalName&\$filter=LogicalName eq 'abhi_eventname'/);
    return { ok: true, text: async () => JSON.stringify({ value: values }) };
  };
  try {
    assert.equal(await dataverse.findComponentBySchema('https://source.crm.dynamics.com', 2, 'abhi_eventname', { parentSchemaName: 'abhi_event' }), attributeId);
    values = [{ MetadataId: attributeId, LogicalName: 'abhi_eventname' }, { MetadataId: '22222222-3333-4444-8555-666666666666', LogicalName: 'abhi_eventname' }];
    assert.equal(await dataverse.findComponentBySchema('https://source.crm.dynamics.com', 2, 'abhi_eventname', { parentSchemaName: 'abhi_event' }), null);
    values = [{ MetadataId: attributeId, LogicalName: 'abhi_eventname' }];
    assert.equal(await dataverse.findComponentBySchema('https://source.crm.dynamics.com', 2, 'abhi_eventname'), null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('resolves global option sets and site maps by their exact source names', async () => {
  const dataverse = require('../electron/services/dataverse');
  const originalFetch = global.fetch;
  const optionSetId = '11111111-2222-4333-8444-555555555555';
  const siteMapId = '22222222-3333-4444-8555-666666666666';
  global.fetch = async (url) => {
    if (url.endsWith("/GlobalOptionSetDefinitions(Name='abhi_choiceoption')")) {
      return { ok: true, text: async () => JSON.stringify({ MetadataId: optionSetId, Name: 'abhi_choiceoption' }) };
    }
    assert.match(decodeURIComponent(url), /\/sitemaps\?\$select=sitemapid&\$filter=sitemapname eq 'abhi_DSTech_My_FundraiserApp'/);
    return { ok: true, text: async () => JSON.stringify({ value: [{ sitemapid: siteMapId }] }) };
  };
  try {
    assert.equal(await dataverse.findComponentBySchema('https://source.crm.dynamics.com', 9, 'abhi_choiceoption'), optionSetId);
    assert.equal(await dataverse.findComponentBySchema('https://source.crm.dynamics.com', 62, 'abhi_DSTech_My_FundraiserApp'), siteMapId);
  } finally {
    global.fetch = originalFetch;
  }
});

test('captures missing dependencies from nested Dataverse error details', async () => {
  const dataverse = require('../electron/services/dataverse');
  const file = path.join(os.tmpdir(), 'powerapps-import-nested-' + Date.now() + '.zip');
  fs.writeFileSync(file, 'test');
  const originalFetch = global.fetch;
  const missingId = '11111111-2222-4333-8444-555555555555';
  const xml = '<MissingDependencies><MissingDependency><Required type="61" id="' + missingId + '" schemaName="new_script.js"/></MissingDependency></MissingDependencies>';
  global.fetch = async (url) => {
    if (url.includes('/ImportSolutionAsync')) {
      return { ok: false, status: 400, statusText: 'Bad Request', text: async () => JSON.stringify({ error: { message: 'Import failed', innererror: { message: xml } } }) };
    }
    if (url.includes('/importjobs(')) return { ok: false, status: 404, statusText: 'Not Found', text: async () => '{}' };
    assert.fail('Unexpected URL: ' + url);
  };
  try {
    const result = await dataverse.importSolutionFromFile('https://target.crm.dynamics.com', file);
    assert.equal(result.dependencies[0].requiredId, missingId);
    assert.match(result.importLog, /MissingDependencies/);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(file, { force: true });
  }
});

test('waits briefly for a failed target import job to expose its dependency log', async () => {
  const dataverse = require('../electron/services/dataverse');
  const file = path.join(os.tmpdir(), 'powerapps-import-delayed-' + Date.now() + '.zip');
  fs.writeFileSync(file, 'test');
  const originalFetch = global.fetch;
  const missingId = '11111111-2222-4333-8444-555555555555';
  let jobReads = 0;
  global.fetch = async (url) => {
    if (url.includes('/ImportSolutionAsync')) {
      return { ok: false, status: 400, statusText: 'Bad Request', text: async () => JSON.stringify({ error: { message: 'Missing dependencies' } }) };
    }
    if (url.includes('/importjobs(')) {
      jobReads++;
      if (jobReads === 1) return { ok: false, status: 404, statusText: 'Not Found', text: async () => '{}' };
      return { ok: true, text: async () => JSON.stringify({ data: '<MissingDependencies><MissingDependency><Required type="61" id="' + missingId + '" schemaName="new_script.js"/></MissingDependency></MissingDependencies>' }) };
    }
    assert.fail('Unexpected URL: ' + url);
  };
  try {
    const result = await dataverse.importSolutionFromFile('https://target.crm.dynamics.com', file);
    assert.equal(jobReads, 2);
    assert.equal(result.dependencies[0].requiredId, missingId);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(file, { force: true });
  }
});

test('includes subcomponents only when adding an Entity through the Web API', async () => {
  const dataverse = require('../electron/services/dataverse');
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return { ok: true, text: async () => '{}' };
  };
  try {
    await dataverse.addSolutionComponent('https://source.crm.dynamics.com', 'Sample', '11111111-2222-4333-8444-555555555555', 9);
    await dataverse.addSolutionComponent('https://source.crm.dynamics.com', 'Sample', '22222222-3333-4444-8555-666666666666', 1);
    assert.deepEqual(requests.map(({ body }) => ({ type: body.ComponentType, includeSubcomponents: body.DoNotIncludeSubcomponents })), [
      { type: 9, includeSubcomponents: false },
      { type: 1, includeSubcomponents: true }
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('reads an entity primary-name column by its exact logical name', async () => {
  const dataverse = require('../electron/services/dataverse');
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(url, /EntityDefinitions\(LogicalName='abhi_donation'\)\?\$select=MetadataId,LogicalName,PrimaryNameAttribute/);
    return {
      ok: true,
      text: async () => JSON.stringify({
        MetadataId: '11111111-2222-4333-8444-555555555555',
        LogicalName: 'abhi_donation',
        PrimaryNameAttribute: 'abhi_donationname'
      })
    };
  };
  try {
    assert.deepEqual(await dataverse.getEntityPrimaryNameAttribute('https://source.crm.dynamics.com', 'abhi_Donation'), {
      entityId: '11111111-2222-4333-8444-555555555555',
      entitySchemaName: 'abhi_donation',
      attributeSchemaName: 'abhi_donationname'
    });
    assert.equal(await dataverse.getEntityPrimaryNameAttribute('https://source.crm.dynamics.com', 'invalid name'), null);
  } finally {
    global.fetch = originalFetch;
  }
});
