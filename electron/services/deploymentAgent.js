'use strict';

const crypto = require('crypto');
const path = require('path');

const MAX_REPAIR_CYCLES = 5;
const MAX_COMPONENTS_PER_CYCLE = 12;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPPORTED_TYPES = new Set([1, 2, 9, 10, 20, 26, 29, 31, 59, 60, 61, 62, 70, 80, 90, 91, 92, 150, 300, 371, 380]);

function candidateKey(item) {
  return item.type + ':' + item.id.toLowerCase();
}

function tableRootsForCandidate(roots, item) {
  const id = item.id.toLowerCase();
  const schema = String(item.verifiedSchemaName || '').toLowerCase();
  return roots.filter((root) => {
    if (Number(root.type) !== 1) return false;
    const rootId = String(root.id || '').replace(/[{}]/g, '').toLowerCase();
    const rootSchema = String(root.schemaName || '').toLowerCase();
    const idMatches = rootId && rootId === id;
    const schemaMatches = schema && rootSchema && rootSchema === schema;
    if ((idMatches && schema && rootSchema && !schemaMatches) ||
        (schemaMatches && rootId && !idMatches)) {
      throw new Error('The exported table identity for ' + item.label + ' conflicts with source metadata. The agent stopped.');
    }
    return idMatches || schemaMatches;
  });
}

function missingPrimaryNameEntity(error, importLog) {
  const message = [error, importLog].map((value) => String(value || '')).join('\n');
  const match = message.match(/PrimaryName\s+attribute\s+not\s+found\s+for\s+Entity\s*:\s*([A-Za-z][A-Za-z0-9_]*)/i);
  return match ? match[1] : '';
}

function fillMissingIdsFromPackage(targetDependencies, packageDependencies) {
  return (targetDependencies || []).map((dependency) => {
    if (GUID.test(String(dependency.requiredId || '').replace(/[{}]/g, ''))) return dependency;
    const schema = String(dependency.requiredSchema || '').trim().toLowerCase();
    const type = Number(dependency.requiredTypeCode);
    if (!schema || !type) return dependency;
    const parentSchema = String(dependency.requiredParentSchema || '').trim().toLowerCase();
    const ids = new Set((packageDependencies || [])
      .filter((item) => Number(item.requiredTypeCode) === type &&
        String(item.requiredSchema || '').trim().toLowerCase() === schema &&
        (type !== 2 || String(item.requiredParentSchema || '').trim().toLowerCase() === parentSchema))
      .map((item) => String(item.requiredId || '').replace(/[{}]/g, '').toLowerCase())
      .filter((id) => GUID.test(id)));
    return ids.size === 1 ? { ...dependency, requiredId: [...ids][0] } : dependency;
  });
}

async function fillMissingIdsFromSource(dependencies, snapshot, dataverse) {
  const resolved = [];
  const lookupCache = new Map();
  for (const dependency of dependencies) {
    const id = String(dependency.requiredId || '').replace(/[{}]/g, '');
    const type = Number(dependency.requiredTypeCode);
    if (GUID.test(id) || !SUPPORTED_TYPES.has(type) || !dependency.requiredSchema || !dataverse.findComponentBySchema) {
      resolved.push(dependency);
      continue;
    }
    let sourceId;
    try {
      const schema = String(dependency.requiredSchema).trim().toLowerCase();
      const parentSchema = type === 2 ? String(dependency.requiredParentSchema || '').trim().toLowerCase() : '';
      const key = type + ':' + parentSchema + ':' + schema;
      if (!lookupCache.has(key)) {
        lookupCache.set(key, await dataverse.findComponentBySchema(snapshot.sourceUrl, type, dependency.requiredSchema, {
          parentSchemaName: dependency.requiredParentSchema || ''
        }));
      }
      sourceId = lookupCache.get(key);
    } catch (error) {
      throw new Error('Source lookup failed for ' + dependency.requiredSchema + ' (type ' + type + '): ' + error.message);
    }
    resolved.push(sourceId && GUID.test(sourceId) ? { ...dependency, requiredId: sourceId } : dependency);
  }
  return resolved;
}

function selectRepairCandidates(dependencies, attempted = new Set()) {
  if (!Array.isArray(dependencies) || !dependencies.length) {
    throw new Error('The failed target import did not provide missing dependency entries. The agent cannot identify a source component to add safely.');
  }
  const classified = classifyRepairCandidates(dependencies, attempted);
  if (classified.unresolved.length) {
    const first = classified.unresolved[0];
    if (first.reason === 'already-attempted') {
      throw new Error(first.label + ' is still missing after being added to the source solution. The agent stopped to avoid repeating the same change.');
    }
    throw new Error('The target import and source lookup did not identify a unique supported component ID and type for ' + first.label + '. The agent stopped.');
  }
  return classified.candidates;
}

// A target import may report several dependencies while omitting IDs for some.
// Add the entries that have exact IDs, then re-import to let Dataverse narrow
// the remaining dependency list. Never guess IDs for unresolved entries.
function classifyRepairCandidates(dependencies, attempted = new Set()) {
  if (!Array.isArray(dependencies) || !dependencies.length) {
    throw new Error('The failed target import did not provide missing dependency entries. The agent cannot identify a source component to add safely.');
  }
  const candidates = [];
  const unresolved = [];
  const seen = new Set();
  for (const dep of dependencies) {
    const id = String(dep.requiredId || '').replace(/[{}]/g, '');
    const type = Number(dep.requiredTypeCode);
    const label = dep.requiredSchema || dep.requiredType || id || 'Unknown component';
    if (!GUID.test(id) || !Number.isInteger(type) || !SUPPORTED_TYPES.has(type)) {
      const parent = dep.requiredParentSchema ? ' on ' + dep.requiredParentSchema : '';
      unresolved.push({
        label: label + parent,
        reason: !Number.isInteger(type) || !SUPPORTED_TYPES.has(type) ? 'unsupported-type' : 'missing-id'
      });
      continue;
    }
    const item = { id, type, label, requiredSolution: dep.requiredSolution || '',
      ...(dep.requiredSchemaName ? { schemaName: dep.requiredSchemaName } : {}) };
    const key = candidateKey(item);
    if (attempted.has(key)) {
      unresolved.push({ label, reason: 'already-attempted' });
      continue;
    }
    if (!seen.has(key)) { seen.add(key); candidates.push(item); }
  }
  if (candidates.length > MAX_COMPONENTS_PER_CYCLE) {
    throw new Error('The import needs ' + candidates.length + ' components; the agent limit is ' + MAX_COMPONENTS_PER_CYCLE + ' per repair cycle.');
  }
  return { candidates, unresolved };
}

function invokeApiArguments(tool, body) {
  const schema = tool.inputSchema || {};
  const properties = schema.properties || {};
  const nameKey = ['apiName', 'api_name', 'name'].find((key) => properties[key]);
  const paramsKey = ['parameters', 'requestParameters', 'apiParameters'].find((key) => properties[key]);
  if (!nameKey || !paramsKey) return null;
  const required = schema.required || [];
  if (required.some((key) => key !== nameKey && key !== paramsKey)) return null;
  const args = { [nameKey]: 'AddSolutionComponent' };
  args[paramsKey] = properties[paramsKey].type === 'string' ? JSON.stringify(body) : body;
  return args;
}

function mcpError(result) {
  return (result.content || []).filter((part) => part.type === 'text').map((part) => part.text).join(' ').slice(0, 500);
}

async function addThroughMcp(connection, body) {
  const tool = connection.tools.find((item) => /^invoke_api$/i.test(item.name));
  if (!tool) return { supported: false };
  if (/custom api/i.test(tool.description || '') && !/built-in|standard api/i.test(tool.description || '')) return { supported: false };
  const args = invokeApiArguments(tool, body);
  if (!args) return { supported: false };
  const result = await connection.callTool(tool.name, args);
  if (result.isError) {
    const detail = mcpError(result);
    if (/AddSolutionComponent.*(not found|does not exist|cannot be found|unsupported|not supported)|(?:no|cannot find|could not find).*api.*AddSolutionComponent/i.test(detail)) {
      return { supported: false };
    }
    throw new Error('Dataverse MCP could not add the component: ' + (detail || 'unknown tool error'));
  }
  return { supported: true };
}

function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.mode !== 'source' || !snapshot.sourceUrl || !snapshot.targetUrl) {
    throw new Error('Agent deployment needs different source and target environments.');
  }
  let source;
  let target;
  try { source = new URL(snapshot.sourceUrl); target = new URL(snapshot.targetUrl); }
  catch { throw new Error('Choose valid source and target environment URLs.'); }
  if (source.protocol !== 'https:' || target.protocol !== 'https:' ||
      !source.hostname.toLowerCase().endsWith('.dynamics.com') ||
      !target.hostname.toLowerCase().endsWith('.dynamics.com') ||
      source.origin.toLowerCase() === target.origin.toLowerCase()) {
    throw new Error('Agent deployment needs different HTTPS Dataverse source and target environments.');
  }
  if (!/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(snapshot.solutionUniqueName || '')) {
    throw new Error('The source solution unique name is invalid.');
  }
  if (!snapshot.analysis) {
    if (!snapshot.deferExport || !snapshot.solutionId) {
      throw new Error('Choose an unmanaged source solution before starting the agent.');
    }
  } else {
    if (!snapshot.analysis.artifact || !snapshot.analysis.inspection) {
      throw new Error('The analyzed source package is incomplete.');
    }
    if (snapshot.analysis.inspection.uniqueName !== snapshot.solutionUniqueName) {
      throw new Error('The exported package does not match the selected source solution.');
    }
    if (snapshot.analysis.inspection.managed !== !!snapshot.exportManaged) {
      throw new Error('The exported package type differs from the selected deployment type.');
    }
    if (snapshot.version && snapshot.analysis.inspection.version && snapshot.analysis.inspection.version !== snapshot.version) {
      throw new Error('The exported package version differs from the selected version. Re-export before starting the agent.');
    }
  }
}

async function ensureUnmanagedSource(dataverse, snapshot) {
  const available = await dataverse.listSolutions(snapshot.sourceUrl);
  const sourceSolution = available.solutions?.find((item) =>
    item.uniqueName === snapshot.solutionUniqueName && !item.isManaged
  );
  if (!sourceSolution || sourceSolution.solutionId?.toLowerCase() !== snapshot.solutionId?.toLowerCase()) {
    throw new Error('The selected unmanaged source solution changed or is no longer accessible. The agent stopped before editing it.');
  }
  return sourceSolution;
}

function failure(error, attempts, repairs, analysis, lastImport) {
  return {
    ok: false, error: String(error?.message || error), attempts, repairs, analysis,
    importJobId: lastImport?.importJobId,
    dependencies: lastImport?.dependencies || [],
    importLog: lastImport?.importLog || ''
  };
}

function makeHistoryRecord(snapshot, result, accountUsername) {
  const finalAnalysis = result.analysis || snapshot.analysis;
  const failedAttempts = (result.attempts || []).filter((attempt) => !attempt.ok);
  return {
    solution: snapshot.solution,
    solutionUniqueName: snapshot.solutionUniqueName,
    version: snapshot.version,
    sourceEnv: snapshot.sourceEnv,
    sourceUrl: snapshot.sourceUrl,
    targetEnv: snapshot.targetEnv,
    targetUrl: snapshot.targetUrl,
    account: accountUsername,
    description: snapshot.description,
    workItems: snapshot.workItems,
    workItemDetails: snapshot.workItemDetails,
    workItemSummary: snapshot.workItemSummary,
    exportManaged: snapshot.exportManaged,
    mode: 'source',
    deploymentMethod: 'agent',
    runId: snapshot.runId,
    agent: {
      attempts: result.attempts || [], repairs: result.repairs || [],
      failedDependencies: result.dependencies?.length ? result.dependencies : failedAttempts.flatMap((attempt) => attempt.dependencies || []),
      importLog: result.importLog || failedAttempts.map((attempt) => attempt.importLog || '').filter(Boolean).join('\n\n').slice(0, 24000)
    },
    artifact: finalAnalysis?.artifact || null,
    stored: finalAnalysis?.stored || {},
    dependencies: finalAnalysis?.inspection?.dependencies || [],
    summary: finalAnalysis?.inspection?.summary || {},
    notes: snapshot.notes,
    warning: result.warning || null,
    status: result.ok ? 'success' : 'failed',
    error: result.ok ? null : result.error
  };
}

async function runAgentDeployment(snapshot, services) {
  validateSnapshot(snapshot);
  const { dataverse, mcp, zip, artifactsDir, storeArtifact, requestApproval, report = () => {}, checkAccount = async () => {} } = services;
  const attempts = [];
  const repairs = [];
  const attempted = new Set();
  let analysis = snapshot.analysis || null;
  const storageWarnings = analysis?.stored?.warning ? [analysis.stored.warning] : [];
  let lastImport;
  let repairApproval;
  try {
    if (!analysis) {
      await checkAccount();
      report('version', 'running', null, 'Checking the selected unmanaged source solution…');
      try {
        const sourceSolution = await ensureUnmanagedSource(dataverse, snapshot);
        if (snapshot.version) {
          await dataverse.setSolutionVersion(snapshot.sourceUrl, sourceSolution.solutionId, snapshot.version);
          report('version', 'done', 100, 'Source version set to ' + snapshot.version + '.');
        } else {
          report('version', 'done', 100, 'Using the current source version.');
        }
      } catch (error) {
        report('version', 'error', null, error.message);
        throw error;
      }
      await checkAccount();
      report('export', 'running', null, 'Exporting the source solution…');
      const artifact = path.join(artifactsDir(), snapshot.solutionUniqueName + '_agent_initial_' + crypto.randomUUID() + (snapshot.exportManaged ? '_managed' : '') + '.zip');
      try {
        await dataverse.exportToFile(snapshot.sourceUrl, snapshot.solutionUniqueName, snapshot.exportManaged, artifact);
      } catch (error) {
        report('export', 'error', null, error.message);
        throw error;
      }
      report('export', 'done', 100, 'Source solution exported.');
      report('analyze', 'running', null, 'Inspecting the exported package…');
      let inspection;
      try {
        inspection = zip.inspect(artifact);
        if (inspection.uniqueName !== snapshot.solutionUniqueName || inspection.managed !== !!snapshot.exportManaged) {
          throw new Error('The exported package did not match the selected solution and package type.');
        }
        if (snapshot.version && inspection.version && inspection.version !== snapshot.version) {
          throw new Error('The exported package version differs from the selected version.');
        }
      } catch (error) {
        report('analyze', 'error', null, error.message);
        throw error;
      }
      report('analyze', 'done', 100, 'Package inspected. Its dependency list is advisory until target import.');
      let stored = {};
      try {
        stored = await storeArtifact({
          artifact, account: snapshot.account, sourceEnv: snapshot.sourceEnv,
          targetEnv: snapshot.targetEnv, solution: snapshot.solutionUniqueName,
          version: snapshot.version, managed: snapshot.exportManaged
        });
      } catch (error) {
        const warning = 'Export could not be saved to the configured storage: ' + error.message;
        storageWarnings.push(warning);
        stored = { warning };
        report('store', 'error', null, warning);
      }
      analysis = { artifact, inspection, stored };
    }
    const exportedVersion = analysis.inspection.version;
    for (let cycle = 0; cycle <= MAX_REPAIR_CYCLES; cycle++) {
      await checkAccount();
      if (cycle) await repairApproval.assertValid();
      report('import', 'running', 1, cycle ? 'Retrying import after source repair (' + (cycle + 1) + ' of ' + (MAX_REPAIR_CYCLES + 1) + ')…' : 'Starting import…');
      lastImport = await dataverse.importSolutionFromFile(snapshot.targetUrl, analysis.artifact, {
        overwrite: snapshot.overwrite, publishWorkflows: true
      }, (percent, message) => report('import', 'running', percent, message));
      attempts.push({
        number: cycle + 1, ok: !!lastImport.ok, importJobId: lastImport.importJobId || null,
        error: lastImport.ok ? null : lastImport.error,
        dependencies: lastImport.ok ? [] : (lastImport.dependencies || []),
        importLog: lastImport.ok ? '' : (lastImport.importLog || '')
      });
      if (lastImport.ok) {
        report('import', 'done', 100, 'Imported on attempt ' + (cycle + 1) + '.');
        if (snapshot.publishChanges && !snapshot.exportManaged) {
          report('publish', 'running', null, 'Publishing customizations…');
          try {
            await dataverse.publishAll(snapshot.targetUrl);
            report('publish', 'done', 100, 'Published.');
          } catch (error) {
            report('publish', 'error', null, 'Publish warning: ' + error.message);
            return { ok: true, warning: [...storageWarnings, 'Import succeeded, but publishing failed: ' + error.message].join(' '), attempts, repairs, analysis, importJobId: lastImport.importJobId };
          }
        }
        return { ok: true, warning: storageWarnings.join(' '), attempts, repairs, analysis, importJobId: lastImport.importJobId };
      }
      report('import', 'error', null, lastImport.error || 'Import failed.');
      if (cycle === MAX_REPAIR_CYCLES) {
        throw new Error('Import still failed after ' + MAX_REPAIR_CYCLES + ' source repair cycles: ' + (lastImport.error || 'unknown error'));
      }
      const primaryNameEntity = missingPrimaryNameEntity(lastImport.error, lastImport.importLog);
      const hasMissingLog = /<(?:\w+:)?MissingDependencies\b/i.test(lastImport.importLog || '');
      const isDependencyFailure = /dependenc|missing component/i.test(lastImport.error || '') || hasMissingLog;
      if (!isDependencyFailure && !primaryNameEntity) {
        throw new Error('The import failed without a dependency error: ' + (lastImport.error || 'unknown error') + '. The agent made no further source changes.');
      }
      // Package declarations may only supply a missing GUID when type and schema
      // identify one exact match. A PrimaryName failure is handled below only
      // when the source metadata and exported entity can both be verified.
      let targetDependencies = fillMissingIdsFromPackage(lastImport.dependencies, analysis.inspection?.dependencies);
      if (primaryNameEntity) {
        report('resolve', 'running', null, 'Resolving the primary-name column for ' + primaryNameEntity + ' in the source environment…');
        try {
          await checkAccount();
          await ensureUnmanagedSource(dataverse, snapshot);
          if (!dataverse.getEntityPrimaryNameAttribute || !dataverse.findComponentBySchema) {
            throw new Error('Source metadata lookup is unavailable for the primary-name column.');
          }
          const entity = await dataverse.getEntityPrimaryNameAttribute(snapshot.sourceUrl, primaryNameEntity);
          const entityId = String(entity?.entityId || '').replace(/[{}]/g, '').toLowerCase();
          const entitySchemaName = String(entity?.entitySchemaName || '');
          if (!GUID.test(entityId) || entitySchemaName.toLowerCase() !== primaryNameEntity.toLowerCase()) {
            throw new Error('The source entity ' + primaryNameEntity + ' or its primary-name column could not be verified.');
          }
          const packageRoots = analysis.inspection?.rootComponentRefs || [];
          // Table roots can be identified by GUID, logical name, or both.
          // When both are present, neither may contradict the source metadata.
          if (!packageRoots.some((item) => {
            if (Number(item.type) !== 1) return false;
            const id = String(item.id || '').replace(/[{}]/g, '').toLowerCase();
            const schemaName = String(item.schemaName || '').toLowerCase();
            return !!(id || schemaName) && (!id || id === entityId) &&
              (!schemaName || schemaName === entitySchemaName.toLowerCase());
          })) {
            throw new Error('The source entity ' + primaryNameEntity + ' was not verified as a root component in the exported package.');
          }
          const attributeId = await dataverse.findComponentBySchema(snapshot.sourceUrl, 2, entity.attributeSchemaName, {
            parentSchemaName: entitySchemaName
          });
          if (!GUID.test(String(attributeId || '').replace(/[{}]/g, ''))) {
            throw new Error('The primary-name column ' + entity.attributeSchemaName + ' could not be resolved to one source component ID.');
          }
          const normalizedAttributeId = String(attributeId).replace(/[{}]/g, '').toLowerCase();
          if (packageRoots.some((item) => Number(item.type) === 2 && String(item.id || '').replace(/[{}]/g, '').toLowerCase() === normalizedAttributeId)) {
            throw new Error('The primary-name column is already a root component in the exported package; the agent stopped without changing the source.');
          }
          if (!targetDependencies.some((item) => Number(item.requiredTypeCode) === 2 && String(item.requiredId || '').replace(/[{}]/g, '').toLowerCase() === normalizedAttributeId)) {
            targetDependencies.push({
              requiredId: normalizedAttributeId,
              requiredTypeCode: '2',
              requiredSchema: entity.attributeSchemaName,
              requiredParentSchema: entitySchemaName
            });
          }
          report('resolve', 'done', 100, 'Resolved the exact primary-name column ' + entity.attributeSchemaName + ' on ' + entitySchemaName + '.');
        } catch (error) {
          report('resolve', 'error', null, error.message);
          throw error;
        }
      }
      if (targetDependencies.some((item) => !GUID.test(String(item.requiredId || '').replace(/[{}]/g, '')))) {
        report('resolve', 'running', null, 'Looking up missing component IDs in the source environment…');
        try {
          await checkAccount();
          await ensureUnmanagedSource(dataverse, snapshot);
          targetDependencies = await fillMissingIdsFromSource(targetDependencies, snapshot, dataverse);
          const unresolved = targetDependencies.filter((item) => !GUID.test(String(item.requiredId || '').replace(/[{}]/g, '')));
          report('resolve', unresolved.length ? 'error' : 'done', unresolved.length ? null : 100,
            unresolved.length ? 'Some components could not be identified uniquely in the source.' : 'Missing component IDs found in the source.');
        } catch (error) {
          report('resolve', 'error', null, error.message);
          throw error;
        }
      }
      const { candidates, unresolved } = classifyRepairCandidates(targetDependencies, attempted);
      if (!candidates.length) {
        const detail = unresolved.map((item) => item.reason === 'already-attempted'
          ? item.label + ' is still missing after being added to the source solution'
          : item.reason === 'unsupported-type'
            ? item.label + ' (unsupported component type)'
            : item.label + ' (no exact ID was returned by the import log, package, or source lookup)').join(', ');
        throw new Error('No new source components could be added safely. ' + (detail || 'The import did not identify a supported component.') + '. The agent stopped.');
      }
      if (unresolved.length) {
        report('resolve', 'done', 100, 'Identified ' + candidates.length + ' source component(s); ' + unresolved.length + ' dependency entry/entries still need exact IDs. Adding identified components and retrying the import.');
      }
      const roots = analysis.inspection?.rootComponentRefs || [];
      const included = new Set(roots
        .filter((item) => item.id)
        .map((item) => Number(item.type) + ':' + String(item.id).replace(/[{}]/g, '').toLowerCase()));
      const includedNonTable = candidates.find((item) => item.type !== 1 && included.has(candidateKey(item)));
      if (includedNonTable) {
        throw new Error(includedNonTable.label + ' is already in the exported package. The target likely needs an external solution or configuration; the agent did not add it again.');
      }
      await checkAccount();
      await ensureUnmanagedSource(dataverse, snapshot);
      // A type-1 root may have only a logical name, so confirm that name
      // resolves to the same metadata ID before using it to identify a table.
      for (const item of candidates.filter((candidate) => candidate.type === 1 && candidate.schemaName)) {
        if (!dataverse.findComponentBySchema) throw new Error('Source table metadata lookup is unavailable. The agent stopped.');
        const sourceId = String(await dataverse.findComponentBySchema(snapshot.sourceUrl, 1, item.schemaName) || '')
          .replace(/[{}]/g, '').toLowerCase();
        if (sourceId !== item.id.toLowerCase()) {
          throw new Error('The source table name and component ID for ' + item.label + ' could not be verified. The agent stopped.');
        }
        item.verifiedSchemaName = item.schemaName;
      }
      const alreadyIncluded = candidates.find((item) => {
        if (item.type !== 1) return false;
        const matches = tableRootsForCandidate(roots, item);
        if (!matches.length && !item.verifiedSchemaName && roots.some((root) =>
          Number(root.type) === 1 && !root.id && root.schemaName)) {
          throw new Error('The exported table roots for ' + item.label + ' cannot be compared with its component ID. The agent stopped.');
        }
        return matches.some((root) => String(root.behavior) !== '2');
      });
      if (alreadyIncluded) {
        throw new Error(alreadyIncluded.label + ' is already in the exported package. The target likely needs an external solution or configuration; the agent did not add it again.');
      }
      // Source additions and retry side effects require approval of this exact cycle.
      if (!requestApproval) throw new Error('Dependency approval is not configured. The agent stopped before adding source dependencies.');
      const approval = await requestApproval(snapshot, candidates, {
        cycle: cycle + 1, error: lastImport.error, importJobId: lastImport.importJobId, unresolved
      }, { report, checkAccount });
      if (!approval || typeof approval.assertValid !== 'function') throw new Error('The dependency approval could not be verified.');
      await approval.assertValid();
      repairApproval = approval;
      await ensureUnmanagedSource(dataverse, snapshot);
      const approvalEvidence = { approvalEventId: approval.eventId, planHash: approval.planHash, approvalId: approval.approvalId };
      report('repair', 'running', 0, 'Checking ' + candidates.length + ' missing components in the source environment…');
      const addWithWebApi = async (fallbackReason) => {
        for (const [index, item] of candidates.entries()) {
          await checkAccount();
          await approval.assertValid();
          await dataverse.addSolutionComponent(snapshot.sourceUrl, snapshot.solutionUniqueName, item.id, item.type);
          attempted.add(candidateKey(item));
          const method = fallbackReason ? 'Dataverse Web API fallback' : 'Dataverse Web API';
          repairs.push({
            componentId: item.id, componentType: item.type, label: item.label, method, ...approvalEvidence,
            ...(fallbackReason ? { fallbackReason: String(fallbackReason).slice(0, 300) } : {}),
            cycle: cycle + 1
          });
          report('repair', 'running', Math.round((index + 1) * 100 / candidates.length), 'Added ' + item.label + ' through ' + method + '.');
        }
      };
      let enteredMcpAction = false;
      const requireMcp = snapshot.repairTransport === 'mcp';
      if (!mcp) {
        if (requireMcp) throw new Error('Helper’s source MCP connection is required for this repair. Check Helper’s MCP client configuration and source-environment access.');
        report('repair', 'running', 0, 'Using Dataverse Web API for approved source additions. Optional MCP is not connected for this run.');
        try {
          await addWithWebApi();
        } catch (error) {
          report('repair', 'error', null, error.message);
          throw error;
        }
      } else try {
        await mcp.withSourceMcp(snapshot.sourceUrl, async (connection) => {
          enteredMcpAction = true;
          for (const [index, item] of candidates.entries()) {
            await checkAccount();
            await approval.assertValid();
            const body = {
              ComponentId: item.id,
              ComponentType: item.type,
              SolutionUniqueName: snapshot.solutionUniqueName,
              AddRequiredComponents: false,
              DoNotIncludeSubcomponents: item.type === 1
            };
            const viaMcp = await addThroughMcp(connection, body);
            if (requireMcp && !viaMcp.supported) throw new Error('The source MCP endpoint does not advertise a supported AddSolutionComponent action. The repair stopped without switching to the API.');
            const method = viaMcp.supported ? 'Microsoft Dataverse MCP' : 'Dataverse Web API fallback';
            if (!viaMcp.supported) await dataverse.addSolutionComponent(snapshot.sourceUrl, snapshot.solutionUniqueName, item.id, item.type);
            attempted.add(candidateKey(item));
            repairs.push({ componentId: item.id, componentType: item.type, label: item.label, method, cycle: cycle + 1, ...approvalEvidence });
            report('repair', 'running', Math.round((index + 1) * 100 / candidates.length), 'Added ' + item.label + ' through ' + method + '.');
          }
        });
      } catch (error) {
        if (enteredMcpAction || requireMcp) {
          report('repair', 'error', null, error.message);
          throw error;
        }
        report('repair', 'running', 0, 'Microsoft Dataverse MCP could not connect; using the authenticated Dataverse Web API fallback…');
        try {
          await addWithWebApi(error.message || error);
        } catch (fallbackError) {
          report('repair', 'error', null, fallbackError.message);
          throw fallbackError;
        }
      }
      report('repair', 'done', 100, 'Added ' + candidates.length + ' component(s) to the source solution.');
      await checkAccount();
      await approval.assertValid();
      report('publishsource', 'running', null, 'Publishing source customizations before re-export…');
      try {
        await dataverse.publishAll(snapshot.sourceUrl);
        report('publishsource', 'done', 100, 'Source customizations published.');
      } catch (error) {
        report('publishsource', 'error', null, error.message);
        throw new Error('Source publish failed after adding dependencies: ' + error.message);
      }
      await checkAccount();
      await approval.assertValid();
      report('reexport', 'running', null, 'Exporting the repaired source solution…');
      const name = snapshot.solutionUniqueName + '_agent_' + crypto.randomUUID() + (snapshot.exportManaged ? '_managed' : '') + '.zip';
      const artifact = path.join(artifactsDir(), name);
      let inspection;
      try {
        await dataverse.exportToFile(snapshot.sourceUrl, snapshot.solutionUniqueName, snapshot.exportManaged, artifact);
        inspection = zip.inspect(artifact);
        for (const item of candidates.filter((candidate) => candidate.type === 1)) {
          const matches = tableRootsForCandidate(inspection.rootComponentRefs || [], item);
          if (!matches.some((root) => ['0', '1'].includes(String(root.behavior))) ||
              matches.some((root) => !['0', '1'].includes(String(root.behavior)))) {
            throw new Error('The re-export did not confirm that table ' + item.label + ' is included beyond a shell. The agent stopped before another import.');
          }
        }
      } catch (error) {
        report('reexport', 'error', null, error.message);
        throw error;
      }
      if (inspection.uniqueName !== snapshot.solutionUniqueName || inspection.managed !== !!snapshot.exportManaged) {
        throw new Error('The repaired export did not match the selected solution and package type.');
      }
      if (exportedVersion && inspection.version && inspection.version !== exportedVersion) {
        throw new Error('The source solution version changed during agent deployment. The agent stopped before retrying the import.');
      }
      let stored = {};
      try {
        stored = await storeArtifact({
          artifact, account: snapshot.account, sourceEnv: snapshot.sourceEnv,
          targetEnv: snapshot.targetEnv, solution: snapshot.solutionUniqueName,
          version: snapshot.version, managed: snapshot.exportManaged
        });
      } catch (error) {
        const warning = 'Re-export could not be saved to the configured storage: ' + error.message;
        storageWarnings.push(warning);
        stored = { warning };
        report('store', 'error', null, warning);
      }
      analysis = { artifact, inspection, stored };
      report('reexport', 'done', 100, 'Re-exported the repaired solution.');
    }
  } catch (error) {
    report('agent', 'error', null, error.message);
    return { ...failure(error, attempts, repairs, analysis, lastImport), warning: storageWarnings.join(' ') };
  }
}

module.exports = { runAgentDeployment, selectRepairCandidates, classifyRepairCandidates, fillMissingIdsFromPackage, invokeApiArguments, addThroughMcp, makeHistoryRecord, MAX_REPAIR_CYCLES };
