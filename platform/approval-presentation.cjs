'use strict';

// Presentation v1.1.4 — patch an exact current clientdata envelope. Preserve
// live connections, trigger metadata and authenticated decision handlers.
const PRESENTATION_VERSION = '1.1.4.0';
const literal = text => "'" + text.replace(/'/g, "''") + "'";
const value = name => `coalesce(triggerBody()?['abhi_${name}'],'')`;
const concat = (...parts) => `concat(${parts.join(',')})`;
// Labels outside code blocks cannot create extra Markdown headings or links.
// Environment URLs are validated by the existing Helper request contract.
const label = name => ['\\', '`', '*', '_', '[', ']', '<', '>', '#']
  .reduce((expression, character) => `replace(${expression},${literal(character)},${literal('\\' + character)})`,
    `replace(replace(string(${value(name)}),${literal('\r')},' '),${literal('\n')},' ')`);
const publicDetails = `trim(first(split(${value('details')},'TECHNICAL COMPONENT REFERENCES')))`;
const approvalRule = "if(equals(triggerBody()?['abhi_approvalmode'],100000000),'Every selected approver must approve.','The first selected approver to respond decides. A rejection stops the repair.')";
function errorText(limit) {
  const bounded = `substring(${value('errordetails')},0,min(${limit},length(${value('errordetails')})))`;
  // Diagnostics cannot close a code fence. Lay XML out one element per line;
  // the full original error is retained in the Deployment Event.
  const formatted = `replace(replace(${bounded},${literal('```')},'~~~'),'><',${literal('>\n<')})`;
  return concat(formatted, `if(greater(length(${value('errordetails')}),${limit}),${literal('\n[Excerpt; full error retained in the Deployment Event.]')},'')`);
}
const detailsExpression = '@' + concat(
  literal('**Dependency repair approval**\n\n'),
  "coalesce(first(body('Load_profile')?['value'])?['abhi_approvalintro'],'')",
  literal('\n\n**Approval rule:** '), approvalRule,
  literal('\n\n**1. Deployment**\n\n- **Solution:** '), label('solutionname'),
  literal('\n- **Version:** '), label('solutionversion'),
  literal('\n- **From:** '), label('sourceenvironment'), literal(' ('), value('sourceurl'), literal(')'),
  literal('\n- **To:** '), label('targetenvironment'), literal(' ('), value('targeturl'), literal(')'),
  literal('\n\n'), publicDetails,
  literal('\n\n**5. Reported dependency error**\n\n```text\n'), errorText(4000), literal('\n```'),
  literal('\n\n**6. Request reference**\n\n- **Run:** '), label('runid'),
  literal('\n- **Repair cycle:** '), "string(triggerBody()?['abhi_repaircycle'])",
  literal('\n- **Expires (UTC):** '), label('expireson'),
  literal('\n- **Plan SHA-256:**\n\n```text\n'), label('planhash'), literal('\n```'),
  literal('\n\nThe exact machine plan and technical component references are retained in the Deployment Event in PowerApps Helper Setup.')
);
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
  const field = name => `@string(${value(name)})`;
  const facts = pairs => ({ type: 'FactSet', facts: pairs.map(([title, name]) => ({ title, value: field(name) })) });
  const fenceStart = literal('```text\n');
  const fenceEnd = literal('\n```');
  const hasSummary = `contains(${publicDetails},${fenceStart})`;
  // Teams TextBlock has a smaller Markdown subset than Approvals. Render code
  // separately with the supported Adaptive Card 1.2 Monospace fontType.
  const dependencyCode = `first(split(last(split(${publicDetails},${fenceStart})),${fenceEnd}))`;
  validation.actions.Teams_approval_card.inputs = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.2', body: [
      block('Dependency repair approval', { size: 'Medium', weight: 'Bolder' }),
      block('@' + concat(literal('**Approval rule:** '), approvalRule)),
      block('1. Deployment', { weight: 'Bolder', separator: true }),
      facts([['Solution','solutionname'], ['Version','solutionversion'], ['From','sourceenvironment'], ['To','targetenvironment']]),
      block(`@replace(first(split(${publicDetails},${fenceStart})),'\u0060','')`, { separator: true }),
      block(`@if(${hasSummary},${dependencyCode},'')`, { fontType: 'Monospace', isVisible: '@' + hasSummary }),
      block(`@if(${hasSummary},replace(last(split(${publicDetails},${fenceEnd})),'\u0060',''),'')`, { isVisible: '@' + hasSummary }),
      block('5. Reported dependency error', { weight: 'Bolder', separator: true }),
      block('@' + errorText(1200), { fontType: 'Monospace' }),
      block('6. Request reference', { weight: 'Bolder', separator: true }),
      facts([['Requested by','initiatedby'], ['Run','runid'], ['Repair cycle','repaircycle'], ['Expires (UTC)','expireson']]),
      block('@' + concat(literal('**Plan SHA-256:**\n'), value('planhash'))),
      block('Use the matching Microsoft approval request to approve or reject. Chat replies do not approve changes. The exact machine plan and full error are retained in the Deployment Event in PowerApps Helper Setup.', { separator: true })
    ], actions: [{ type: 'Action.OpenUrl', title: 'Open approvals', url: 'https://make.powerautomate.com' }]
  };
  definition.contentVersion = PRESENTATION_VERSION;
  return flow;
}
module.exports = { applyApprovalPresentation, detailsExpression, PRESENTATION_VERSION };
