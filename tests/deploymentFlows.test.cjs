'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extendApproval } = require('../platform/build-dependency-teams.cjs');

const platformDirectory = path.join(__dirname, '..', 'platform');
const readFlow = name => JSON.parse(fs.readFileSync(path.join(platformDirectory, name), 'utf8'));
const triggerParameters = flow => flow.properties.definition.triggers.When_deployment_event_is_created.inputs.parameters;

test('base generators use Flow owner for the organization-owned event table', () => {
  const written = new Map();
  vm.runInNewContext(fs.readFileSync(path.join(platformDirectory, 'build-flows.cjs'), 'utf8'), {
    __dirname: platformDirectory,
    require(name) {
      if (name === 'fs') return { writeFileSync(file, contents) { written.set(path.basename(file), JSON.parse(contents)); } };
      if (name === 'path') return path;
      if (name === './approval-presentation.cjs') return require('../platform/approval-presentation.cjs');
      throw new Error('Unexpected generator dependency: ' + name);
    }
  });
  assert.deepEqual([...written.keys()].sort(), ['dependency-approval.json', 'deployment-outcome.json']);
  for (const [name, flow] of written) {
    const parameters = triggerParameters(flow);
    assert.equal(parameters['subscriptionRequest/entityname'], 'abhi_deploymentevent');
    assert.equal(parameters['subscriptionRequest/message'], 1);
    assert.equal(parameters['subscriptionRequest/scope'], 4);
    assert.equal(parameters['subscriptionRequest/runas'], 3);
    assert.equal(flow.properties.definition.contentVersion, name === 'dependency-approval.json' ? '1.1.4.0' : '1.1.3.0');
  }
  assert.match(triggerParameters(written.get('dependency-approval.json'))['subscriptionRequest/filterexpression'], /abhi_eventtype eq 100000002/);
});

function fixtures() {
  const baseline = readFlow('dependency-approval-live-before-teams.json');
  const teams = readFlow('teams-live-before-destination-routing.json');
  const bindings = {
    shared_commondataserviceforapps: { connectorId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps', logicalName: 'abhi_testDataverse', connectionId: 'synthetic-dataverse' },
    shared_approvals: { connectorId: '/providers/Microsoft.PowerApps/apis/shared_approvals', logicalName: 'abhi_testApprovals', connectionId: 'synthetic-approvals' }
  };
  return { baseline, teams, bindings };
}

test('Teams extension corrects historical Row owner while preserving the trigger contract', () => {
  const { baseline, teams, bindings } = fixtures();
  const original = structuredClone(baseline);
  const flow = extendApproval(baseline, teams, bindings);
  assert.deepEqual(baseline, original);
  const expected = { ...triggerParameters(baseline), 'subscriptionRequest/runas': 3 };
  assert.deepEqual(triggerParameters(flow), expected);
  assert.equal(flow.properties.definition.contentVersion, '1.1.4.0');
  assert.equal(flow.properties.connectionReferences.shared_commondataserviceforapps.connection.connectionReferenceLogicalName, 'abhi_testDataverse');
  const actions = flow.properties.definition.actions.Process_dependency_approval.actions.Validate_request.actions;
  assert.equal(actions.Choose_approval_mode.else.actions.Request_first_response.inputs.parameters.approvalType, 'Basic');
  assert.equal(actions.Notify_each_dependency_approver.foreach, "@split(triggerBody()?['abhi_recipients'],';')");
});

test('Teams extension rejects a missing or different Dataverse trigger', () => {
  for (const change of [
    flow => { delete flow.properties.definition.triggers; },
    flow => { triggerParameters(flow)['subscriptionRequest/entityname'] = 'abhi_other'; },
    flow => { flow.properties.definition.triggers.When_deployment_event_is_created.inputs.host.operationId = 'OtherTrigger'; }
  ]) {
    const { baseline, teams, bindings } = fixtures();
    change(baseline);
    assert.throws(() => extendApproval(baseline, teams, bindings), /Expected the verified Deployment Events Dataverse trigger/);
  }
});
