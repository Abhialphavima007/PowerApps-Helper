'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const workflow = require('../electron/services/teamsWorkflow');
const { DEFAULTS, settings, createTeamsNotifications } = require('../electron/services/teamsNotifications');

// Synthetic URL only. Tests never contact Microsoft or use a saved credential.
const endpoint = 'https://example.logic.azure.com/workflows/synthetic/triggers/manual/paths/invoke?sig=test-fixture-not-a-credential';
const snapshot = { runId: 'synthetic-run', solution: 'ExampleSolution', version: '1.0.0.1',
  sourceEnv: 'Development', targetEnv: 'Staging', account: 'initiator@example.invalid' };
const settle = async () => { for (let i = 0; i < 4; i += 1) await new Promise(resolve => setImmediate(resolve)); };

function fixture(t, choices = {}) {
  let config = settings({ enabled: true, recipients: 'person@example.invalid', ...choices });
  const privateStore = new Map();
  const requests = [];
  const credentials = { get: name => privateStore.get(name), save: (name, value) => privateStore.set(name, value),
    remove: name => privateStore.delete(name) };
  const ticks = [];
  let authCalls = 0;
  t.mock.method(global, 'setInterval', (callback, gap) => { ticks.push({ callback, gap }); return { unref() {} }; });
  t.mock.method(global, 'clearInterval', () => {});
  t.mock.method(global, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 202, body: { async cancel() {} } };
  });
  const service = createTeamsNotifications({
    auth: { async status() { authCalls += 1; throw new Error('Workflow must not ask for Graph sign-in.'); } },
    credentials,
    getSettings: () => ({ teamsNotifications: config }), notify() {}
  });
  t.after(() => service.dispose());
  service.saveWorkflow(endpoint, config);
  return { service, requests, ticks, credentials, privateStore, authCalls: () => authCalls,
    config: () => config, change: patch => { config = settings({ ...config, ...patch }); service.configure(); } };
}

test('workflow settings validate recipients, interval, channel and transport', () => {
  assert.equal(DEFAULTS.transport, 'workflow');
  assert.equal(settings({}).intervalMinutes, 5);
  assert.equal(settings({ recipients: ' A@example.invalid; a@example.invalid, B@example.invalid ' }).recipients,
    'a@example.invalid; b@example.invalid');
  for (const value of [{ intervalMinutes: 0 }, { intervalMinutes: 1441 }, { intervalMinutes: 1.5 },
    { recipients: 'invalid' }, { transport: 'unknown' }, { enabled: true }, { channelLink: 'https://example.invalid/' }]) {
    assert.throws(() => settings(value));
  }
});

test('only signed Microsoft HTTPS workflow endpoints are accepted', () => {
  assert.equal(workflow.validateEndpoint(endpoint), endpoint);
  assert.doesNotThrow(() => workflow.validateEndpoint(endpoint.replace('example.logic.azure.com', 'example.api.powerplatform.com')));
  for (const url of [endpoint.replace('https:', 'http:'), endpoint.replace('example.logic.azure.com', 'example.invalid'),
    endpoint.replace('/paths/invoke', '/other'), endpoint.replace('?sig=test-fixture-not-a-credential', ''),
    endpoint.replace('https://', 'https://user@'), endpoint + '#fragment', endpoint + '&access_token=invalid']) {
    assert.throws(() => workflow.validateEndpoint(url));
  }
});

test('workflow setup normalizes choices and never invokes Graph or reveals the callback', async t => {
  const f = fixture(t);
  f.service.assertReady({ enabled: true, recipients: 'PERSON@example.invalid' });
  const result = await f.service.connect();
  assert.equal(result.ok, true);
  assert.equal(result.transport, 'workflow');
  assert.equal(f.authCalls(), 0);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.service.workflowStatus(), { configured: true, destinationsMatch: true, deliveryVerified: false });
  assert.equal(JSON.stringify(result).includes(endpoint), false);
  assert.throws(() => f.service.assertReady({ ...f.config(), recipients: 'other@example.invalid' }), /destinations changed/);
});

test('dedicated workflow check refuses direct sender and invalid saved setup without authentication', async t => {
  const f = fixture(t);
  const checked = f.service.checkWorkflow();
  assert.equal(checked.transport, 'workflow');
  assert.equal(JSON.stringify(checked).includes(endpoint), false);
  assert.equal(f.service.revealWorkflow(), endpoint);
  f.change({ transport: 'graph' });
  assert.throws(() => f.service.checkWorkflow(), /Select Workflows bot/);
  await assert.rejects(f.service.connect('workflow'), /sender changed/);
  f.change({ transport: 'workflow', recipients: 'other@example.invalid' });
  assert.throws(() => f.service.checkWorkflow(), /destinations changed/);
  f.service.removeWorkflow();
  assert.throws(() => f.service.checkWorkflow(), /Save your Teams workflow address/);
  assert.throws(() => f.service.revealWorkflow(), /No saved workflow address/);
  assert.equal(f.authCalls(), 0);
  assert.equal(f.requests.length, 0);
});

test('unreadable or invalid workflow records cannot be revealed or checked', t => {
  const f = fixture(t);
  f.privateStore.set('teamsWorkflow', JSON.stringify({ version: 1, routingKey: '', url: 'https://example.invalid/' }));
  assert.throws(() => f.service.revealWorkflow(), /No saved workflow address/);
  assert.throws(() => f.service.checkWorkflow(), /Save your Teams workflow address/);
  t.mock.method(f.credentials, 'get', () => { throw new Error(endpoint); });
  assert.throws(() => f.service.revealWorkflow(), /No saved workflow address/);
  assert.equal(f.authCalls(), 0);
  assert.equal(f.requests.length, 0);
});

test('a fast completion retains the callback until both ordered messages finish', async t => {
  const f = fixture(t);
  f.service.start(snapshot);
  f.service.finish(snapshot.runId, { ok: true });
  await settle();
  assert.equal(f.requests.length, 2);
  const cards = f.requests.map(item => JSON.parse(item.options.body));
  assert.equal(cards[0].type, 'message');
  const lines = cards.map(card => card.attachments[0].content.body.map(block => block.text).join('\n'));
  assert.match(lines[0], /Started/);
  assert.match(lines[1], /Completed/);
  assert.match(lines[1], /Development → Staging/);
  assert.match(lines[1], /ExampleSolution v1.0.0.1/);
  assert.equal(f.requests[0].options.headers.Authorization, undefined);
  assert.equal(f.requests[0].options.redirect, 'error');
  assert.equal(f.service.get(snapshot.runId).state, 'workflow_accepted');
  assert.equal(f.service.get(snapshot.runId).destinations[0].state, 'delivery_unconfirmed');
  assert.equal(JSON.stringify(f.service.list()).includes(endpoint), false);
});

test('progress uses the configured gap and latest observation; queued progress skips after finish', async t => {
  const f = fixture(t, { intervalMinutes: 7 });
  f.service.start(snapshot);
  await settle();
  assert.equal(f.ticks[0].gap, 7 * 60000);
  f.service.update(snapshot.runId, 'import', 'running', 42, 'Import job is running.');
  f.ticks[0].callback();
  await settle();
  assert.match(f.requests[1].options.body, /Import job is running/);
  assert.match(f.requests[1].options.body, /42%/);
  f.ticks[0].callback();
  f.service.finish(snapshot.runId, { ok: false, error: 'Synthetic import failure.' });
  await settle();
  assert.equal(f.requests.length, 3);
  assert.match(f.requests[2].options.body, /Synthetic import failure/);
  assert.equal(f.service.get(snapshot.runId).outcome, 'failure');
});

test('uncertain Started request is not retried; a distinct failure event still sends', async t => {
  const f = fixture(t);
  let calls = 0;
  t.mock.method(global, 'fetch', async () => {
    calls += 1;
    if (calls === 1) throw new Error('Synthetic network failure.');
    return { ok: true, status: 202 };
  });
  f.service.start(snapshot);
  await settle();
  assert.equal(f.service.get(snapshot.runId).state, 'attention');
  f.ticks[0].callback();
  await settle();
  assert.equal(calls, 1);
  f.service.finish(snapshot.runId, { ok: false, error: 'Synthetic deployment failure.' });
  await settle();
  assert.equal(calls, 2);
  assert.equal(f.service.get(snapshot.runId).outcome, 'failure');
});

test('replacing a callback cancels already closed sessions with queued messages', async t => {
  const f = fixture(t);
  f.service.start(snapshot);
  f.service.finish(snapshot.runId, { ok: true });
  f.service.saveWorkflow(endpoint, f.config());
  await settle();
  assert.equal(f.requests.length, 0);
  assert.equal(f.service.get(snapshot.runId).cancelled, true);
});

test('disabling, switching transport and removing workflow stop queued sends', async t => {
  const f = fixture(t);
  f.service.start(snapshot);
  f.change({ enabled: false });
  await settle();
  assert.equal(f.requests.length, 0);
  f.change({ enabled: true });
  f.service.start({ ...snapshot, runId: 'switch-run' });
  f.change({ transport: 'graph' });
  await settle();
  assert.equal(f.requests.length, 0);
  f.change({ transport: 'workflow' });
  f.service.start({ ...snapshot, runId: 'remove-run' });
  f.service.removeWorkflow();
  await settle();
  assert.equal(f.requests.length, 0);
  assert.equal(f.service.workflowStatus().configured, false);
});

test('workflow HTTP rejection is sanitized and cannot expose the callback', async t => {
  t.mock.method(global, 'fetch', async () => ({ ok: false, status: 403, body: { async cancel() {} } }));
  await assert.rejects(workflow.post(endpoint, 'Synthetic update', new AbortController().signal), error => {
    assert.match(error.message, /returned 403/);
    assert.equal(error.message.includes(endpoint), false);
    return true;
  });
});

test('unsigned tenant webhooks give actionable instructions; modern signed URLs are accepted', () => {
  const modern = endpoint.replace('example.logic.azure.com', 'example.environment.api.powerplatform.com')
    .replace('/workflows/', '/powerautomate/automations/direct/workflows/');
  assert.equal(workflow.validateEndpoint(` ${modern} `), modern);
  for (const value of [modern.split('?')[0], modern.replace('sig=test-fixture-not-a-credential', 'sig=%20')]) {
    assert.throws(() => workflow.validateEndpoint(value), error => {
      const failure = workflow.setupFailure(error);
      assert.equal(failure.code, 'WORKFLOW_SIGNATURE_MISSING');
      assert.match(failure.error, /Who can trigger the flow to Anyone/);
      assert.equal(JSON.stringify(failure).includes(value), false);
      return true;
    });
  }
  for (const value of [null, '', 'not an address', 'x'.repeat(8001)]) {
    assert.throws(() => workflow.validateEndpoint(value), { code: 'WORKFLOW_ADDRESS_INVALID' });
  }
  assert.throws(() => workflow.validateEndpoint(modern.replace('.api.powerplatform.com', '.api.powerplatform.com.evil.invalid')),
    { code: 'WORKFLOW_ADDRESS_UNSUPPORTED' });
});

test('arbitrary storage errors and spoofed error codes never cross IPC', () => {
  for (const error of [new Error(endpoint), { code: 'WORKFLOW_SIGNATURE_MISSING', message: endpoint }, null]) {
    const failure = workflow.setupFailure(error);
    assert.equal(failure.code, 'WORKFLOW_SETUP_FAILED');
    assert.equal(JSON.stringify(failure).includes(endpoint), false);
  }
});

test('invalid settings and unsigned endpoints leave the saved callback intact', t => {
  const f = fixture(t);
  const old = f.privateStore.get('teamsWorkflow');
  let persisted = false;
  assert.throws(() => f.service.saveWorkflow(endpoint.split('?')[0], f.config(), () => { persisted = true; }),
    { code: 'WORKFLOW_SIGNATURE_MISSING' });
  assert.throws(() => f.service.saveWorkflow(endpoint, { ...f.config(), intervalMinutes: 0 }),
    { code: 'WORKFLOW_CHOICES_INVALID' });
  assert.throws(() => f.service.saveWorkflow(endpoint, { enabled: false }),
    { code: 'WORKFLOW_DESTINATIONS_MISSING' });
  assert.equal(f.privateStore.get('teamsWorkflow'), old);
  assert.equal(persisted, false);
});

test('credential read/save failures are safe and do not write settings', t => {
  const f = fixture(t);
  let persisted = false;
  for (const method of ['get', 'save']) {
    const mock = t.mock.method(f.credentials, method, () => { throw new Error(endpoint); });
    assert.throws(() => f.service.saveWorkflow(endpoint, f.config(), () => { persisted = true; }), error => {
      const failure = workflow.setupFailure(error);
      assert.equal(failure.code, 'WORKFLOW_CREDENTIAL_SAVE_FAILED');
      assert.equal(JSON.stringify(failure).includes(endpoint), false);
      return true;
    });
    mock.mock.restore();
  }
  assert.equal(persisted, false);
});

test('failed settings persistence restores the earlier workflow and preserves queued sends', async t => {
  const f = fixture(t);
  const old = f.privateStore.get('teamsWorkflow');
  f.service.start(snapshot);
  assert.throws(() => f.service.saveWorkflow(endpoint, { ...f.config(), recipients: 'other@example.invalid' }, () => {
    throw new Error('Synthetic disk write failure.');
  }), { code: 'WORKFLOW_SETTINGS_SAVE_FAILED' });
  assert.equal(f.privateStore.get('teamsWorkflow'), old);
  assert.equal(f.service.workflowStatus().destinationsMatch, true);
  await settle();
  assert.equal(f.requests.length, 1);
});

test('a failed first setup removes only the newly stored callback', t => {
  const f = fixture(t);
  f.privateStore.delete('teamsWorkflow');
  f.privateStore.set('azureDevOps', 'synthetic-existing-credential');
  assert.throws(() => f.service.saveWorkflow(endpoint, f.config(), () => { throw new Error('Synthetic disk failure.'); }),
    { code: 'WORKFLOW_SETTINGS_SAVE_FAILED' });
  assert.equal(f.privateStore.has('teamsWorkflow'), false);
  assert.equal(f.privateStore.get('azureDevOps'), 'synthetic-existing-credential');
});

test('failed recovery cancels workflow reporting and returns only a safe message', async t => {
  const f = fixture(t);
  f.service.start(snapshot);
  let saves = 0;
  t.mock.method(f.credentials, 'save', (name, value) => {
    saves += 1;
    if (saves > 1) throw new Error(endpoint);
    f.privateStore.set(name, value);
  });
  assert.throws(() => f.service.saveWorkflow(endpoint, f.config(), () => { throw new Error(endpoint); }), error => {
    const failure = workflow.setupFailure(error);
    assert.equal(failure.code, 'WORKFLOW_RECOVERY_FAILED');
    assert.equal(JSON.stringify(failure).includes(endpoint), false);
    return true;
  });
  await settle();
  assert.equal(f.service.get(snapshot.runId).cancelled, true);
  assert.equal(f.requests.length, 0);
});

test('successful setup persists normalized settings and payload routing follows selected people', async t => {
  const f = fixture(t, { workflowRouting: 'payload' });
  let saved;
  const state = f.service.saveWorkflow(endpoint, { ...f.config(), recipients: 'PERSON@example.invalid' }, config => { saved = config; });
  assert.equal(saved.recipients, 'person@example.invalid');
  assert.equal(state.routingMode, 'payload');
  assert.equal(state.destinationsMatch, true);
  assert.equal(JSON.stringify(saved).includes(endpoint), false);
  f.change({ recipients: 'other@example.invalid' });
  f.service.assertReady(f.config());
  f.service.start(snapshot);
  f.service.finish(snapshot.runId, { ok: true });
  await settle();
  assert.equal(f.requests.length, 2);
  for (const item of f.requests) {
    const body = JSON.parse(item.options.body);
    assert.deepEqual(body.helper.recipients, ['other@example.invalid']);
    assert.equal(body.attachments[0].content.body.length, 2);
  }
  assert.throws(() => settings({ ...f.config(), channelLink: 'https://teams.microsoft.com/l/channel/example/general?groupId=00000000-0000-0000-0000-000000000001' }));
});
