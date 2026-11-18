const test = require('node:test');
const assert = require('node:assert/strict');
const agent = require('../electron/services/deploymentAgent');
const zip = require('../electron/services/solutionZip');

const id = '11111111-2222-4333-8444-555555555555';
const dependency = { requiredId: id, requiredTypeCode: '61', requiredType: 'Web Resource', requiredSchema: 'new_script.js' };

function snapshot() {
  return {
    mode: 'source', accountId: 'account-id', account: 'person@example.com',
    sourceUrl: 'https://source.crm.dynamics.com', sourceEnv: 'Source',
    targetUrl: 'https://target.crm.dynamics.com', targetEnv: 'Target',
    solution: 'Sample', solutionUniqueName: 'Sample', solutionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    version: '1.2.3.4', exportManaged: true, publishChanges: true, overwrite: true,
    description: 'Story summary', workItems: '123, 456',
    workItemDetails: { items: [{ id: 123 }, { id: 456 }] }, workItemSummary: 'Two stories',
    notes: 'Hand edited notes', gitCommit: false,
    analysis: { artifact: 'first.zip', inspection: { uniqueName: 'Sample', managed: true, dependencies: [] }, stored: { storedPath: 'first.zip' } }
  };
}

test('parses attributed and namespaced dependency entries in an import log', () => {
  const xml = '<ImportJob><MissingDependencies><MissingDependency canResolveMissingDependency="true"><Required type="61" id="{' + id + '}" schemaName="new_script.js" solution="Base"/><Dependent type="29" schemaName="Flow"/></MissingDependency></MissingDependencies><x:MissingDependencies><x:MissingDependency><x:Required type=' + "'1'" + ' id=' + "'" + id + "'" + ' schemaName=' + "'new_table'" + '/></x:MissingDependency></x:MissingDependencies></ImportJob>';
  const deps = zip.parseMissingDependencies(xml);
  assert.equal(deps.length, 2);
  assert.equal(deps[0].requiredId, id);
  assert.equal(deps[0].requiredTypeCode, '61');
  assert.equal(deps[0].requiredSolution, 'Base');
  assert.equal(deps[1].requiredSchema, 'new_table');
});

test('rejects ambiguous dependencies before changing the source', () => {
  assert.throws(() => agent.selectRepairCandidates([{ requiredTypeCode: '61', requiredSchema: 'Unknown' }]), /supported component ID/);
  assert.throws(() => agent.selectRepairCandidates([{ requiredId: id, requiredTypeCode: '999' }]), /supported component ID/);
  assert.throws(() => agent.selectRepairCandidates([dependency], new Set(['61:' + id])), /still missing/);
});

test('repairs from a failed import, re-exports, retries, and preserves deployment details', async () => {
  const selected = snapshot();
  const original = structuredClone(selected);
  const calls = { imports: [], additions: [], exports: [], stored: [], reports: [] };
  const result = await agent.runAgentDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async (_target, artifact, options) => {
        calls.imports.push({ artifact, options });
        return calls.imports.length === 1
          ? { ok: false, error: 'Missing dependency', dependencies: [dependency], importJobId: 'job-1' }
          : { ok: true, importJobId: 'job-2' };
      },
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      addSolutionComponent: async (...args) => { calls.additions.push(args); },
      exportToFile: async (...args) => { calls.exports.push(args); }
    },
    mcp: { withSourceMcp: async (_url, action) => action({ tools: [], callTool: async () => assert.fail('No MCP tool should be called') }) },
    zip: { inspect: () => ({ uniqueName: 'Sample', managed: true, dependencies: [], summary: { webResources: 1 } }) },
    artifactsDir: () => 'artifacts',
    storeArtifact: async (args) => { calls.stored.push(args); return { storedPath: 'repaired.zip' }; },
    report: (...args) => calls.reports.push(args),
    checkAccount: async () => {}
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.repairs.length, 1);
  assert.equal(result.repairs[0].method, 'Dataverse Web API fallback');
  assert.equal(calls.additions.length, 1);
  assert.equal(calls.additions[0][0], selected.sourceUrl);
  assert.equal(calls.additions[0][1], 'Sample');
  assert.equal(calls.exports.length, 1);
  assert.equal(calls.imports.length, 2);
  assert.notEqual(calls.imports[1].artifact, 'first.zip');
  assert.deepEqual(selected, original);
  const history = agent.makeHistoryRecord(selected, result, selected.account);
  assert.equal(history.sourceUrl, original.sourceUrl);
  assert.equal(history.targetUrl, original.targetUrl);
  assert.equal(history.notes, original.notes);
  assert.equal(history.description, original.description);
  assert.deepEqual(history.workItemDetails, original.workItemDetails);
  assert.equal(history.deploymentMethod, 'agent');
  assert.equal(history.artifact, result.analysis.artifact);
  assert(calls.reports.some(([stage, status]) => stage === 'repair' && status === 'done'));
});

test('exports after agent starts and ignores package dependency declarations when target import succeeds', async () => {
  const selected = snapshot();
  selected.analysis = null;
  selected.deferExport = true;
  const original = structuredClone(selected);
  const calls = { version: 0, export: 0, import: 0, repair: 0, mcp: 0 };
  const result = await agent.runAgentDeployment(selected, {
    dataverse: {
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      setSolutionVersion: async () => { calls.version++; },
      exportToFile: async () => { calls.export++; },
      importSolutionFromFile: async (_target, artifact) => {
        calls.import++;
        assert.match(artifact, /agent_initial/);
        return { ok: true, importJobId: 'job-1' };
      },
      addSolutionComponent: async () => { calls.repair++; }
    },
    mcp: { withSourceMcp: async () => { calls.mcp++; } },
    zip: { inspect: () => ({ uniqueName: 'Sample', managed: true, version: selected.version, dependencies: [dependency] }) },
    artifactsDir: () => 'artifacts',
    storeArtifact: async () => ({ storedPath: 'saved.zip' })
  });
  assert.equal(result.ok, true);
  assert.equal(calls.version, 1);
  assert.equal(calls.export, 1);
  assert.equal(calls.import, 1);
  assert.equal(calls.repair, 0);
  assert.equal(calls.mcp, 0);
  assert.deepEqual(selected, original);
  const history = agent.makeHistoryRecord(selected, result, selected.account);
  assert.equal(history.notes, original.notes);
  assert.equal(history.sourceUrl, original.sourceUrl);
  assert.equal(history.targetUrl, original.targetUrl);
  assert.equal(history.artifact, result.analysis.artifact);
});

test('a deferred agent export repairs only after target import reports a dependency', async () => {
  const selected = snapshot();
  selected.analysis = null;
  selected.deferExport = true;
  let exports = 0;
  let imports = 0;
  let additions = 0;
  const result = await agent.runAgentDeployment(selected, {
    dataverse: {
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      setSolutionVersion: async () => {},
      exportToFile: async () => { exports++; },
      importSolutionFromFile: async () => {
        imports++;
        return imports === 1
          ? { ok: false, error: 'Missing dependency in target', dependencies: [dependency] }
          : { ok: true, importJobId: 'job-2' };
      },
      addSolutionComponent: async () => { additions++; }
    },
    mcp: { withSourceMcp: async (_url, action) => action({ tools: [] }) },
    zip: { inspect: () => ({ uniqueName: 'Sample', managed: true, version: selected.version, dependencies: [dependency] }) },
    artifactsDir: () => 'artifacts',
    storeArtifact: async () => ({})
  });
  assert.equal(result.ok, true);
  assert.equal(exports, 2);
  assert.equal(imports, 2);
  assert.equal(additions, 1);
});

test('an export failure stops before target import and remains recordable', async () => {
  const selected = snapshot();
  selected.analysis = null;
  selected.deferExport = true;
  let imports = 0;
  const result = await agent.runAgentDeployment(selected, {
    dataverse: {
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      setSolutionVersion: async () => {},
      exportToFile: async () => { throw new Error('Export service unavailable'); },
      importSolutionFromFile: async () => { imports++; }
    },
    artifactsDir: () => 'artifacts'
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Export service unavailable/);
  assert.equal(imports, 0);
  const history = agent.makeHistoryRecord(selected, result, selected.account);
  assert.equal(history.status, 'failed');
  assert.equal(history.artifact, null);
  assert.equal(history.notes, selected.notes);
});

test('stops after the same dependency remains missing and does not loop', async () => {
  let imports = 0;
  let additions = 0;
  const selected = snapshot();
  const result = await agent.runAgentDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async () => { imports++; return { ok: false, error: 'Missing dependency', dependencies: [dependency] }; },
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      addSolutionComponent: async () => { additions++; },
      exportToFile: async () => {}
    },
    mcp: { withSourceMcp: async (_url, action) => action({ tools: [] }) },
    zip: { inspect: () => ({ uniqueName: 'Sample', managed: true }) },
    artifactsDir: () => 'artifacts',
    storeArtifact: async () => ({})
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /still missing/);
  assert.equal(imports, 2);
  assert.equal(additions, 1);
});

test('does not change the source when an import fails for another reason', async () => {
  let additions = 0;
  const selected = snapshot();
  const result = await agent.runAgentDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async () => ({ ok: false, error: 'Access denied', dependencies: [dependency] }),
      addSolutionComponent: async () => { additions++; }
    },
    mcp: { withSourceMcp: async () => assert.fail('MCP should not be opened') }
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /without a dependency error/);
  assert.equal(additions, 0);
});

test('does not add a component already exported in the package', async () => {
  const selected = snapshot();
  selected.analysis.inspection.rootComponentRefs = [{ id, type: 61 }];
  const result = await agent.runAgentDeployment(selected, {
    dataverse: { importSolutionFromFile: async () => ({ ok: false, error: 'Missing dependency', dependencies: [dependency] }) },
    mcp: { withSourceMcp: async () => assert.fail('MCP should not be opened') }
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /already in the exported package/);
});

test('limits the workflow to two source repairs and three imports', async () => {
  const selected = snapshot();
  let imports = 0;
  let additions = 0;
  const result = await agent.runAgentDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async () => {
        imports++;
        return { ok: false, error: 'Missing dependency', dependencies: [{
          requiredId: imports === 1 ? id : imports === 2 ? '22222222-3333-4444-8555-666666666666' : '33333333-4444-4555-8666-777777777777',
          requiredTypeCode: '61', requiredSchema: 'resource_' + imports
        }] };
      },
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      addSolutionComponent: async () => { additions++; },
      exportToFile: async () => {}
    },
    mcp: { withSourceMcp: async (_url, action) => action({ tools: [] }) },
    zip: { inspect: () => ({ uniqueName: 'Sample', managed: true }) },
    artifactsDir: () => 'artifacts',
    storeArtifact: async () => ({})
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /after 2 source repair cycles/);
  assert.equal(imports, 3);
  assert.equal(additions, 2);
});

test('uses a supported MCP invoke_api schema for a source addition', async () => {
  let called;
  const body = { ComponentId: id, ComponentType: 61, SolutionUniqueName: 'Sample' };
  const outcome = await agent.addThroughMcp({
    tools: [{ name: 'invoke_api', inputSchema: { properties: { apiName: { type: 'string' }, parameters: { type: 'object' } }, required: ['apiName', 'parameters'] } }],
    callTool: async (name, args) => { called = { name, args }; return { content: [{ type: 'text', text: 'Done' }] }; }
  }, body);
  assert.equal(outcome.supported, true);
  assert.equal(called.name, 'invoke_api');
  assert.deepEqual(called.args, { apiName: 'AddSolutionComponent', parameters: body });
  const customOnly = await agent.addThroughMcp({
    tools: [{ name: 'invoke_api', description: 'Invoke a Custom API', inputSchema: { properties: { apiName: {}, parameters: {} } } }],
    callTool: async () => assert.fail('Built-in actions should not be sent to a custom-only MCP tool')
  }, body);
  assert.equal(customOnly.supported, false);
});
