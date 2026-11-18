'use strict';

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const auth = require('./auth');

function sourceOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Choose a valid source environment before using the deployment agent.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.toLowerCase().endsWith('.dynamics.com')) {
    throw new Error('The Microsoft Dataverse MCP connection requires an HTTPS Dynamics environment URL.');
  }
  return url.origin;
}

async function timed(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
    ]);
  } finally { clearTimeout(timer); }
}

async function withSourceMcp(sourceUrl, action) {
  const origin = sourceOrigin(sourceUrl);
  // The environment-hosted endpoint requires its own allowed client application.
  // The token belongs to the active PowerApps Helper user, not a CLI profile.
  const token = await auth.getMcpToken(origin);
  const transport = new StreamableHTTPClientTransport(new URL(origin + '/api/mcp'), {
    requestInit: { headers: { Authorization: 'Bearer ' + token } }
  });
  const client = new Client({ name: 'powerapps-helper-deployment-agent', version: require('../../package.json').version }, { capabilities: {} });
  try {
    await timed(client.connect(transport), 45000, 'The source environment MCP connection timed out.');
    const listed = await timed(client.listTools(), 30000, 'The source environment MCP endpoint did not list tools.');
    return await action({
      origin, tools: listed.tools || [],
      callTool: (name, args) => timed(client.callTool({ name, arguments: args }), 60000, 'Dataverse MCP tool ' + name + ' timed out.')
    });
  } catch (error) {
    if (/^401|^403|Unauthorized|Forbidden/i.test(error.message)) {
      throw new Error('The source environment denied the MCP connection. Ask your tenant and environment admins to grant consent, enable the MCP endpoint, and allow the Dataverse MCP client.');
    }
    if (/404|Not Found/i.test(error.message)) {
      throw new Error('The source environment MCP endpoint was not found. Ask an environment admin to enable Microsoft Dataverse MCP.');
    }
    throw error;
  } finally {
    try { await client.close(); } catch {}
    try { await transport.close(); } catch {}
  }
}

module.exports = { sourceOrigin, withSourceMcp };
