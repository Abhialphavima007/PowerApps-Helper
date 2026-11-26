'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { approvalDetails, componentType } = require('../electron/services/approvalPresentation');
const { createDeploymentPower } = require('../electron/services/deploymentPower');
const { settings, createDeploymentAutomation, repairPlan, planHash } = require('../electron/services/deploymentAutomation');
const { applyApprovalPresentation, detailsExpression } = require('../platform/approval-presentation.cjs');
const { addProfileAccountPicker, registration } = require('../platform/profile-form.cjs');
const { extendApproval } = require('../platform/build-dependency-teams.cjs');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const id = '11111111-2222-4333-8444-555555555555';
const otherId = '22222222-3333-4444-8555-666666666666';

test('approval lists names and friendly types first without changing the approved machine plan', () => {
  const plan = { components: [{ name: 'new_orders', type: 1, id, includeSubcomponents: false },
    { name: 'Send\n*updates*', type: 29, id: otherId, includeSubcomponents: true }] };
  const before = JSON.stringify(plan);
  const details = approvalDetails(plan, [{ label: 'Unknown <component>' }], { [otherId]: 5 });
  assert.match(details, /^COMPONENTS TO ADD.*\n- new_orders — Table\n- Send updates — Cloud flow/);
  assert.match(details, /Unknown component/);
  assert.ok(details.indexOf('AFTER APPROVAL') < details.indexOf('TECHNICAL COMPONENT REFERENCES'));
  assert.equal(JSON.stringify(plan), before);
  assert.match(approvalDetails({ components: [{ type: 999, id }] }), /Unnamed component — Component \(type 999\)/);
});

test('process category determines workflow, business rule, action and flow names with a safe fallback', () => {
  for (const [category, name] of [[0,'Workflow'],[1,'Dialog'],[2,'Business rule'],[3,'Action'],[4,'Business process flow'],[5,'Cloud flow'],[6,'Desktop flow']]) {
    assert.equal(componentType(29, category), name);
  }
  assert.equal(componentType(29), 'Process');
  assert.equal(componentType(29, 99), 'Process');
  assert.equal(componentType(2), 'Column');
  assert.equal(componentType(61), 'Web resource');
});

test('saved MCP settings migrate to the existing authenticated API while destinations stay intact', () => {
  for (const repairTransport of ['mcp', 'auto', undefined]) {
    const migrated = settings({ enabled: true, environmentUrl: 'https://setup.crm3.dynamics.com', repairTransport });
    assert.equal(migrated.repairTransport, 'auto');
    assert.equal(migrated.environmentUrl, 'https://setup.crm3.dynamics.com');
    assert.equal(migrated.reportingDestination, 'setup');
  }
  assert.equal(settings().repairTransport, 'auto');
  assert.throws(() => settings({ repairTransport: 'unknown' }), /valid reporting/);
});

test('approval service labels source process categories and preserves the exact approved plan on lookup failure', async () => {
  const sourceUrl = 'https://source.crm3.dynamics.com', targetUrl = 'https://target.crm3.dynamics.com';
  for (const failLookup of [false, true]) {
    let event;
    const fixedTime = Date.parse('2026-11-26T10:00:00Z');
    const profile = { abhi_enabled:true, abhi_approvalmode:100000001, abhi_approvaltimeoutminutes:60,
      abhi_approvers:'approver@example.com', abhi_flowuserid:otherId };
    const config = {enabled:true,environmentUrl:'https://setup.crm3.dynamics.com',reportingDestination:'target',profileKey:'default'};
    const snapshot = {runId:id,solutionUniqueName:'Sample',version:'1.2.3.4',sourceUrl,targetUrl,
      sourceEnv:'Source',targetEnv:'Target',account:'deployer@example.com',accountId:'synthetic-account',deploymentAutomation:config};
    const candidates = [{id,type:29,label:'Notify_customers'}];
    const calls = [];
    const service = createDeploymentAutomation({ userDataPath:'synthetic-unused', getSettings:()=>({deploymentAutomation:config}),
      auth:{getTokenSilent:async ()=>'synthetic-token'}, now:()=>fixedTime,
      fetchImpl:async (url, options) => {
        calls.push(url);
        let result, status = 200;
        if (url.includes('abhi_deploymentprofiles?')) result = {value:[profile]};
        else if (url.includes('/workflows(')) {
          assert.ok(url.startsWith(sourceUrl));
          result = {category:5};
          if (failLookup) status = 403;
        } else if (options.method === 'POST') { event = JSON.parse(options.body); result = {}; }
        else if (url.includes('abhi_deploymentdecisions?')) {
          result = {value:[{abhi_deploymentdecisionid:event.abhi_deploymenteventid,
            _createdby_value:otherId,_modifiedby_value:otherId,abhi_runid:id,abhi_planhash:event.abhi_planhash,
            abhi_outcome:100000000,abhi_approvalid:'synthetic-approval',respondedon:'unused',
            abhi_respondedon:event.abhi_completedon,createdon:event.abhi_completedon,
            abhi_responses:JSON.stringify([{responder:{email:'approver@example.com'},approverResponse:'Approve'}])}]};
        } else if (url.includes('abhi_deploymentevents(')) result = event;
        else assert.fail('Unexpected request');
        return {ok:status===200,status,text:async()=>JSON.stringify(result)};
      }
    });
    const before = JSON.stringify(candidates);
    const approved = await service.requestApproval(snapshot,candidates,{cycle:1,error:'Reported dependency issue',unresolved:[]});
    assert.match(event.abhi_details, failLookup ? /Notify_customers — Process/ : /Notify_customers — Cloud flow/);
    assert.equal(event.abhi_planjson,JSON.stringify(repairPlan(snapshot,candidates,1)));
    assert.equal(event.abhi_planhash,planHash(repairPlan(snapshot,candidates,1)));
    assert.equal(JSON.stringify(candidates),before);
    assert.ok(calls.some(url=>url.includes('/workflows(')));
    await approved.assertValid();
  }
});

function powerHarness() {
  let next = 0;
  const running = new Set();
  const starts = [], stops = [];
  const power = createDeploymentPower({ start(type) { starts.push(type); running.add(++next); return next; },
    isStarted: id => running.has(id), stop(id) { stops.push(id); running.delete(id); } });
  return { power, starts, stops, running };
}
test('automatic sleep protection covers overlapping work and releases only after the last operation', async () => {
  const { power, starts, stops } = powerHarness();
  let releaseFirst, releaseSecond;
  const first = power.run(() => new Promise(resolve => { releaseFirst = resolve; }));
  const second = power.run(() => new Promise(resolve => { releaseSecond = resolve; }));
  assert.deepEqual(starts, ['prevent-app-suspension']);
  releaseFirst('exported');
  assert.equal(await first, 'exported');
  assert.deepEqual(stops, []);
  releaseSecond('approved');
  assert.equal(await second, 'approved');
  assert.deepEqual(stops, [1]);
  await power.run(async () => 'next');
  assert.equal(starts.length, 2);
  assert.deepEqual(stops, [1,2]);
});
test('sleep blocker releases on asynchronous failures and synchronous exceptions', async () => {
  const { power, stops } = powerHarness();
  await assert.rejects(power.run(async () => { throw new Error('import failed'); }), /import failed/);
  await assert.rejects(power.run(() => { throw new Error('export failed'); }), /export failed/);
  assert.deepEqual(stops, [1,2]);
});
test('a failed blocker start does not leave a phantom active operation', async () => {
  let calls = 0;
  const power = createDeploymentPower({ start() { if (++calls === 1) throw new Error('unavailable'); return 2; }, isStarted: () => false });
  await assert.rejects(power.run(async () => assert.fail('must not start work')), /unavailable/);
  assert.equal(await power.run(async () => 'recovered'), 'recovered');
  assert.equal(calls, 2);
});

test('the actual IPC registrations protect export, import and the complete agent approval wait', () => {
  const source = read('electron/main.js');
  const registered = new Map(), wrapped = new Set();
  const context = { ipcMain: { handle(name, handler) { registered.set(name, handler); if (handler.protected) wrapped.add(name); } },
    deploymentHandler(handler) { handler.protected = true; return handler; } };
  vm.runInNewContext(source.slice(source.indexOf('function registerIpc() {')), context);
  context.registerIpc();
  assert.deepEqual([...wrapped].sort(), ['deploy:agent','deploy:export','deploy:import']);
  assert.match(source, /dataverse, mcp: null, zip/);
  assert.doesNotMatch(source, /require\(['"]\.\/services\/dataverseMcp/);
});

function approvalFixture() {
  return extendApproval(JSON.parse(read('platform/dependency-approval-live-before-teams.json')),
    JSON.parse(read('platform/teams-live-before-destination-routing.json')), {
      shared_commondataserviceforapps: { connectorId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps', logicalName: 'abhi_testDataverse', connectionId: 'synthetic-dataverse' },
      shared_approvals: { connectorId: '/providers/Microsoft.PowerApps/apis/shared_approvals', logicalName: 'abhi_testApprovals', connectionId: 'synthetic-approvals' }
    });
}
test('presentation patch changes only two approval titles/details and reminder content; security is identical', () => {
  const before = approvalFixture();
  const after = applyApprovalPresentation(before);
  assert.notEqual(after, before);
  assert.deepEqual(after, before); // The generator already applies this presentation.
  const actions = after.properties.definition.actions.Process_dependency_approval.actions.Validate_request.actions;
  assert.equal(actions.Choose_approval_mode.actions.Request_every_approver.inputs.parameters['WebhookApprovalCreationInput/details'], detailsExpression);
  assert.match(detailsExpression, /first\(split/);
  assert.doesNotMatch(detailsExpression, /abhi_planjson/);
  const text = JSON.stringify(actions.Teams_approval_card.inputs);
  assert.ok(text.indexOf('first(split') < text.indexOf('Reported dependency error'));
  for (const change of [flow => { delete flow.properties.definition.actions.Process_dependency_approval; },
    flow => { flow.properties.definition.triggers.When_deployment_event_is_created.inputs.parameters['subscriptionRequest/runas'] = 2; }]) {
    const invalid = approvalFixture(); change(invalid);
    assert.throws(() => applyApprovalPresentation(invalid), /verified active approval/);
  }
});

function formHarness() {
  const attributes = new Map();
  const makeAttribute = value => ({ value, getValue() { return this.value; }, setValue(value) { this.value = value; },
    addOnChange(handler) { this.handler = handler; this.registrations = (this.registrations || 0) + 1; }, setSubmitMode(mode) { this.mode = mode; } });
  attributes.set('abhi_flowuserid', makeAttribute(id));
  attributes.set('abhi_approvalflowuser', makeAttribute(null));
  let reads = [], prevented = 0;
  const notices = [];
  const form = { getAttribute: name => attributes.get(name), ui: { setFormNotification: (...args) => notices.push(args) },
    data: { entity: { addOnSave(handler) { this.handler = handler; this.registrations = (this.registrations || 0) + 1; } } } };
  const context = { getFormContext: () => form, getEventArgs: () => ({ preventDefault() { prevented++; } }) };
  const sandbox = { Xrm: { WebApi: { retrieveRecord(entity, key, query) {
    assert.equal(entity, 'systemuser'); assert.equal(query, '?$select=systemuserid,fullname,isdisabled');
    return new Promise((resolve, reject) => reads.push({ key, resolve, reject }));
  } } } };
  vm.runInNewContext(read('platform/webresources/deployment-profile.js'), sandbox);
  return { api: sandbox.ABHI.DeploymentProfile, attributes, form, context, reads, notices,
    prevented: () => prevented, select(key = otherId, entityType = 'systemuser') { attributes.get('abhi_approvalflowuser').setValue([{ id: key, entityType }]); },
    user(key = otherId, isdisabled = false) { return { systemuserid: key, fullname: 'Test Account', isdisabled }; } };
}
test('form displays an existing trusted account by name and registers handlers once without replacing trust', async () => {
  const h = formHarness();
  const load = h.api.onLoad(h.context);
  h.reads[0].resolve(h.user(id)); await load;
  assert.equal(h.attributes.get('abhi_flowuserid').value, id);
  assert.equal(h.attributes.get('abhi_approvalflowuser').value[0].name, 'Test Account');
  await h.api.onLoad(h.context);
  assert.equal(h.attributes.get('abhi_approvalflowuser').registrations, 1);
  assert.equal(h.form.data.entity.registrations, 1);
  h.api.onSave(h.context); assert.equal(h.prevented(), 0);
});
test('explicit account selection validates an active user, blocks pending save and fills canonical GUID', async () => {
  const h = formHarness(); h.select();
  const pending = h.api.onAccountChange(h.context);
  h.api.onSave(h.context); assert.equal(h.prevented(), 1);
  h.reads[0].resolve(h.user()); await pending;
  assert.equal(h.attributes.get('abhi_flowuserid').value, otherId);
  assert.equal(h.attributes.get('abhi_flowuserid').mode, 'always');
  h.api.onSave(h.context); assert.equal(h.prevented(), 1);
});
test('inactive users, mismatched returned users and read failures never replace trusted identity', async () => {
  for (const action of [read => read.reject(new Error('403')), read => read.resolve({ systemuserid: otherId, isdisabled: true }),
    read => read.resolve({ systemuserid: id, isdisabled: false })]) {
    const h = formHarness(); h.select();
    const pending = h.api.onAccountChange(h.context); action(h.reads[0]); await pending;
    assert.equal(h.attributes.get('abhi_flowuserid').value, id);
    h.api.onSave(h.context); assert.equal(h.prevented(), 1);
    assert.equal(h.notices.at(-1)[1], 'ERROR');
  }
});
test('invalid selection and manually mismatched lookup prevent profile save', async () => {
  for (const selection of [['bad','systemuser'],[otherId,'contact']]) {
    const h = formHarness(); h.select(...selection); await h.api.onAccountChange(h.context);
    assert.equal(h.reads.length, 0); h.api.onSave(h.context); assert.equal(h.prevented(), 1);
  }
  const h = formHarness(); h.select(); h.api.onSave(h.context); assert.equal(h.prevented(), 1);
});
test('clearing selection clears trust and stale validation cannot restore the cleared account', async () => {
  const h = formHarness(); h.select(); const pending = h.api.onAccountChange(h.context);
  h.attributes.get('abhi_approvalflowuser').setValue(null); await h.api.onAccountChange(h.context);
  h.reads[0].resolve(h.user()); await pending;
  assert.equal(h.attributes.get('abhi_flowuserid').value, null);
  h.api.onSave(h.context); assert.equal(h.prevented(), 0);
});
test('latest selection wins against a slower earlier result', async () => {
  const h = formHarness(); h.select(); const first = h.api.onAccountChange(h.context);
  h.select(id); const second = h.api.onAccountChange(h.context);
  h.reads[1].resolve(h.user(id)); await second;
  h.reads[0].resolve(h.user()); await first;
  assert.equal(h.attributes.get('abhi_flowuserid').value, id);
});
test('form hydration failures preserve trust and slow hydration cannot override explicit selection', async () => {
  const h = formHarness(); const load = h.api.onLoad(h.context);
  h.select(); const change = h.api.onAccountChange(h.context);
  h.reads[1].resolve(h.user()); await change;
  h.reads[0].resolve(h.user(id)); await load;
  assert.equal(h.attributes.get('abhi_flowuserid').value, otherId);
  for (const result of ['failure','inactive','mismatch']) {
    const broken = formHarness(); const pending = broken.api.onLoad(broken.context);
    if (result === 'failure') broken.reads[0].reject(new Error('403'));
    else broken.reads[0].resolve(broken.user(result === 'mismatch' ? otherId : id, result === 'inactive'));
    await pending;
    assert.equal(broken.attributes.get('abhi_flowuserid').value, id);
    assert.equal(broken.attributes.get('abhi_approvalflowuser').value, null);
    assert.equal(broken.notices.at(-1)[1], 'WARNING');
  }
  const empty = formHarness(); empty.attributes.get('abhi_flowuserid').setValue(null);
  await empty.api.onLoad(empty.context); assert.equal(empty.reads.length, 0);
});
test('surgical form patch preserves unrelated fields and rejects unknown or already-customized registrations', () => {
  const base = '<form><tabs><row><cell id="trust"><control datafieldname="abhi_flowuserid" disabled="false" /></cell></row></tabs></form>';
  const result = addProfileAccountPicker(base);
  assert.match(result, /datafieldname="abhi_approvalflowuser"/);
  assert.match(result, /datafieldname="abhi_flowuserid" disabled="true"/);
  assert.ok(result.includes(registration));
  assert.throws(() => addProfileAccountPicker(result), /already present/);
  assert.throws(() => addProfileAccountPicker('<form></form>'), /existing deployment/);
  assert.throws(() => addProfileAccountPicker(base.replace('</form>','<events></events></form>')), /Unexpected/);
});
