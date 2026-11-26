'use strict';

// Extend the verified live solution flow, preserving its native trigger and
// bound connection. Never use the historical empty-trigger draft as a base.
const fs = require('fs');
const path = require('path');
const BASELINE = 'teams-live-before-destination-routing.json';

function extendFlow(baseline) {
  const flow = structuredClone(baseline);
  const definition = flow.properties?.definition;
  const trigger = definition?.triggers?.manual;
  const actions = definition?.actions;
  const send = actions?.Recipients_are_valid?.actions?.Notify_each_person?.actions?.Send_private_deployment_card;
  const connection = send?.inputs?.host?.connectionName;
  if (trigger?.type !== 'Request' || trigger.kind !== 'TeamsWebhook' || trigger.inputs?.triggerAuthenticationType !== 'All' ||
      !flow.properties.connectionReferences?.[connection]?.connection?.connectionReferenceLogicalName ||
      send.inputs.host.operationId !== 'PostCardToConversation') {
    throw new Error('Expected the reviewed signed Teams webhook with its bound Teams connection.');
  }

  const schema = actions.Validate_Helper_update.inputs.schema;
  const helperSchema = schema.properties.helper;
  helperSchema.properties.version.enum = [1, 2];
  helperSchema.properties.recipients.minItems = 0;
  helperSchema.properties.groupChats = { type: 'array', maxItems: 1, uniqueItems: true,
    items: { type: 'string', minLength: 14, maxLength: 413 } };
  helperSchema.properties.channels = { type: 'array', maxItems: 1, uniqueItems: true,
    items: { type: 'object', required: ['teamId', 'channelId'], additionalProperties: false, properties: {
      teamId: { type: 'string', minLength: 36, maxLength: 36 },
      channelId: { type: 'string', minLength: 17, maxLength: 416 }
    } } };

  const helper = "body('Validate_Helper_update')?['helper']";
  const groups = `coalesce(${helper}?['groupChats'],json('[]'))`;
  const channels = `coalesce(${helper}?['channels'],json('[]'))`;
  const people = `${helper}?['recipients']`;
  // Power Automate rejects ParseJson regex patterns for OpenApi flows.
  // Validate IDs in bounded filters instead, before any messages are sent.
  const invalidThread = (id, suffixes) => {
    const token = `last(split(first(split(${id},'@')),'19:'))`;
    const endings = suffixes.map(suffix => `endsWith(${id},'${suffix}')`);
    const validEnding = endings.length === 1 ? endings[0] : `or(${endings.join(',')})`;
    return `or(not(startsWith(${id},'19:')),not(equals(length(split(${id},'19:')),2)),not(equals(length(split(${id},'@')),2)),not(${validEnding}),empty(${token}),not(equals(uriComponent(${token}),${token})),${['.', '!', '~', '*', '(', ')'].map(char => `contains(${token},'${char}')`).join(',')},contains(${token},decodeUriComponent('%27')))`;
  };
  actions.Find_invalid_group_chats = { type: 'Query', runAfter: { Validate_Helper_update: ['Succeeded'] },
    inputs: { from: `@${groups}`, where: `@${invalidThread('item()', ['@thread.v2'])}` } };
  const team = "item()?['teamId']";
  const parts = `split(${team},'-')`;
  let nonHex = team;
  for (const char of '0123456789abcdef-') nonHex = `replace(${nonHex},'${char}','')`;
  // Indexing an invalid GUID shape must not fail the filter itself. Padding
  // gives safe indexes; exact split length and each segment are still checked.
  const padded = `split(concat(${team},'-----'),'-')`;
  const invalidTeam = `or(not(equals(length(${parts}),5)),not(empty(${nonHex})),${[8,4,4,4,12].map((length, index) => `not(equals(length(${padded}[${index}]),${length}))`).join(',')})`;
  actions.Find_invalid_channels = { type: 'Query', runAfter: { Validate_Helper_update: ['Succeeded'] },
    inputs: { from: `@${channels}`, where: `@or(${invalidTeam},${invalidThread("item()?['channelId']", ['@thread.skype','@thread.tacv2'])})` } };
  // Version 1 retains private-only routing. Version 2 requires a destination;
  // Array limits and ID filters are enforced before connector actions run.
  actions.Recipients_are_valid.runAfter.Find_invalid_group_chats = ['Succeeded'];
  actions.Recipients_are_valid.runAfter.Find_invalid_channels = ['Succeeded'];
  actions.Recipients_are_valid.expression = `@and(empty(body('Find_invalid_recipients')),empty(body('Find_invalid_group_chats')),empty(body('Find_invalid_channels')),or(and(equals(${helper}?['version'],1),greater(length(${people}),0),empty(${groups}),empty(${channels})),and(equals(${helper}?['version'],2),greater(add(add(length(${people}),length(${groups})),length(${channels})),0))))`;
  actions.Recipients_are_valid.else.actions.Reject_recipients.inputs.runError = {
    code: 'InvalidDestinations', message: 'Use valid Helper destinations and at least one person, group chat or channel. No message was sent.'
  };

  const routedAction = parameters => {
    const action = structuredClone(send);
    delete action.metadata;
    action.inputs.parameters = { poster: 'Flow bot', ...parameters,
      'body/messageBody': send.inputs.parameters['body/messageBody'] };
    action.inputs.retryPolicy = { type: 'none' };
    return action;
  };
  const branch = (foreach, name, action) => ({ type: 'Foreach', runAfter: {}, foreach,
    runtimeConfiguration: { concurrency: { repetitions: 1 } }, actions: { [name]: action } });
  const destinations = actions.Recipients_are_valid.actions;
  // Independent bounded branches ensure a failed private recipient doesn't
  // skip the group/channel. Private recipients retain their sequential loop.
  destinations.Notify_each_group_chat = branch(`@${groups}`, 'Send_group_deployment_card', routedAction({
    location: 'Group chat', 'body/recipient': "@items('Notify_each_group_chat')"
  }));
  destinations.Notify_each_channel = branch(`@${channels}`, 'Send_channel_deployment_card', routedAction({
    location: 'Channel', 'body/recipient/groupId': "@items('Notify_each_channel')?['teamId']",
    'body/recipient/channelId': "@items('Notify_each_channel')?['channelId']"
  }));
  definition.contentVersion = '1.1.0.0';
  return { flow, schema };
}

if (require.main === module) {
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, BASELINE), 'utf8'));
  const { flow, schema } = extendFlow(baseline);
  fs.writeFileSync(path.join(__dirname, 'teams-destination-notification.json'), JSON.stringify(flow, null, 2) + '\n');
  fs.writeFileSync(path.join(__dirname, 'teams-destination-request-schema.json'), JSON.stringify(schema, null, 2) + '\n');
  process.stdout.write('Generated Teams destination routing from the verified live baseline.\n');
}
module.exports = { extendFlow };
