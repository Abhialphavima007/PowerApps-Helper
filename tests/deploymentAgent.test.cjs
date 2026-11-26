const test = require('node:test');
const assert = require('node:assert/strict');
const agent = require('../electron/services/deploymentAgent');
const zip = require('../electron/services/solutionZip');

const id = '11111111-2222-4333-8444-555555555555';
const dependency = { requiredId: id, requiredTypeCode: '61', requiredType: 'Web Resource', requiredSchema: 'new_script.js' };

// These behavior fixtures explicitly simulate an authenticated approval.
// Tests for missing/rejected/expired approval call the production entry directly.
async function runApprovedDeployment(selected, services) {
  return agent.runAgentDeployment(selected, {
    requestApproval: async () => ({ eventId: id, planHash: 'synthetic-plan-hash',
      approvalId: 'synthetic-approval', assertValid: async () => {} }),
    ...services
  });
}

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

test('missing, rejected or unverifiable approval stops before any source side effect', async () => {
  for (const requestApproval of [undefined, async () => { throw new Error('Rejected by approver'); },
    async () => ({}), async () => ({ assertValid: async () => { throw new Error('Approval expired'); } })]) {
    let imports = 0;
    const result = await agent.runAgentDeployment(snapshot(), { requestApproval,
      dataverse: {
        importSolutionFromFile: async () => { imports++; return { ok:false, error:'Missing dependency', dependencies:[dependency] }; },
        listSolutions: async () => ({ solutions:[{uniqueName:'Sample',solutionId:snapshot().solutionId,isManaged:false}] }),
        addSolutionComponent: async () => assert.fail('Unapproved source addition'),
        publishAll: async () => assert.fail('Unapproved publish'),
        exportToFile: async () => assert.fail('Unapproved export')
      }
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /approval|Rejected|expired/i);
    assert.equal(imports, 1);
  }
});

test('approval invalidation after an addition stops publication and retry', async () => {
  let additions = 0, imports = 0;
  const result = await agent.runAgentDeployment(snapshot(), {
    requestApproval: async () => ({ eventId:id, planHash:'synthetic-plan-hash', approvalId:'synthetic-approval',
      assertValid: async () => { if (additions) throw new Error('Approval configuration changed'); } }),
    dataverse: {
      importSolutionFromFile: async () => { imports++; return { ok:false,error:'Missing dependency',dependencies:[dependency] }; },
      listSolutions: async () => ({solutions:[{uniqueName:'Sample',solutionId:snapshot().solutionId,isManaged:false}]}),
      addSolutionComponent: async () => { additions++; },
      publishAll: async () => assert.fail('Invalidated approval must not publish'),
      exportToFile: async () => assert.fail('Invalidated approval must not export')
    }, mcp:null
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Approval configuration changed/);
  assert.equal(additions, 1);
  assert.equal(imports, 1);
});

test('parses attributed and namespaced dependency entries in an import log', () => {
  const xml = '<ImportJob><MissingDependencies><MissingDependency canResolveMissingDependency="true"><Required type="61" id="{' + id + '}" schemaName="new_script.js" solution="Base"/><Dependent type="29" schemaName="Flow"/></MissingDependency><MissingDependency><Required type="2" schemaName="abhi_eventname" displayName="Event Name" parentSchemaName="abhi_event" parentDisplayName="Event"/><Dependent type="60"/></MissingDependency></MissingDependencies><x:MissingDependencies><x:MissingDependency><x:Required type=' + "'1'" + ' id=' + "'" + id + "'" + ' schemaName=' + "'new_table'" + '/></x:MissingDependency></x:MissingDependencies></ImportJob>';
  const deps = zip.parseMissingDependencies(xml);
  assert.equal(deps.length, 3);
  assert.equal(deps[0].requiredId, id);
  assert.equal(deps[0].requiredTypeCode, '61');
  assert.equal(deps[0].requiredSolution, 'Base');
  assert.equal(deps[1].requiredSchema, 'abhi_eventname');
  assert.equal(deps[1].requiredParentSchema, 'abhi_event');
  assert.equal(deps[1].requiredParentDisplayName, 'Event');
  assert.equal(deps[2].requiredSchema, 'new_table');
});

test('rejects ambiguous dependencies before changing the source', () => {
  assert.throws(() => agent.selectRepairCandidates([{ requiredTypeCode: '61', requiredSchema: 'Unknown' }]), /supported component ID/);
  assert.throws(() => agent.selectRepairCandidates([{ requiredId: id, requiredTypeCode: '999' }]), /supported component ID/);
  assert.throws(() => agent.selectRepairCandidates([dependency], new Set(['61:' + id])), /still missing/);
});

test('classifies resolvable dependencies separately from missing IDs', () => {
  const viewId = '22222222-3333-4444-8555-666666666666';
  const classified = agent.classifyRepairCandidates([
    { requiredTypeCode: '1', requiredSchema: 'abhi_donation' },
    { requiredId: viewId, requiredTypeCode: '26', requiredSchema: 'Active Donations' }
  ]);
  assert.deepEqual(classified.candidates.map(({ id, type }) => ({ id, type })), [{ id: viewId, type: 26 }]);
  assert.deepEqual(classified.unresolved, [{ label: 'abhi_donation', reason: 'missing-id' }]);
});

test('fills an absent target dependency ID only from one exact package match', () => {
  const target = [{ requiredTypeCode: '61', requiredSchema: 'new_script.js' }];
  assert.equal(agent.fillMissingIdsFromPackage(target, [dependency])[0].requiredId, id);
  assert.equal(target[0].requiredId, undefined);
  assert.equal(agent.fillMissingIdsFromPackage(target, [{ ...dependency, requiredSchema: 'other.js' }])[0].requiredId, undefined);
  assert.equal(agent.fillMissingIdsFromPackage(target, [dependency, { ...dependency, requiredId: '22222222-3333-4444-8555-666666666666' }])[0].requiredId, undefined);
});

test('matches package attributes only when both the attribute and parent table match', () => {
  const target = [{ requiredTypeCode: '2', requiredSchema: 'abhi_eventname', requiredParentSchema: 'abhi_event' }];
  const sameAttribute = { ...dependency, requiredTypeCode: '2', requiredSchema: 'abhi_eventname', requiredParentSchema: 'abhi_event' };
  const otherParent = { ...sameAttribute, requiredParentSchema: 'abhi_donation' };
  assert.equal(agent.fillMissingIdsFromPackage(target, [otherParent])[0].requiredId, undefined);
  assert.equal(agent.fillMissingIdsFromPackage(target, [sameAttribute])[0].requiredId, id);
});

test('repairs from a failed import, re-exports, retries, and preserves deployment details', async () => {
  const selected = snapshot();
  const original = structuredClone(selected);
  const calls = { imports: [], additions: [], exports: [], stored: [], reports: [], publishes: [], order: [] };
  const result = await runApprovedDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async (_target, artifact, options) => {
        calls.imports.push({ artifact, options });
        return calls.imports.length === 1
          ? { ok: false, error: 'Missing dependency', dependencies: [dependency], importLog: '<MissingDependencies>first failure</MissingDependencies>', importJobId: 'job-1' }
          : { ok: true, importJobId: 'job-2' };
      },
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      addSolutionComponent: async (...args) => { calls.additions.push(args); calls.order.push('add'); },
      publishAll: async (...args) => { calls.publishes.push(args); calls.order.push('publish'); },
      exportToFile: async (...args) => { calls.exports.push(args); calls.order.push('export'); }
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
  assert.deepEqual(calls.publishes, [[selected.sourceUrl]]);
  assert.deepEqual(calls.order, ['add', 'publish', 'export']);
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
  assert.equal(history.agent.failedDependencies[0].requiredId, id);
  assert.match(history.agent.importLog, /first failure/);
  assert.match(history.agent.attempts[0].importLog, /first failure/);
  assert(calls.reports.some(([stage, status]) => stage === 'repair' && status === 'done'));
});

test('uses the Dataverse Web API directly when MCP is disabled', async () => {
  const selected = snapshot();
  let imports = 0;
  let additions = 0;
  const reports = [];
  const result = await runApprovedDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async () => ++imports === 1
        ? { ok: false, error: 'Missing dependency', dependencies: [dependency] }
        : { ok: true },
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      addSolutionComponent: async (...args) => {
        assert.deepEqual(args, [selected.sourceUrl, 'Sample', id, 61]);
        additions++;
      },
      publishAll: async () => {},
      exportToFile: async () => {}
    },
    mcp: null,
    zip: { inspect: () => ({ uniqueName: 'Sample', managed: true, version: selected.version, dependencies: [] }) },
    artifactsDir: () => 'artifacts',
    storeArtifact: async () => ({}),
    report: (...args) => reports.push(args)
  });

  assert.equal(result.ok, true);
  assert.equal(imports, 2);
  assert.equal(additions, 1);
  assert.equal(result.repairs[0].method, 'Dataverse Web API');
  assert.ok(reports.some(([, , , message]) => /Using Dataverse Web API for approved source additions/.test(message)));
});

test('stops an MCP-disabled repair when the Dataverse Web API rejects the source change', async () => {
  const selected = snapshot();
  let imports = 0;
  let exports = 0;
  const result = await runApprovedDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async () => { imports++; return { ok: false, error: 'Missing dependency', dependencies: [dependency] }; },
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      addSolutionComponent: async () => { throw new Error('Dataverse denied source update'); },
      publishAll: async () => assert.fail('Source must not publish after a rejected addition'),
      exportToFile: async () => { exports++; }
    },
    mcp: null,
    zip: { inspect: () => ({ uniqueName: 'Sample', managed: true, version: selected.version, dependencies: [] }) },
    artifactsDir: () => 'artifacts',
    storeArtifact: async () => ({})
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Dataverse denied source update/);
  assert.equal(imports, 1);
  assert.equal(exports, 0);
});

test('exports after agent starts and ignores package dependency declarations when target import succeeds', async () => {
  const selected = snapshot();
  selected.analysis = null;
  selected.deferExport = true;
  const original = structuredClone(selected);
  const calls = { version: 0, export: 0, import: 0, repair: 0, mcp: 0 };
  const result = await runApprovedDeployment(selected, {
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
  let publishes = 0;
  const result = await runApprovedDeployment(selected, {
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
      addSolutionComponent: async () => { additions++; },
      publishAll: async (url) => { assert.equal(url, selected.sourceUrl); publishes++; }
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
  assert.equal(publishes, 1);
});

test('uses a matching package ID only after the target reports that missing dependency', async () => {
  const selected = snapshot();
  selected.analysis.inspection.dependencies = [dependency];
  let additions = 0;
  let publishes = 0;
  let imports = 0;
  const result = await runApprovedDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async () => {
        imports++;
        return imports === 1
          ? { ok: false, error: 'Missing dependency', dependencies: [{ requiredTypeCode: '61', requiredSchema: 'new_script.js' }] }
          : { ok: true };
      },
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      addSolutionComponent: async (_url, _solution, componentId) => { assert.equal(componentId, id); additions++; },
      publishAll: async () => { publishes++; },
      exportToFile: async () => {}
    },
    mcp: { withSourceMcp: async (_url, action) => action({ tools: [] }) },
    zip: { inspect: () => ({ uniqueName: 'Sample', managed: true, version: selected.version }) },
    artifactsDir: () => 'artifacts',
    storeArtifact: async () => ({})
  });
  assert.equal(result.ok, true);
  assert.equal(imports, 2);
  assert.equal(additions, 1);
  assert.equal(publishes, 1);
});

test('looks up a missing component ID in the source when target and package omit it', async () => {
  const selected = snapshot();
  let imports = 0;
  let additions = 0;
  let publishes = 0;
  let lookups = 0;
  const result = await runApprovedDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async () => {
        imports++;
        return imports === 1
          ? { ok: false, error: 'Missing dependency', dependencies: Array.from({ length: 3 }, () => ({ requiredTypeCode: '61', requiredSchema: 'new_script.js' })) }
          : { ok: true };
      },
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      findComponentBySchema: async (url, type, schema) => {
        lookups++;
        assert.equal(url, selected.sourceUrl);
        assert.equal(type, 61);
        assert.equal(schema, 'new_script.js');
        return id;
      },
      addSolutionComponent: async (_url, _solution, componentId) => { assert.equal(componentId, id); additions++; },
      publishAll: async () => { publishes++; },
      exportToFile: async () => {}
    },
    mcp: { withSourceMcp: async (_url, action) => action({ tools: [] }) },
    zip: { inspect: () => ({ uniqueName: 'Sample', managed: true, version: selected.version }) },
    artifactsDir: () => 'artifacts',
    storeArtifact: async () => ({})
  });
  assert.equal(result.ok, true);
  assert.equal(imports, 2);
  assert.equal(lookups, 1);
  assert.equal(additions, 1);
  assert.equal(publishes, 1);
});

test('adds exact-ID dependencies and retries when other import entries have no source ID', async () => {
  const selected = snapshot();
  const viewId = '22222222-3333-4444-8555-666666666666';
  let imports = 0;
  let lookups = 0;
  const mcpAdds = [];
  const reports = [];
  const result = await runApprovedDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async () => ++imports === 1
        ? { ok: false, error: 'Missing dependencies', dependencies: [
          { requiredTypeCode: '1', requiredSchema: 'abhi_donation' },
          { requiredId: viewId, requiredTypeCode: '26', requiredSchema: 'Active Donations' }
        ] }
        : { ok: true },
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      findComponentBySchema: async (_url, type, schema) => {
        lookups++;
        assert.equal(type, 1);
        assert.equal(schema, 'abhi_donation');
        return null;
      },
      addSolutionComponent: async () => assert.fail('Resolved dependency should be added through MCP'),
      publishAll: async () => {},
      exportToFile: async () => {}
    },
    mcp: {
      withSourceMcp: async (url, action) => {
        assert.equal(url, selected.sourceUrl);
        return action({
          tools: [{ name: 'invoke_api', inputSchema: { properties: { apiName: {}, parameters: {} }, required: ['apiName', 'parameters'] } }],
          callTool: async (_name, args) => { mcpAdds.push(args.parameters); return { isError: false, content: [] }; }
        });
      }
    },
    zip: { inspect: () => ({ uniqueName: 'Sample', managed: true, version: selected.version }) },
    artifactsDir: () => 'artifacts',
    storeArtifact: async () => ({}),
    report: (...args) => reports.push(args)
  });
  assert.equal(result.ok, true);
  assert.equal(imports, 2);
  assert.equal(lookups, 1);
  assert.deepEqual(mcpAdds.map(({ ComponentId, ComponentType }) => ({ componentId: ComponentId, componentType: ComponentType })), [
    { componentId: viewId, componentType: 26 }
  ]);
  assert.ok(reports.some(([stage, , , message]) => stage === 'resolve' && /Identified 1 source component/.test(message)));
});

test('continues to later exact dependencies without re-adding an earlier component', async () => {
  const selected = snapshot();
  const secondId = '22222222-3333-4444-8555-666666666666';
  let imports = 0;
  const additions = [];
  const result = await runApprovedDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async () => {
        imports++;
        if (imports === 3) return { ok: true };
        return {
          ok: false,
          error: 'Missing dependencies',
          dependencies: [
            dependency,
            ...(imports === 2 ? [{ requiredId: secondId, requiredTypeCode: '61', requiredSchema: 'second.js' }] : [])
          ]
        };
      },
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      addSolutionComponent: async (_url, _solution, componentId) => additions.push(componentId),
      publishAll: async () => {},
      exportToFile: async () => {}
    },
    mcp: null,
    zip: { inspect: () => ({ uniqueName: 'Sample', managed: true, version: selected.version }) },
    artifactsDir: () => 'artifacts',
    storeArtifact: async () => ({})
  });
  assert.equal(result.ok, true);
  assert.equal(imports, 3);
  assert.deepEqual(additions, [id, secondId]);
});

test('looks up attributes using their parent table and keeps same-named attributes separate', async () => {
  const selected = snapshot();
  const otherId = '22222222-3333-4444-8555-666666666666';
  const targetDependencies = [
    { requiredTypeCode: '2', requiredSchema: 'abhi_eventname', requiredParentSchema: 'abhi_event' },
    { requiredTypeCode: '2', requiredSchema: 'abhi_eventname', requiredParentSchema: 'abhi_donation' }
  ];
  let imports = 0;
  let lookups = 0;
  const mcpCalls = [];
  const result = await runApprovedDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async () => ++imports === 1
        ? { ok: false, error: 'Missing dependency', dependencies: targetDependencies }
        : { ok: true },
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      findComponentBySchema: async (_url, type, schema, options) => {
        lookups++;
        assert.equal(type, 2);
        assert.equal(schema, 'abhi_eventname');
        return options.parentSchemaName === 'abhi_event' ? id : otherId;
      },
      addSolutionComponent: async () => assert.fail('Resolved components should be added through MCP'),
      publishAll: async () => {},
      exportToFile: async () => {}
    },
    mcp: {
      withSourceMcp: async (url, action) => {
        assert.equal(url, selected.sourceUrl);
        return action({
          tools: [{ name: 'invoke_api', inputSchema: { properties: { apiName: {}, parameters: {} }, required: ['apiName', 'parameters'] } }],
          callTool: async (_name, args) => { mcpCalls.push(args.parameters); return { isError: false, content: [] }; }
        });
      }
    },
    zip: { inspect: () => ({ uniqueName: 'Sample', managed: true, version: selected.version }) },
    artifactsDir: () => 'artifacts',
    storeArtifact: async () => ({})
  });
  assert.equal(result.ok, true);
  assert.equal(lookups, 2);
  assert.deepEqual(mcpCalls.map(({ ComponentId, ComponentType }) => ({ componentId: ComponentId, type: ComponentType })), [
    { componentId: id, type: 2 }, { componentId: otherId, type: 2 }
  ]);
  assert.deepEqual(result.repairs.map(({ method }) => method), ['Microsoft Dataverse MCP', 'Microsoft Dataverse MCP']);
});

test('stops before re-export when publishing the repaired source fails', async () => {
  const selected = snapshot();
  let exports = 0;
  let imports = 0;
  const result = await runApprovedDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async () => { imports++; return { ok: false, error: 'Missing dependency', dependencies: [dependency] }; },
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      addSolutionComponent: async () => {},
      publishAll: async () => { throw new Error('Publish denied'); },
      exportToFile: async () => { exports++; }
    },
    mcp: { withSourceMcp: async (_url, action) => action({ tools: [] }) },
    artifactsDir: () => 'artifacts'
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Source publish failed.*Publish denied/);
  assert.equal(exports, 0);
  assert.equal(imports, 1);
});

test('uses the authenticated Dataverse API when MCP cannot connect before source changes', async () => {
  const selected = snapshot();
  let imports = 0;
  let additions = 0;
  const result = await runApprovedDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async () => ++imports === 1
        ? { ok: false, error: 'Missing dependency', dependencies: [dependency] }
        : { ok: true },
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      addSolutionComponent: async () => { additions++; },
      publishAll: async () => {},
      exportToFile: async () => {}
    },
    mcp: { withSourceMcp: async () => { throw new Error('MCP endpoint unavailable'); } },
    zip: { inspect: () => ({ uniqueName: 'Sample', managed: true, version: selected.version }) },
    artifactsDir: () => 'artifacts',
    storeArtifact: async () => ({})
  });
  assert.equal(result.ok, true);
  assert.equal(imports, 2);
  assert.equal(additions, 1);
  assert.equal(result.repairs[0].method, 'Dataverse Web API fallback');
  assert.match(result.repairs[0].fallbackReason, /MCP endpoint unavailable/);
});

test('does not fall back after MCP has begun a source action', async () => {
  const selected = snapshot();
  let additions = 0;
  const result = await runApprovedDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async () => ({ ok: false, error: 'Missing dependency', dependencies: [dependency] }),
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      addSolutionComponent: async () => { additions++; }
    },
    mcp: { withSourceMcp: async (_url, action) => action({
      tools: [{ name: 'invoke_api', inputSchema: { properties: { apiName: {}, parameters: {} }, required: ['apiName', 'parameters'] } }],
      callTool: async () => ({ isError: true, content: [{ type: 'text', text: 'Permission denied' }] })
    }) }
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /MCP could not add the component/);
  assert.equal(additions, 0);
});

test('adds only the verified primary-name column when Dataverse reports it missing', async () => {
  const selected = snapshot();
  const entityId = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';
  const attributeId = 'cccccccc-1111-4222-8333-dddddddddddd';
  selected.analysis.inspection.rootComponentRefs = [{ id: entityId, type: 1 }];
  let imports = 0;
  const additions = [];
  const result = await runApprovedDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async () => ++imports === 1
        ? { ok: false, error: 'PrimaryName attribute not found for Entity: abhi_TimeSlot', importLog: '<importexportxml />' }
        : { ok: true },
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      getEntityPrimaryNameAttribute: async (url, schema) => {
        assert.equal(url, selected.sourceUrl);
        assert.equal(schema, 'abhi_TimeSlot');
        return { entityId, entitySchemaName: 'abhi_timeslot', attributeSchemaName: 'abhi_timeslotname' };
      },
      findComponentBySchema: async (url, type, schema, options) => {
        assert.equal(url, selected.sourceUrl);
        assert.equal(type, 2);
        assert.equal(schema, 'abhi_timeslotname');
        assert.equal(options.parentSchemaName, 'abhi_timeslot');
        return attributeId;
      },
      addSolutionComponent: async () => assert.fail('The configured MCP action should add the primary-name column'),
      publishAll: async () => {},
      exportToFile: async () => {}
    },
    mcp: {
      withSourceMcp: async (url, action) => {
        assert.equal(url, selected.sourceUrl);
        return action({
          tools: [{ name: 'invoke_api', inputSchema: { properties: { apiName: {}, parameters: {} }, required: ['apiName', 'parameters'] } }],
          callTool: async (_name, args) => { additions.push(args.parameters); return { isError: false, content: [] }; }
        });
      }
    },
    zip: { inspect: () => ({ uniqueName: 'Sample', managed: true, version: selected.version }) },
    artifactsDir: () => 'artifacts',
    storeArtifact: async () => ({})
  });
  assert.equal(result.ok, true);
  assert.equal(imports, 2);
  assert.deepEqual(additions.map(({ ComponentId, ComponentType, SolutionUniqueName }) => ({ ComponentId, ComponentType, SolutionUniqueName })), [
    { ComponentId: attributeId, ComponentType: 2, SolutionUniqueName: 'Sample' }
  ]);
  assert.deepEqual(result.repairs.map(({ componentId, componentType }) => ({ componentId, componentType })), [
    { componentId: attributeId, componentType: 2 }
  ]);
  assert.equal(result.repairs[0].method, 'Microsoft Dataverse MCP');
});

test('stops without source changes when a reported primary-name column cannot be verified', async () => {
  const selected = snapshot();
  const entityId = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';
  selected.analysis.inspection.rootComponentRefs = [{ id: entityId, type: 1 }];
  let additions = 0;
  const result = await runApprovedDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async () => ({ ok: false, error: 'PrimaryName attribute not found for Entity: abhi_Donation' }),
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      getEntityPrimaryNameAttribute: async () => ({ entityId, entitySchemaName: 'abhi_donation', attributeSchemaName: 'abhi_donationname' }),
      findComponentBySchema: async () => null,
      addSolutionComponent: async () => { additions++; }
    },
    mcp: null
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /could not be resolved to one source component ID/);
  assert.equal(additions, 0);
});

test('an export failure stops before target import and remains recordable', async () => {
  const selected = snapshot();
  selected.analysis = null;
  selected.deferExport = true;
  let imports = 0;
  const result = await runApprovedDeployment(selected, {
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
  const result = await runApprovedDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async () => { imports++; return { ok: false, error: 'Missing dependency', dependencies: [dependency] }; },
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      addSolutionComponent: async () => { additions++; },
      publishAll: async () => {},
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
  const result = await runApprovedDeployment(selected, {
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
  const result = await runApprovedDeployment(selected, {
    dataverse: { importSolutionFromFile: async () => ({ ok: false, error: 'Missing dependency', dependencies: [dependency] }) },
    mcp: { withSourceMcp: async () => assert.fail('MCP should not be opened') }
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /already in the exported package/);
});

test('limits the workflow to five source repairs and six imports', async () => {
  const selected = snapshot();
  let imports = 0;
  let additions = 0;
  let publishes = 0;
  const result = await runApprovedDeployment(selected, {
    dataverse: {
      importSolutionFromFile: async () => {
        imports++;
        return { ok: false, error: 'Missing dependency', dependencies: [{
          requiredId: String(imports).padStart(8, '0') + '-3333-4444-8555-666666666666',
          requiredTypeCode: '61', requiredSchema: 'resource_' + imports
        }] };
      },
      listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
      addSolutionComponent: async () => { additions++; },
      publishAll: async () => { publishes++; },
      exportToFile: async () => {}
    },
    mcp: { withSourceMcp: async (_url, action) => action({ tools: [] }) },
    zip: { inspect: () => ({ uniqueName: 'Sample', managed: true }) },
    artifactsDir: () => 'artifacts',
    storeArtifact: async () => ({})
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /after 5 source repair cycles/);
  assert.equal(imports, 6);
  assert.equal(additions, 5);
  assert.equal(publishes, 5);
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

test('sets DoNotIncludeSubcomponents only for Entity components through MCP', async () => {
  const cases = [
    { id, type: 9, includeSubcomponents: false },
    { id: '22222222-3333-4444-8555-666666666666', type: 1, includeSubcomponents: true }
  ];
  const added = [];

  for (const item of cases) {
    const selected = snapshot();
    let imports = 0;
    const result = await runApprovedDeployment(selected, {
      dataverse: {
        importSolutionFromFile: async () => ++imports === 1
          ? { ok: false, error: 'Missing dependency', dependencies: [{ requiredId: item.id, requiredTypeCode: String(item.type) }] }
          : { ok: true },
        listSolutions: async () => ({ solutions: [{ uniqueName: 'Sample', solutionId: selected.solutionId, isManaged: false }] }),
        addSolutionComponent: async () => assert.fail('The supported MCP action should add the component'),
        publishAll: async () => {},
        exportToFile: async () => {}
      },
      mcp: {
        withSourceMcp: async (_url, action) => action({
          tools: [{ name: 'invoke_api', inputSchema: { properties: { apiName: {}, parameters: {} }, required: ['apiName', 'parameters'] } }],
          callTool: async (_name, args) => { added.push(args.parameters); return { isError: false, content: [] }; }
        })
      },
      zip: { inspect: () => ({ uniqueName: 'Sample', managed: true, version: selected.version,
        rootComponentRefs: item.type === 1 ? [{ id: item.id, type: 1, behavior: '1' }] : [] }) },
      artifactsDir: () => 'artifacts',
      storeArtifact: async () => ({})
    });
    assert.equal(result.ok, true, result.error);
  }

  assert.deepEqual(added.map(({ ComponentType, DoNotIncludeSubcomponents }) => ({ type: ComponentType, includeSubcomponents: DoNotIncludeSubcomponents })), [
    { type: 9, includeSubcomponents: false },
    { type: 1, includeSubcomponents: true }
  ]);
});
