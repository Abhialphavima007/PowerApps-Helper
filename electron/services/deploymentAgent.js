'use strict';

const crypto = require('crypto');
const path = require('path');

const MAX_REPAIR_CYCLES = 2;
const MAX_COMPONENTS_PER_CYCLE = 12;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPPORTED_TYPES = new Set([1, 2, 9, 10, 20, 26, 29, 31, 59, 60, 61, 62, 70, 80, 90, 91, 92, 150, 300, 371, 380]);

function candidateKey(item) {
  return item.type + ':' + item.id.toLowerCase();
}

function selectRepairCandidates(dependencies, attempted = new Set()) {
  if (!Array.isArray(dependencies) || !dependencies.length) {
    throw new Error('The failed import did not provide identifiable missing dependencies. Review its import log and repair the target manually.');
  }
  const candidates = [];
  const seen = new Set();
  for (const dep of dependencies) {
    const id = String(dep.requiredId || '').replace(/[{}]/g, '');
    const type = Number(dep.requiredTypeCode);
    const label = dep.requiredSchema || dep.requiredType || id || 'Unknown component';
    if (!GUID.test(id) || !Number.isInteger(type) || !SUPPORTED_TYPES.has(type)) {
      throw new Error('The import log did not identify a supported component ID and type for ' + label + '. The agent stopped.');
    }
    const item = { id, type, label, requiredSolution: dep.requiredSolution || '' };
    const key = candidateKey(item);
    if (attempted.has(key)) {
      throw new Error(label + ' is still missing after being added to the source solution. The agent stopped to avoid repeating the same change.');
    }
    if (!seen.has(key)) { seen.add(key); candidates.push(item); }
  }
  if (candidates.length > MAX_COMPONENTS_PER_CYCLE) {
    throw new Error('The import needs ' + candidates.length + ' components; the agent limit is ' + MAX_COMPONENTS_PER_CYCLE + ' per repair cycle.');
  }
  return candidates;
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
    agent: { attempts: result.attempts || [], repairs: result.repairs || [], failedDependencies: result.dependencies || [], importLog: result.importLog || '' },
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
  const { dataverse, mcp, zip, artifactsDir, storeArtifact, report = () => {}, checkAccount = async () => {} } = services;
  const attempts = [];
  const repairs = [];
  const attempted = new Set();
  let analysis = snapshot.analysis || null;
  let lastImport;
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
        report('store', 'error', null, 'Storage warning: ' + error.message);
      }
      analysis = { artifact, inspection, stored };
    }
    const exportedVersion = analysis.inspection.version;
    for (let cycle = 0; cycle <= MAX_REPAIR_CYCLES; cycle++) {
      await checkAccount();
      report('import', 'running', 1, cycle ? 'Retrying import after source repair (' + (cycle + 1) + ' of ' + (MAX_REPAIR_CYCLES + 1) + ')…' : 'Starting import…');
      lastImport = await dataverse.importSolutionFromFile(snapshot.targetUrl, analysis.artifact, {
        overwrite: snapshot.overwrite, publishWorkflows: true
      }, (percent, message) => report('import', 'running', percent, message));
      attempts.push({ number: cycle + 1, ok: !!lastImport.ok, importJobId: lastImport.importJobId || null, error: lastImport.ok ? null : lastImport.error });
      if (lastImport.ok) {
        report('import', 'done', 100, 'Imported on attempt ' + (cycle + 1) + '.');
        if (snapshot.publishChanges && !snapshot.exportManaged) {
          report('publish', 'running', null, 'Publishing customizations…');
          try {
            await dataverse.publishAll(snapshot.targetUrl);
            report('publish', 'done', 100, 'Published.');
          } catch (error) {
            report('publish', 'error', null, 'Publish warning: ' + error.message);
            return { ok: true, warning: 'Import succeeded, but publishing failed: ' + error.message, attempts, repairs, analysis, importJobId: lastImport.importJobId };
          }
        }
        return { ok: true, attempts, repairs, analysis, importJobId: lastImport.importJobId };
      }
      report('import', 'error', null, lastImport.error || 'Import failed.');
      if (cycle === MAX_REPAIR_CYCLES) {
        throw new Error('Import still failed after ' + MAX_REPAIR_CYCLES + ' source repair cycles: ' + (lastImport.error || 'unknown error'));
      }
      const hasMissingLog = /<(?:\w+:)?MissingDependencies\b/i.test(lastImport.importLog || '');
      if (!/dependenc|missing component/i.test(lastImport.error || '') && !hasMissingLog) {
        throw new Error('The import failed without a dependency error: ' + (lastImport.error || 'unknown error') + '. The agent made no further source changes.');
      }
      const candidates = selectRepairCandidates(lastImport.dependencies, attempted);
      const included = new Set((analysis.inspection?.rootComponentRefs || []).map((item) => Number(item.type) + ':' + String(item.id).toLowerCase()));
      const alreadyIncluded = candidates.find((item) => included.has(candidateKey(item)));
      if (alreadyIncluded) {
        throw new Error(alreadyIncluded.label + ' is already in the exported package. The target likely needs an external solution or configuration; the agent did not add it again.');
      }
      await checkAccount();
      report('repair', 'running', 0, 'Checking ' + candidates.length + ' missing components in the source environment…');
      await ensureUnmanagedSource(dataverse, snapshot);
      try {
        await mcp.withSourceMcp(snapshot.sourceUrl, async (connection) => {
          for (const [index, item] of candidates.entries()) {
            await checkAccount();
            const body = {
              ComponentId: item.id,
              ComponentType: item.type,
              SolutionUniqueName: snapshot.solutionUniqueName,
              AddRequiredComponents: false,
              DoNotIncludeSubcomponents: true
            };
            const viaMcp = await addThroughMcp(connection, body);
            const method = viaMcp.supported ? 'Microsoft Dataverse MCP' : 'Dataverse Web API fallback';
            if (!viaMcp.supported) await dataverse.addSolutionComponent(snapshot.sourceUrl, snapshot.solutionUniqueName, item.id, item.type);
            attempted.add(candidateKey(item));
            repairs.push({ componentId: item.id, componentType: item.type, label: item.label, method, cycle: cycle + 1 });
            report('repair', 'running', Math.round((index + 1) * 100 / candidates.length), 'Added ' + item.label + ' through ' + method + '.');
          }
        });
      } catch (error) {
        report('repair', 'error', null, error.message);
        throw error;
      }
      report('repair', 'done', 100, 'Added ' + candidates.length + ' component(s) to the source solution.');
      await checkAccount();
      report('reexport', 'running', null, 'Exporting the repaired source solution…');
      const name = snapshot.solutionUniqueName + '_agent_' + crypto.randomUUID() + (snapshot.exportManaged ? '_managed' : '') + '.zip';
      const artifact = path.join(artifactsDir(), name);
      let inspection;
      try {
        await dataverse.exportToFile(snapshot.sourceUrl, snapshot.solutionUniqueName, snapshot.exportManaged, artifact);
        inspection = zip.inspect(artifact);
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
        report('store', 'error', null, 'Storage warning: ' + error.message);
      }
      analysis = { artifact, inspection, stored };
      report('reexport', 'done', 100, 'Re-exported the repaired solution.');
    }
  } catch (error) {
    report('agent', 'error', null, error.message);
    return failure(error, attempts, repairs, analysis, lastImport);
  }
}

module.exports = { runAgentDeployment, selectRepairCandidates, invokeApiArguments, addThroughMcp, makeHistoryRecord, MAX_REPAIR_CYCLES };
