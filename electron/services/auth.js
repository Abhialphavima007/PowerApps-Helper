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
// Manual, cancellable loopback auth-code + PKCE flow lets us time out / cancel a
// sign-in so the login button always works again on retry.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { shell, safeStorage } = require('electron');
const { PublicClientApplication, CryptoProvider } = require('@azure/msal-node');

const DV_CLIENT_ID = process.env.AZURE_CLIENT_ID || '04b07795-8ddb-461a-bbee-02f9e1bf7b46'; // Azure CLI
const GRAPH_CLIENT_ID = process.env.AZURE_GRAPH_CLIENT_ID || '14d82eec-204b-4c2f-b7e8-296a70dab67e'; // Graph CLI
const MCP_CLIENT_ID = process.env.DATAVERSE_MCP_CLIENT_ID || '0c412cc3-0dd6-449b-987f-05b053db9457'; // Microsoft Dataverse MCP CLI client
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
let inflight = null;

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

function init(userDataPath) {
  const dir = path.join(userDataPath, 'powerapps-helper');
  dvCacheFile = path.join(dir, 'msal-cache.bin');
  graphCacheFile = path.join(dir, 'graph-cache.bin');
  mcpCacheFile = path.join(dir, 'mcp-cache.bin');
  activeFile = path.join(dir, 'active-account.json');
  try {
    if (fs.existsSync(activeFile)) activeHomeAccountId = JSON.parse(fs.readFileSync(activeFile, 'utf8')).homeAccountId || null;
  } catch {}
  dvPca = new PublicClientApplication({ auth: { clientId: DV_CLIENT_ID, authority: AUTHORITY }, cache: { cachePlugin: cachePlugin(dvCacheFile) } });
  graphPca = new PublicClientApplication({ auth: { clientId: GRAPH_CLIENT_ID, authority: AUTHORITY }, cache: { cachePlugin: cachePlugin(graphCacheFile) } });
  mcpPca = new PublicClientApplication({ auth: { clientId: MCP_CLIENT_ID, authority: AUTHORITY }, cache: { cachePlugin: cachePlugin(mcpCacheFile) } });
  cryptoProvider = new CryptoProvider();
}

function persistActive() {
  try { fs.writeFileSync(activeFile, JSON.stringify({ homeAccountId: activeHomeAccountId })); } catch {}
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
    inflight = null;
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
  const controller = { server };
  const cancelled = new Promise((_, reject) => { controller.reject = reject; });
  inflight = controller;
  try {
    controller.timeout = setTimeout(() => controller.reject(new Error('Sign-in timed out. Please try again.')), 5 * 60 * 1000);
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
  } finally {
    try { if (controller.timeout) clearTimeout(controller.timeout); } catch {}
    try { server.close(); } catch {}
    if (inflight === controller) inflight = null;
  }
}

// ---------- accounts (Dataverse client is the source of truth) ----------
function mapAcct(a) {
  return { username: a.username, name: a.name || a.username, tenantId: a.tenantId, homeAccountId: a.homeAccountId, active: a.homeAccountId === activeHomeAccountId };
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
async function addAccount() {
  const r = await interactiveLogin(dvPca, scopeFor(GLOBAL_DISCO));
  activeHomeAccountId = r.account.homeAccountId;
  persistActive();
  return mapAcct(r.account);
}
async function setActive(homeAccountId) {
  activeHomeAccountId = homeAccountId;
  persistActive();
  const a = await getActiveAccount();
  return { ok: true, account: a ? mapAcct(a) : null };
}
async function signOut(homeAccountId) {
  const removed = (await allAccounts()).filter((a) => !homeAccountId || a.homeAccountId === homeAccountId);
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
  const r = await interactiveLogin(dvPca, scopes, account ? account.username : undefined);
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
  const result = await interactiveLogin(mcpPca, scopes, active.username);
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
  const r = await interactiveLogin(graphPca, scopes, active ? active.username : undefined);
  return r.accessToken;
}

module.exports = {
  init,
  cancelSignIn,
  addAccount,
  listAccounts,
  setActive,
  signOut,
  status,
  getToken,
  getMcpToken,
  getGraphToken,
  GLOBAL_DISCO,
  GRAPH
};
