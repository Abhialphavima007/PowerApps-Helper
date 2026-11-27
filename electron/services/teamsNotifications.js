'use strict';

const crypto = require('crypto');
const workflow = require('./teamsWorkflow');
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = ['User.Read', 'User.ReadBasic.All', 'Chat.Create', 'ChatMessage.Send', 'ChannelMessage.Send'];
const DEFAULTS = Object.freeze({ enabled: false, transport: 'workflow', recipients: '', groupLink: '', channelLink: '', intervalMinutes: 5,
  started: true, progress: true, success: true, failure: true, codexEnabled: false });

function teamsLink(link, kind) {
  let url;
  try { url = new URL(link); } catch { throw new Error(`Paste a Teams ${kind} link copied from Teams.`); }
  if (url.protocol !== 'https:' || url.hostname !== 'teams.microsoft.com' || url.username || url.password ||
      url.port || url.hash || /[\u0000-\u0020\u007f]/.test(link)) {
    throw new Error(`Use a valid https://teams.microsoft.com ${kind} link.`);
  }
  return url;
}

function parseGroup(link) {
  if (!link) return null;
  const url = teamsLink(link, 'group chat');
  const match = url.pathname.match(/^\/l\/chat\/([^/]+)(?:\/conversations)?\/?$/);
  let chatId;
  try { chatId = match && decodeURIComponent(match[1]); } catch {}
  if (!/^19:[A-Za-z0-9_-]{1,400}@thread\.v2$/.test(chatId || '')) {
    throw new Error('Use Copy link to chat for an existing Teams group chat.');
  }
  return { chatId };
}

function parseChannel(link) {
  if (!link) return null;
  const url = teamsLink(link, 'channel');
  const match = url.pathname.match(/^\/l\/channel\/([^/]+)\//);
  const teamId = url.searchParams.get('groupId');
  if (!match || url.searchParams.getAll('groupId').length !== 1 ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(teamId || '')) {
    throw new Error('Use a teams.microsoft.com channel link containing its groupId.');
  }
  let channelId;
  try { channelId = decodeURIComponent(match[1]); } catch { throw new Error('The Teams channel link contains an invalid channel ID. Copy the link again.'); }
  if (!/^19:[A-Za-z0-9_-]{1,400}@thread\.(?:skype|tacv2)$/.test(channelId || '')) {
    throw new Error('Copy a valid Teams channel link again.');
  }
  return { teamId: teamId.toLowerCase(), channelId };
}

function settings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Teams notification settings.');
  const config = { ...DEFAULTS };
  config.transport = value.transport ?? DEFAULTS.transport;
  if (!['workflow', 'graph'].includes(config.transport)) throw new Error('Choose Teams Workflow or direct Microsoft connection.');
  config.workflowRouting = value.workflowRouting ?? 'fixed';
  if (!['fixed', 'payload'].includes(config.workflowRouting)) throw new Error('Choose fixed workflow recipients or Helper recipients.');
  for (const key of ['enabled', 'started', 'progress', 'success', 'failure', 'codexEnabled']) {
    if (Object.hasOwn(value, key)) {
      if (typeof value[key] !== 'boolean') throw new Error('Teams notification choices must be on or off.');
      config[key] = value[key];
    }
  }
  config.intervalMinutes = Number(value.intervalMinutes ?? DEFAULTS.intervalMinutes);
  if (!Number.isInteger(config.intervalMinutes) || config.intervalMinutes < 1 || config.intervalMinutes > 1440) {
    throw new Error('Choose a Teams progress interval between 1 and 1440 minutes.');
  }
  const input = value.recipients ?? '';
  if (typeof input !== 'string' || input.length > 6000) throw new Error('Enter Microsoft work sign-in addresses for recipients.');
  const people = [...new Set(input.split(/[;,\s]+/).filter(Boolean).map(s => s.toLowerCase()))];
  if (people.length > 20 || people.some(s => s.length > 254 || /[\u0000-\u001f\u007f]/.test(s) ||
      !/^[^@\s<>"'\\/]+@[^@\s<>"'\\/]+\.[^@\s<>"'\\/]+$/.test(s))) {
    throw new Error('Use up to 20 work sign-in addresses, separated by semicolons.');
  }
  config.recipients = people.join('; ');
  if (typeof (value.groupLink ?? '') !== 'string' || (value.groupLink || '').length > 4000) throw new Error('Invalid Teams group chat link.');
  config.groupLink = (value.groupLink || '').trim();
  parseGroup(config.groupLink);
  if (typeof (value.channelLink ?? '') !== 'string' || (value.channelLink || '').length > 4000) throw new Error('Invalid Teams channel link.');
  config.channelLink = (value.channelLink || '').trim();
  parseChannel(config.channelLink);
  if (config.enabled && !people.length && !config.groupLink && !config.channelLink) throw new Error('Choose at least one person, group chat or channel to notify.');
  return config;
}

function safeText(value, limit = 500) {
  return String(value ?? '').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/((?:api[-_]?key|token|secret|password|sig|code)\s*[=:]\s*)[^\s&;,]+/gi, '$1[redacted]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, limit);
}

function createTeamsNotifications({ auth, credentials, getSettings, notify, onStatus = () => {} }) {
  const runs = new Map();
  function readWorkflow() {
    try {
      const value = credentials?.get('teamsWorkflow');
      if (!value) return null;
      const record = JSON.parse(value);
      if (record.version !== 1 || typeof record.routingKey !== 'string') return null;
      if (record.routingMode !== undefined && record.routingMode !== 'payload') return null;
      return { url: workflow.validateEndpoint(record.url), routingKey: record.routingKey, routingMode: record.routingMode || 'fixed' };
    } catch { return null; }
  }
  function workflowStatus(choice = getSettings().teamsNotifications || DEFAULTS) {
    const record = readWorkflow();
    let matches = false;
    try {
      const config = settings(choice);
      matches = !!record && record.routingMode === config.workflowRouting && (record.routingMode === 'payload'
        ? !!(config.recipients || config.groupLink || config.channelLink) : record.routingKey === workflow.routingKey(config, parseChannel, parseGroup));
    } catch {}
    return { configured: !!record, destinationsMatch: matches, deliveryVerified: false,
      ...(record?.routingMode === 'payload' ? { routingMode: 'payload' } : {}) };
  }
  function assertReady(config) {
    config = settings(config);
    if (config.transport !== 'workflow' || !config.enabled) return;
    const state = workflowStatus(config);
    if (!state.configured) throw new Error('Save your Teams workflow address in Settings before enabling notifications.');
    if (!state.destinationsMatch) throw new Error('The workflow destinations changed or its routing mode does not match. For a fixed workflow, update its destinations. Save the matching workflow address in Settings.');
  }
  function saveWorkflow(url, choice, persistSettings) {
    const endpoint = workflow.validateEndpoint(url);
    let config;
    try { config = settings({ ...choice, transport: 'workflow' }); }
    catch { throw workflow.setupError('WORKFLOW_CHOICES_INVALID'); }
    if (!config.recipients && !config.groupLink && !config.channelLink) throw workflow.setupError('WORKFLOW_DESTINATIONS_MISSING');
    let previous;
    try {
      // Retain the previous encrypted-store value only for in-memory recovery.
      if (persistSettings) previous = credentials.get('teamsWorkflow');
      credentials.save('teamsWorkflow', JSON.stringify({ version: 1, url: endpoint,
        routingKey: workflow.routingKey(config, parseChannel, parseGroup), ...(config.workflowRouting === 'payload' ? { routingMode: 'payload' } : {}) }));
    } catch { throw workflow.setupError('WORKFLOW_CREDENTIAL_SAVE_FAILED'); }
    if (persistSettings) {
      try { persistSettings(config); }
      catch {
        try {
          if (previous) credentials.save('teamsWorkflow', previous);
          else credentials.remove('teamsWorkflow');
        } catch {
          for (const run of runs.values()) if (run.config.transport === 'workflow') cancel(run);
          throw workflow.setupError('WORKFLOW_RECOVERY_FAILED');
        }
        throw workflow.setupError('WORKFLOW_SETTINGS_SAVE_FAILED');
      }
    }
    for (const run of runs.values()) if (run.config.transport === 'workflow') cancel(run);
    return workflowStatus(config);
  }
  function removeWorkflow() {
    credentials.remove('teamsWorkflow');
    for (const run of runs.values()) if (run.config.transport === 'workflow') cancel(run);
    return workflowStatus();
  }
  function cancel(run) {
    if (run.cancelled) return;
    run.cancelled = true;
    run.state = 'disabled';
    clearInterval(run.timer);
    run.controller.abort();
    run.workflow = null;
    announce(run);
  }
  function allowed(run) {
    const current = getSettings().teamsNotifications || DEFAULTS;
    if (!current.enabled || (run.origin === 'Codex' && !current.codexEnabled) ||
        (current.transport || DEFAULTS.transport) !== run.config.transport) cancel(run);
    return !run.cancelled;
  }
  async function request(accountId, route, body, interactive = false, run) {
    if (run && !allowed(run)) throw new Error('Teams notifications were disabled.');
    const config = run?.config || settings(getSettings().teamsNotifications || DEFAULTS);
    const scopes = ['User.Read', ...(config.recipients ? ['User.ReadBasic.All', 'Chat.Create'] : []),
      ...(config.recipients || config.groupLink ? ['ChatMessage.Send'] : []),
      ...(config.channelLink ? ['ChannelMessage.Send'] : [])];
    let token;
    if (interactive) token = await auth.getTeamsGraphToken(scopes, accountId, true);
    else {
      let timer;
      try {
        token = await Promise.race([auth.getTeamsGraphToken(scopes, accountId, false),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Teams sign-in check timed out. Reconnect Teams in Settings.')), 15000); timer.unref(); })]);
      } finally { clearTimeout(timer); }
    }
    if (run && !allowed(run)) throw new Error('Teams notifications were disabled.');
    try {
      const timeout = AbortSignal.timeout(15000);
      const response = await fetch(GRAPH + route, { method: body ? 'POST' : 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: run ? AbortSignal.any([timeout, run.controller.signal]) : timeout });
      if (!response.ok) {
        // Graph response bodies can contain tenant data. Report the status without logging them.
        await response.body?.cancel();
        throw new Error(`Teams returned ${response.status}. Check consent, recipient access and channel membership in Settings.`);
      }
      return await response.json();
    } catch (error) {
      if (error.message.startsWith('Teams returned')) throw error;
      throw new Error('Teams request did not complete. Delivery may be uncertain; check Teams before retrying.');
    }
  }
  function checkWorkflow() {
    const config = settings(getSettings().teamsNotifications || DEFAULTS);
    if (config.transport !== 'workflow') {
      throw new Error('Select Workflows bot and save Teams settings before checking workflow setup.');
    }
    assertReady({ ...config, enabled: true });
    return { ok: true, transport: 'workflow', workflow: workflowStatus(config),
      message: 'Workflow setup checked on this computer. No Microsoft sign-in is needed. Check workflow run history to confirm Teams delivery.' };
  }
  // Only the Windows Hello protected IPC handler may expose this address.
  function revealWorkflow() {
    const record = readWorkflow();
    if (!record) throw new Error('No saved workflow address is available to reveal.');
    return record.url;
  }
  async function connect(expectedTransport) {
    const config = settings(getSettings().teamsNotifications || DEFAULTS);
    if (expectedTransport !== undefined && config.transport !== expectedTransport) {
      throw new Error('The Teams sender changed. Refresh Settings and save your selected sender again.');
    }
    if (config.transport === 'workflow') return checkWorkflow();
    const current = await auth.status();
    if (!current.account) throw new Error('Sign in to Microsoft before connecting Teams.');
    const me = await request(current.account.homeAccountId, '/me?$select=id,displayName,userPrincipalName', null, true);
    return { ok: true, transport: 'graph', user: { displayName: me.displayName, username: me.userPrincipalName } };
  }
  function summary(run) {
    return { runId: run.id, origin: run.origin, solution: run.context.solution, version: run.context.version,
      sourceEnv: run.context.sourceEnv, targetEnv: run.context.targetEnv, transport: run.config.transport,
      stage: run.latest.stage, message: run.latest.message, observedAt: run.observedAt,
      outcome: run.outcome, phase: run.context.phase, state: run.state, closed: run.closed, cancelled: run.cancelled, error: run.error,
      sent: run.sent, intervalMinutes: run.config.intervalMinutes, destinations: run.destinations.map(d =>
        ({ name: d.name, state: d.state, sent: d.sent || 0 })), updatedAt: run.updatedAt };
  }
  function announce(run) {
    run.updatedAt = new Date().toISOString();
    try { onStatus(summary(run)); } catch { /* A closed window does not stop delivery. */ }
  }
  function problem(run, error) {
    run.error = safeText(error.message);
    run.state = 'attention';
    if (!run.alerted) {
      run.alerted = true;
      try { notify('Teams notification needs attention', run.error); } catch {}
    }
    announce(run);
  }
  async function prepare(run) {
    const me = run.config.recipients ? await request(run.accountId, '/me?$select=id', null, false, run) : null;
    for (const dest of run.destinations) {
      if (!allowed(run)) return;
      try {
        if (dest.channel) {
          dest.route = `/teams/${encodeURIComponent(dest.channel.teamId)}/channels/${encodeURIComponent(dest.channel.channelId)}/messages`;
        } else if (dest.group) {
          dest.route = `/chats/${encodeURIComponent(dest.group.chatId)}/messages`;
        } else {
          const user = await request(run.accountId, `/users/${encodeURIComponent(dest.name)}?$select=id`, null, false, run);
          if (!user.id || user.id === me.id) throw new Error('Select another Teams user; notifications cannot create a private chat with yourself.');
          const member = id => ({ '@odata.type': '#microsoft.graph.aadUserConversationMember', roles: ['owner'],
            'user@odata.bind': `${GRAPH}/users('${id}')` });
          const chat = await request(run.accountId, '/chats', { chatType: 'oneOnOne', members: [member(me.id), member(user.id)] }, false, run);
          if (!chat.id) throw new Error('Teams did not return a private chat.');
          dest.route = `/chats/${encodeURIComponent(chat.id)}/messages`;
        }
        dest.state = 'ready';
      } catch (error) { if (run.cancelled) return; dest.state = 'failed'; problem(run, error); }
    }
  }
  function message(run, kind, update) {
    const label = update.label || (run.context.phase === 'export'
      ? { started: 'Export started', progress: 'Export progress', success: 'Export ready for review', failure: 'Export failed' }
      : { started: 'Started', progress: 'Progress', success: 'Completed', failure: 'Failed' })[kind];
    const terminal = kind === 'success' || kind === 'failure';
    const eventTime = kind === 'started' ? run.startedAt : terminal ? run.completedAt : Date.now();
    const seconds = Math.max(0, Math.floor((eventTime - run.startedAt) / 1000));
    const elapsed = [seconds >= 3600 ? `${Math.floor(seconds / 3600)}h` : '',
      seconds >= 60 ? `${Math.floor(seconds / 60) % 60}m` : '', `${seconds % 60}s`].filter(Boolean).join(' ');
    const stages = { starting: 'Starting', agent: 'Agent deployment', version: 'Setting solution version',
      export: 'Exporting solution', analyze: 'Inspecting package', store: 'Saving package',
      import: 'Importing solution', publish: 'Publishing target customizations', resolve: 'Resolving dependencies',
      repair: 'Adding missing components', publishsource: 'Publishing source customizations',
      reexport: 'Re-exporting solution', complete: 'Complete', export_ready: 'Export ready for review',
      failed: 'Failed', reporting_stopped: 'Reporting stopped',
      installation: 'Microsoft installation check', authentication: 'Microsoft session check' };
    const stageName = value => Object.hasOwn(stages, value) ? stages[value] : safeText(value, 80);
    const title = `PowerApps Helper — ${safeText(label, 80)}${run.context.queuePosition ? ' · ' + run.context.queuePosition : ''}`;
    const sections = [
      { heading: '1. Solution', fields: [
        ['Name', safeText(run.context.displayName, 100)],
        ['Unique name', safeText(run.context.solution, 100)],
        ['Version', run.context.version || 'Not provided'], ['Type', run.context.solutionType]
      ] },
      { heading: '2. Deployment', fields: [
        ['Operation', run.context.operation],
        run.context.queuePosition && ['Queue order', run.context.queuePosition],
        ['Source', safeText(run.context.sourceEnv || 'Not provided', 100)],
        ['Target', safeText(run.context.targetEnv || 'Not provided', 100)],
        ['Initiator', safeText(run.context.account || 'Not provided', 100)],
        ['Started from', safeText(run.origin, 30)],
        run.context.phase !== 'export' && typeof run.context.overwrite === 'boolean'
          && ['Overwrite unmanaged customizations', run.context.overwrite ? 'Yes' : 'No'],
        run.context.phase !== 'export' && (run.context.solutionType === 'Managed'
          ? ['Publish target customizations', 'Not applicable for managed imports']
          : typeof run.context.publishChanges === 'boolean'
            && ['Publish target customizations', run.context.publishChanges ? 'Yes' : 'No'])
      ].filter(Boolean) },
      { heading: '3. Status', fields: [
        ['Stage', stageName(update.stage || kind)],
        terminal && kind === 'failure' && ['Failed at', stageName(run.resultDetails.phase || run.latest.stage)],
        terminal && run.resultDetails.importCompleted !== undefined && ['Import', run.resultDetails.importCompleted
          ? 'Completed' : run.resultDetails.phase === 'installation' && !run.resultDetails.importJobId
            ? 'Not started' : 'Completion not confirmed'],
        Number.isFinite(update.percent) && ['Stage progress', `${Math.max(0, Math.min(100, update.percent))}%`],
        terminal && run.resultDetails.attempts !== undefined && ['Import attempts', String(run.resultDetails.attempts)],
        terminal && run.resultDetails.repairs !== undefined && ['Dependency components added', String(run.resultDetails.repairs)],
        terminal && run.resultDetails.importJobId && ['Import job', run.resultDetails.importJobId]
      ].filter(Boolean) },
      { heading: '4. Timing', fields: [
        ['Started (UTC)', new Date(run.startedAt).toISOString()],
        terminal && [run.outcome === 'unknown' ? 'Reporting stopped (UTC)' : 'Finished (UTC)', new Date(eventTime).toISOString()],
        !terminal && ['Update time (UTC)', new Date(eventTime).toISOString()],
        kind === 'progress' && ['Last observed update (UTC)', run.observedAt],
        ['Elapsed', elapsed], ['Run', safeText(run.id, 100)]
      ].filter(Boolean) }
    ];
    // Escape values so errors/names cannot introduce headings, links or HTML.
    const markdown = value => String(value).replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]()<>#!|]/g, '\\$&');
    const fieldText = ([name, value]) => `- **${name}:** ${markdown(value)}`;
    const sectionText = section => [`**${section.heading}**`, ...section.fields.map(fieldText)].join('\n');
    const text = () => [markdown(title), ...sections.map(sectionText)].join('\n\n');
    const detailLabel = kind === 'failure' ? 'Error' : 'Update';
    let detail = safeText(update.message, 500);
    // The workflow bounds each section's TextBlock at 2,000 characters.
    const available = Math.max(0, 2000 - sectionText(sections[2]).length - fieldText([detailLabel, '']).length - 1);
    while (detail && markdown(detail).length > available) detail = detail.slice(0, -1);
    if (detail) sections[2].fields.push([detailLabel, detail]);
    return { text: text(), title, sections };
  }
  function enqueue(run, kind, update) {
    if (!run.config.enabled || !run.config[kind] || run.cancelled) return;
    if (kind === 'progress') {
      if (run.closed || run.progressPending) return;
      run.progressPending = true;
    }
    run.chain = run.chain.then(async () => {
      if (kind === 'progress') {
        run.progressPending = false;
        if (run.closed) return;
        update = { ...run.latest };
      }
      if (!allowed(run)) return;
      if (run.config.transport === 'workflow') {
        // A new final event is distinct from an earlier uncertain request.
        // Suppress further periodic requests without retrying the failed event.
        if (run.workflowFailed && kind === 'progress') return;
        try {
          // Keep the version-1 private-only envelope for older Helper installs.
          const extended = !!(run.config.groupLink || run.config.channelLink);
          const helper = run.workflow.routingMode === 'payload' ? { version: extended ? 2 : 1,
            recipients: run.config.recipients.split('; ').filter(Boolean), runId: run.id, event: kind,
            observedAt: run.observedAt, ...(extended ? {
              groupChats: run.destinations.filter(dest => dest.group).map(dest => dest.group.chatId),
              channels: run.destinations.filter(dest => dest.channel).map(dest => dest.channel)
            } : {}) } : undefined;
          await workflow.post(run.workflow.url, message(run, kind, update).text, run.controller.signal, helper);
          if (run.cancelled) return;
          run.sent += 1;
          run.state = 'workflow_accepted';
          run.destinations.forEach(dest => { dest.state = 'delivery_unconfirmed'; });
        } catch (error) {
          if (run.cancelled) return;
          run.workflowFailed = true;
          run.destinations.forEach(dest => { dest.state = 'delivery_unconfirmed'; });
          problem(run, error);
        }
        announce(run);
        return;
      }
      if (!run.prepared) { run.prepared = true; await prepare(run); }
      for (const dest of run.destinations.filter(d => d.state !== 'failed')) {
        if (!allowed(run) || (kind === 'progress' && run.closed)) break;
        try {
          const formatted = message(run, kind, update);
          const html = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
          const content = `<p><strong>${html(formatted.title)}</strong></p>` + formatted.sections.map(section =>
            `<p><strong>${html(section.heading)}</strong></p><ul>` + section.fields.map(([name, value]) =>
              `<li><strong>${html(name)}:</strong> ${html(value)}</li>`).join('') + '</ul>').join('');
          await request(run.accountId, dest.route, { body: { contentType: 'html', content } }, false, run);
          dest.sent = (dest.sent || 0) + 1; dest.state = 'accepted'; run.sent += 1;
        } catch (error) {
          if (run.cancelled) { dest.state = 'uncertain'; announce(run); return; }
          dest.state = 'failed'; problem(run, error);
        }
      }
      if (!run.error && !run.cancelled && run.sent) run.state = 'accepted';
      announce(run);
    }).catch(error => { if (run.cancelled) return; run.destinations.forEach(d => { d.state = 'failed'; }); problem(run, error); });
  }
  function start(snapshot, choice, origin = 'PowerApps Helper') {
    const id = snapshot.runId || crypto.randomUUID();
    if (runs.has(id)) {
      if (runs.get(id).signature !== snapshot.signature) throw new Error('This deployment key already has different notification details. Use a new unique key.');
      return id;
    }
    let config;
    let error;
    try {
      const saved = getSettings().teamsNotifications || DEFAULTS;
      config = settings(choice ?? saved);
      if (!saved.enabled) config.enabled = false;
      if (origin === 'Codex' && !saved.codexEnabled) config.enabled = false;
      // Optional MCP callers cannot select a different transport or callback.
      config.transport = saved.transport || DEFAULTS.transport;
      config.workflowRouting = saved.workflowRouting || 'fixed';
      assertReady(config);
    } catch (e) { config = { ...DEFAULTS }; error = e; }
    const channel = config.channelLink ? parseChannel(config.channelLink) : null;
    const group = config.groupLink ? parseGroup(config.groupLink) : null;
    const startedAt = Date.now();
    const managed = typeof snapshot.exportManaged === 'boolean' ? snapshot.exportManaged : snapshot.analysis?.inspection?.managed;
    const run = { id, origin, config, accountId: snapshot.accountId, signature: snapshot.signature,
      workflow: config.enabled && config.transport === 'workflow' ? readWorkflow() : null,
      context: { solution: safeText(snapshot.solutionUniqueName || snapshot.solution || 'Solution', 150),
        displayName: safeText(snapshot.solution || snapshot.solutionUniqueName || 'Solution', 150),
        solutionType: typeof managed === 'boolean' ? (managed ? 'Managed' : 'Unmanaged') : 'Not provided',
        operation: snapshot.phase === 'export' ? 'Export only — import has not started'
          : snapshot.deploymentMethod === 'agent' ? 'Agent deployment'
            : snapshot.deploymentMethod === 'import' ? 'Solution import' : 'Deployment',
        overwrite: typeof snapshot.overwrite === 'boolean' ? snapshot.overwrite : undefined,
        publishChanges: typeof snapshot.publishChanges === 'boolean' ? snapshot.publishChanges : undefined,
        phase: snapshot.phase === 'export' ? 'export' : 'deployment',
        queuePosition: Number.isInteger(snapshot.queueIndex) && Number.isInteger(snapshot.queueCount) &&
          snapshot.queueIndex >= 0 && snapshot.queueIndex < snapshot.queueCount && snapshot.queueCount <= 100
          ? `Solution ${snapshot.queueIndex + 1} of ${snapshot.queueCount}` : '',
        version: safeText(snapshot.version || snapshot.analysis?.inspection?.version, 50), sourceEnv: safeText(snapshot.sourceEnv, 150),
        targetEnv: safeText(snapshot.targetEnv, 150), account: safeText(snapshot.account, 150) },
      destinations: [...config.recipients.split('; ').filter(Boolean).map(name => ({ name, state: 'pending' })),
        ...(group ? [{ name: 'Existing group chat', group, state: 'pending' }] : []),
        ...(channel ? [{ name: 'Teams channel', channel, state: 'pending' }] : [])],
      chain: Promise.resolve(), latest: { stage: 'starting', message: snapshot.phase === 'export' ? 'Export started. Import has not started.' : 'Deployment started.' },
      controller: new AbortController(), startedAt, lastActivity: startedAt, observedAt: new Date(startedAt).toISOString(), outcome: 'pending',
      state: config.enabled ? 'queued' : 'disabled', sent: 0, error: '', closed: false, cancelled: !config.enabled };
    runs.set(id, run);
    if (error) problem(run, error);
    if (config.enabled && (config.progress || origin === 'Codex')) {
      run.timer = setInterval(() => {
        if (!allowed(run)) return;
        if (origin === 'Codex' && Date.now() - run.lastActivity >= Math.max(30 * 60000, config.intervalMinutes * 120000)) {
          finish(id, { ok: false, stale: true, error: 'Codex stopped reporting progress. The deployment outcome is unknown. Check the deployment tool before continuing.' });
          return;
        }
        enqueue(run, 'progress', { ...run.latest });
      }, config.intervalMinutes * 60000);
      run.timer.unref();
    }
    enqueue(run, 'started', run.latest);
    announce(run);
    // Retain only a bounded set of completed sessions for the status screen.
    for (const [key, old] of runs) {
      if (runs.size <= 100) break;
      if (old.closed || old.cancelled) runs.delete(key);
    }
    return id;
  }
  function update(id, stage, status, percent, text) {
    const run = runs.get(id);
    if (!run || run.closed) return;
    run.lastActivity = Date.now();
    run.observedAt = new Date().toISOString();
    run.latest = { stage: safeText(stage, 80), status: safeText(status, 40), percent, message: safeText(text) };
  }
  function finish(id, result) {
    const run = runs.get(id);
    if (!run || run.closed) return run ? summary(run) : null;
    run.closed = true;
    run.outcome = result.stale ? 'unknown' : result.ok ? 'success' : 'failure';
    run.completedAt = Date.now();
    run.resultDetails = {
      attempts: Array.isArray(result.attempts) ? result.attempts.filter(attempt =>
        attempt?.importJobId || !['installation', 'authentication'].includes(attempt?.phase)).length : undefined,
      repairs: Array.isArray(result.repairs) ? result.repairs.length : undefined,
      phase: safeText(result.phase, 40),
      importCompleted: typeof result.importCompleted === 'boolean' ? result.importCompleted : undefined,
      importJobId: /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result.importJobId || '') ? result.importJobId : ''
    };
    clearInterval(run.timer);
    enqueue(run, result.ok ? 'success' : 'failure', { stage: result.stale ? 'reporting_stopped' : result.ok ? (run.context.phase === 'export' ? 'export_ready' : 'complete') : 'failed',
      label: result.stale ? 'Reporting stopped' : undefined,
      percent: result.ok ? 100 : undefined, message: result.ok
        ? (result.warning ? `Warning: ${result.warning}` : run.context.phase === 'export' ? 'Export is ready for review. Import has not started.' : 'Solution deployment completed.')
        : (result.error || 'Deployment failed.') });
    run.chain = run.chain.finally(() => { run.workflow = null; });
    announce(run);
    return summary(run);
  }
  function configure() { for (const run of runs.values()) allowed(run); }
  function dispose() { for (const run of runs.values()) { cancel(run); run.closed = true; } }
  return { connect, checkWorkflow, revealWorkflow, start, update, finish, configure, dispose, workflowStatus, saveWorkflow, removeWorkflow, assertReady,
    list: () => [...runs.values()].map(summary),
    get: id => runs.has(id) ? summary(runs.get(id)) : null };
}

module.exports = { DEFAULTS, SCOPES, settings, parseChannel, parseGroup, safeText, createTeamsNotifications };
