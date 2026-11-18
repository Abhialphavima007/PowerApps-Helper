const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const http = require('node:http');
const path = require('node:path');

test('a cancelled account sign-in releases the flow and the next attempt succeeds', async () => {
  const originalLoad = Module._load;
  let holdUrl = true;
  let urlRequested;
  const urlStarted = new Promise((resolve) => { urlRequested = resolve; });
  Module._load = function (name, parent, isMain) {
    if (name === 'electron') return {
      shell: { openExternal: async (url) => {
        const redirect = new URL(url).searchParams.get('redirect_uri');
        await new Promise((resolve, reject) => {
          http.get(`${redirect}/?code=test`, (response) => { response.resume(); response.on('end', resolve); }).on('error', reject);
        });
      } },
      safeStorage: { isEncryptionAvailable: () => false }
    };
    if (name === '@azure/msal-node') return {
      CryptoProvider: class { async generatePkceCodes() { return { verifier: 'v', challenge: 'c' }; } },
      PublicClientApplication: class {
        async getAuthCodeUrl({ redirectUri }) {
          urlRequested();
          if (holdUrl) await new Promise((resolve) => { this.releaseUrl = resolve; });
          return `https://example.com/?redirect_uri=${encodeURIComponent(redirectUri)}`;
        }
        async acquireTokenByCode() { return { account: { homeAccountId: 'test', username: 'test@example.com', name: 'Test' } }; }
        getTokenCache() { return { getAllAccounts: async () => [] }; }
      }
    };
    return originalLoad.call(this, name, parent, isMain);
  };
  const auth = require('../electron/services/auth');
  Module._load = originalLoad;
  auth.init(path.join(process.cwd(), 'tests'));
  const first = auth.addAccount();
  await urlStarted;
  auth.cancelSignIn();
  await assert.rejects(first, /cancelled/);
  holdUrl = false;
  const second = await auth.addAccount();
  assert.equal(second.homeAccountId, 'test');
});
