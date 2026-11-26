'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { settings, safeText } = require('./teamsNotifications');
const VERSION = '1.1.0';
const descriptorPath = userData => path.join(userData, 'powerapps-helper', 'teams-bridge.json');

function text(value, name, required = false, max = 500) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`Enter a valid ${name}.`);
  const cleaned = safeText(value, max);
  if (required && !cleaned.trim()) throw new Error(`Enter a valid ${name}.`);
  return cleaned;
}

function validateCommand(command) {
  const fields = {
    status: [],
    begin: ['externalKey', 'solution', 'version', 'sourceEnv', 'targetEnv', 'notifications'],
    update: ['runId', 'stage', 'percent', 'message'],
    finish: ['runId', 'outcome', 'message']
  };
  if (!command || typeof command !== 'object' || Array.isArray(command) ||
      !Object.hasOwn(fields, command.action) ||
      Object.keys(command).some(key => key !== 'action' && !fields[command.action].includes(key))) {
    throw new Error('Invalid Teams connector request or unsupported fields.');
  }
  if (command.notifications !== undefined) {
    const choices = command.notifications;
    const booleans = ['enabled', 'started', 'progress', 'success', 'failure'];
    if (!choices || typeof choices !== 'object' || Array.isArray(choices) ||
        Object.keys(choices).some(key => ![...booleans, 'recipients', 'groupLink', 'channelLink', 'intervalMinutes'].includes(key)) ||
        booleans.some(key => Object.hasOwn(choices, key) && typeof choices[key] !== 'boolean') ||
        ['recipients', 'groupLink', 'channelLink'].some(key => Object.hasOwn(choices, key) && typeof choices[key] !== 'string') ||
        (Object.hasOwn(choices, 'intervalMinutes') && !Number.isInteger(choices.intervalMinutes))) {
      throw new Error('Invalid Teams notification choices.');
    }
  }
}

async function startBridge({ userDataPath, credentials, teams, auth, getSettings }) {
  let server;
  let bearer = '';
  let busy = false;
  const descriptor = descriptorPath(userDataPath);
  async function dispatch(command) {
    validateCommand(command);
    if (!getSettings().teamsNotifications?.codexEnabled || !getSettings().teamsNotifications?.enabled) {
      throw new Error('Enable Teams notifications and optional Codex access in PowerApps Helper Settings.');
    }
    if (command.action === 'status') return { runs: teams.list(), workflow: teams.workflowStatus() };
    if (command.action === 'begin') {
      const current = await auth.status();
      if (!current.account) throw new Error('Sign in to Microsoft in PowerApps Helper.');
      const key = text(command.externalKey, 'external deployment key', true, 200);
      const config = settings({ ...getSettings().teamsNotifications, ...command.notifications });
      teams.assertReady(config);
      const snapshot = {
        // Repeated begin calls with the same correlation key cannot send twice in this app session.
        runId: crypto.createHash('sha256').update(`Codex:${current.account.homeAccountId}:${key}`).digest('hex'),
        accountId: current.account.homeAccountId, account: current.account.username,
        solutionUniqueName: text(command.solution, 'solution name', true, 150),
        version: text(command.version, 'version', false, 50),
        sourceEnv: text(command.sourceEnv, 'source environment', false, 150),
        targetEnv: text(command.targetEnv, 'target environment', true, 150)
      };
      snapshot.signature = crypto.createHash('sha256').update(JSON.stringify({ snapshot, config })).digest('hex');
      if (teams.list().filter(r => r.origin === 'Codex' && !r.closed && !r.cancelled).length >= 20 && !teams.get(snapshot.runId)) {
        throw new Error('Finish an existing Codex notification session before starting another.');
      }
      teams.start(snapshot, config, 'Codex');
      return teams.get(snapshot.runId);
    }
    const id = text(command.runId, 'notification run ID', true, 100);
    const run = teams.get(id);
    if (!run || run.origin !== 'Codex') throw new Error('This Codex notification session was not found.');
    if (command.action === 'finish') {
      if (!['success', 'failure'].includes(command.outcome)) throw new Error('Choose success or failure.');
      return teams.finish(id, { ok: command.outcome === 'success',
        warning: command.outcome === 'success' ? text(command.message, 'message') : '',
        error: command.outcome === 'failure' ? text(command.message, 'message') : '' });
    }
    if (command.action === 'update') {
      if (run.closed || run.cancelled) throw new Error('This notification session has finished or been disabled. Use a new unique deployment key to restart reporting.');
      if (command.percent !== undefined && (!Number.isFinite(command.percent) || command.percent < 0 || command.percent > 100)) {
        throw new Error('Progress must be a number from 0 to 100.');
      }
      teams.update(id, text(command.stage, 'stage', true, 80), 'running', command.percent, text(command.message, 'message'));
      return teams.get(id);
    }
    throw new Error('Unknown Teams connector action.');
  }
  async function configure() {
    if (busy) throw new Error('Teams connector configuration is already changing.');
    busy = true;
    try {
      if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); server = null; }
      if (fs.existsSync(descriptor)) fs.unlinkSync(descriptor);
      if (!getSettings().teamsNotifications?.codexEnabled || !getSettings().teamsNotifications?.enabled) return { enabled: false };
      bearer = credentials.get('teamsCodex');
      if (!bearer) { bearer = crypto.randomBytes(32).toString('hex'); credentials.save('teamsCodex', bearer); }
      server = http.createServer(async (req, res) => {
        const reply = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
        const supplied = String(req.headers.authorization || '').replace(/^Bearer /, '');
        const expected = Buffer.from(bearer);
        const actual = Buffer.from(supplied);
        if (req.headers.origin || !/^127\.0\.0\.1:\d+$/.test(req.headers.host || '') ||
            actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
          req.resume(); reply(403, { error: 'Teams connector access denied.' }); return;
        }
        if (req.method !== 'POST' || req.url !== '/teams') { req.resume(); reply(404, { error: 'Unknown connector route.' }); return; }
        const chunks = []; let size = 0;
        try {
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 16000) { reply(413, { error: 'Teams connector message is too large.' }); req.destroy(); return; }
            chunks.push(chunk);
          }
          const command = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!command || typeof command !== 'object' || Array.isArray(command)) throw new Error('Invalid connector request.');
          reply(200, { ok: true, result: await dispatch(command) });
        } catch (error) { reply(400, { ok: false, error: safeText(error.message) }); }
      });
      server.requestTimeout = 10000; server.headersTimeout = 10000;
      server.maxConnections = 16;
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      fs.writeFileSync(descriptor, JSON.stringify({ version: VERSION, port: server.address().port }), { mode: 0o600 });
      return { enabled: true };
    } catch {
      if (server) { server.close(); server.closeAllConnections(); server = null; }
      try { fs.unlinkSync(descriptor); } catch {}
      throw new Error('Optional Codex connection could not start. Check secure OS credential storage and save Teams settings again.');
    } finally { busy = false; }
  }
  function dispose() {
    if (server) { server.close(); server.closeAllConnections(); }
    try { fs.unlinkSync(descriptor); } catch {}
  }
  return { configure, dispose, status: () => ({ enabled: !!server?.listening, version: VERSION }) };
}

// A second, headless Electron process can use OS encryption to read the bearer.
// The Codex configuration needs only an executable and args, never a service secret.
async function runStdio({ app, userDataPath, credentials }) {
  const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
  const propertyText = { type: 'string', maxLength: 500 };
  const tool = (name, description, properties, required, readOnlyHint = false) => ({ name, description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
    annotations: { readOnlyHint, destructiveHint: false, idempotentHint: true, openWorldHint: true } });
  const tools = [
    tool('teams_deployment_status', 'Read notification delivery status while PowerApps Helper is open.', {}, [], true),
    tool('teams_deployment_begin', 'Start reporting a deployment to Teams. Only use people, group chat and channel authorized by the user. This reports notifications; it does not deploy a solution.', {
      externalKey: { type: 'string', maxLength: 200 }, solution: { type: 'string', maxLength: 150 },
      version: { type: 'string', maxLength: 50 }, sourceEnv: { type: 'string', maxLength: 150 }, targetEnv: { type: 'string', maxLength: 150 },
      notifications: { type: 'object', additionalProperties: false, properties: {
        enabled: { type: 'boolean' }, recipients: { type: 'string', maxLength: 6000 }, groupLink: { type: 'string', maxLength: 4000 }, channelLink: { type: 'string', maxLength: 4000 },
        intervalMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
        started: { type: 'boolean' }, progress: { type: 'boolean' }, success: { type: 'boolean' }, failure: { type: 'boolean' }
      } }
    }, ['externalKey', 'solution', 'targetEnv']),
    tool('teams_deployment_update', 'Update the latest deployment stage. Teams progress messages follow the session interval. Report observed progress; do not infer a successful import.', {
      runId: { type: 'string', maxLength: 100 }, stage: { type: 'string', maxLength: 80 }, percent: { type: 'number', minimum: 0, maximum: 100 }, message: propertyText
    }, ['runId', 'stage']),
    tool('teams_deployment_finish', 'Report observed deployment success or failure immediately and stop periodic updates. Use this when the deployment finishes or is cancelled.', {
      runId: { type: 'string', maxLength: 100 }, outcome: { type: 'string', enum: ['success', 'failure'] }, message: propertyText
    }, ['runId', 'outcome'])
  ];
  const names = { teams_deployment_status: 'status', teams_deployment_begin: 'begin', teams_deployment_update: 'update', teams_deployment_finish: 'finish' };
  const server = new Server({ name: 'powerapps-helper-teams', version: VERSION }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      if (!Object.hasOwn(names, request.params.name)) throw new Error('Unknown Teams connector tool.');
      const args = request.params.arguments ?? {};
      if (typeof args !== 'object' || Array.isArray(args) || Object.hasOwn(args, 'action')) {
        throw new Error('Invalid Teams connector tool arguments.');
      }
      const command = { ...args, action: names[request.params.name] };
      validateCommand(command);
      const descriptor = JSON.parse(fs.readFileSync(descriptorPath(userDataPath), 'utf8'));
      if (descriptor.version !== VERSION) throw new Error('Restart PowerApps Helper and reconnect Codex using the current connection details.');
      if (!Number.isInteger(descriptor.port) || descriptor.port < 1 || descriptor.port > 65535) throw new Error('Invalid connector port.');
      const bearer = credentials.get('teamsCodex');
      if (!bearer) throw new Error('Enable optional Codex access in PowerApps Helper Settings.');
      const response = await fetch(`http://127.0.0.1:${descriptor.port}/teams`, { method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command), signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Teams connector request failed.');
      return { content: [{ type: 'text', text: JSON.stringify(result.result) }] };
    } catch (error) {
      const message = error.code || error.name === 'TimeoutError' || error.name === 'TypeError'
        ? 'Teams connector is unavailable. Keep PowerApps Helper open, sign in, enable Teams and Codex in Settings, and check delivery status there.'
        : safeText(error.message);
      return { isError: true, content: [{ type: 'text', text: message }] };
    }
  });
  await server.connect(new StdioServerTransport());
  process.stdin.once('end', () => app.quit());
}

module.exports = { VERSION, startBridge, runStdio };
