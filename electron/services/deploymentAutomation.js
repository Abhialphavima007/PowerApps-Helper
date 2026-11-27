'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { approvalDetails } = require('./approvalPresentation');

const EVENT = { success: 100000000, failed: 100000001, approval: 100000002 };
const APPROVED = 100000000;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULTS = { enabled: false, environmentUrl: '', profileKey: 'default', reportingDestination: 'target', repairTransport: 'auto' };

function environmentUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Choose an HTTPS Dataverse environment URL.'); }
  // Global Discovery supplies ApiUrl (org.api.crmN.dynamics.com). Keep that
  // origin for authentication and API calls, as the deployment client does.
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.(?:api\.)?crm[0-9]*\.dynamics\.com$/i.test(url.hostname) ||
      url.username || url.password || url.port || !['', '/'].includes(url.pathname) || url.search || url.hash) {
    throw new Error('Choose an HTTPS Dataverse environment URL.');
  }
  return url.origin;
}

function settings(value = {}) {
  const result = { ...DEFAULTS, ...value };
  // Preserve explicit destinations and repair behavior in older saved settings.
  result.reportingDestination = value.reportingDestination || (value.environmentUrl ? 'setup' : 'target');
  // Migrate the previously saved MCP-only choice. Desktop repair now uses the
  // same authenticated Dataverse API as export/import, after approval checks.
  result.repairTransport = value.repairTransport || 'auto';
  if (typeof result.enabled !== 'boolean' || !/^[a-zA-Z0-9_-]{1,100}$/.test(result.profileKey)) {
    throw new Error('Choose a valid notification profile key.');
  }
  result.environmentUrl = result.environmentUrl ? environmentUrl(result.environmentUrl) : '';
  if (!['target', 'setup'].includes(result.reportingDestination) || !['mcp', 'auto'].includes(result.repairTransport)) {
    throw new Error('Choose valid reporting and dependency repair options.');
  }
  result.repairTransport = 'auto';
  if (result.enabled && result.reportingDestination === 'setup' && !result.environmentUrl) throw new Error('Choose the setup environment for fixed reporting.');
  return result;
}

function deploymentConfig(value, snapshot, purpose = 'outcome') {
  const config = settings(value);
  const destination = purpose === 'outcome' && config.reportingDestination === 'target'
    ? snapshot.targetUrl : config.environmentUrl || snapshot.targetUrl;
  if (!config.enabled) return config;
  try { return { ...config, environmentUrl: environmentUrl(destination) }; }
  catch {
    throw new Error(purpose === 'approval'
      ? 'Dependency approval needs a valid Dataverse environment. Check the approval setup URL in Settings, or leave it blank to use the deployment target.'
      : 'Outcome reporting needs a valid Dataverse environment. Check the reporting destination in Settings and the selected deployment target.');
  }
}

function emails(value) {
  const list = [...new Set(String(value || '').split(/[;,\n]/).map(x => x.trim().toLowerCase()).filter(Boolean))];
  if (list.length > 50 || list.some(x => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x)) || list.join(';').length > 2000) {
    throw new Error('Enter up to 50 valid email addresses separated by semicolons.');
  }
  return list;
}

function redact(value, limit = 12000) {
  return String(value || '').replace(/Bearer\s+[^\s"<>]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:sig|code|token|access_token)=)[^&\s<>"']+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|client[_-]?secret|password|authorization)\s*[:=]\s*)[^\s,;"<>]+/gi, '$1[redacted]')
    .slice(0, limit);
}

function eventId(runId, type, cycle = 0) {
  const bytes = crypto.createHash('sha256').update(`${runId}:${type}:${cycle}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function repairPlan(snapshot, candidates, cycle) {
  return {
    runId: snapshot.runId, cycle, solution: snapshot.solutionUniqueName,
    version: snapshot.version || snapshot.analysis?.inspection?.version || '',
    sourceUrl: environmentUrl(snapshot.sourceUrl), targetUrl: environmentUrl(snapshot.targetUrl),
    // Including required components implicitly would exceed the approval scope.
    addRequiredComponents: false,
    components: candidates.map(x => ({ id: x.id.toLowerCase(), type: x.type, name: x.label,
      includeSubcomponents: x.type !== 1 })).sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`)),
    nextActions: ['Add only these existing components to the selected unmanaged source solution',
      'Publish source customizations', 'Re-export the same solution version', 'Retry target import']
  };
}

function planHash(plan) {
  return crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

function createDeploymentAutomation({ auth, getSettings, userDataPath, notify = () => {}, fetchImpl = fetch,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now() }) {
  const dir = path.join(userDataPath, 'powerapps-helper', 'notification-outbox');
  let flushing = false;

  function pendingFiles() {
    try { return fs.readdirSync(dir).filter(x => x.endsWith('.json')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }

  function notification(message) {
    try { notify('Deployment notification needs attention', message); }
    catch { /* Reporting failures must never change the deployment result. */ }
  }

  async function request(config, rel, { method = 'GET', body } = {}) {
    const token = await auth.getTokenSilent(config.environmentUrl, config.accountId);
    const response = await fetchImpl(config.environmentUrl + '/api/data/v9.2/' + rel, {
      method, signal: AbortSignal.timeout(15000), redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json',
        'OData-Version': '4.0', 'OData-MaxVersion': '4.0' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error('Notification setup request failed (' + response.status + '). Check sign-in and table permissions.');
      error.status = response.status;
      throw error;
    }
    return text ? JSON.parse(text) : {};
  }

  async function profile(config) {
    let data;
    try { data = await request(config, "abhi_deploymentprofiles?$filter=abhi_profilekey eq '" + config.profileKey + "'&$top=2"); }
    catch (error) {
      if (error.status !== 404) throw error;
      throw new Error('PowerApps Helper Setup was not found in ' + config.environmentUrl + '. Install it there, or check the reporting and approval destinations in Settings.');
    }
    if (data.value?.length !== 1) throw new Error('Create exactly one deployment profile with key ' + config.profileKey + ' in PowerApps Helper Setup at ' + config.environmentUrl + '.');
    const row = data.value[0];
    const mode = row.abhi_approvalmode;
    if (![100000000, 100000001].includes(mode)) throw new Error('Choose an approval mode in the setup profile.');
    const timeout = row.abhi_approvaltimeoutminutes;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 1440) throw new Error('Approval timeout must be between 1 and 1440 minutes.');
    return { ...row, successRecipients: emails(row.abhi_successrecipients), failureRecipients: emails(row.abhi_failurerecipients),
      approvers: emails(row.abhi_approvers), timeout, mode };
  }

  function baseEvent(config, snapshot, type, cycle = 0) {
    return {
      abhi_deploymenteventid: eventId(snapshot.runId, type, cycle),
      abhi_name: `${snapshot.solutionUniqueName || snapshot.solution || 'Deployment'} - ${type}`.slice(0, 100),
      abhi_runid: snapshot.runId, abhi_profilekey: config.profileKey, abhi_eventtype: EVENT[type],
      abhi_solutionname: String(snapshot.solutionUniqueName || snapshot.solution || '').slice(0, 100),
      abhi_solutionversion: String(snapshot.version || '').slice(0, 50),
      abhi_sourceenvironment: String(snapshot.sourceEnv || '').slice(0, 200), abhi_sourceurl: snapshot.sourceUrl || '',
      abhi_targetenvironment: String(snapshot.targetEnv || '').slice(0, 200), abhi_targeturl: snapshot.targetUrl || '',
      abhi_initiatedby: String(snapshot.account || '').slice(0, 320), abhi_completedon: new Date(now()).toISOString(),
      abhi_repaircycle: cycle, abhi_deliverystatus: 100000000
    };
  }

  function persist(item) {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, item.body.abhi_deploymenteventid + '.json');
    const temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(item), { mode: 0o600 });
    fs.renameSync(temp, file);
    return file;
  }

  async function postEvent(config, body) {
    try { await request(config, 'abhi_deploymentevents', { method: 'POST', body }); }
    catch (error) {
      if (![409, 412].includes(error.status)) throw error;
      const previous = await request(config, `abhi_deploymentevents(${body.abhi_deploymenteventid})`);
      if (previous.abhi_runid !== body.abhi_runid || previous.abhi_eventtype !== body.abhi_eventtype ||
          (previous.abhi_planhash || '') !== (body.abhi_planhash || '')) throw new Error('A conflicting deployment event already exists.');
    }
  }

  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      const current = await auth.status();
      for (const file of pendingFiles()) {
        const absolute = path.join(dir, file);
        try {
          const item = JSON.parse(fs.readFileSync(absolute, 'utf8'));
          if (!current.signedIn || item.accountId !== current.account?.homeAccountId) continue;
          const config = { ...settings(item.config), accountId: item.accountId };
          const selected = settings(getSettings().deploymentAutomation);
          if (!selected.enabled || selected.profileKey !== config.profileKey ||
              selected.reportingDestination !== config.reportingDestination ||
              (selected.reportingDestination === 'setup' && selected.environmentUrl !== config.environmentUrl)) continue;
          const row = await profile(config);
          const recipients = item.body.abhi_eventtype === EVENT.success ? row.successRecipients : row.failureRecipients;
          if (!row.abhi_enabled || !recipients.length) item.body.abhi_deliverystatus = 100000003;
          item.body.abhi_recipients = recipients.join(';');
          await postEvent(config, item.body);
          fs.unlinkSync(absolute);
        } catch { /* Retain the event for an explicit retry using the same Microsoft account. */ }
      }
    } finally { flushing = false; }
  }

  // Persist before attempting the network. A delivery problem never changes the import result.
  async function recordOutcome(snapshot, result) {
    try {
      const config = deploymentConfig(snapshot.deploymentAutomation || getSettings().deploymentAutomation, snapshot);
      if (!config.enabled) return { queued: false, disabled: true };
      const current = await auth.status();
      if (!GUID.test(snapshot.runId)) throw new Error('The deployment run ID is invalid.');
      const body = baseEvent(config, snapshot, result.ok ? 'success' : 'failed');
      body.abhi_importjobid = result.importJobId || '';
      body.abhi_errordetails = redact(result.error);
      body.abhi_warning = redact(result.warning, 4000);
      body.abhi_details = redact([
        snapshot.description, snapshot.notes,
        'Import attempts: ' + JSON.stringify(result.attempts || []),
        'Dependency additions: ' + JSON.stringify(result.repairs || []),
        result.dependencies?.length ? 'Reported dependencies: ' + JSON.stringify(result.dependencies) : ''
      ].filter(Boolean).join('\n\n'), 30000);
      persist({ config, accountId: snapshot.accountId || current.account?.homeAccountId, body });
      void flush().catch(() => notification('The deployment report remains queued. Retry it from Settings.'));
      return { queued: true };
    } catch (error) {
      notification('The deployment result is retained. Email reporting could not be queued: ' + error.message);
      return { queued: false, error: error.message };
    }
  }

  async function requestApproval(snapshot, candidates, context, { report = () => {}, checkAccount = async () => {} } = {}) {
    const config = { ...deploymentConfig(snapshot.deploymentAutomation || getSettings().deploymentAutomation, snapshot, 'approval'), accountId: snapshot.accountId };
    if (!config.enabled) throw new Error('Dependency repair needs approval. Enable deployment automation in Settings before using the agent to repair dependencies.');
    function verifySavedSettings() {
      const selected = deploymentConfig(getSettings().deploymentAutomation, snapshot, 'approval');
      if (!selected.enabled || selected.environmentUrl !== config.environmentUrl || selected.profileKey !== config.profileKey ||
          selected.repairTransport !== config.repairTransport) {
        throw new Error('Deployment automation settings changed. Source repair stopped; request a new approval.');
      }
    }
    const row = await profile(config);
    const missing = [!row.abhi_enabled && 'enable the profile', !row.approvers.length && 'select approvers',
      !GUID.test(row.abhi_flowuserid || '') && 'configure the verified trusted approval flow user'].filter(Boolean);
    if (missing.length) {
      throw new Error('Dependency repair is paused. In PowerApps Helper Setup at ' + config.environmentUrl + ', ' + missing.join('; ') + '.');
    }
    const plan = repairPlan(snapshot, candidates, context.cycle);
    const hash = planHash(plan);
    const body = baseEvent(config, snapshot, 'approval', context.cycle);
    body.abhi_planhash = hash;
    body.abhi_planjson = JSON.stringify(plan);
    body.abhi_recipients = row.approvers.join(';');
    body.abhi_approvalmode = row.mode;
    body.abhi_errordetails = redact(context.error);
    body.abhi_importjobid = context.importJobId || '';
    const categories = {};
    // Category lookup is presentation only: failed reads remain labelled
    // Process and never change the exact machine plan or its approval hash.
    for (const item of plan.components.filter(item => item.type === 29)) {
      try {
        const process = await request({ ...config, environmentUrl: plan.sourceUrl }, `workflows(${item.id})?$select=category`);
        categories[item.id] = process.category;
      } catch { /* Keep the verified generic Process type. */ }
    }
    body.abhi_details = redact(approvalDetails(plan, context.unresolved || [], categories,
      context.error || '', context.dependencies || []), 30000);
    // Dataverse date columns can discard fractional seconds.
    const deadline = Math.floor((now() + row.timeout * 60000) / 1000) * 1000;
    body.abhi_expireson = new Date(deadline).toISOString();
    await checkAccount();
    verifySavedSettings();
    await postEvent(config, body);
    report('approval', 'running', null, 'Waiting for ' + row.approvers.join(', ') + ' to approve the exact dependency plan. No dependencies have been added.');
    while (now() < deadline) {
      await checkAccount();
      verifySavedSettings();
      const data = await request(config, "abhi_deploymentdecisions?$filter=abhi_eventid eq '" + body.abhi_deploymenteventid + "'&$top=2");
      if (data.value?.length > 1) throw new Error('Conflicting approval decisions were found. Source repair stopped.');
      if (data.value?.length === 1) {
        const decision = data.value[0];
        const responseTime = Date.parse(decision.abhi_respondedon);
        const createdTime = Date.parse(decision.createdon);
        if (String(decision._createdby_value || '').toLowerCase() !== row.abhi_flowuserid.toLowerCase() ||
            String(decision._modifiedby_value || '').toLowerCase() !== row.abhi_flowuserid.toLowerCase() ||
            decision.abhi_deploymentdecisionid !== body.abhi_deploymenteventid ||
            decision.abhi_runid !== snapshot.runId || decision.abhi_planhash !== hash ||
            !Number.isFinite(responseTime) || !Number.isFinite(createdTime) ||
            responseTime < Math.floor(Date.parse(body.abhi_completedon) / 1000) * 1000 ||
            createdTime < Math.floor(Date.parse(body.abhi_completedon) / 1000) * 1000) {
          throw new Error('Approval identity, request, plan or expiry could not be verified. Source repair stopped.');
        }
        if (decision.abhi_outcome !== APPROVED) throw new Error('Dependency repair was rejected, expired or failed. No approved dependencies were added.');
        if (responseTime >= deadline || createdTime >= deadline || !decision.abhi_approvalid) {
          throw new Error('Approval evidence is missing or expired. Source repair stopped.');
        }
        let responses;
        try { responses = JSON.parse(decision.abhi_responses); } catch { throw new Error('Approval response evidence is invalid.'); }
        if (!Array.isArray(responses) || !responses.length) throw new Error('Approval response evidence is missing.');
        const responders = responses.map(x => ({ email: String(x.responder?.email || '').toLowerCase(), response: x.approverResponse }));
        if (responders.some(x => !row.approvers.includes(x.email) || x.response !== 'Approve') ||
            (row.mode === 100000000 && row.approvers.some(email => !responders.some(x => x.email === email)))) {
          throw new Error('The selected approvers have not approved this plan. Source repair stopped.');
        }
        async function verifyCurrentRequest() {
          await checkAccount();
          verifySavedSettings();
          if (now() >= deadline || planHash(repairPlan(snapshot, candidates, context.cycle)) !== hash) {
            throw new Error('Approval expired or the proposed repair changed. Source repair stopped.');
          }
          const latest = await profile(config);
          const savedEvent = await request(config, `abhi_deploymentevents(${body.abhi_deploymenteventid})`);
          const approvedFields = ['abhi_runid', 'abhi_eventtype', 'abhi_profilekey', 'abhi_planhash', 'abhi_planjson',
            'abhi_recipients', 'abhi_approvalmode', 'abhi_solutionname', 'abhi_solutionversion', 'abhi_sourceurl', 'abhi_targeturl',
            'abhi_initiatedby', 'abhi_details', 'abhi_errordetails'];
          if (!latest.abhi_enabled || latest.abhi_flowuserid !== row.abhi_flowuserid || latest.mode !== row.mode ||
              latest.approvers.join(';') !== row.approvers.join(';') ||
              approvedFields.some(field => (savedEvent[field] ?? '') !== (body[field] ?? '')) ||
              Date.parse(savedEvent.abhi_expireson) !== deadline) {
            throw new Error('Approval configuration or request changed. Request a new approval before repair.');
          }
        }
        await verifyCurrentRequest();
        report('approval', 'done', 100, 'Dependency plan approved. Adding the approved components and retrying.');
        return { eventId: body.abhi_deploymenteventid, planHash: hash, approvalId: decision.abhi_approvalid, expiresOn: body.abhi_expireson,
          assertValid: verifyCurrentRequest };
      }
      await wait(Math.min(15000, Math.max(1, deadline - now())));
    }
    report('approval', 'error', null, 'Approval timed out. Source dependencies were not added.');
    throw new Error('Dependency approval timed out. Request a new approval to retry.');
  }

  async function setupStatus() {
    const config = settings(getSettings().deploymentAutomation);
    const pending = pendingFiles().length;
    if (!config.enabled) return { ok: true, enabled: false, pending };
    if (!config.environmentUrl) return { ok: true, enabled: true, pending, targetDefault: true,
      deferred: true, message: 'Reporting and approval setup will use the selected deployment target. Install and configure PowerApps Helper Setup there before deploying.' };
    const row = await profile(config);
    return { ok: true, enabled: true, pending, targetDefault: config.reportingDestination === 'target', profileEnabled: row.abhi_enabled, profileId: row.abhi_deploymentprofileid,
      approvalReady: !!(row.abhi_enabled && row.approvers.length && GUID.test(row.abhi_flowuserid || '')), recipients: row.successRecipients,
      // This verifies Dataverse access only. It does not claim that a flow or mail connection is running.
      setupUrl: config.environmentUrl.replace('.api.crm', '.crm') + '/main.aspx?appname=abhi_PowerAppsHelperSetup' };
  }

  return { recordOutcome, requestApproval, flush, setupStatus };
}

module.exports = { createDeploymentAutomation, settings, deploymentConfig, environmentUrl, emails, redact, repairPlan, planHash, eventId, EVENT, DEFAULTS };
