/* Reproducible forms/views for the three new PowerApps Helper tables. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const schema = require('./schema.json');
const { registration } = require('./profile-form.cjs');
const controls = {
  string: '4273EDBD-AC1D-40D3-9FB2-095C621B552D',
  memo: 'E0DECE4B-6FC8-4A8F-A065-082708572369',
  boolean: '67FAC785-CD58-4F9F-ABB3-4B7DDC6ED5ED',
  integer: 'C6D124CA-7EDA-4A60-AEA9-7FB8D318B68F',
  picklist: '3EF39988-22BB-4F0B-BBBE-64B5A3748AEE',
  datetime: '5B773807-9FB2-42DB-97C3-7A91EFF8ADFF',
  lookup: '270BD3DB-D9AF-4782-9025-509E298DEC0A'
};
function id(value) {
  const hex = crypto.createHash('sha256').update(value).digest('hex');
  return '{' + [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-') + '}';
}
const xml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const label = value => '<labels><label description="' + xml(value) + '" languagecode="1033" /></labels>';
const specifications = [
  { table: 'abhi_deploymentprofile', formId: '4e1d4cfe-d9fd-471c-9bc1-3b7a6bb9a01a',
    viewId: '30e97c2e-96b8-4c5c-b5e2-4c5c5fd6927b', code: 11618, name: 'Notification Profiles',
    sections: {
      'Notification settings': ['Name', 'ProfileKey', 'Enabled', 'SuccessRecipients', 'FailureRecipients', 'SubjectPrefix'],
      'Dependency approval': ['Approvers', 'ApprovalMode', 'ApprovalTimeoutMinutes', 'ApprovalFlowUser', 'FlowUserId'],
      'Email wording': ['SuccessIntro', 'FailureIntro', 'ApprovalIntro']
    }, viewFields: ['abhi_name', 'abhi_profilekey', 'abhi_enabled', 'abhi_successrecipients', 'abhi_failurerecipients', 'abhi_approvers', 'abhi_approvalmode'], order: 'abhi_name' },
  { table: 'abhi_deploymentevent', formId: 'cd751944-2790-41f8-8f02-d9098c7fcfdc',
    viewId: '4a066f0c-2eb2-49bf-8958-865b983ec9b6', code: 11619, name: 'Deployment Events', readonly: true,
    sections: {
      'Deployment': ['Name', 'RunId', 'ProfileKey', 'EventType', 'SolutionName', 'SolutionVersion', 'InitiatedBy', 'CompletedOn', 'ImportJobId', 'RepairCycle'],
      'Environments': ['SourceEnvironment', 'SourceUrl', 'TargetEnvironment', 'TargetUrl'],
      'Details': ['Details', 'ErrorDetails', 'Warning'],
      'Dependency approval request': ['PlanHash', 'PlanJson', 'ExpiresOn', 'Recipients', 'ApprovalMode'],
      'Notification delivery': ['DeliveryStatus', 'DeliveryError']
    }, viewFields: ['abhi_name', 'abhi_completedon', 'abhi_eventtype', 'abhi_solutionname', 'abhi_targetenvironment', 'abhi_deliverystatus', 'abhi_runid'], order: 'abhi_completedon', descending: true },
  { table: 'abhi_deploymentdecision', formId: '3ed1b4f0-2344-42d6-a243-16398ffda143',
    viewId: '23745c58-4aa5-4acb-929c-cd96b0dbfc5d', code: 11620, name: 'Dependency Decisions', readonly: true,
    sections: {
      'Approval decision': ['Name', 'EventId', 'RunId', 'Outcome', 'RespondedOn', 'ApprovalId', 'PlanHash'],
      'Approver responses': ['Responses']
    }, viewFields: ['abhi_name', 'abhi_respondedon', 'abhi_outcome', 'abhi_runid', 'abhi_approvalid'], order: 'abhi_respondedon', descending: true }
];
for (const spec of specifications) {
  const table = schema.tables.find(value => value.schema.toLowerCase() === spec.table);
  const columns = new Map([['Name', ['Name', 'Name', 'string']], ...table.columns.map(column => [column[0], column])]);
  const sections = Object.entries(spec.sections).map(([title, fields]) => {
    const rows = fields.map(field => {
      const column = columns.get(field);
      if (!column || !controls[column[2]]) throw new Error('Unknown form field/type: ' + field);
      const logical = 'abhi_' + field.toLowerCase();
      const rows = column[2] === 'memo' ? 5 : 1;
      return '<row><cell id="' + id(spec.table + field) + '" showlabel="true" rowspan="' + rows + '" colspan="1">' + label(column[1]) +
        '<control id="' + logical + '" classid="{' + controls[column[2]] + '}" datafieldname="' + logical + '" disabled="' + (!!spec.readonly || field === 'FlowUserId') + '" />' +
        '</cell></row>' + '<row />'.repeat(rows - 1);
    }).join('');
    return '<section id="' + id(spec.table + title) + '" name="' + xml(title) + '" showlabel="true" showbar="true" IsUserDefined="1" columns="1">' + label(title) + '<rows>' + rows + '</rows></section>';
  }).join('');
  spec.formXml = '<form><tabs><tab id="' + id(spec.table + 'tab') + '" name="general" verticallayout="true" IsUserDefined="1" expanded="true">' +
    label(spec.name) + '<columns><column width="100%"><sections>' + sections + '</sections></column></columns></tab></tabs>' +
    (spec.table === 'abhi_deploymentprofile' ? registration : '') + '</form>';
  spec.fetchXml = '<fetch version="1.0" mapping="logical"><entity name="' + spec.table + '"><attribute name="' + spec.table + 'id" />' +
    spec.viewFields.map(field => '<attribute name="' + field + '" />').join('') + '<order attribute="' + spec.order + '" descending="' + !!spec.descending + '" />' +
    '<filter type="and"><condition attribute="statecode" operator="eq" value="0" /></filter></entity></fetch>';
  spec.layoutXml = '<grid name="resultset" object="' + spec.code + '" jump="abhi_name" select="1" icon="1" preview="1"><row name="result" id="' + spec.table + 'id">' +
    spec.viewFields.map(field => '<cell name="' + field + '" width="' + (field === 'abhi_name' ? 250 : 180) + '" />').join('') + '</row></grid>';
}
fs.writeFileSync(path.join(__dirname, 'setup-components.json'), JSON.stringify(specifications, null, 2) + '\n');
