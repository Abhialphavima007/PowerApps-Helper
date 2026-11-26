/* Private deployment notification draft, contract 1.0.0.
 * Build: node platform/build-teams-flow.cjs
 * The native Teams webhook must be added in the designer. Its serialized
 * definition/authentication enum was unavailable through Dataverse MCP.
 * No generic HTTP/premium trigger is substituted. See teams-workflow.md.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const requestSchema = {
  type: 'object', required: ['type', 'helper', 'attachments'], additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['message'] },
    helper: {
      type: 'object', required: ['version', 'recipients', 'runId', 'event', 'observedAt'], additionalProperties: false,
      properties: {
        version: { type: 'integer', enum: [1] },
        recipients: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true,
          items: { type: 'string', minLength: 3, maxLength: 254 } },
        runId: { type: 'string', minLength: 1, maxLength: 200 },
        event: { type: 'string', enum: ['started', 'progress', 'success', 'failure'] },
        observedAt: { type: 'string', format: 'date-time' }
      }
    },
    attachments: { type: 'array', minItems: 1, maxItems: 1, items: {
      type: 'object', required: ['contentType', 'content'], additionalProperties: false, properties: {
        contentType: { type: 'string', enum: ['application/vnd.microsoft.card.adaptive'] },
        contentUrl: { type: ['string', 'null'] },
        content: { type: 'object', required: ['type', 'version', 'body'], additionalProperties: false, properties: {
          $schema: { type: 'string', enum: ['http://adaptivecards.io/schemas/adaptive-card.json'] },
          type: { type: 'string', enum: ['AdaptiveCard'] }, version: { type: 'string', enum: ['1.2'] },
          body: { type: 'array', minItems: 1, maxItems: 20, items: {
            type: 'object', required: ['type', 'text'], additionalProperties: false,
            properties: { type: { type: 'string', enum: ['TextBlock'] },
              text: { type: 'string', maxLength: 2000 }, wrap: { type: 'boolean' },
              weight: { type: 'string', enum: ['Bolder'] }, size: { type: 'string', enum: ['Medium'] } }
          } }
        } }
      }
    } }
  }
};

const terminate = (code, message) => ({ type: 'Terminate', runAfter: {},
  inputs: { runStatus: 'Failed', runError: { code, message } } });
// ParseJson validates the custom body even if the Teams trigger uses its own schema.
const flow = {
  properties: {
    connectionReferences: { shared_teams: {
      runtimeSource: 'embedded', connection: { connectionReferenceLogicalName: 'abhi_DeploymentTeams' },
      api: { name: 'shared_teams' }
    } },
    definition: {
      $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
      contentVersion: '1.0.0.0',
      parameters: { $connections: { defaultValue: {}, type: 'Object' },
        $authentication: { defaultValue: {}, type: 'SecureObject' } },
      // Add When a Teams webhook request is received, Anyone, in the designer.
      // An empty trigger collection intentionally keeps this an incomplete draft.
      triggers: {},
      actions: {
        Validate_Helper_update: { type: 'ParseJson', runAfter: {},
          inputs: { content: '@triggerBody()', schema: requestSchema } },
        Invalid_update: { ...terminate('InvalidHelperUpdate', 'The Helper update does not match the notification contract. No message was sent.'),
          runAfter: { Validate_Helper_update: ['Failed', 'TimedOut'] } },
        Find_invalid_recipients: { type: 'Query', runAfter: { Validate_Helper_update: ['Succeeded'] },
          inputs: { from: "@body('Validate_Helper_update')?['helper']?['recipients']",
            where: "@or(not(equals(length(split(item(),'@')),2)),empty(first(split(item(),'@'))),empty(last(split(item(),'@'))),not(contains(last(split(item(),'@')),'.')),not(equals(item(),toLower(trim(item())))),contains(item(),' '),contains(item(),';'),contains(item(),','),contains(item(),'<'),contains(item(),'>'),contains(item(),decodeUriComponent('%22')),contains(item(),decodeUriComponent('%27')),contains(item(),decodeUriComponent('%5C')),contains(item(),'/'),contains(item(),decodeUriComponent('%0A')),contains(item(),decodeUriComponent('%0D')),contains(item(),decodeUriComponent('%09')))" } },
        Recipients_are_valid: { type: 'If', runAfter: { Find_invalid_recipients: ['Succeeded'] },
          expression: "@empty(body('Find_invalid_recipients'))",
          actions: {
            Notify_each_person: { type: 'Foreach', runAfter: {},
              foreach: "@body('Validate_Helper_update')?['helper']?['recipients']",
              runtimeConfiguration: { concurrency: { repetitions: 1 } },
              actions: {
                Send_private_deployment_card: { type: 'OpenApiConnection', runAfter: {},
                  inputs: {
                    host: { connectionName: 'shared_teams', operationId: 'PostCardToConversation',
                      apiId: '/providers/Microsoft.PowerApps/apis/shared_teams' },
                    parameters: { poster: 'Flow bot', location: 'Chat with Flow bot',
                      'body/recipient': "@items('Notify_each_person')",
                      'body/messageBody': "@string(body('Validate_Helper_update')?['attachments']?[0]?['content'])" },
                    authentication: "@parameters('$authentication')", retryPolicy: { type: 'none' }
                  }
                }
              }
            }
          }, else: { actions: { Reject_recipients: terminate('InvalidRecipients', 'Use normalized Microsoft work sign-in addresses. No message was sent.') } }
        }
      }, outputs: {}
    }
  }, schemaVersion: '1.0.0.0'
};

if (require.main === module) {
  fs.writeFileSync(path.join(__dirname, 'teams-private-notification.json'), JSON.stringify(flow, null, 2) + '\n');
  fs.writeFileSync(path.join(__dirname, 'teams-request-schema.json'), JSON.stringify(requestSchema, null, 2) + '\n');
  process.stdout.write('Generated the private Teams notification draft and request schema. Native Teams trigger setup is pending.\n');
}
module.exports = { flow, requestSchema };
