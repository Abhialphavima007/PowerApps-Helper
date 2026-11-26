const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const account = { homeAccountId: 'synthetic-account', username: 'person@example.com', tenantId: 'synthetic-tenant' };
const resource = 'https://synthetic.crm.dynamics.com';
const response = {
  userCode: 'TEST-CODE', verificationUri: 'https://microsoft.com/devicelogin',
  expiresIn: 900, deviceCode: 'synthetic-private-device-value'
};

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'powerapps-auth-check-'));
  const clients = [];
  const progress = [];
  const authPath = require.resolve('../electron/services/auth');
  const originalLoad = Module._load;
  Module._load = function (name, parent, isMain) {
    if (name === 'electron') return {
      safeStorage: { isEncryptionAvailable: () => false },
      shell: { openExternal: async () => assert.fail('Device-code login must not start browser authorization') }
    };
    if (name === '@azure/msal-node') return {
      CryptoProvider: class {},
      PublicClientApplication: class {
        constructor(config) {
          this.config = config;
          this.accounts = config.auth.clientId === (process.env.AZURE_CLIENT_ID || '04b07795-8ddb-461a-bbee-02f9e1bf7b46') ? [account] : [];
          this.removed = [];
          this.requests = [];
          this.cache = {
            getAllAccounts: async () => this.accounts,
            removeAccount: async (item) => { this.removed.push(item); this.accounts = this.accounts.filter((a) => a.homeAccountId !== item.homeAccountId); }
          };
          this.deviceResult = async () => ({ account, accessToken: 'synthetic-access-token' });
          clients.push(this);
        }
        getTokenCache() { return this.cache; }
        async acquireTokenSilent() { throw new Error('Synthetic interaction required'); }
        async acquireTokenByDeviceCode(request) {
          this.requests.push(request);
          request.deviceCodeCallback(response);
          return this.deviceResult(request);
        }
      }
    };
    return originalLoad.call(this, name, parent, isMain);
  };
  delete require.cache[authPath];
  let auth;
  try { auth = require(authPath); } finally { Module._load = originalLoad; }
  auth.init(directory, (value) => progress.push(value));
  t.after(() => {
    auth.cancelSignIn();
    delete require.cache[authPath];
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert(path.basename(directory).startsWith('powerapps-auth-check-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const mcp = () => clients.filter(client => client.config.auth.clientId === (process.env.DATAVERSE_MCP_CLIENT_ID || '0c412cc3-0dd6-449b-987f-05b053db9457')).at(-1);
  return { auth, clients, mcp, progress, directory };
}

test('device-code account connection emits only public progress and saves the method', async (t) => {
  const { auth, clients, mcp, progress } = fixture(t);
  const result = await auth.addAccount({ method: 'deviceCode' });
  assert.equal(result.signInMethod, 'deviceCode');
  assert.deepEqual(clients[0].requests[0].scopes, [auth.GLOBAL_DISCO + '/.default']);
  assert.equal(clients[0].requests[0].timeout, 300);
  assert.deepEqual(progress.map((item) => item.stage), ['started', 'code', 'finished']);
  const shown = progress.find((item) => item.stage === 'code');
  assert.equal(shown.userCode, response.userCode);
  assert.equal(shown.verificationUri, response.verificationUri);
  assert(shown.expiresAt <= Date.now() + 300000);
  assert.equal(shown.deviceCode, undefined);
  assert.equal(shown.accessToken, undefined);
});

test('MCP uses the selected device-code method and the environment resource, including after restart', async (t) => {
  const { auth, clients, mcp, progress, directory } = fixture(t);
  await auth.setSignInMethod('deviceCode');
  assert.equal(await auth.getMcpToken(resource + '/'), 'synthetic-access-token');
  assert.equal(mcp().requests.length, 1);
  assert.deepEqual(mcp().requests[0].scopes, [resource + '/.default']);
  assert.equal(progress.find((item) => item.stage === 'code').loginHint, account.username);
  auth.init(directory);
  assert.equal((await auth.status()).account.signInMethod, 'deviceCode');
  assert.equal(await auth.getMcpToken(resource), 'synthetic-access-token');
  assert.equal(mcp().requests.length, 1);
});

test('changing an existing account to device code routes Dataverse and Graph prompts too', async (t) => {
  const { auth, clients, mcp } = fixture(t);
  await auth.setSignInMethod('deviceCode');
  await auth.getToken(resource);
  await auth.getGraphToken(['Files.ReadWrite']);
  assert.equal(clients[0].requests.length, 1);
  assert.deepEqual(clients[1].requests[0].scopes, ['Files.ReadWrite']);
});

test('a cached MCP token avoids another interactive prompt', async (t) => {
  const { auth, clients, mcp, progress } = fixture(t);
  mcp().accounts = [account];
  mcp().acquireTokenSilent = async () => ({ accessToken: 'synthetic-cached-token' });
  assert.equal(await auth.getMcpToken(resource), 'synthetic-cached-token');
  assert.equal(mcp().requests.length, 0);
  assert.equal(progress.length, 0);
});

test('device-code cancellation stops polling and permits a successful retry', async (t) => {
  const { auth, clients, mcp, progress } = fixture(t);
  let started;
  const pending = new Promise((resolve) => { started = resolve; });
  clients[0].deviceResult = async () => { started(); return new Promise(() => {}); };
  const first = auth.addAccount({ method: 'deviceCode' });
  await pending;
  auth.cancelSignIn();
  await assert.rejects(first, /cancelled/);
  assert.equal(clients[0].requests[0].cancel, true);
  clients[0].deviceResult = async () => ({ account, accessToken: 'synthetic-access-token' });
  assert.equal((await auth.addAccount({ method: 'deviceCode' })).homeAccountId, account.homeAccountId);
  assert.equal(progress.filter((item) => item.stage === 'finished').length, 2);
});

test('a newly introduced wrong account is removed from the MCP cache', async (t) => {
  const { auth, clients, mcp } = fixture(t);
  await auth.setSignInMethod('deviceCode');
  const wrong = { homeAccountId: 'other-account', username: 'other@example.com' };
  mcp().deviceResult = async () => ({ account: wrong, accessToken: 'synthetic-access-token' });
  await assert.rejects(auth.getMcpToken(resource), /different account/);
  assert.deepEqual(mcp().removed, [wrong]);
  assert.equal((await auth.status()).account.username, account.username);
});

test('a wrong account already present in the MCP cache is retained', async (t) => {
  const { auth, clients, mcp } = fixture(t);
  await auth.setSignInMethod('deviceCode');
  const wrong = { homeAccountId: 'other-account', username: 'other@example.com' };
  mcp().accounts = [wrong];
  mcp().deviceResult = async () => ({ account: wrong, accessToken: 'synthetic-access-token' });
  await assert.rejects(auth.getMcpToken(resource), /different account/);
  assert.deepEqual(mcp().removed, []);
});

test('device code preserves the administrator consent requirement', async (t) => {
  const { auth, clients, mcp } = fixture(t);
  await auth.setSignInMethod('deviceCode');
  mcp().deviceResult = async () => { throw Object.assign(new Error('Synthetic AADSTS65001'), { errorCode: 'consent_required' }); };
  await assert.rejects(auth.getMcpToken(resource), /administrator approval.*same approval/);
});

test('device-code expiry and rejection report actionable errors', async (t) => {
  const { auth, clients, mcp } = fixture(t);
  for (const [code, message] of [['expired_token', /expired/], ['authorization_declined', /declined or blocked/]]) {
    clients[0].deviceResult = async () => { throw Object.assign(new Error('Synthetic error'), { errorCode: code }); };
    await assert.rejects(auth.addAccount({ method: 'deviceCode' }), message);
  }
});

test('a null device-code result releases the flow', async (t) => {
  const { auth, clients, mcp, progress } = fixture(t);
  clients[0].deviceResult = async () => null;
  await assert.rejects(auth.addAccount({ method: 'deviceCode' }), /did not complete/);
  assert.equal(progress.at(-1).stage, 'finished');
});

test('device-code progress rejects an unsupported verification host', async (t) => {
  const { auth, clients, mcp, progress } = fixture(t);
  clients[0].acquireTokenByDeviceCode = async (request) => {
    request.deviceCodeCallback({ ...response, verificationUri: 'https://example.com/devicelogin' });
    assert.fail('Unsupported verification addresses must be rejected');
  };
  await assert.rejects(auth.addAccount({ method: 'deviceCode' }), /unsupported.*address/);
  assert.equal(progress.some((item) => item.stage === 'code'), false);
});
