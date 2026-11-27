'use strict';

// v1.1.0 — approval presentation only; the hashed repair plan is unchanged.
const { parseMissingDependencies } = require('./solutionZip');

// Dataverse solution component types. Process category is retrieved separately;
// type 29 alone cannot distinguish a cloud flow from a classic workflow.
const COMPONENT_TYPES = Object.freeze({
  1: 'Table', 2: 'Column', 9: 'Choice', 10: 'Table relationship', 20: 'Security role',
  26: 'View', 29: 'Process', 31: 'Report', 59: 'Chart', 60: 'Form', 61: 'Web resource',
  62: 'Site map', 70: 'Field security profile', 80: 'Model-driven app',
  90: 'Plug-in type', 91: 'Plug-in assembly', 92: 'SDK message processing step',
  150: 'Routing rule', 300: 'Canvas app', 371: 'Connector', 380: 'Environment variable definition'
});
const PROCESS_TYPES = Object.freeze({ 0: 'Workflow', 1: 'Dialog', 2: 'Business rule',
  3: 'Action', 4: 'Business process flow', 5: 'Cloud flow', 6: 'Desktop flow' });

function componentType(type, category) {
  return type === 29 ? PROCESS_TYPES[category] || 'Process' : COMPONENT_TYPES[type] || `Component (type ${type})`;
}
function cleanName(value) {
  return String(value || 'Unnamed component').replace(/[\r\n\t]+/g, ' ').replace(/[\\`*\[\]<>]/g, '').slice(0, 200);
}
function dependencyType(name, code) {
  if (/^\d+$/.test(String(code || ''))) return componentType(Number(code));
  // Keep the shared XML parser's legacy public labels intact; modernize display.
  if (name === 'Entity') return 'Table';
  if (name === 'Attribute') return 'Column';
  if (name === 'Relationship') return 'Table relationship';
  return name || 'Component';
}
function dependencySummary(error, reportedDependencies) {
  const dependencies = Array.isArray(reportedDependencies) && reportedDependencies.length
    ? reportedDependencies : parseMissingDependencies(String(error || ''));
  if (!dependencies.length) return 'No structured dependency entries were returned.\nSee the reported error below.';
  const reference = (schema, parent, type) => `${parent ? cleanName(parent) + '.' : ''}${cleanName(schema)} (${cleanName(type || 'Component')})`;
  const lines = [...new Set(dependencies.map(item =>
    `${reference(item.dependentSchema, item.dependentParentSchema, dependencyType(item.dependentType))}\n  requires ${reference(item.requiredSchema, item.requiredParentSchema, dependencyType(item.requiredType, item.requiredTypeCode))}`))];
  // Diagnostic summaries are bounded; every proposed addition is still listed.
  return lines.slice(0, 30).join('\n\n') + (lines.length > 30
    ? '\n\nAdditional dependency entries are retained in the Deployment Event.' : '');
}
function approvalDetails(plan, unresolved = [], categories = {}, error = '', reportedDependencies = []) {
  const components = plan.components.map(item => `- **${componentType(item.type, categories[item.id])}:** \`${cleanName(item.name)}\``);
  return [
    `**2. Components to add to the source solution (${plan.components.length})**`, '', ...components,
    '', '**3. Missing dependencies**', '', '```text', dependencySummary(error, reportedDependencies), '```',
    '', '**4. After approval**', '',
    '1. Add only the listed existing source components.',
    '2. Publish source customizations.',
    '3. Re-export the same solution version.',
    '4. Retry the target import.', '',
    '- **Tables:** added without their subcomponents.',
    '- **Other listed components:** include their subcomponents.',
    '- **Required components:** are not added automatically.',
    ...(unresolved.length ? ['', '**Unresolved dependencies (excluded from this approval)**', '',
      ...unresolved.map(item => `- \`${cleanName(item.label || item.name || item.required?.displayName || item.required?.schemaName || 'Unresolved dependency')}\``)] : []),
    '', 'TECHNICAL COMPONENT REFERENCES',
    ...plan.components.map(item => `${cleanName(item.name)}: type ${item.type}, ID ${item.id}, include subcomponents: ${item.includeSubcomponents}`)
  ].join('\n');
}
module.exports = { componentType, approvalDetails };
