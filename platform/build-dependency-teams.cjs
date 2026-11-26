'use strict';

// Extend the verified approval flow with a private Teams reminder. Decisions
// still come exclusively from the authenticated Approvals connector.
const fs = require('fs');
const path = require('path');
const { applyApprovalPresentation } = require('./approval-presentation.cjs');

function extendApproval(baseline, teamsBaseline, bindings) {
  const flow = structuredClone(baseline);
  const definition = flow.properties?.definition;
  const validation = definition?.actions?.Process_dependency_approval?.actions?.Validate_request;
  const choose = validation?.actions?.Choose_approval_mode;
  const sendBaseline = teamsBaseline.properties?.definition?.actions?.Recipients_are_valid?.actions
    ?.Notify_each_person?.actions?.Send_private_deployment_card;
  const connectionName = sendBaseline?.inputs?.host?.connectionName;
  const reference = teamsBaseline.properties?.connectionReferences?.[connectionName];
  if (!choose || choose.actions?.Request_every_approver?.inputs?.host?.operationId !== 'StartAndWaitForAnApproval' ||
      choose.else?.actions?.Request_first_response?.inputs?.parameters?.approvalType !== 'Basic' ||
      !reference?.connection?.connectionReferenceLogicalName ||
      sendBaseline?.inputs?.host?.operationId !== 'PostCardToConversation') {
    throw new Error('Expected the verified approval actions and private Teams connector contract.');
  }
  const trigger = definition.triggers?.When_deployment_event_is_created;
  const triggerParameters = trigger?.inputs?.parameters;
  if (trigger?.inputs?.host?.operationId !== 'SubscribeWebhookTrigger' ||
      triggerParameters?.['subscriptionRequest/entityname'] !== 'abhi_deploymentevent') {
    throw new Error('Expected the verified Deployment Events Dataverse trigger.');
  }
  // The historical baseline uses Row owner, which cannot subscribe to the
  // OrganizationOwned event table. Verified callback metadata: Flow owner = 3.
  triggerParameters['subscriptionRequest/runas'] = 3;
  if (Object.hasOwn(flow.properties.connectionReferences, connectionName)) throw new Error('Teams connection name conflicts with the approval baseline.');
  flow.properties.connectionReferences[connectionName] = structuredClone(reference);
  for (const name of ['shared_commondataserviceforapps', 'shared_approvals']) {
    const binding = bindings?.[name];
    const current = flow.properties.connectionReferences[name];
    if (binding?.connectorId !== '/providers/Microsoft.PowerApps/apis/' + current?.api?.name ||
        !binding?.logicalName || !binding?.connectionId) throw new Error('Verified bound approval connections are required.');
    current.connection.connectionReferenceLogicalName = binding.logicalName;
  }
  for (const request of [choose.actions.Request_every_approver, choose.else.actions.Request_first_response]) {
    request.type = 'OpenApiConnectionWebhook';
    const title = request.inputs.parameters['WebhookApprovalCreationInput/title'];
    if (!title?.startsWith('@concat(') || !title.endsWith(')')) throw new Error('Unexpected approval title contract.');
    request.inputs.parameters['WebhookApprovalCreationInput/title'] = title.slice(0, -1) +
      ", ' / Run ',triggerBody()?['abhi_runid'],' / cycle ',string(triggerBody()?['abhi_repaircycle']))";
  }
  const field = name => `triggerBody()?['abhi_${name}']`;
  const text = value => ({ type: 'TextBlock', text: value, wrap: true });
  const facts = [ ['Solution', 'solutionname'], ['Version', 'solutionversion'], ['Source', 'sourceenvironment'],
    ['Source URL', 'sourceurl'], ['Target', 'targetenvironment'], ['Target URL', 'targeturl'],
    ['Requested by', 'initiatedby'], ['Run ID', 'runid'], ['Import job', 'importjobid'], ['Expires (UTC)', 'expireson'] ];
  validation.actions.Teams_approval_card = { type: 'Compose', runAfter: {}, inputs: {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.2', body: [
      { ...text('Dependency repair approval requested'), size: 'Medium', weight: 'Bolder' },
      text('The deployment encountered missing dependencies. Approve or reject the Microsoft approval email whose title includes this run ID and repair cycle. You can also open Power Automate, select the environment hosting this approval flow, then Approvals → Received. Approval permits the exact listed source additions, publication, re-export and retry. Replying to this chat does not approve a repair.'),
      { type: 'FactSet', facts: facts.map(([title, name]) => ({ title, value: `@string(coalesce(${field(name)},''))` })) },
      text("@if(equals(triggerBody()?['abhi_approvalmode'],100000000),'Rule: every selected approver must approve.','Rule: first selected member to respond decides. A rejection stops repair.')"),
      text(`@concat('Reported error: ',substring(coalesce(${field('errordetails')},''),0,min(1500,length(coalesce(${field('errordetails')},'')))))`),
      text(`@concat('Proposed dependencies and next steps: ',substring(coalesce(${field('details')},''),0,min(7000,length(coalesce(${field('details')},'')))),'\n\nFull details and exact plan are in the approval request.')`),
      text(`@concat('Repair cycle: ',string(${field('repaircycle')}),' / Plan SHA-256: ',${field('planhash')})`)
    ], actions: [{ type: 'Action.OpenUrl', title: 'Open Power Automate approvals', url: 'https://make.powerautomate.com' }]
  }};
  const send = structuredClone(sendBaseline);
  delete send.metadata;
  send.inputs.parameters['body/recipient'] = "@items('Notify_each_dependency_approver')";
  send.inputs.parameters['body/messageBody'] = "@string(outputs('Teams_approval_card'))";
  send.inputs.retryPolicy = { type: 'none' };
  validation.actions.Notify_each_dependency_approver = {
    type: 'Foreach', runAfter: { Teams_approval_card: ['Succeeded'] },
    foreach: "@split(triggerBody()?['abhi_recipients'],';')",
    runtimeConfiguration: { concurrency: { repetitions: 1 } },
    actions: { Send_private_dependency_approval: send }
  };
  // Reminder sends and the authenticated approval run independently. A Teams
  // delivery problem cannot manufacture an approval or overwrite its decision.
  validation.actions.Record_Teams_reminder_failure = { type: 'Compose',
    runAfter: { Notify_each_dependency_approver: ['Failed', 'TimedOut'] },
    inputs: 'One or more Teams reminders failed. Review this run. Use the correlated authenticated approval email or Power Automate Approvals.' };
  const failure = definition.actions.Record_approval_failure?.actions;
  const markFailed = failure?.Mark_approval_failed;
  if (!markFailed) throw new Error('Expected the verified approval failure handler.');
  failure.Mark_approval_failed = {
    type: 'If', runAfter: structuredClone(markFailed.runAfter),
    expression: "@empty(body('Load_failure_decisions')?['value'])",
    actions: { Mark_undecided_approval_failed: { ...markFailed, runAfter: {} } },
    else: { actions: {} }
  };
  return applyApprovalPresentation(flow);
}

if (require.main === module) {
  const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
  const flow = extendApproval(read('dependency-approval-live-before-teams.json'), read('teams-live-before-destination-routing.json'), read('dependency-approval-connection-bindings.json'));
  fs.writeFileSync(path.join(__dirname, 'dependency-approval-teams.json'), JSON.stringify(flow, null, 2) + '\n');
  process.stdout.write('Generated private Teams approval reminders from verified flow baselines.\n');
}
module.exports = { extendApproval };
