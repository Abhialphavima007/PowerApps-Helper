'use strict';
// Inspect an exported solution .zip: extract version, component summary and the
// MissingDependencies block (the same dependency info shown during a portal import).

const AdmZip = require('adm-zip');

function readEntry(zip, name) {
  const entry = zip.getEntry(name);
  return entry ? zip.readAsText(entry) : null;
}

// Very small XML helpers — we avoid a full XML parser dependency and use focused
// regexes against the well-known Dataverse solution schema.
function firstMatch(xml, re) {
  const m = xml && xml.match(re);
  return m ? m[1] : null;
}

function inspect(zipPath) {
  const zip = new AdmZip(zipPath);
  const solutionXml = readEntry(zip, 'solution.xml') || '';
  const customizationsXml = readEntry(zip, 'customizations.xml') || '';

  const uniqueName = firstMatch(solutionXml, /<UniqueName>([^<]+)<\/UniqueName>/i);
  const version = firstMatch(solutionXml, /<Version>([^<]+)<\/Version>/i);
  const managed = firstMatch(solutionXml, /<Managed>(\d)<\/Managed>/i);
  const publisher = firstMatch(solutionXml, /<UniqueName>([^<]+)<\/UniqueName>\s*<LocalizedNames>[\s\S]*?<\/Publisher>/i);

  // Root components declared in the solution.
  const components = [];
  const compRe = /<RootComponent\s+type="(\d+)"[^>]*schemaName="([^"]*)"[^>]*\/?>/gi;
  let cm;
  while ((cm = compRe.exec(solutionXml)) !== null) {
    components.push({ type: componentTypeName(cm[1]), schemaName: cm[2] });
  }
  // Some exports put the schemaName differently; also capture id-only components.
  if (components.length === 0) {
    const compRe2 = /<RootComponent\s+type="(\d+)"/gi;
    let c2;
    const counts = {};
    while ((c2 = compRe2.exec(solutionXml)) !== null) {
      const t = componentTypeName(c2[1]);
      counts[t] = (counts[t] || 0) + 1;
    }
    for (const [t, n] of Object.entries(counts)) components.push({ type: t, count: n });
  }

  // MissingDependencies — dependencies required by this solution but not included.
  const dependencies = parseMissingDependencies(solutionXml) ;

  // Content summary from customizations.xml.
  const summary = {
    entities: countTag(customizationsXml, 'Entity'),
    webResources: countTag(customizationsXml, 'WebResource'),
    workflows: countTag(customizationsXml, 'Workflow'),
    optionSets: countTag(customizationsXml, 'optionset'),
    roles: countTag(customizationsXml, 'Role'),
    ribbons: countTag(customizationsXml, 'RibbonDiffXml')
  };

  return {
    uniqueName,
    version,
    managed: managed === '1',
    publisher,
    components,
    dependencies,
    summary
  };
}

function parseMissingDependencies(xml) {
  const block = firstMatch(xml, /<MissingDependencies>([\s\S]*?)<\/MissingDependencies>/i);
  if (!block) return [];
  const deps = [];
  const depRe = /<MissingDependency>([\s\S]*?)<\/MissingDependency>/gi;
  let d;
  while ((d = depRe.exec(block)) !== null) {
    const seg = d[1];
    const required = extractNode(seg, 'Required');
    const dependent = extractNode(seg, 'Dependent');
    deps.push({
      requiredType: componentTypeName(required.type),
      requiredSchema: required.schemaName || required.displayName || required.key || '',
      dependentType: componentTypeName(dependent.type),
      dependentSchema: dependent.schemaName || dependent.displayName || dependent.key || ''
    });
  }
  return deps;
}

function extractNode(seg, tag) {
  const m = seg.match(new RegExp('<' + tag + '\\b([^>]*)\\/?>', 'i'));
  if (!m) return {};
  const attrs = m[1];
  const get = (a) => (attrs.match(new RegExp(a + '="([^"]*)"', 'i')) || [])[1] || '';
  return {
    type: get('type'),
    schemaName: get('schemaName'),
    displayName: get('displayName'),
    key: get('key')
  };
}

function countTag(xml, tag) {
  if (!xml) return 0;
  const re = new RegExp('<' + tag + '\\b', 'gi');
  return (xml.match(re) || []).length;
}

// Common Dataverse component type codes -> friendly names.
function componentTypeName(code) {
  const map = {
    '1': 'Entity',
    '2': 'Attribute',
    '9': 'Option Set',
    '10': 'Relationship',
    '20': 'Security Role',
    '26': 'Saved Query (View)',
    '29': 'Workflow / Flow',
    '31': 'Report',
    '59': 'Chart',
    '60': 'Form',
    '61': 'Web Resource',
    '62': 'Site Map',
    '70': 'Field Security Profile',
    '80': 'Model-driven App',
    '90': 'Plugin Assembly',
    '91': 'Plugin Type',
    '92': 'SDK Message Processing Step',
    '150': 'Connector',
    '300': 'Canvas App',
    '371': 'Connection Reference',
    '380': 'Environment Variable Definition'
  };
  return map[String(code)] || (code ? 'Type ' + code : 'Unknown');
}

module.exports = { inspect, componentTypeName };
