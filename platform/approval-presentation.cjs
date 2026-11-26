'use strict';

// Presentation-only patch of an exact current clientdata envelope. Never
// recreate live connections, trigger metadata or approval decision handlers.
const detailsExpression = "@concat(coalesce(first(body('Load_profile')?['value'])?['abhi_approvalintro'],''),'\n\nSolution: ',triggerBody()?['abhi_solutionname'],' / ',coalesce(triggerBody()?['abhi_solutionversion'],''),'\nFrom: ',coalesce(triggerBody()?['abhi_sourceenvironment'],''),' (',triggerBody()?['abhi_sourceurl'],')','\nTo: ',coalesce(triggerBody()?['abhi_targetenvironment'],''),' (',triggerBody()?['abhi_targeturl'],')','\n\n',first(split(coalesce(triggerBody()?['abhi_details'],''),'TECHNICAL COMPONENT REFERENCES')),'\n\nREPORTED DEPENDENCY ERROR\n',substring(coalesce(triggerBody()?['abhi_errordetails'],''),0,min(4000,length(coalesce(triggerBody()?['abhi_errordetails'],'')))),'\n\nREQUEST REFERENCE\nRun: ',triggerBody()?['abhi_runid'],' / repair cycle ',string(triggerBody()?['abhi_repaircycle']),'\nExpires (UTC): ',triggerBody()?['abhi_expireson'],'\nPlan SHA-256: ',triggerBody()?['abhi_planhash'],'\nThe exact machine plan and technical component references are retained in the Deployment Event in PowerApps Helper Setup.')";
function applyApprovalPresentation(envelope) {
  const flow = structuredClone(envelope);
  const definition = flow.properties?.definition;
  const validation = definition?.actions?.Process_dependency_approval?.actions?.Validate_request;
  const choose = validation?.actions?.Choose_approval_mode;
  const requests = [choose?.actions?.Request_every_approver, choose?.else?.actions?.Request_first_response];
  if (requests.some(request => request?.inputs?.host?.operationId !== 'StartAndWaitForAnApproval') ||
      !validation.actions.Teams_approval_card || definition.triggers?.When_deployment_event_is_created?.inputs?.parameters?.['subscriptionRequest/runas'] !== 3) {
    throw new Error('Expected the verified active approval and Teams reminder contracts.');
  }
  for (const request of requests) {
    request.inputs.parameters['WebhookApprovalCreationInput/details'] = detailsExpression;
    request.inputs.parameters['WebhookApprovalCreationInput/title'] = "@concat('Approve dependency repair: ',triggerBody()?['abhi_solutionname'],' / Run ',triggerBody()?['abhi_runid'],' / cycle ',string(triggerBody()?['abhi_repaircycle']))";
  }
  const block = (text, extra = {}) => ({ type: 'TextBlock', text, wrap: true, ...extra });
  const field = name => `@string(coalesce(triggerBody()?['abhi_${name}'],''))`;
  validation.actions.Teams_approval_card.inputs = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.2', body: [
      block('Approve dependency repair', { size: 'Medium', weight: 'Bolder' }),
      { type: 'FactSet', facts: [['Solution','solutionname'], ['Version','solutionversion'], ['From','sourceenvironment'], ['To','targetenvironment']]
        .map(([title, name]) => ({ title, value: field(name) })) },
      block("@first(split(coalesce(triggerBody()?['abhi_details'],''),'TECHNICAL COMPONENT REFERENCES'))"),
      block('Reported dependency error', { weight: 'Bolder', separator: true }),
      block("@substring(coalesce(triggerBody()?['abhi_errordetails'],''),0,min(1200,length(coalesce(triggerBody()?['abhi_errordetails'],''))))"),
      block('Use the matching Microsoft approval request to approve or reject. Chat replies do not approve changes.', { separator: true }),
      block("@if(equals(triggerBody()?['abhi_approvalmode'],100000000),'Every selected approver must approve.','The first selected approver to respond decides.')"),
      { type: 'FactSet', facts: [['Requested by','initiatedby'], ['Run','runid'], ['Expires (UTC)','expireson']]
        .map(([title, name]) => ({ title, value: field(name) })) }
    ], actions: [{ type: 'Action.OpenUrl', title: 'Open approvals', url: 'https://make.powerautomate.com' }]
  };
  definition.contentVersion = '1.1.3.0';
  return flow;
}
module.exports = { applyApprovalPresentation, detailsExpression };
