'use strict';

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
function approvalDetails(plan, unresolved = [], categories = {}) {
  const components = plan.components.map(item => `- ${cleanName(item.name)} — ${componentType(item.type, categories[item.id])}`);
  return [
    'COMPONENTS TO ADD TO THE SOURCE SOLUTION', ...components,
    '', 'AFTER APPROVAL',
    'Add only the listed existing source components, publish, re-export this solution version, and retry the target import.',
    'Tables are added without their subcomponents. Other listed components include their subcomponents. Required components are not added automatically.',
    ...(unresolved.length ? ['', 'UNRESOLVED DEPENDENCIES (EXCLUDED)',
      ...unresolved.map(item => `- ${cleanName(item.label || item.name || item.required?.displayName || item.required?.schemaName || 'Unresolved dependency')}`)] : []),
    '', 'TECHNICAL COMPONENT REFERENCES',
    ...plan.components.map(item => `${cleanName(item.name)}: type ${item.type}, ID ${item.id}, include subcomponents: ${item.includeSubcomponents}`)
  ].join('\n');
}
module.exports = { componentType, approvalDetails };
