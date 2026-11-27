/* PowerApps Helper solution-aware flow definitions, version 1.1.3.
 * Build: node platform/build-flows.cjs
 * Connections are deliberately unbound. See platform/README.md before activation.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { detailsExpression, PRESENTATION_VERSION } = require('./approval-presentation.cjs');

const DV = 'shared_commondataserviceforapps';
const MAIL = 'shared_office365';
const APPROVALS = 'shared_approvals';
const references = {
  [DV]: 'abhi_DeploymentDataverse',
  [MAIL]: 'abhi_DeploymentOutlook',
  [APPROVALS]: 'abhi_DeploymentApprovals'
};
function api(connector, operationId, parameters, runAfter = {}) {
  return { type: 'OpenApiConnection', runAfter, inputs: {
    host: { connectionName: connector, operationId, apiId: '/providers/Microsoft.PowerApps/apis/' + connector },
    parameters, authentication: "@parameters('$authentication')"
  }};
}
function after(name, status = ['Succeeded']) { return { [name]: status }; }
function updateEvent(status, error = '', runAfter = {}) {
  return api(DV, 'UpdateRecord', {
    entityName: 'abhi_deploymentevents', recordId: "@triggerBody()?['abhi_deploymenteventid']",
    'item/abhi_deliverystatus': status, 'item/abhi_deliveryerror': error
  }, runAfter);
}
function profile() {
  return api(DV, 'ListRecords', {
    entityName: 'abhi_deploymentprofiles',
    '$filter': "abhi_profilekey eq '@{replace(triggerBody()?['abhi_profilekey'],'''','''''')}'",
    '$top': 2
  });
}
function envelope(eventFilter, actions, connectors) {
  return { properties: {
    connectionReferences: Object.fromEntries(connectors.map(name => [name, {
      runtimeSource: 'embedded', connection: { connectionReferenceLogicalName: references[name] }, api: { name }
    }])),
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
      contentVersion: '1.1.3.0', parameters: {
        '$connections': { defaultValue: {}, type: 'Object' },
        '$authentication': { defaultValue: {}, type: 'SecureObject' }
      }, triggers: { When_deployment_event_is_created: {
        type: 'OpenApiConnectionWebhook', inputs: {
          host: { connectionName: DV, operationId: 'SubscribeWebhookTrigger', apiId: '/providers/Microsoft.PowerApps/apis/' + DV },
          parameters: {
            'subscriptionRequest/message': 1, 'subscriptionRequest/entityname': 'abhi_deploymentevent',
            'subscriptionRequest/scope': 4, 'subscriptionRequest/filterexpression': eventFilter,
            // Deployment Events is OrganizationOwned. Verified Dataverse
            // callbackregistration metadata: 3 = Flow owner; 2 = Row owner.
            'subscriptionRequest/runas': 3
          }, authentication: "@parameters('$authentication')"
        }
      }}, actions, outputs: {}
    }
  }, schemaVersion: '1.0.0.0' };
}
function escapeHtml(expression) {
  return "@{replace(replace(replace(string(coalesce(" + expression + ",'')),'&','&amp;'),'<','&lt;'),'>','&gt;')}";
}
const event = name => "triggerBody()?['abhi_" + name + "']";
const selectedProfile = "first(body('Load_profile')?['value'])";
const profileField = name => selectedProfile + "?['abhi_" + name + "']";
const normalizeEmails = expr => "toLower(replace(replace(trim(coalesce(" + expr + ",'')),',',';'),' ',''))";
const uniqueEnabledProfile = "@and(equals(length(body('Load_profile')?['value']),1),equals(" + profileField('enabled') + ",true))";
const outcomeIntro = "if(equals(" + event('eventtype') + ",100000000)," + profileField('successintro') + ',' + profileField('failureintro') + ')';
const outcomeRecipients = "if(equals(" + event('eventtype') + ",100000000)," + profileField('successrecipients') + ',' + profileField('failurerecipients') + ')';
const outcomeHtml = '<h2>PowerApps Helper deployment result</h2><p>' + escapeHtml(outcomeIntro) + '</p>' +
  '<dl>' + [['Solution', 'solutionname'], ['Version', 'solutionversion'], ['Source environment', 'sourceenvironment'],
    ['Source URL', 'sourceurl'], ['Target environment', 'targetenvironment'], ['Target URL', 'targeturl'],
    ['Initiated by', 'initiatedby'], ['Event time (UTC)', 'completedon'], ['Run ID', 'runid'], ['Import job ID', 'importjobid']]
    .map(([label, field]) => '<dt><b>' + label + '</b></dt><dd>' + escapeHtml(event(field)) + '</dd>').join('') + '</dl>' +
  [['Deployment details', 'details'], ['Errors', 'errordetails'], ['Warnings', 'warning']]
    .map(([label, field]) => '<h3>' + label + '</h3><pre style="white-space:pre-wrap">' + escapeHtml(event(field)) + '</pre>').join('');

const outcome = envelope(
  'abhi_deliverystatus eq 100000000 and (abhi_eventtype eq 100000000 or abhi_eventtype eq 100000001)', {
    Deliver_outcome: { type: 'Scope', runAfter: {}, actions: {
      Load_profile: profile(),
      Profile_is_enabled: { type: 'If', runAfter: after('Load_profile'), expression: uniqueEnabledProfile, actions: {
        Recipient_snapshot_is_present: { type: 'If', runAfter: {}, expression: "@and(not(empty(" + event('recipients') + ')),equals(' + normalizeEmails(event('recipients')) + ',' + normalizeEmails(outcomeRecipients) + '))', actions: {
          Send_outcome_email: api(MAIL, 'SendEmailV2', {
            'emailMessage/To': '@' + event('recipients'),
            'emailMessage/Subject': "@concat(coalesce(" + profileField('subjectprefix') + ",'[PowerApps Helper]'),' ',if(equals(" + event('eventtype') + ",100000000),'Deployment completed: ','Deployment failed: ')," + event('solutionname') + ",' ',coalesce(" + event('solutionversion') + ",''))",
            'emailMessage/Body': outcomeHtml, 'emailMessage/Importance': 'Normal'
          }),
          Mark_sent: updateEvent(100000001, '', after('Send_outcome_email'))
        }, else: { actions: { Mark_no_recipients: updateEvent(100000003, 'Recipients are empty or no longer match the configured profile. No email was sent.') } } }
      }, else: { actions: { Mark_profile_disabled: updateEvent(100000003, 'Profile is disabled, missing, or duplicated.') } } }
    }},
    Record_delivery_failure: { type: 'Scope', runAfter: after('Deliver_outcome', ['Failed', 'TimedOut']), actions: {
      Mark_failed: updateEvent(100000002, 'Email delivery failed. Review the flow run history. Deployment outcome is unchanged.')
    }}
  }, [DV, MAIL]);
// Connector retries are disabled for the external email side effect to avoid automatic duplicate sends.
outcome.properties.definition.actions.Deliver_outcome.actions.Profile_is_enabled.actions.Recipient_snapshot_is_present.actions.Send_outcome_email.inputs.retryPolicy = { type: 'none' };

function approvalAction(approvalType) {
  const action = api(APPROVALS, 'StartAndWaitForAnApproval', {
    approvalType,
    'WebhookApprovalCreationInput/title': "@concat(coalesce(" + profileField('subjectprefix') + ",'[PowerApps Helper]'),' Approve dependency additions: '," + event('solutionname') + ')',
    'WebhookApprovalCreationInput/assignedTo': '@' + event('recipients'),
    'WebhookApprovalCreationInput/details': detailsExpression,
    'WebhookApprovalCreationInput/enableNotifications': true,
    'WebhookApprovalCreationInput/enableReassignment': false
  });
  action.type = 'OpenApiConnectionWebhook';
  action.limit = { timeout: "@concat('PT',string(max(1,div(sub(ticks(" + event('expireson') + "),ticks(utcNow())),10000000))),'S')" };
  action.inputs.retryPolicy = { type: 'none' };
  return action;
}
function approvalDecision(outcomeValue, response, runAfter = {}) {
  const action = api(DV, 'CreateRecord', {
    entityName: 'abhi_deploymentdecisions',
    // One final decision per event. A duplicate create cannot overwrite approval evidence.
    'item/abhi_deploymentdecisionid': '@' + event('deploymenteventid'),
    'item/abhi_name': "@concat('Dependency decision - '," + event('runid') + ')',
    'item/abhi_eventid': '@' + event('deploymenteventid'),
    'item/abhi_runid': '@' + event('runid'), 'item/abhi_planhash': '@' + event('planhash'),
    'item/abhi_outcome': outcomeValue, 'item/abhi_respondedon': '@utcNow()',
    'item/abhi_approvalid': response ? "@coalesce(outputs('Approval_result')?['name'],outputs('Approval_result')?['approvalId'],'')" : '',
    'item/abhi_responses': response ? "@string(coalesce(outputs('Approval_result')?['responses'],json('[]')))" : '[]'
  }, runAfter);
  action.inputs.retryPolicy = { type: 'none' };
  return action;
}
const approval = envelope('abhi_deliverystatus eq 100000000 and abhi_eventtype eq 100000002', {
  Process_dependency_approval: { type: 'Scope', runAfter: {}, actions: {
    Load_profile: profile(),
    Load_existing_decisions: api(DV, 'ListRecords', {
      entityName: 'abhi_deploymentdecisions', '$filter': "abhi_eventid eq '@{triggerBody()?['abhi_deploymenteventid']}'", '$top': 1
    }, after('Load_profile')),
    Validate_request: { type: 'If', runAfter: after('Load_existing_decisions'), expression:
      "@and(equals(length(body('Load_profile')?['value']),1),equals(" + profileField('enabled') + ",true),not(empty(" + profileField('flowuserid') + ")),empty(body('Load_existing_decisions')?['value']),not(empty(" + event('recipients') + ")),not(empty(" + event('planjson') + ")),equals(length(coalesce(" + event('planhash') + ",'')),64),greater(ticks(coalesce(" + event('expireson') + ",'2000-01-01T00:00:00Z')),ticks(utcNow())),lessOrEquals(ticks(coalesce(" + event('expireson') + ",'2000-01-01T00:00:00Z')),ticks(addDays(utcNow(),1))),equals(" + event('approvalmode') + ',' + profileField('approvalmode') + '),equals(' + normalizeEmails(event('recipients')) + ',' + normalizeEmails(profileField('approvers')) + '))',
      actions: {
        Choose_approval_mode: { type: 'If', runAfter: {}, expression: '@equals(' + event('approvalmode') + ',100000000)', actions: {
          Request_every_approver: approvalAction('BasicAwaitAll')
        }, else: { actions: { Request_first_response: approvalAction('Basic') } } },
        Approval_result: { type: 'Compose', runAfter: after('Choose_approval_mode'), inputs:
          "@if(equals(" + event('approvalmode') + ",100000000),body('Request_every_approver'),body('Request_first_response'))" },
        Decision: approvalDecision("@if(greaterOrEquals(ticks(utcNow()),ticks(" + event('expireson') + ")),100000002,if(equals(outputs('Approval_result')?['outcome'],'Approve'),100000000,100000001))", true, after('Approval_result')),
        Mark_approval_processed: updateEvent(100000001, '', after('Decision'))
      }, else: { actions: {
        Record_invalid_if_undecided: { type: 'If', runAfter: {}, expression: "@empty(body('Load_existing_decisions')?['value'])", actions: {
          Invalid_decision: approvalDecision(100000002, false)
        }, else: { actions: {} } },
        Mark_invalid_request: updateEvent(100000002, 'Approval request is expired, already processed, or no longer matches the enabled profile.', after('Record_invalid_if_undecided', ['Succeeded', 'Failed', 'TimedOut', 'Skipped']))
      } }
    }
  }},
  Record_approval_failure: { type: 'Scope', runAfter: after('Process_dependency_approval', ['Failed', 'TimedOut']), actions: {
    Load_failure_decisions: api(DV, 'ListRecords', {
      entityName: 'abhi_deploymentdecisions', '$filter': "abhi_eventid eq '@{triggerBody()?['abhi_deploymenteventid']}'", '$top': 1
    }),
    Record_failure_if_undecided: { type: 'If', runAfter: after('Load_failure_decisions'), expression: "@empty(body('Load_failure_decisions')?['value'])", actions: {
      Failed_decision: approvalDecision(100000002, false)
    }, else: { actions: {} } },
    Mark_approval_failed: updateEvent(100000002, 'Approval processing failed or expired. Source dependency changes remain blocked. Review the flow run history.', after('Record_failure_if_undecided', ['Succeeded', 'Failed', 'TimedOut', 'Skipped']))
  }}
}, [DV, APPROVALS]);

approval.properties.definition.contentVersion = PRESENTATION_VERSION;
for (const [name, definition] of [['deployment-outcome', outcome], ['dependency-approval', approval]]) {
  fs.writeFileSync(path.join(__dirname, name + '.json'), JSON.stringify(definition, null, 2) + '\n');
}
