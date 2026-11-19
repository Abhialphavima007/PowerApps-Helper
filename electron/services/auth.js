'use strict';
// Microsoft sign-in WITHOUT an app registration, with multi-account support.
//
// Two Microsoft first-party PUBLIC clients are used, because Microsoft only lets
// specific first-party clients call specific first-party APIs:
//   • Dataverse / Global Discovery  -> Azure CLI client (04b07795-…)
//   • Microsoft Graph (OneDrive)     -> Microsoft Graph CLI client (14d82eec-…)
// The Azure CLI client is NOT preauthorized for Graph (AADSTS65002), so OneDrive
// uses the Graph CLI client, which is designed to call Graph.
//
// Cancellable browser (loopback + PKCE) and device-code sign-in share the same
// clients and token caches. Tenant consent applies to both methods.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { randomUUID } = require('crypto');
const { shell, safeStorage } = require('electron');
const { PublicClientApplication, CryptoProvider } = require('@azure/msal-node');

const DV_CLIENT_ID = process.env.AZURE_CLIENT_ID || '04b07795-8ddb-461a-bbee-02f9e1bf7b46'; // Azure CLI
const GRAPH_CLIENT_ID = process.env.AZURE_GRAPH_CLIENT_ID || '14d82eec-204b-4c2f-b7e8-296a70dab67e'; // Graph CLI
// Compatibility default: the documented Dataverse CLI/local-proxy client requires
// tenant admin consent. Microsoft's direct /api/mcp setup uses a custom public
// client with Dynamics CRM mcp.tools permission; configure its approved ID here.
const MCP_CLIENT_ID = process.env.DATAVERSE_MCP_CLIENT_ID || '0c412cc3-0dd6-449b-987f-05b053db9457';
const AUTHORITY = process.env.AZURE_AUTHORITY || 'https://login.microsoftonline.com/common';

const GLOBAL_DISCO = 'https://globaldisco.crm.dynamics.com';
const GRAPH = 'https://graph.microsoft.com';

let dvPca; // Dataverse client
let graphPca; // Graph client
let mcpPca; // Environment-hosted Dataverse MCP client
let cryptoProvider;
let dvCacheFile;
let graphCacheFile;
let mcpCacheFile;
let activeFile;
let activeHomeAccountId = null;
let signInMethods = {};
let reportProgress = () => {};
let inflight = null;
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

// ---------- encrypted cache helpers ----------
function encrypt(str) {
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) return safeStorage.encryptString(str);
  } catch {}
  return Buffer.from('PLAIN:' + str, 'utf8');
}
function decrypt(buf) {
  try {
    if (buf.slice(0, 6).toString('utf8') === 'PLAIN:') return buf.slice(6).toString('utf8');
    if (safeStorage && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(buf);
  } catch {}
  return buf.toString('utf8');
}
function cachePlugin(file) {
  return {
    beforeCacheAccess: async (ctx) => {
      try { if (fs.existsSync(file)) ctx.tokenCache.deserialize(decrypt(fs.readFileSync(file))); } catch {}
    },
    afterCacheAccess: async (ctx) => {
      if (ctx.cacheHasChanged) { try { fs.writeFileSync(file, encrypt(ctx.tokenCache.serialize())); } catch {} }
    }
  };
}

function init(userDataPath, onProgress = () => {}) {
  const dir = path.join(userDataPath, 'powerapps-helper');
  fs.mkdirSync(dir, { recursive: true });
  dvCacheFile = path.join(dir, 'msal-cache.bin');
  graphCacheFile = path.join(dir, 'graph-cache.bin');
  mcpCacheFile = path.join(dir, 'mcp-cache.bin');
  activeFile = path.join(dir, 'active-account.json');
  reportProgress = onProgress;
  try {
    if (fs.existsSync(activeFile)) {
      const saved = JSON.parse(fs.readFileSync(activeFile, 'utf8'));
      activeHomeAccountId = saved.homeAccountId || null;
      signInMethods = Object.fromEntries(Object.entries(saved.signInMethods || {}).filter(([, method]) => method === 'browser' || method === 'deviceCode'));
    }
  } catch {}
  dvPca = new PublicClientApplication({ auth: { clientId: DV_CLIENT_ID, authority: AUTHORITY }, cache: { cachePlugin: cachePlugin(dvCacheFile) } });
  graphPca = new PublicClientApplication({ auth: { clientId: GRAPH_CLIENT_ID, authority: AUTHORITY }, cache: { cachePlugin: cachePlugin(graphCacheFile) } });
  mcpPca = new PublicClientApplication({ auth: { clientId: MCP_CLIENT_ID, authority: AUTHORITY }, cache: { cachePlugin: cachePlugin(mcpCacheFile) } });
  cryptoProvider = new CryptoProvider();
}

function persistActive() {
  try { fs.writeFileSync(activeFile, JSON.stringify({ homeAccountId: activeHomeAccountId, signInMethods })); } catch {}
}
function validateMethod(method) {
  if (method !== 'browser' && method !== 'deviceCode') throw new Error('Choose browser or device-code sign-in.');
  return method;
}
function activeSignInMethod() { return signInMethods[activeHomeAccountId] || 'browser'; }
function progress(controller, details) {
  if (inflight !== controller) return;
  try { reportProgress({ requestId: controller.requestId, method: controller.method, ...details }); } catch { /* The sign-in timeout still releases the flow if the window closes. */ }
}
function signInError(error) {
  const code = error?.errorCode;
  if (code === 'device_code_expired' || code === 'expired_token' || code === 'user_timeout_reached') {
    return new Error('Sign-in code expired or timed out. Please try again for a new code.');
  }
  if (code === 'authorization_declined' || code === 'access_denied') {
    return new Error('Microsoft sign-in was declined or blocked by your organization. Device code does not bypass tenant consent or access policies.');
  }
  if (code === 'consent_required' || /AADSTS65001|AADSTS90094|AADSTS90093/i.test(error?.message || '')) {
    return new Error('Your organization requires administrator approval for this Microsoft application. Device-code sign-in requires the same approval.');
  }
  return error;
}
function scopeFor(resourceUrl) {
  return [resourceUrl.replace(/\/+$/, '') + '/.default'];
}

const SUCCESS_HTML =
  '<html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#0f1420;color:#e6ecf7;display:flex;height:100vh;align-items:center;justify-content:center"><div style="text-align:center"><h2>✔ Signed in</h2><p>You can close this tab and return to PowerApps Helper.</p></div></body></html>';
const FAIL_HTML = (m) =>
  `<html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#0f1420;color:#e6ecf7;display:flex;height:100vh;align-items:center;justify-content:center"><div style="text-align:center"><h2>Sign-in problem</h2><p>${String(m).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])}</p><p>Return to PowerApps Helper and try again.</p></div></body></html>`;

function cancelSignIn() {
  if (inflight) {
    const c = inflight;
    progress(c, { stage: 'finished' });
    inflight = null;
    if (c.deviceRequest) c.deviceRequest.cancel = true;
    try { if (c.timeout) clearTimeout(c.timeout); } catch {}
    try { if (c.server) c.server.close(); } catch {}
    c.reject(new Error('Sign-in cancelled.'));
  }
  return { ok: true };
}

// Manual, cancellable loopback interactive sign-in for a given client (pca).
async function interactiveLogin(pca, scopes, loginHint) {
  cancelSignIn();
  const server = http.createServer();
  const controller = { server, requestId: randomUUID(), method: 'browser' };
  const cancelled = new Promise((_, reject) => { controller.reject = reject; });
  inflight = controller;
  progress(controller, { stage: 'started', loginHint });
  try {
    controller.timeout = setTimeout(() => controller.reject(new Error('Sign-in timed out. Please try again.')), SIGN_IN_TIMEOUT_MS);
    const { verifier, challenge } = await Promise.race([cryptoProvider.generatePkceCodes(), cancelled]);
    await Promise.race([new Promise((res, rej) => {
      server.once('error', rej);
      server.listen(0, '127.0.0.1', res);
    }), cancelled]);
    if (inflight !== controller) throw new Error('Sign-in cancelled.');
    const port = server.address().port;
    const redirectUri = `http://localhost:${port}`;
    const authUrl = await Promise.race([pca.getAuthCodeUrl({
      scopes,
      redirectUri,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      prompt: loginHint ? undefined : 'select_account',
      loginHint
    }), cancelled]);
    if (inflight !== controller) throw new Error('Sign-in cancelled.');
    const result = await Promise.race([new Promise((resolve, reject) => {
      server.on('request', async (req, res) => {
        try {
          const u = new URL(req.url, redirectUri);
          if (u.pathname === '/favicon.ico') { res.statusCode = 204; return res.end(); }
          const err = u.searchParams.get('error');
          const code = u.searchParams.get('code');
          if (err) {
            res.end(FAIL_HTML(err));
            return reject(new Error(u.searchParams.get('error_description') || err));
          }
          if (!code) { res.end('Waiting for sign-in…'); return; }
          const token = await pca.acquireTokenByCode({ code, scopes, redirectUri, codeVerifier: verifier });
          res.end(SUCCESS_HTML);
          resolve(token);
        } catch (e) {
          if (!res.writableEnded) res.end(FAIL_HTML('Authentication could not be completed.'));
          reject(e);
        }
      });
      shell.openExternal(authUrl).catch(reject);
    }), cancelled]);
    return result;
  } catch (error) {
    throw signInError(error);
  } finally {
    try { if (controller.timeout) clearTimeout(controller.timeout); } catch {}
    try { server.close(); } catch {}
    if (inflight === controller) {
      progress(controller, { stage: 'finished' });
      inflight = null;
    }
  }
}

async function deviceCodeLogin(pca, scopes, loginHint) {
  cancelSignIn();
  const controller = { requestId: randomUUID(), method: 'deviceCode' };
  const cancelled = new Promise((_, reject) => { controller.reject = reject; });
  const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
  controller.deviceRequest = {
    scopes,
    timeout: SIGN_IN_TIMEOUT_MS / 1000,
    cancel: false,
    deviceCodeCallback: (response) => {
      if (inflight !== controller) { controller.deviceRequest.cancel = true; return; }
      if (!response.userCode || !Number.isFinite(response.expiresIn) || response.expiresIn <= 0) {
        throw new Error('Microsoft did not return a valid sign-in code. Please try again.');
      }
      const uri = new URL(response.verificationUri);
      if (uri.protocol !== 'https:' || uri.username || uri.password ||
          !['microsoft.com', 'www.microsoft.com', 'login.microsoft.com', 'login.microsoftonline.com'].includes(uri.hostname)) {
        throw new Error('Microsoft returned an unsupported device-code verification address.');
      }
      // Send only the user-facing code. The device credential and tokens stay in main.
      progress(controller, {
        stage: 'code', userCode: response.userCode, verificationUri: uri.href,
        expiresAt: Math.min(deadline, Date.now() + response.expiresIn * 1000), loginHint
      });
    }
  };
  inflight = controller;
  progress(controller, { stage: 'started', loginHint });
  controller.timeout = setTimeout(() => {
    controller.deviceRequest.cancel = true;
    controller.reject(new Error('Sign-in timed out. Please try again for a new code.'));
  }, SIGN_IN_TIMEOUT_MS);
  try {
    const knownAccounts = new Set((await Promise.race([pca.getTokenCache().getAllAccounts(), cancelled])).map((account) => account.homeAccountId));
    if (inflight !== controller || controller.deviceRequest.cancel) throw new Error('Sign-in cancelled.');
    const result = await Promise.race([pca.acquireTokenByDeviceCode(controller.deviceRequest), cancelled]);
    if (inflight !== controller || controller.deviceRequest.cancel) throw new Error('Sign-in cancelled.');
    if (!result?.account || !result.accessToken) throw new Error('Microsoft did not complete sign-in. Please try again.');
    if (loginHint && result.account.username?.toLowerCase() !== loginHint.toLowerCase()) {
      if (!knownAccounts.has(result.account.homeAccountId)) await pca.getTokenCache().removeAccount(result.account);
      throw new Error('Sign-in used a different account. Retry with ' + loginHint + '.');
    }
    return result;
  } catch (error) {
    throw signInError(error);
  } finally {
    controller.deviceRequest.cancel = true;
    clearTimeout(controller.timeout);
    if (inflight === controller) {
      progress(controller, { stage: 'finished' });
      inflight = null;
    }
  }
}

function login(pca, scopes, loginHint, method = activeSignInMethod()) {
  return validateMethod(method) === 'deviceCode'
    ? deviceCodeLogin(pca, scopes, loginHint)
    : interactiveLogin(pca, scopes, loginHint);
}

// ---------- accounts (Dataverse client is the source of truth) ----------
function mapAcct(a) {
  return { username: a.username, name: a.name || a.username, tenantId: a.tenantId, homeAccountId: a.homeAccountId, active: a.homeAccountId === activeHomeAccountId, signInMethod: signInMethods[a.homeAccountId] || 'browser' };
}
async function allAccounts() {
  return dvPca.getTokenCache().getAllAccounts();
}
async function listAccounts() {
  return (await allAccounts()).map(mapAcct);
}
async function getActiveAccount() {
  const a = await allAccounts();
  if (!a.length) return null;
  let acc = a.find((x) => x.homeAccountId === activeHomeAccountId) || a[0];
  if (activeHomeAccountId !== acc.homeAccountId) { activeHomeAccountId = acc.homeAccountId; persistActive(); }
  return acc;
}
async function addAccount({ method = 'browser' } = {}) {
  validateMethod(method);
  const r = await login(dvPca, scopeFor(GLOBAL_DISCO), undefined, method);
  activeHomeAccountId = r.account.homeAccountId;
  signInMethods[activeHomeAccountId] = method;
  persistActive();
  return mapAcct(r.account);
}
async function setSignInMethod(method) {
  validateMethod(method);
  if (inflight) throw new Error('Finish or cancel sign-in before changing its method.');
  const account = await getActiveAccount();
  if (!account) throw new Error('Connect an account before changing its sign-in method.');
  signInMethods[account.homeAccountId] = method;
  persistActive();
  return { ok: true, account: mapAcct(account) };
}
async function setActive(homeAccountId) {
  activeHomeAccountId = homeAccountId;
  persistActive();
  const a = await getActiveAccount();
  return { ok: true, account: a ? mapAcct(a) : null };
}
async function signOut(homeAccountId) {
  const removed = (await allAccounts()).filter((a) => !homeAccountId || a.homeAccountId === homeAccountId);
  for (const account of removed) delete signInMethods[account.homeAccountId];
  const cache = dvPca.getTokenCache();
  const accts = await cache.getAllAccounts();
  for (const a of accts) if (!homeAccountId || a.homeAccountId === homeAccountId) await cache.removeAccount(a);
  try {
    const mcpCache = mcpPca.getTokenCache();
    for (const mcpAccount of await mcpCache.getAllAccounts()) {
      if (removed.some((a) => a.username?.toLowerCase() === mcpAccount.username?.toLowerCase())) await mcpCache.removeAccount(mcpAccount);
    }
  } catch {}
  if (!homeAccountId || homeAccountId === activeHomeAccountId) {
    const rest = await cache.getAllAccounts();
    activeHomeAccountId = rest[0] ? rest[0].homeAccountId : null;
    persistActive();
  }
  if (!(await cache.getAllAccounts()).length) {
    try { if (fs.existsSync(dvCacheFile)) fs.unlinkSync(dvCacheFile); } catch {}
    // Also clear Graph tokens on full sign-out.
    try {
      const gc = graphPca.getTokenCache();
      for (const a of await gc.getAllAccounts()) await gc.removeAccount(a);
      if (fs.existsSync(graphCacheFile)) fs.unlinkSync(graphCacheFile);
    } catch {}
    try { if (fs.existsSync(mcpCacheFile)) fs.unlinkSync(mcpCacheFile); } catch {}
  }
  persistActive();
  return { ok: true };
}
async function status() {
  const active = await getActiveAccount();
  const accounts = await listAccounts();
  return { signedIn: !!active, account: active ? mapAcct(active) : null, accounts, clientId: DV_CLIENT_ID };
}

// ---------- Dataverse tokens ----------
async function getToken(resourceUrl) {
  const scopes = scopeFor(resourceUrl);
  const account = await getActiveAccount();
  if (account) {
    try { return (await dvPca.acquireTokenSilent({ account, scopes })).accessToken; } catch {}
  }
  const r = await login(dvPca, scopes, account ? account.username : undefined);
  activeHomeAccountId = r.account.homeAccountId;
  persistActive();
  return r.accessToken;
}

async function getMcpToken(resourceUrl) {
  const active = await getActiveAccount();
  if (!active) throw new Error('Sign in to a Microsoft account before using the deployment agent.');
  const scopes = scopeFor(resourceUrl);
  const matches = (await mcpPca.getTokenCache().getAllAccounts()).filter(
    (item) => item.username?.toLowerCase() === active.username?.toLowerCase()
  );
  for (const account of matches) {
    try { return (await mcpPca.acquireTokenSilent({ account, scopes })).accessToken; } catch {}
  }
  const result = await login(mcpPca, scopes, active.username);
  if (result.account?.username?.toLowerCase() !== active.username?.toLowerCase()) {
    throw new Error('The Dataverse MCP sign-in used a different account. Retry with the active PowerApps Helper account.');
  }
  return result.accessToken;
}

// ---------- Graph tokens (OneDrive) ----------
async function graphAccountMatchingActive() {
  const a = await graphPca.getTokenCache().getAllAccounts();
  if (!a.length) return null;
  const active = await getActiveAccount();
  if (active) {
    const m = a.find((x) => (x.username || '').toLowerCase() === (active.username || '').toLowerCase());
    if (m) return m;
  }
  return a[0];
}
async function getGraphToken(scopes) {
  const acc = await graphAccountMatchingActive();
  if (acc) {
    try { return (await graphPca.acquireTokenSilent({ account: acc, scopes })).accessToken; } catch {}
  }
  const active = await getActiveAccount();
  const r = await login(graphPca, scopes, active ? active.username : undefined);
  return r.accessToken;
}

module.exports = {
  init,
  cancelSignIn,
  addAccount,
  listAccounts,
  setActive,
  setSignInMethod,
  signOut,
  status,
  getToken,
  getMcpToken,
  getGraphToken,
  GLOBAL_DISCO,
  GRAPH
};
